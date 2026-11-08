"""Build the word lists ordered by Wikipedia prominence, such as Classical composers.

Usage: python3 scripts/ranked-wordlists.py QRANK DANKER [LIST ...]

QRANK is qrank.csv.gz from https://qrank.wmcloud.org/ (about 130 MB), which ranks Wikidata items by
their page views across all Wikipedias, and DANKER is the latest *.allwiki.links.rank.bz2 from
https://danker.s3.amazonaws.com/index.html (about 230 MB), which gives each Wikidata item the
PageRank of its articles' links across all Wikipedias. Each LIST is the name of a file in
ranked-wordlists/, without its .txt (all of them if none are given), and is written to the file of
the same name in wordlists/; run npm run build afterwards to update the Wordlists page.

A list's file in ranked-wordlists/, which is edited by hand, starts with the header for the word
list (its # name:, # description:, # tag: and optional # attribution: lines), which is copied as it
is. Each line after that is a Wikidata item, then the words to list for it, separated by commas,
and optionally a comment after a #:

  Q131861: Rachmaninoff, Rachmaninov  # Sergei Rachmaninoff

The items are ordered by how prominent they are: a weighted average of their PageRank and their
page views, each taken as a logarithm and scaled to have mean 0 and standard deviation 1 across the
list. Page views alone overrate popular items, such as film composers, so PageRank, which measures
how much other articles refer to an item, gets PAGERANK_WEIGHT of the weight; but not all of it,
since PageRank alone underrates items that are looked up more than written about. Each word is
listed once, at the place of the most prominent item with it, and words with letters that stand
for two, ß, æ or œ, are followed by their ASCII forms, so Æsop would be followed by Aesop, since
the Patterns page can match accents, as (?d:Dvorak) does Dvořák, but not one letter with two.
"""

import bz2
import gzip
import math
import re
import statistics
import sys
import unicodedata
from pathlib import Path

# how much of an item's prominence comes from PageRank rather than page views
PAGERANK_WEIGHT = 0.75

QRANK, DANKER, *NAMES = sys.argv[1:]
HERE = Path(__file__).parent / "ranked-wordlists"
OUT = Path(__file__).parent.parent / "wordlists"
HEADER = re.compile(r"# (name|description|tag|attribution): ")

# --- Lists: name -> (header, {Wikidata item: [word]})

lists = {}
for path in sorted(HERE.glob("*.txt")) if not NAMES else [HERE / f"{name}.txt" for name in NAMES]:
    header, items = [], {}
    for line in open(path, encoding="utf-8"):
        if not items and HEADER.match(line):
            header.append(line)
            continue
        line = line.split("#")[0].strip()
        if line:
            item, words = line.split(":", 1)
            if item in items:
                sys.exit(f"{path.name}: {item} is listed twice")
            items[item] = [word.strip() for word in words.split(",")]
    lists[path.stem] = ("".join(header), items)

# --- Scores: Wikidata item -> page views and PageRank, from the two downloads, read once for all
# the lists

wanted = {item for header, items in lists.values() for item in items}


def scores(lines, separator):
    found = {}
    for line in lines:
        item, score = line.rstrip("\n").split(separator)[:2]
        if item in wanted:
            found[item] = float(score)
    missing = sorted(wanted - set(found))
    if missing:
        sys.exit(f"no score for {', '.join(missing)}")
    return found


with gzip.open(QRANK, "rt", encoding="utf-8") as f:
    next(f)
    views = scores(f, ",")
with bz2.open(DANKER, "rt", encoding="utf-8") as f:
    pagerank = scores(f, "\t")


def standardised(measure, items):
    logs = {item: math.log(measure[item]) for item in items}
    mean, deviation = statistics.mean(logs.values()), statistics.pstdev(logs.values())
    return {item: (value - mean) / deviation for item, value in logs.items()}


# --- Write: most prominent first, each word with ß, æ or œ followed by its ASCII form

# letters that don't decompose into an ASCII letter and accents
LETTERS = str.maketrans({"ß": "ss", "ẞ": "SS", "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe", "ø": "o", "ł": "l", "Ł": "L", "đ": "d", "ı": "i"})
TWO_LETTERS = set("ßẞæÆœŒ")


def ascii_form(word):
    folded = "".join(c for c in unicodedata.normalize("NFKD", word.translate(LETTERS)) if not unicodedata.combining(c))
    if not folded.isascii():
        sys.exit(f"no ASCII form for {word!r}")
    return folded


for name, (header, items) in lists.items():
    v, p = standardised(views, items), standardised(pagerank, items)
    prominence = {item: PAGERANK_WEIGHT * p[item] + (1 - PAGERANK_WEIGHT) * v[item] for item in items}
    words, seen = [], set()
    for item in sorted(items, key=lambda item: -prominence[item]):
        for word in items[item]:
            for form in (word, ascii_form(word)) if TWO_LETTERS & set(word) else (word,):
                if form not in seen:
                    seen.add(form)
                    words.append(form)
    (OUT / f"{name}.txt").write_text(header + "\n" + "\n".join(words) + "\n", encoding="utf-8")
    print(f"{name}: {len(items):,} items, {len(words):,} words")
