"""Build the English, Common English and English phrases word lists.

Usage: python3 scripts/english-wordlists.py KAIKKI ENABLE

KAIKKI is the English Wiktionary extract from https://kaikki.org/dictionary/English/
(kaikki.org-dictionary-English.jsonl.gz, about 530 MB), and ENABLE is enable1.txt from
https://github.com/dolph/dictionary. Needs the wordfreq package (pip install wordfreq). Writes
wordlists/english.txt, wordlists/common-english.txt and wordlists/english-phrases.txt; run
npm run build afterwards to update the Wordlists page.

- English: single words from Wiktionary that wordfreq has seen, plus all of ENABLE, plus common
  proper nouns (capitalised) and contractions, most frequent first.
- Common English: the words from English with a wordfreq Zipf frequency of 3 or more (about once
  per million words), without the hand-reviewed exclusions in english-wordlists/excluded.txt.
- English phrases: multi-word and hyphenated Wiktionary entries with a definition of their own,
  alphabetical.

Wiktionary entries are left out if all their senses are misspellings, abbreviations, initialisms,
acronyms, or misspelt, proscribed or obsolete spellings.
"""

import gzip
import json
import re
import sys
from functools import cache
from pathlib import Path

from wordfreq import zipf_frequency

KAIKKI, ENABLE_FILE = sys.argv[1:3]
HERE = Path(__file__).parent
OUT = HERE.parent / "wordlists"

ENABLE = {line.strip() for line in open(ENABLE_FILE) if line.strip()}
EXCLUDED = {line.strip() for line in open(HERE / "english-wordlists" / "excluded.txt") if line.strip() and not line.startswith("#")}


@cache
def zipf(word):
    return zipf_frequency(word, "en")


# --- Wiktionary entries: word -> [(part of speech, [sense tags], {categories})]. A sense that's a form
# of another entry (an inflection or alternative spelling) is also tagged "of-abbreviation" if that entry
# is an abbreviation, so that hrs (plural of hr) and tv (alternative form of TV) count as abbreviations.

NOT_WORDS = {"prefix", "suffix", "infix", "interfix", "circumfix", "symbol", "character", "punct"}
ABBREVIATION = {"abbreviation", "initialism", "acronym"}
entries = {}
targets = []  # (word, entry index, sense index, words it's a form of)
with gzip.open(KAIKKI, "rt", encoding="utf-8") as f:
    for line in f:
        e = json.loads(line)
        if e.get("lang_code") != "en" or e.get("pos") in NOT_WORDS:
            continue
        tags = [frozenset(s.get("tags", [])) for s in e.get("senses", [])]
        cats = {c.get("name") if isinstance(c, dict) else c for s in e.get("senses", []) for c in s.get("categories", [])}
        entries.setdefault(e["word"], []).append((e.get("pos"), tags, cats))
        for i, s in enumerate(e.get("senses", [])):
            of = [x["word"] for x in s.get("alt_of", []) + s.get("form_of", []) if x.get("word")]
            if of:
                targets.append((e["word"], len(entries[e["word"]]) - 1, i, of))


def abbreviation(word):
    """Whether a word is an abbreviation: written with full stops or all in capitals, or only ever
    tagged as an abbreviation (other than a contraction)."""
    if "." in word or (len(word) > 1 and word.isupper()):
        return True
    tags = [t for pos, ts, cats in entries.get(word, []) for t in ts]
    return bool(tags) and all((t & ABBREVIATION or "of-abbreviation" in t) and "contraction" not in t for t in tags)


for _ in range(2):  # twice, for forms of forms: ceos is the plural of ceo, an alternative form of CEO
    for word, entry, sense, of in targets:
        if any(abbreviation(w) for w in of):
            pos, tags, cats = entries[word][entry]
            tags[sense] = tags[sense] | {"of-abbreviation"}


def bad(tags):
    """A sense that doesn't make its word worth listing."""
    if tags & {"misspelling", "initialism", "acronym", "of-abbreviation"}:
        return True
    if "abbreviation" in tags and "contraction" not in tags:
        return True
    return "alt-of" in tags and bool(tags & {"misspelling", "proscribed", "obsolete"})


def senses(word):
    return [t for pos, tags, cats in entries.get(word, []) for t in tags] or [frozenset()]


def categories(word):
    return {c for pos, tags, cats in entries.get(word, []) for c in cats}


SHAPE = re.compile(r"^[^\W\d_]+(?:['\- .][^\W\d_]+)*\.?$")  # letters, joined by ' - space or .


def listable(word):
    return bool(SHAPE.match(word)) and not all(bad(t) for t in senses(word))


# --- Single words

LOWER = re.compile(r"^[a-zà-öø-ÿ]+$")  # a-z and Western European accents
CAPITAL = re.compile(r"^[A-Z][a-z]+$")

# Capitalised words are kept if they're in one of these categories...
CATEGORIES = re.compile(
    r"^(Days of the week|Months|Holidays|Countries|Countries in .*|Constituent countries.*|Continents.*|Oceans|Seas"
    r"|States of the United States|Provinces and territories of Canada|States and territories of Australia"
    r"|National capitals|Capital cities|.*demonyms|Languages|Ethnonyms|Nationalities"
    r"|Religion|Christianity|Islam|Judaism|Hinduism|Buddhism|God|Books of the Bible|Planets of the Solar System"
    r"|English (male |female |unisex )?given names|English diminutives of (male|female) given names"
    r"|English (genericized )?trademarks)$")
# ...or are major cities...
CITIES = re.compile(r"^Cities in (England|the United Kingdom|the United States|Canada|Australia|Scotland|Ireland)$")
# ...but if the lowercase word is a standard (ENABLE) word, wordfreq can't tell the two apart, so only
# places, the calendar and nationalities count (March, China, Polish), not other terms (Word, Mass, Will)
STRICT = re.compile(
    r"^(Days of the week|Months|Holidays|Countries|Countries in .*|Constituent countries.*|Continents.*|Oceans|Seas"
    r"|States of the United States|Provinces and territories of Canada|States and territories of Australia"
    r"|National capitals|Capital cities|.*demonyms|Ethnonyms|Nationalities|God|Planets of the Solar System)$")
# capitalised words whose categories qualify, but whose use is nearly all as the lowercase word
NOT_PROPER = set("""Man Word Lord White Vote Mass Channel Tape Label Creek Carrier Sooner Mama Pole Noon Darling
Lesbian Anal Ive Even More Lol""".split())


def proper(word, threshold):
    """Whether a capitalised word is a common proper noun, used about as often as the threshold or more."""
    if not CAPITAL.match(word) or len(word) < 3 or not re.search("[aeiouy]", word) or word in NOT_PROPER or zipf(word) < threshold:
        return False
    cats = categories(word)
    if word != "God":
        cats.discard("God")  # the category also has Word, Lord, Creator...
    if word.lower() in ENABLE:
        return any(STRICT.match(c) for c in cats)
    return any(CATEGORIES.match(c) for c in cats) or (zipf(word) >= 3 and any(CITIES.match(c) for c in cats))


CONTRACTIONS = """I'm I've I'll I'd you're you've you'll you'd he's he'll he'd she's she'll she'd it's it'll it'd
we're we've we'll we'd they're they've they'll they'd that's that'll that'd there's there'll there'd here's
what's what'll what'd who's who'll who'd who've where's where'd when's why's how's how'd let's
isn't aren't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't shouldn't mustn't mightn't
needn't hasn't haven't hadn't shan't ain't would've could've should've might've must've
o'clock y'all ma'am ne'er e'er o'er""".split()
assert all(w in entries for w in CONTRACTIONS)

# the only words under three letters in Common English
SHORT = set("""a am an as at be by do go he if in is it me my no of on or so to up us we
ah aw eh er ha hi hm mm oh ok ow uh um yo ad ax ex id ma pa ox pi em en lo ye re mi fa la ti""".split())

NONSTANDARD = {"noone"}  # spellings Wiktionary doesn't tag as misspellings

def only_names(word):
    """Whether every entry is a proper noun, as with lowercase spellings like javascript or midwest."""
    return all(pos == "name" for pos, tags, cats in entries[word])


propers = {w for w in entries if CAPITAL.match(w) and listable(w) and proper(w, 2.0)} | {"I"}


def lowercase_word(w):
    """Whether a lowercase Wiktionary word that isn't in ENABLE belongs in English. Words under three
    letters must be in ENABLE or the chosen short words. Lowercase spellings of listed proper nouns
    (paul, york), words written without vowels (bldg) and the reviewed exclusions are left out."""
    if not (LOWER.match(w) and listable(w) and not only_names(w) and zipf(w) > 0):
        return False
    if len(w) < 3:
        return w in SHORT
    if w.capitalize() in propers or w in EXCLUDED or "English words spelled without vowels" in categories(w):
        return False
    # Below Common English's cutoff, where words weren't reviewed by hand, also leave out words with a
    # proper noun or all-caps entry (drury, oreo, atari), since that's probably what wordfreq counted.
    if zipf(w) >= 3:
        return True
    capitalised = entries.get(w.capitalize(), [])
    return w.upper() not in entries and not any(pos == "name" for pos, tags, cats in capitalised)


lower = {w for w in entries if w not in ENABLE and lowercase_word(w)} | ENABLE
lower -= NONSTANDARD

by_frequency = lambda w: (-zipf(w), w.lower(), w)
english = sorted(lower | propers | set(CONTRACTIONS), key=by_frequency)
common = [w for w in english if zipf(w) >= 3 and (
    w in SHORT or w == "I"
    or (w in lower and len(w) >= 3 and w not in EXCLUDED)
    or (w in propers and proper(w, 3.0))
    or w in CONTRACTIONS)]

# --- Phrases: multi-word and hyphenated entries with a definition of their own (not just a form of
# another entry), and not only obsolete or archaic. Capitalised phrases only if they name places, the
# calendar, languages or religions (New York, Good Friday).

PHRASE = re.compile(r"^[^\W\d_]+(?:(?: |-|'|\. ?)[^\W\d_]+)+\.?$")
phrases = []
for w in entries:
    if not (" " in w or "-" in w) or not PHRASE.match(w) or not listable(w):
        continue
    if all("form-of" in t or bad(t) for t in senses(w)) or all(t & {"obsolete", "archaic"} for t in senses(w)):
        continue
    is_proper = w[0].isupper() or all(pos == "name" for pos, tags, cats in entries[w])
    if is_proper and not any(CATEGORIES.match(c) and "given names" not in c for c in categories(w)):
        continue
    phrases.append(w)
phrases.sort(key=lambda w: (w.lower(), w))

# --- Write

WIKTIONARY = "[Wiktionary](https://en.wiktionary.org/) (via [Kaikki](https://kaikki.org/))"
ENABLE_LINK = "[ENABLE](https://github.com/dolph/dictionary)"
WORDFREQ = "[wordfreq](https://github.com/rspeer/wordfreq)"
LICENCE = "Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)"
LISTS = {
    "english": (english, "English",
        "General English words, including common proper nouns, most common first (phrases are a separate list).",
        f"Adapted from {WIKTIONARY} and {ENABLE_LINK}, filtered and ordered by {WORDFREQ} frequency, and excluding some name and abbreviation overlaps. {LICENCE}, like content from Wiktionary and wordfreq's data."),
    "common-english": (common, "Common English",
        "English words used about once per million words or more, including common proper nouns, most common first.",
        f"Adapted from {WIKTIONARY} and {ENABLE_LINK}, filtered and ordered by {WORDFREQ} frequency, and excluding some name and abbreviation overlaps. {LICENCE}, like content from Wiktionary and wordfreq's data."),
    "english-phrases": (phrases, "English phrases",
        "English phrases, idioms and hyphenated words from Wiktionary, in alphabetical order.",
        f"Adapted from {WIKTIONARY}. {LICENCE}, like content from Wiktionary."),
}
for file, (words, name, description, attribution) in LISTS.items():
    header = f"# name: {name}\n# description: {description}\n# tag: general\n# attribution: {attribution}\n\n"
    (OUT / f"{file}.txt").write_text(header + "\n".join(words) + "\n", encoding="utf-8")
    print(f"{file}: {len(words):,} words")
