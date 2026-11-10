"""Build the character data for the Unicode page.

Usage: python3 scripts/unicode-data.py UCD_DIR

UCD_DIR holds the Unicode Character Database files listed in FILES; any that are missing are downloaded
there first. Writes unicode/characters.txt: a header, then sections that each start with an @name line,
with tab-separated fields (codepoints in hex, sequences space-separated):

@scripts    code, name                       scripts used by @script
@blocks     first, last, name
@script     first, last, script code         ranges of codepoints, unlisted ones are Zzzz (Unknown)
@age        first, last, version             the Unicode version that added each codepoint
@ranges     first, last, category, name, flag
            characters whose names are made from their codepoints. The name is a prefix to add the hex
            codepoint to (ending in "-"); a prefix, "#" and a number, for characters numbered from that
            number, zero-padded to its width (Tangut components, Jurchen radicals); "hangul" for Hangul syllables (named from their jamo), or empty
            for private use and surrogates. The flag is "omit" for those left out of the searchable list
            at first (the names say nothing about the character), or empty.
@chars      codepoint, category, name, aliases
            every other assigned character. Controls have an empty name (their aliases name them).
            Aliases are type:ALIAS separated by "|", with types from NameAliases.txt (correction, control,
            alternate, figment, abbreviation).
@groups     emoji group, subgroup            the emoji groups referred to by number in @emoji
@emoji      sequence, name, group, version, tones, mixed tones
            every fully-qualified emoji from emoji-test.txt except skin-tone variants, with its CLDR short
            name, its group (row of @groups, from 0) and its emoji version. Tones, when it has skin-tone
            variants, is the sequence to use with one tone, with * for each tone modifier; mixed tones,
            when people in it can have different tones, is the sequence for that, with * for each
            person's tone modifier in turn (every combination of different tones exists).
@sequences  sequence, name                   Unicode named sequences (NamedSequences.txt)
@variants   sequence, description            standardized variation sequences (StandardizedVariants.txt),
                                             leaving out emoji and text presentation ones
"""

import re
import sys
import urllib.request
from collections import defaultdict
from itertools import product
from pathlib import Path

VERSION = "18.0.0"
UCD = f"https://www.unicode.org/Public/{VERSION}/ucd/"
FILES = {
    "UnicodeData.txt": UCD,
    "extracted/DerivedName.txt": UCD,
    "NameAliases.txt": UCD,
    "NamedSequences.txt": UCD,
    "StandardizedVariants.txt": UCD,
    "Scripts.txt": UCD,
    "Blocks.txt": UCD,
    "DerivedAge.txt": UCD,
    "PropertyValueAliases.txt": UCD,
    "emoji-test.txt": f"https://www.unicode.org/Public/{VERSION}/emoji/",
}
# Blocks of characters named by codepoint (or number) that are left out of the searchable list at first.
OMIT = re.compile(r"^(CJK UNIFIED IDEOGRAPH|CJK COMPATIBILITY IDEOGRAPH|TANGUT IDEOGRAPH|TANGUT COMPONENT|"
                  r"SMALL SEAL CHARACTER|JURCHEN CHARACTER|JURCHEN RADICAL|KHITAN SMALL SCRIPT CHARACTER|"
                  r"NUSHU CHARACTER|EGYPTIAN HIEROGLYPH)-")
TONES = range(0x1F3FB, 0x1F400)
OUT = Path(__file__).parent.parent / "unicode" / "characters.txt"

HEADER = f"""\
# name: Unicode characters
# description: Character names, aliases, scripts, blocks and ages, emoji and named sequences, from Unicode {VERSION[:-2]} (see scripts/unicode-data.py for the format).
# attribution: From the [Unicode Character Database](https://www.unicode.org/ucd/) and [emoji data](https://www.unicode.org/emoji/), © Unicode, Inc., under the [Unicode License v3](https://www.unicode.org/license.txt).
"""


def lines(name):
    """The data lines of a UCD file, split into stripped fields."""
    for line in (DIR / name).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            yield [f.strip() for f in line.split(";")]


def span(field):
    first, _, last = field.partition("..")
    return int(first, 16), int(last or first, 16)


def seq(field):
    return tuple(int(c, 16) for c in field.split())


def hexseq(cps):
    return " ".join(f"{c:04X}" for c in cps)


def merge(ranges):
    """Join adjacent (first, last, value) ranges with the same value."""
    out = []
    for first, last, value in sorted(ranges):
        if out and out[-1][1] + 1 == first and out[-1][2] == value:
            out[-1][1] = last
        else:
            out.append([first, last, value])
    return out


def download():
    for name, base in FILES.items():
        path = DIR / name
        if not path.exists():
            print(f"downloading {name}", file=sys.stderr)
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(base + name) as response:
                path.write_bytes(response.read())


def characters():
    """(@ranges rows, @chars rows)."""
    category = {}
    first = None
    for cp, name, gc, *_ in lines("UnicodeData.txt"):
        cp = int(cp, 16)
        if name.endswith(", First>"):
            first = cp
        elif name.endswith(", Last>"):
            for c in range(first, cp + 1):
                category[c] = gc
        else:
            category[cp] = gc

    aliases = defaultdict(list)
    for cp, alias, kind in lines("NameAliases.txt"):
        aliases[int(cp, 16)].append(f"{kind}:{alias}")

    names = {}
    ranges = []
    for field, name in lines("extracted/DerivedName.txt"):
        first, last = span(field)
        if name.endswith("-*"):
            prefix = name[:-1]
            gcs = {category[c] for c in range(first, last + 1)}
            assert len(gcs) == 1, field
            ranges.append([first, last, gcs.pop(), prefix, "omit" if OMIT.match(prefix) else ""])
        else:
            assert first == last, field
            names[first] = name

    # Hangul syllables are named from their jamo: the page makes the names, as for the ranges above.
    hangul = [c for c, n in names.items() if n.startswith("HANGUL SYLLABLE ")]
    assert hangul == list(range(0xAC00, 0xD7A4)), "Hangul syllables"
    for c in hangul:
        del names[c]
    ranges.append([0xAC00, 0xD7A3, "Lo", "hangul", ""])

    # Tangut components and Jurchen radicals are numbered rather than named by codepoint: make them a
    # range by checking that the numbers follow the codepoints.
    for prefix in ("TANGUT COMPONENT-", "JURCHEN RADICAL-"):
        run = sorted(c for c, n in names.items() if n.startswith(prefix))
        numbers = {c: names.pop(c)[len(prefix):] for c in run}
        assert [int(numbers[c]) for c in run] == list(range(1, len(run) + 1)), prefix
        for first, last, gc in merge((c, c, category[c]) for c in run):
            ranges.append([first, last, gc, f"{prefix}#{numbers[first]}", "omit"])

    # Private use and surrogates: no names.
    named = set(names) | {c for r in ranges for c in range(r[0], r[1] + 1)}
    for gc in ("Co", "Cs"):
        for first, last, _ in merge((c, c, 0) for c, g in category.items() if g == gc):
            ranges.append([first, last, gc, "", ""])
            named.update(range(first, last + 1))

    chars = []
    for c, gc in sorted(category.items()):
        if c in named and c not in names:
            continue
        name = names.get(c, "")
        assert name or gc == "Cc", f"{c:04X} has no name"
        chars.append((c, gc, name, "|".join(aliases[c])))
    assert set(aliases) <= {c for c, *_ in chars}, "aliases for unlisted characters"
    return sorted(ranges), chars


def scripts():
    codes = {long: short for kind, short, long, *_ in lines("PropertyValueAliases.txt") if kind == "sc"}
    ranges = merge((*span(field), codes[script]) for field, script in lines("Scripts.txt"))
    used = {r[2] for r in ranges}
    return sorted((short, long.replace("_", " ")) for long, short in codes.items() if short in used), ranges




def untoned(name):
    """The name without its skin tones: "person: medium skin tone, blond hair" -> "person: blond hair"."""
    base, _, details = name.partition(": ")
    details = [d for d in details.split(", ") if d and not d.endswith(" skin tone")]
    return ": ".join([base, ", ".join(details)]) if details else base


def emoji():
    """(@groups rows, @emoji rows)."""
    groups = []
    rows = {}  # sequence -> [name, group, version] (+ tones, mixed tones)
    toned = defaultdict(list)  # base name -> toned sequences
    for line in (DIR / "emoji-test.txt").read_text(encoding="utf-8").splitlines():
        if line.startswith("# group: "):
            group = line[9:]
        elif line.startswith("# subgroup: "):
            groups.append((group, line[12:]))
        elif "; fully-qualified" in line:
            cps = seq(line.split(";")[0])
            version, name = re.match(r".*# \S+ E(\d+\.\d+) (.*)$", line).groups()
            if any(c in TONES for c in cps) and len(cps) > 1:
                toned[untoned(name)].append(cps)
            else:
                rows[cps] = [name, len(groups) - 1, version]

    # Skin-tone variants go with the emoji of the same name without tones, or failing that (mixed tones in
    # "kiss: person, person, light skin tone, dark skin tone") with the one named before the colon.
    by_name = {row[0]: cps for cps, row in rows.items()}
    by_base = defaultdict(list)
    for name, variants in toned.items():
        by_base[by_name.get(name) or by_name[name.split(":")[0]]].extend(variants)
    for base, variants in by_base.items():
        # one template for a single tone throughout, and one (possibly different) for mixed tones
        templates = defaultdict(set)
        for v in variants:
            tones = [c for c in v if c in TONES]
            templates[len(set(tones)) > 1].add((tuple(-1 if c in TONES else c for c in v), tuple(tones)))
        row = rows[base]
        row.extend(["", ""])
        for mixed in (False, True):
            if not templates[mixed]:
                continue
            (template,) = {t for t, _ in templates[mixed]}
            slots = template.count(-1)
            fills = {f for _, f in templates[mixed]}
            expected = {f for f in product(TONES, repeat=slots) if (len(set(f)) > 1) == mixed}
            assert fills == expected, f"{base}: tone combinations"
            row[3 + mixed] = " ".join("*" if c < 0 else f"{c:04X}" for c in template)
    for row in rows.values():
        row.extend([""] * (5 - len(row)))
    return groups, rows


def main():
    download()
    ranges, chars = characters()
    script_names, script_ranges = scripts()
    blocks = [span(f) + (name,) for f, name in lines("Blocks.txt")]
    ages = merge((*span(f), age) for f, age in lines("DerivedAge.txt"))
    groups, emoji_rows = emoji()
    sequences = sorted((seq(s), name) for name, s in lines("NamedSequences.txt"))
    variants = sorted((seq(s), desc) for s, desc, *_ in lines("StandardizedVariants.txt")
                      if desc not in ("text style", "emoji style"))

    # every character in a sequence should be listed (or in a range)
    known = {c for c, *_ in chars} | {c for r in ranges for c in range(r[0], r[1] + 1)}
    for cps in [*emoji_rows, *(s for s, _ in sequences), *(s for s, _ in variants)]:
        assert set(cps) <= known, hexseq(cps)

    out = [HEADER]

    def section(name, rows):
        out.append(f"\n@{name}\n")
        out.extend("\t".join(map(str, row)).rstrip("\t") + "\n" for row in rows)

    section("scripts", script_names)
    section("blocks", ((f"{a:04X}", f"{b:04X}", n) for a, b, n in blocks))
    section("script", ((f"{a:04X}", f"{b:04X}", s) for a, b, s in script_ranges))
    section("age", ((f"{a:04X}", f"{b:04X}", v) for a, b, v in ages))
    section("ranges", ((f"{a:04X}", f"{b:04X}", *rest) for a, b, *rest in ranges))
    section("chars", ((f"{c:04X}", gc, name, al) for c, gc, name, al in chars))
    section("groups", groups)
    section("emoji", ((hexseq(cps), *row) for cps, row in emoji_rows.items()))
    section("sequences", ((hexseq(s), n) for s, n in sequences))
    section("variants", ((hexseq(s), d) for s, d in variants))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("".join(out), encoding="utf-8")

    searchable = len(chars) + sum(r[1] - r[0] + 1 for r in ranges if r[3] and not r[4])
    omitted = sum(r[1] - r[0] + 1 for r in ranges if r[4])
    print(f"{len(chars)} listed characters, {searchable} searchable with Hangul, {omitted} omitted; "
          f"{len(emoji_rows)} emoji ({sum(1 for r in emoji_rows.values() if r[3])} with tones, {sum(1 for r in emoji_rows.values() if r[4])} mixed), "
          f"{len(sequences)} named sequences, {len(variants)} variants; {OUT.stat().st_size:,} bytes",
          file=sys.stderr)


if __name__ == "__main__":
    DIR = Path(sys.argv[1])
    main()
