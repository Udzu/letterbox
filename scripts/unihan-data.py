"""Build the CJK ideograph data for the Unicode page: readings, radicals and strokes, from Unihan.

Usage: python3 scripts/unihan-data.py UNIHAN_DIR

UNIHAN_DIR holds the files from Unihan.zip, which is downloaded and unpacked there first if they're
missing, and CJKRadicals.txt and EquivalentUnifiedIdeograph.txt from the UCD (also downloaded if missing).
Writes unicode/readings.txt: a header of "# key: value" lines, then a line for each ideograph with a
reading or a radical, in codepoint order, with tab-separated fields (trailing empty ones left out):

    codepoint      in hex, as the difference from the previous line's (the first from 0)
    Mandarin       kMandarin: pinyin with tone marks, the usual reading first
    Cantonese      kCantonese: Jyutping with tone numbers
    Japanese       kJapanese: on readings in katakana, then kun readings in hiragana
    Korean         kHangul, without its source letters
    Vietnamese     kVietnamese
    radical        kRSUnicode (the first, if several): the radical number, ' for a simplified form of
                   it, ., and the strokes beyond the radical
    strokes        kTotalStrokes (the first, if several)
    common         letters for the lists of common characters it's in, used to rank search results:
                   T China's general standard characters (kTGHZ2013), I the International Ideograph
                   Core (kIICore), J Japan's jōyō kanji, M jinmeiyō kanji, G Hong Kong school grade
                   lists (kGradeLevel), E Korea's basic education hanja, K KS X 1001 hanja (from kHangul)
    frequency      how often it appears in a sample of modern Chinese (the counts in kHanyuPinlu, added
                   up), also used to rank results, as a rough guide to how common it is in each language
    definition     kDefinition: its meanings in English, separated by commas and semicolons

Readings within a field are separated by spaces. Then two sections, each starting with an @name line:

@radicals   radical, character, ideograph
            the 214 Kangxi radicals and the simplified forms of some (numbered like 120'), from
            CJKRadicals.txt: the radical character (in the Kangxi Radicals or CJK Radicals Supplement
            block, empty for a few simplified forms that have none) and the ideograph it's equivalent
            to, in hex
@forms      character, radical
            every character that stands for a radical, so a search can name a radical by it: the
            characters in @radicals, the other radical forms in EquivalentUnifiedIdeograph.txt (like ⺡
            for 氵), and ideographs that are a radical with no strokes added (like 氵 itself)
"""

import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

VERSION = "18.0.0"
URL = f"https://www.unicode.org/Public/{VERSION}/ucd/Unihan.zip"
UCD_FILES = ["CJKRadicals.txt", "EquivalentUnifiedIdeograph.txt"]
FILES = ["Unihan_Readings.txt", "Unihan_IRGSources.txt", "Unihan_OtherMappings.txt", "Unihan_DictionaryLikeData.txt"]
READINGS = ["kMandarin", "kCantonese", "kJapanese", "kHangul", "kVietnamese"]
OUT = Path(__file__).parent.parent / "unicode" / "readings.txt"

HEADER = f"""\
# name: CJK ideograph readings and definitions
# description: Mandarin, Cantonese, Japanese, Korean and Vietnamese readings, English definitions, radicals and stroke counts of CJK ideographs, from Unihan in Unicode {VERSION[:-2]} (see scripts/unihan-data.py for the format).
# attribution: From the [Unihan database](https://www.unicode.org/charts/unihan.html), © Unicode, Inc., under the [Unicode License v3](https://www.unicode.org/license.txt).
"""


def download():
    for name in UCD_FILES:
        if not (DIR / name).exists():
            print(f"downloading {name}", file=sys.stderr)
            with urllib.request.urlopen(f"https://www.unicode.org/Public/{VERSION}/ucd/{name}") as response:
                (DIR / name).write_bytes(response.read())
    if all((DIR / name).exists() for name in FILES):
        return
    archive = DIR / "Unihan.zip"
    if not archive.exists():
        print(f"downloading {URL}", file=sys.stderr)
        DIR.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(URL) as response:
            archive.write_bytes(response.read())
    with zipfile.ZipFile(archive) as z:
        z.extractall(DIR)


def fields():
    """{codepoint: {field: value}} for every Unihan field."""
    data = defaultdict(dict)
    for name in FILES:
        for line in (DIR / name).read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            cp, field, value = line.split("\t", 2)
            data[int(cp[2:], 16)][field] = value
    return data


def ucd(name):
    """The data lines of a UCD file, split into stripped fields."""
    for line in (DIR / name).read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            yield [f.strip() for f in line.split(";")]


def radicals(data):
    """(@radicals rows, @forms rows)."""
    rows = [(radical, char, ideograph) for radical, char, ideograph in ucd("CJKRadicals.txt")]
    forms = {}
    for radical, char, ideograph in rows:
        for cp in (char, ideograph):
            if cp:  # (a few simplified forms have no radical character)
                forms.setdefault(int(cp, 16), radical)

    def plain(cp):
        """the radical an ideograph is with no strokes added, or None"""
        for rs in data.get(cp, {}).get("kRSUnicode", "").split():
            radical, _, extra = rs.partition(".")
            if extra == "0":
                return radical
        return None

    for span, ideograph in ucd("EquivalentUnifiedIdeograph.txt"):
        first, _, last = span.partition("..")
        radical = plain(int(ideograph, 16))
        if radical is None:
            # (a form filed under another radical first, like 卤 for 鹵: use its first radical)
            radical = data.get(int(ideograph, 16), {}).get("kRSUnicode", "").split(".")[0]
        for cp in range(int(first, 16), int(last or first, 16) + 1):
            if radical:
                forms.setdefault(cp, radical)
    for cp in data:
        radical = plain(cp)
        if radical:
            forms.setdefault(cp, radical)
    return rows, sorted(forms.items())


def main():
    download()
    data = fields()
    rows = []
    previous = 0
    counts = defaultdict(int)
    for cp in sorted(data):
        f = data[cp]
        readings = [f.get(k, "") for k in READINGS]
        # kHangul readings end in :source letters (0/1 = KS X 1001/1002, E = education, N = not in either)
        hangul = f.get("kHangul", "").split()
        readings[3] = " ".join(h.split(":")[0] for h in hangul)
        sources = "".join(h.split(":")[1] for h in hangul if ":" in h)
        radical = f.get("kRSUnicode", "").split(" ")[0]
        strokes = f.get("kTotalStrokes", "").split(" ")[0]
        if not any(readings) and not radical:
            continue
        common = "".join(letter for letter, present in [
            ("T", "kTGHZ2013" in f), ("I", "kIICore" in f), ("J", "kJoyoKanji" in f), ("M", "kJinmeiyoKanji" in f),
            ("G", "kGradeLevel" in f), ("E", "E" in sources), ("K", "0" in sources),
        ] if present)
        frequency = sum(int(r.split("(")[1].rstrip(")")) for r in f.get("kHanyuPinlu", "").split())
        for k, r in zip(READINGS, readings):
            counts[k] += bool(r)
        rows.append("\t".join([f"{cp - previous:x}", *readings, radical, strokes, common, str(frequency or ""), f.get("kDefinition", "")]).rstrip("\t"))
        previous = cp
    OUT.parent.mkdir(exist_ok=True)
    count = len(rows)
    radical_rows, forms = radicals(data)
    rows.append("@radicals")
    rows += ["\t".join(row) for row in radical_rows]
    rows.append("@forms")
    rows += [f"{cp:X}\t{radical}" for cp, radical in forms]
    OUT.write_text(HEADER + "\n".join(rows) + "\n", encoding="utf-8")
    print(f"{count} ideographs, {len(radical_rows)} radicals, {len(forms)} radical forms; " + ", ".join(f"{counts[k]} {k}" for k in READINGS) + f"; {OUT.stat().st_size:,} bytes",
          file=sys.stderr)


if __name__ == "__main__":
    DIR = Path(sys.argv[1])
    main()
