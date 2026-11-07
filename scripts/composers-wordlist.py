"""Build the Classical composers word list.

Usage: python3 scripts/composers-wordlist.py QRANK DANKER

QRANK is qrank.csv.gz from https://qrank.wmcloud.org/ (about 130 MB), which ranks Wikidata items by
their page views across all Wikipedias, and DANKER is the latest *.allwiki.links.rank.bz2 from
https://danker.s3.amazonaws.com/index.html (about 230 MB), which gives each Wikidata item the
PageRank of its articles' links across all Wikipedias. Writes wordlists/composers.txt; run npm run
build afterwards to update the Wordlists page.

The composers are the ones in composers-wordlist/composers.txt, which is edited by hand. They're
ordered by how prominent they are: a weighted average of their PageRank and their page views, each
taken as a logarithm and scaled to have mean 0 and standard deviation 1 across the composers. Page
views alone overrate popular composers such as film composers, so PageRank, which measures how much
other articles refer to a composer, gets PAGERANK_WEIGHT of the weight; but not all of it, since
PageRank alone underrates composers known for being played more than written about. Each name is
listed once, at the place of the most prominent composer with it, and names with accents or other
non-ASCII letters are followed by their ASCII forms, so Dvořák is followed by Dvorak.
"""

import bz2
import gzip
import math
import statistics
import sys
import unicodedata
from pathlib import Path

# how much of a composer's prominence comes from PageRank rather than page views
PAGERANK_WEIGHT = 0.75

QRANK, DANKER = sys.argv[1:3]
HERE = Path(__file__).parent
OUT = HERE.parent / "wordlists" / "composers.txt"

# --- Composers: Wikidata item -> [name]

composers = {}
for line in open(HERE / "composers-wordlist" / "composers.txt", encoding="utf-8"):
    line = line.split("#")[0].strip()
    if line:
        item, names = line.split(":", 1)
        if item in composers:
            sys.exit(f"composers.txt: {item} is listed twice")
        composers[item] = [name.strip() for name in names.split(",")]

# --- Scores: Wikidata item -> page views and PageRank, from the two downloads


def scores(lines, separator):
    found = {}
    for line in lines:
        item, score = line.rstrip("\n").split(separator)[:2]
        if item in composers:
            found[item] = float(score)
    missing = sorted(set(composers) - set(found))
    if missing:
        sys.exit(f"no score for {', '.join(missing)}")
    return found


with gzip.open(QRANK, "rt", encoding="utf-8") as f:
    next(f)
    views = scores(f, ",")
with bz2.open(DANKER, "rt", encoding="utf-8") as f:
    pagerank = scores(f, "\t")


def standardised(measure):
    logs = {item: math.log(score) for item, score in measure.items()}
    mean, deviation = statistics.mean(logs.values()), statistics.pstdev(logs.values())
    return {item: (value - mean) / deviation for item, value in logs.items()}


views, pagerank = standardised(views), standardised(pagerank)
prominence = {item: PAGERANK_WEIGHT * pagerank[item] + (1 - PAGERANK_WEIGHT) * views[item] for item in composers}

# --- Write: most prominent first, each name followed by its ASCII form if it's different

# letters that don't decompose into an ASCII letter and accents
LETTERS = str.maketrans({"ß": "ss", "æ": "ae", "ø": "o", "ł": "l", "Ł": "L", "đ": "d", "ı": "i"})


def ascii_form(name):
    folded = "".join(c for c in unicodedata.normalize("NFKD", name.translate(LETTERS)) if not unicodedata.combining(c))
    if not folded.isascii():
        sys.exit(f"no ASCII form for {name!r}")
    return folded


words, seen = [], set()
for item in sorted(composers, key=lambda item: -prominence[item]):
    for name in composers[item]:
        for word in (name, ascii_form(name)):
            if word not in seen:
                seen.add(word)
                words.append(word)

DESCRIPTION = ("Surnames of classical composers, most prominent first."
               " Names with accents are followed by their unaccented forms.")
ATTRIBUTION = ("Ordered by page views from [QRank](https://qrank.wmcloud.org/) and PageRank from"
               " [danker](https://github.com/athalhammer/danker). Licensed under"
               " [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), like Wikipedia's content.")
header = f"# name: Classical composers\n# description: {DESCRIPTION}\n# kind: culture\n# attribution: {ATTRIBUTION}\n\n"
OUT.write_text(header + "\n".join(words) + "\n", encoding="utf-8")
print(f"composers: {len(composers):,} composers, {len(words):,} words")
