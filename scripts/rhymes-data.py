"""Build the pronunciation data for the Rhymes page.

Usage: uv run --with wordfreq python scripts/rhymes-data.py KAIKKI CMUDICT [REPORT_DIR]

KAIKKI is the English Wiktionary extract from https://kaikki.org/dictionary/English/
(kaikki.org-dictionary-English.jsonl.gz, about 530 MB), and CMUDICT is cmudict.dict from
https://github.com/cmusphinx/cmudict. Writes rhymes/pronunciations.txt, and if REPORT_DIR is given, lists
of what was left out there for review.

Everything is General American, in CMUdict's phoneme set (see rhymes-data/phonemes.py). Sources:
- C: CMUdict (all of it: names, acronyms and clippings included).
- U: Wiktionary IPA tagged General American or US.
- W: Wiktionary IPA with no accent tag (or tagged Canada) that shows no sign of being British.
- E: Wiktionary enPR (untagged or American).
- B: Wiktionary IPA for British (RP/UK) or British-looking pronunciations, converted to General American,
  only for words with no American pronunciation from any other source.
Pronunciations tagged obsolete, archaic or dialectal, or as having an accent merger, or with a note that
names another accent, are left out.
"""

import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from functools import cache
from pathlib import Path

from wordfreq import zipf_frequency

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "rhymes-data"))
from phonemes import (Unparsed, encode, from_arpabet, from_enpr, from_ipa, guess_th, ipa_bodies,  # noqa: E402
                      is_vowel, stress_pattern, uk_to_us)

KAIKKI, CMUDICT = sys.argv[1:3]
REPORT = Path(sys.argv[3]) if len(sys.argv) > 3 else None
OUT = HERE.parent / "rhymes" / "pronunciations.txt"
WORDLISTS = HERE.parent / "wordlists"

# --- Classifying Wiktionary pronunciations

US_TAGS = {"General-American", "US"}
UK_TAGS = {"Received-Pronunciation", "UK", "British", "England", "Southern-England", "Standard-Southern-British"}
DROP_TAGS = {"obsolete", "archaic", "dialectal"}
NEUTRAL_TAGS = {"rare", "dated", "also", "unstressed", "stressed", "colloquial", "uncommon", "sometimes",
                "nonstandard", "proscribed", "phoneme", "letter", "name", "standard", "Standard", "informal",
                "emphatic", "common", "casual", "weak", "strong", "careful", "rhotic"}
NOT_WORDS = {"prefix", "suffix", "infix", "interfix", "circumfix", "affix", "symbol", "character", "punct"}
# A note is fine if every part of it is: General American features, or not about accent at all
OK_NOTE = re.compile(
    r"General American|US|Canada|rhotic|(without )?t-flapping|without /æ/ raising( before /ɡ/)?|"
    r"weak vowel (merger|distinction)|(weak|strong|stressed|unstressed) form|(when )?(un)?stressed|"
    r"in fast speech|some speakers|spelling pronunciation|hyperforeign|anglicized|"
    r"(non-|no )yod-coalescence|yod-dropping|(accents with )?foot–strut split|without the trap–bath split|"
    r"(Mary–marry–merry|horse–hoarse|wine–whine|father–bother) merger|without the (?!foot)[^ ]+ (merger|split)|"
    r"emphatic|careful|casual|common|rare|more common|less common|uncommon|also|sometimes|traditional|older|newer")
RHOTIC = re.compile("[ɹrɾɚɝɻ˞]")
# ɑː only looks British in BATH words (dance, path): elsewhere it's PALM (spa), and a lost r is caught
# by comparing with the spelling instead
UK_CLUE = re.compile("ɒ|əʊ|ɛə|ɪə|ʊə|ɐ|ɑː(?=[fθs]|n[stdʃ]|mp)")
US_CLUE = re.compile("ɚ|ɝ|oʊ|ɹ̩|˞")


def non_rhotic(word, ipa):
    """Whether a transcription has fewer r sounds after vowels than the spelling has r's after vowels
    (not counting r's before a vowel letter, which non-rhotic accents keep)."""
    spelt = len(re.findall("r+(?![aeiouy])", word.lower()))
    t = re.sub("[()ːˑ.ˈˌ̯ ]", "", ipa)
    heard = len(re.findall("[ɚɝ˞]", t)) + len(re.findall("[ɹr](?![aeiouyæɑɒɔəɛɪʊʌɜɐøœɵʉɨ])", t))
    return heard < spelt


def note_ok(note):
    return not note or all(OK_NOTE.fullmatch(part.strip()) for part in re.split("[,;]", note))


def classify(word, sound, kind):
    """One of U, W, E, uk (a candidate for conversion), or a reason for leaving it out."""
    tags = set(sound.get("tags", []))
    if tags & DROP_TAGS or {"Early", "Modern"} <= tags:  # Early Modern English
        return "dropped: obsolete/archaic/dialectal"
    tags -= {"Early", "Modern"}
    if any("merger" in t for t in tags):
        return "dropped: merger"
    if not note_ok(sound.get("note", "")):
        return "dropped: note"
    core = tags - NEUTRAL_TAGS
    if core & US_TAGS:
        return "E" if kind == "enpr" else "U"
    if core == {"Canada"}:
        return "E" if kind == "enpr" else "W"
    if core:
        return "uk" if core <= UK_TAGS and kind == "ipa" else "dropped: other accent"
    if kind == "enpr":
        return "E"
    ipa = sound["ipa"]
    uk = bool(UK_CLUE.search(ipa)) or non_rhotic(word, ipa)
    us = bool(US_CLUE.search(ipa))
    return "uk" if uk and not us else "mixed" if uk else "W"


def mixed_to_us(body):
    """An untagged transcription with both American and British features: treat the British ones as
    slips."""
    return body.replace("ɒ", "ɑ").replace("əʊ", "oʊ").replace("ɜː", "ɝ").replace("ː", "")


# --- Read Wiktionary

stats = Counter()
unparsed = []  # (word, source, transcription, reason)
wikt = defaultdict(lambda: defaultdict(set))  # word -> pron -> sources
uk_bodies = defaultdict(list)  # word -> RP transcriptions
enprs = defaultdict(list)  # word -> enPR strings
unstressed = []  # (word, source, transcription) with no stress marks, to try again with more to go on
notes = Counter()

with gzip.open(KAIKKI, "rt", encoding="utf-8") as f:
    for line in f:
        e = json.loads(line)
        if e.get("lang_code") != "en" or e.get("pos") in NOT_WORDS:
            continue
        word = e["word"]
        if word.startswith("-") or word.endswith("-"):
            continue
        seen = set()
        for sound in e.get("sounds", []):
            kind = "ipa" if "ipa" in sound else "enpr" if "enpr" in sound else None
            if kind is None or (kind, sound[kind], tuple(sound.get("tags", []))) in seen:
                continue
            seen.add((kind, sound[kind], tuple(sound.get("tags", []))))
            c = classify(word, sound, kind)
            stats[f"wiktionary {kind}: {c}"] += 1
            if c == "dropped: note":
                notes[sound["note"]] += 1
            if c.startswith("dropped"):
                continue
            if kind == "enpr":
                enprs[word].append(sound["enpr"])
                continue
            bodies = ipa_bodies(sound["ipa"])
            if not bodies:
                stats["wiktionary ipa: phonetic only"] += 1
            for body in bodies:
                if c == "uk":
                    uk_bodies[word].append(body)
                    continue
                body = mixed_to_us(body) if c == "mixed" else body
                try:
                    for p in from_ipa(body, word):
                        wikt[word][p].add("W" if c == "mixed" else c)
                except Unparsed as x:
                    if str(x) == "no stress":
                        unstressed.append((word, "W" if c == "mixed" else c, body))
                    else:
                        unparsed.append((word, c, body, str(x)))


def loose(pron):
    """A key that ignores the differences the page will ignore when matching: unstressed ɪ/ə/ʊ, and
    secondary stress vs none."""
    return tuple("AH0" if p in ("IH0", "UH0") else p[:-1] + "0" if is_vowel(p) and p[-1] == "2" else p for p in pron)


# --- Read CMUdict

cmu = defaultdict(list)
for line in open(CMUDICT, encoding="utf-8"):
    w, p = line.split(" ", 1)
    w = re.sub(r"\(\d+\)$", "", w)
    pron = from_arpabet(p.split("#")[0].strip())
    if pron not in cmu[w]:
        cmu[w].append(pron)


# British pronunciations converted to General American, or None if they can't be
@cache
def converted_uk(word, body):
    try:
        return from_ipa(uk_to_us(body, word), word)
    except Unparsed:
        return None


# --- Transcriptions with no stress marks: if the stress can't be guessed from the vowels, use the
# stress pattern of other pronunciations of the word (from CMUdict, Wiktionary, or British ones)

def patterns(word):
    prons = list(cmu.get(word.lower(), []))
    for w in wikt_forms.get(word.lower(), []):
        prons += wikt.get(w, {})
    for body in uk_bodies.get(word, []):
        prons += converted_uk(word, body) or []
    return [stress_pattern(p) for p in prons]


wikt_forms = defaultdict(list)
for w in list(wikt):
    wikt_forms[w.lower()].append(w)
for word, source, body in unstressed:
    try:
        for p in from_ipa(body, word, patterns(word)):
            wikt[word][p].add(source)
        stats["stress from other pronunciations"] += 1
    except Unparsed as x:
        unparsed.append((word, source, body, str(x)))

# enPR: pick the reading of each "th" that matches the word's IPA, or else guess from the spelling
for word, items in enprs.items():
    known = {loose(p) for p in wikt.get(word, {})}
    for s in items:
        try:
            readings = from_enpr(s)
            converted = [(r, from_ipa(r, word, patterns(word))) for r in readings]
            match = [ps for r, ps in converted if any(loose(p) in known for p in ps)]
            ps = match[0] if match else dict(converted)[guess_th(word, readings)]
            for p in ps:
                wikt[word][p].add("E")
        except Unparsed as x:
            unparsed.append((word, "E", s, str(x)))

# British-only words: convert, if nothing else gives an American pronunciation
uk_failed = []
for word, bodies in uk_bodies.items():
    if wikt.get(word) or word.lower() in cmu:
        continue
    for body in bodies:
        try:
            for p in from_ipa(uk_to_us(body, word), word, patterns(word)):
                wikt[word][p].add("B")
        except Unparsed as x:
            uk_failed.append((word, body, str(x)))

# --- Capitalisation: where CMUdict's (lowercase) words go

list_forms = {}  # lowercase -> forms, most frequent first (English first, then the other lists)
for path in [WORDLISTS / "english.txt"] + sorted(WORDLISTS.glob("*.txt")):
    for line in open(path, encoding="utf-8"):
        w = line.rstrip("\n")
        if w and not w.startswith("#"):
            forms = list_forms.setdefault(w.lower(), [])
            if w not in forms:
                forms.append(w)
wikt_forms = defaultdict(list)
for w in wikt:
    if wikt[w]:
        wikt_forms[w.lower()].append(w)

entries = defaultdict(lambda: defaultdict(set))  # form -> pron -> sources
for w, prons in wikt.items():
    for p, srcs in prons.items():
        entries[w][p] |= srcs
for lw, prons in cmu.items():
    forms = wikt_forms.get(lw, [])
    for p in prons:
        matching = [w for w in forms if any(loose(q) == loose(p) for q in wikt[w])]
        if not matching:
            candidates = forms + [f for f in list_forms.get(lw, []) if f not in forms]
            if lw in candidates or not candidates:
                matching = [lw]
            else:
                ranked = [f for f in list_forms.get(lw, []) if f in candidates]
                matching = [ranked[0] if ranked else candidates[0]]
        for w in matching:
            entries[w][p].add("C")

# --- Merge pronunciations that differ only in secondary stress vs none, preferring CMUdict's

ORDER = "CUWEB"
rows = []
for w, prons in entries.items():
    groups = defaultdict(list)
    for p, srcs in prons.items():
        groups[tuple(x[:-1] + "0" if is_vowel(x) and x[-1] == "2" else x for x in p)].append((p, srcs))
    for items in groups.values():
        items.sort(key=lambda t: (min(ORDER.index(s) for s in t[1]), -sum(x.endswith("2") for x in t[0])))
        srcs = set().union(*(s for _, s in items))
        rows.append((w, encode(items[0][0]), "".join(s for s in ORDER if s in srcs)))


@cache
def zipf(w):
    return round(10 * zipf_frequency(w, "en"))


rows.sort(key=lambda r: (r[0].lower(), r[0], r[1]))
OUT.parent.mkdir(exist_ok=True)
with open(OUT, "w", encoding="utf-8") as o:
    print("""# name: Pronunciations
# description: General American pronunciations: word, pronunciation, sources, wordfreq Zipf frequency × 10.
# attribution: From the [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict) (BSD licence) and [Wiktionary](https://en.wiktionary.org/) (via [Kaikki](https://kaikki.org/)), with frequencies from [wordfreq](https://github.com/rspeer/wordfreq). Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), like content from Wiktionary and wordfreq's data.
# phonemes: vowels A ɑ, a æ, V ʌ/ə, O ɔ, W aʊ, Y aɪ, E ɛ, R ɝ/ɚ, e eɪ, I ɪ, i i, o oʊ, Q ɔɪ, U ʊ, u u (followed by 1 for primary stress, 2 for secondary); consonants b C=tʃ d D=ð f g h J=dʒ k l m n N=ŋ p r s S=ʃ t T=θ v w j z Z=ʒ; space between words
# sources: C CMUdict, U Wiktionary (US), W Wiktionary (untagged), E Wiktionary enPR, B Wiktionary (British, converted)
""", file=o)
    for w, p, s in rows:
        print(f"{w}\t{p}\t{s}\t{zipf(w)}", file=o)

# --- Report

stats["output words"] = len(entries)
stats["output pronunciations"] = len(rows)
stats["output multiword"] = sum(1 for w in entries if " " in w)
stats["unparsed"] = len(unparsed)
stats["British conversion failed"] = len(uk_failed)
for r in rows:
    for s in r[2]:
        stats[f"rows with source {s}"] += 1
    if len(r[2]) == 1:
        stats[f"rows only from {r[2]}"] += 1
counts = Counter(r[0] for r in rows)
stats["words with 1 pronunciation"] = sum(1 for n in counts.values() if n == 1)
stats["words with 2 pronunciations"] = sum(1 for n in counts.values() if n == 2)
stats["words with 3+ pronunciations"] = sum(1 for n in counts.values() if n >= 3)
for k in sorted(stats):
    print(f"{stats[k]:8}  {k}", file=sys.stderr)
if REPORT:
    REPORT.mkdir(parents=True, exist_ok=True)
    with open(REPORT / "unparsed.tsv", "w", encoding="utf-8") as o:
        for r in unparsed:
            print("\t".join(r), file=o)
    with open(REPORT / "uk-failed.tsv", "w", encoding="utf-8") as o:
        for r in uk_failed:
            print("\t".join(r), file=o)
    with open(REPORT / "notes-dropped.tsv", "w", encoding="utf-8") as o:
        for n, k in notes.most_common():
            print(f"{k}\t{n}", file=o)
    reasons = Counter(re.sub("symbol .*", "symbol", r[3]) for r in unparsed)
    symbols = Counter(r[3] for r in unparsed if r[3].startswith("symbol"))
    with open(REPORT / "summary.txt", "w", encoding="utf-8") as o:
        print("unparsed by reason:", reasons.most_common(), file=o)
        print("unparsed symbols:", symbols.most_common(40), file=o)
        print("British conversion failures:", Counter(r[2] for r in uk_failed).most_common(), file=o)
