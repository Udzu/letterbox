"""Build the Cities word list.

Usage: python3 scripts/cities-wordlist.py CITIES ALTERNATE_NAMES

CITIES is cities500.zip and ALTERNATE_NAMES is alternateNamesV2.zip, both from
https://download.geonames.org/export/dump/ (about 14 MB and 200 MB). Writes wordlists/cities.txt;
run npm run build afterwards to update the Wordlists page.

The list has every city with a population of at least MIN_POPULATION, and every capital (national
or of a dependent territory), largest first, leaving out sections of cities (such as boroughs that
GeoNames lists separately from their city). Each city has its GeoNames name and its English names,
including former ones, but not colloquial ones (such as the Big Apple), abbreviations (KL), names
in brackets or after a comma, the hand-reviewed exclusions in cities-wordlist/excluded.txt, or
longer versions of another of its names (Sydney City, City of Manila, Seoul-si). Names in
cities-wordlist/included.txt are added after these, without being filtered. Each name with
accents or other non-ASCII letters is followed by its ASCII form, so São Paulo is followed by Sao
Paulo.
"""

import io
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

MIN_POPULATION = 500_000

CITIES_ZIP, ALTERNATE_NAMES_ZIP = sys.argv[1:3]
HERE = Path(__file__).parent
OUT = HERE.parent / "wordlists"



def lines(file):
    return [line.strip() for line in open(HERE / "cities-wordlist" / file, encoding="utf-8") if line.strip() and not line.startswith("#")]


EXCLUDED = set(lines("excluded.txt"))
# "GeoNames name: name to add", such as "Beijing: Peking"
INCLUDED = [line.split(": ", 1) for line in lines("included.txt")]


def rows(zip_path, member):
    with zipfile.ZipFile(zip_path) as z:
        for line in io.TextIOWrapper(z.open(member), encoding="utf-8"):
            yield line.rstrip("\n").split("\t")


# typographic apostrophes and okinas become plain apostrophes, as in Xi'an and Nuku'alofa
APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʻ": "'", "ʼ": "'", "`": "'"})


def tidy(name):
    return " ".join(name.translate(APOSTROPHES).split())


# letters that don't decompose into an ASCII letter and accents
LETTERS = str.maketrans({"ß": "ss", "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L",
                         "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "þ": "th", "Þ": "Th", "ı": "i", "ŀ": "l", "ħ": "h", "Ħ": "H"})


def ascii_form(name):
    """The name without accents, or None if it has letters that can't be written in ASCII."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", name.translate(LETTERS)) if not unicodedata.combining(c))
    return folded if folded.isascii() else None


# --- Cities: geonameid -> (population, GeoNames name), for big cities and capitals but not sections
# of cities (PPLX)

cities = {}
for f in rows(CITIES_ZIP, "cities500.txt"):
    geonameid, name, feature_code, population = f[0], f[1], f[7], int(f[14] or 0)
    if (population >= MIN_POPULATION and feature_code != "PPLX") or feature_code == "PPLC":
        cities[geonameid] = (population, tidy(name))

# --- Added names: geonameid -> [name], for cities given by their GeoNames name

added = {}
for city, name in INCLUDED:
    matches = [g for g, (population, main) in cities.items() if main == city]
    if len(matches) != 1:
        sys.exit(f"included.txt: {len(matches)} cities called {city!r}")
    added.setdefault(matches[0], []).append(name)

# --- English names: geonameid -> [name], leaving out colloquial ones

english = {}
for f in rows(ALTERNATE_NAMES_ZIP, "alternateNamesV2.txt"):
    geonameid, language, name, colloquial = f[1], f[2], f[3], f[6]
    if geonameid in cities and language == "en" and colloquial != "1":
        english.setdefault(geonameid, []).append(tidy(name))

# --- A city's names: its GeoNames name, then its English names, without unwanted ones


def key(name):
    return (ascii_form(name) or name).lower()


# longer versions of a name, as (pattern, whether it's also dropped from a GeoNames name): Kuwait City
# is a GeoNames name, but Seongnam-si and Ōta-ku are better as Seongnam and Ōta
LONGER = [(re.compile(p), main) for p, main in [
    (r"^(.+) [Cc]ity$", False), (r"^City of (.+)$", False), (r"^(.+) District$", False), (r"^(.+) County$", False),
    (r"^Borough of (.+)$", False), (r"^Greater (.+)$", False), (r"^(.+) State$", False),
    (r"^(.+)-si$", True), (r"^(.+)-shi$", True), (r"^(.+)-ku$", True),
]]


def wanted(name):
    return name not in EXCLUDED and any(c.islower() for c in name) and not re.search(r"[(),]", name)


def names(geonameid):
    main = cities[geonameid][1]
    candidates = [main] + [n for n in english.get(geonameid, []) if wanted(n)]
    keys = {key(n) for n in candidates}
    result = []
    for i, name in enumerate(candidates):
        if any((i > 0 or main_too) and (m := p.match(name)) and key(m[1]) in keys for p, main_too in LONGER):
            continue
        result.append(name)
    return result + added.get(geonameid, [])


# --- Write: largest city first, each name followed by its ASCII form if it's different

words, seen, unwritable = [], set(), []
for geonameid in sorted(cities, key=lambda g: (-cities[g][0], cities[g][1])):
    for name in names(geonameid):
        plain = ascii_form(name)
        if plain is None:
            unwritable.append(name)
        for word in (name, plain):
            if word and word not in seen:
                seen.add(word)
                words.append(word)

for name in unwritable:
    print(f"no ASCII form for {name!r}", file=sys.stderr)

DESCRIPTION = ("Cities of half a million people or more, and all capitals, with English and former names,"
               " largest first. Names with accents are followed by their unaccented forms.")
ATTRIBUTION = ("Adapted from [GeoNames](https://www.geonames.org/). Licensed under"
               " [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), like GeoNames' data.")
header = f"# name: Cities\n# description: {DESCRIPTION}\n# kind: geography\n# attribution: {ATTRIBUTION}\n\n"
(OUT / "cities.txt").write_text(header + "\n".join(words) + "\n", encoding="utf-8")
print(f"cities: {len(cities):,} cities, {len(words):,} words")
