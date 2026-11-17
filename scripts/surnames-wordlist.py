"""Build the Common surnames word list.

Usage: python3 scripts/surnames-wordlist.py CENSUS EW500

CENSUS is Names_2010Census.csv from the US Census Bureau's 2010 surnames file, and EW500 is the
Guild of One-Name Studies' page of the 500 leading surnames in England and Wales (from an ONS survey
of the NHS Central Register, 1991-2000), saved as HTML:

  curl -A "letterbox-wordlists (github.com/Udzu/letterbox)" -O https://www2.census.gov/topics/genealogy/2010surnames/names.zip
  unzip names.zip Names_2010Census.csv
  curl -A "letterbox-wordlists (github.com/Udzu/letterbox)" -o ew500.html https://one-name.org/modern-british-surnames/statistics/top-surnames/england-wales/top-500-names/

Writes wordlists/surnames.txt: the US_TOP most common US surnames, most common first, then surnames
common in Britain and Ireland that miss them: those in the top EW_TOP for England and Wales (in that
order), then the hand-copied extras below. Run npm run build afterwards to update the Wordlists page.
"""

import csv
import html
import re
import sys
from pathlib import Path

CENSUS, EW500 = sys.argv[1:3]
OUT = Path(__file__).parent.parent / "wordlists" / "surnames.txt"
US_TOP = 1000
EW_TOP = 400

# Common surnames from smaller top lists: Scotland's top 50 (Guild of One-Name Studies, from the
# National Records of Scotland's surveys), and the top 20s for Ireland, Northern Ireland and Wales on
# Wikipedia's List of most common surnames in European countries. Only ones missing from the rest.
EXTRA = """Paterson Fraser Allan MacLeod Mackenzie Mackay Thomson Smyth Doherty Driscoll""".split()

# The Census leaves out apostrophes, spaces and inner capitals.
SPELLINGS = {"OBRIEN": "O'Brien", "OCONNOR": "O'Connor", "ONEILL": "O'Neill", "ONEAL": "O'Neal",
             "ODONNELL": "O'Donnell", "OCONNELL": "O'Connell", "OSULLIVAN": "O'Sullivan",
             "MACDONALD": "MacDonald", "DELEON": "De Leon", "DELACRUZ": "De La Cruz",
             "DEJESUS": "De Jesus", "DELAROSA": "De La Rosa", "LEBLANC": "LeBlanc"}


def spell(name):
    """A Census or ONS surname (in capitals) as it's usually written."""
    key = re.sub(r"[^A-Z]", "", name.upper())
    if key in SPELLINGS:
        return SPELLINGS[key]
    word = key.capitalize()
    return "Mc" + word[2:].capitalize() if word.startswith("Mc") else word


def key(name):
    return re.sub(r"[^A-Z]", "", name.upper())


us = [spell(r["name"]) for r in csv.DictReader(open(CENSUS))][:US_TOP]
page = open(EW500, encoding="utf-8").read()
rows = re.findall(r"<tr>\s*<td[^>]*>\s*(\d+)\s*</td>\s*<td[^>]*>([^<]+)</td>", page)
ew = [spell(html.unescape(name).strip()) for rank, name in rows if int(rank) <= EW_TOP]
assert len(ew) == EW_TOP, len(ew)

seen = {key(n) for n in us}
british = []
for name in ew + EXTRA:
    if key(name) not in seen:
        seen.add(key(name))
        british.append(name)

rule = "=" * 60
OUT.write_text(f"""# name: Common surnames
# description: The 1,000 most common surnames in the US, most common first, then common British and Irish ones.
# tag: language
# attribution: From the [2010 US Census](https://www.census.gov/topics/population/genealogy/data/2010_surnames.html) and, for Britain, [ONS and NRS data](https://one-name.org/modern-british-surnames/statistics/top-surnames/) and Wikipedia.

# {rule}
# The {US_TOP:,} most common surnames in the US (2010 Census)
# {rule}

""" + "\n".join(us) + f"""

# {rule}
# Other common surnames in Britain and Ireland: England and
# Wales's top {EW_TOP} (ONS), then Scotland, Ireland, Northern Ireland and Wales
# {rule}

""" + "\n".join(british) + "\n", encoding="utf-8")
print(f"US: {len(us)}, British and Irish: {len(british)}")
