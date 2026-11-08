"""Build the Cities word list.

Usage: python3 scripts/cities-wordlist.py CITIES ALTERNATE_NAMES FAMOUS

CITIES is cities500.zip and ALTERNATE_NAMES is alternateNamesV2.zip, both from
https://download.geonames.org/export/dump/ (about 14 MB and 200 MB). FAMOUS is the result of the
Wikidata query in cities-wordlist/famous.rq, saved as TSV, for instance from QLever:

  curl -L https://qlever.dev/api/wikidata --data-urlencode query@scripts/cities-wordlist/famous.rq \
    --data-urlencode action=tsv_export -o famous.tsv

(retrying if the server is busy). Writes wordlists/cities.txt; run npm run build afterwards to
update the Wordlists page.

The list has every city with a population of at least MIN_POPULATION, every capital (national or
of a dependent territory), and every smaller city that's famous: a settlement with articles in at
least MIN_ARTICLES of the larger Wikipedias that famous.rq counts (which leaves out small ones,
where some towns have articles because of translation campaigns), apart from the towns in
cities-wordlist/not-famous.txt. Cities are largest first, leaving out sections of cities (such
as boroughs that GeoNames lists separately from their city). Each city has its GeoNames name and
its English names, including former ones, but not colloquial ones (such as the Big Apple),
abbreviations (KL), names in brackets or after a comma, the hand-reviewed exclusions in
cities-wordlist/excluded.txt, or longer versions of another of its names (Sydney City, City of
Manila, Seoul-si). Names in cities-wordlist/included.txt are added after these, without being
filtered. Each name with accents or other non-ASCII letters is followed by its ASCII form, so São
Paulo is followed by Sao Paulo.
"""

import io
import math
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

MIN_POPULATION = 500_000
MIN_ARTICLES = 50
# how far a Wikidata settlement can be from the GeoNames city it's matched to by name
MAX_DISTANCE_KM = 20

CITIES_ZIP, ALTERNATE_NAMES_ZIP, FAMOUS_TSV = sys.argv[1:4]
HERE = Path(__file__).parent
OUT = HERE.parent / "wordlists"


def lines(file):
    return [line.strip() for line in open(HERE / "cities-wordlist" / file, encoding="utf-8") if line.strip() and not line.startswith("#")]


EXCLUDED = set(lines("excluded.txt"))
# "GeoNames name: name to add", such as "Beijing: Peking"
INCLUDED = [line.split(": ", 1) for line in lines("included.txt")]
NOT_FAMOUS = set(lines("not-famous.txt"))


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
                         "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "þ": "th", "Þ": "Th", "ı": "i", "ŀ": "l", "ħ": "h", "Ħ": "H",
                         "ǝ": "e", "Ǝ": "E", "ə": "e", "Ə": "E", "ʾ": "'", "ʿ": "'"})


def ascii_form(name):
    """The name without accents, or None if it has letters that can't be written in ASCII."""
    folded = "".join(c for c in unicodedata.normalize("NFKD", name.translate(LETTERS)) if not unicodedata.combining(c))
    return folded if folded.isascii() else None


# --- Places: geonameid -> (population, GeoNames name, ASCII name, latitude, longitude, feature code),
# leaving out sections of cities (PPLX)

places = {}
for f in rows(CITIES_ZIP, "cities500.txt"):
    if f[7] != "PPLX":
        places[f[0]] = (int(f[14] or 0), tidy(f[1]), f[2], float(f[4]), float(f[5]), f[7])

# --- English names: geonameid -> [name], leaving out colloquial ones; and Wikidata IDs: item -> [geonameid]

english, geonames_of_item = {}, {}
for f in rows(ALTERNATE_NAMES_ZIP, "alternateNamesV2.txt"):
    geonameid, language, name, colloquial = f[1], f[2], f[3], f[6]
    if geonameid in places:
        if language == "en" and colloquial != "1":
            english.setdefault(geonameid, []).append(tidy(name))
        elif language == "wkdt":
            geonames_of_item.setdefault(name, []).append(geonameid)

# --- Famous places: Wikidata settlements matched to GeoNames places, by the GeoNames IDs that either
# gives for the other or by being near each other, as long as the Wikidata settlement's English
# label is one of the place's English names (so Bruges is Brugge, but Petra isn't Wadi Musa, the
# town by it), or a longer or shorter version of its GeoNames name (Freiburg im Breisgau is Freiburg)


def match_key(name):
    folded = "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c)).lower()
    return " ".join(re.sub(r"[^0-9a-z]+", " ", folded).split())


def same_name(label, geonameid):
    population, name, ascii_name = places[geonameid][:3]
    label = match_key(label)
    main = {match_key(name), match_key(ascii_name)}
    if label in main | {match_key(n) for n in english.get(geonameid, [])}:
        return True
    return any(label.startswith(m + " ") or m.startswith(label + " ") for m in main)


grid = {}
for geonameid, (population, name, ascii_name, lat, lon, feature_code) in places.items():
    grid.setdefault((int(lat), int(lon)), []).append(geonameid)


def nearby(lat, lon):
    for dlat in (-1, 0, 1):
        for dlon in (-1, 0, 1):
            for geonameid in grid.get((int(lat) + dlat, int(lon) + dlon), []):
                plat, plon = places[geonameid][3:5]
                if math.hypot(plat - lat, (plon - lon) * math.cos(math.radians(lat))) * 111.2 <= MAX_DISTANCE_KM:
                    yield geonameid


famous = set()
with open(FAMOUS_TSV, encoding="utf-8") as f:
    next(f)
    for line in f:
        item, articles, coord, label, ids = line.rstrip("\n").split("\t")
        point = re.search(r"Point\(([-\d.e]+) ([-\d.e]+)\)", coord, re.I)
        label = re.fullmatch(r'"(.*)"@en', label)
        if int(articles) < MIN_ARTICLES or not point or not label:
            continue
        lon, lat = float(point[1]), float(point[2])
        label = label[1].split(",")[0]
        qid = re.search(r"Q\d+", item)[0]
        for candidates in (geonames_of_item.get(qid, []), re.findall(r"\d+", ids), nearby(lat, lon)):
            matches = [g for g in candidates if g in places and same_name(label, g)]
            if matches:
                famous.add(max(matches, key=lambda g: places[g][0]))
                break

# --- Cities: geonameid -> (population, GeoNames name), for big cities, capitals and famous cities

cities = {}
for geonameid, (population, name, ascii_name, lat, lon, feature_code) in places.items():
    if population >= MIN_POPULATION or feature_code == "PPLC" or (geonameid in famous and name not in NOT_FAMOUS):
        cities[geonameid] = (population, name)

# --- Added names: geonameid -> [name], for cities given by their GeoNames name

added = {}
for city, name in INCLUDED:
    matches = [g for g, (population, main) in cities.items() if main == city]
    if len(matches) != 1:
        sys.exit(f"included.txt: {len(matches)} cities called {city!r}")
    added.setdefault(matches[0], []).append(name)

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

DESCRIPTION = ("Cities of half a million people or more, capitals, and smaller cities with articles in most"
               " major Wikipedias, largest first, with English and former names. Names with accents are"
               " followed by their unaccented forms.")
ATTRIBUTION = ("Adapted from [GeoNames](https://www.geonames.org/), with famous cities found using"
               " [Wikidata](https://www.wikidata.org/). Licensed under"
               " [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), like GeoNames' data.")
header = f"# name: Cities\n# description: {DESCRIPTION}\n# tag: geography\n# attribution: {ATTRIBUTION}\n\n"
(OUT / "cities.txt").write_text(header + "\n".join(words) + "\n", encoding="utf-8")
smaller = sum(1 for g in cities if cities[g][0] < MIN_POPULATION and places[g][5] != "PPLC")
print(f"cities: {len(cities):,} cities ({smaller:,} smaller famous ones), {len(words):,} words")
