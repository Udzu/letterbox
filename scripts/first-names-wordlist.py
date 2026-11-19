"""Build the Common first names word list.

Usage: python3 scripts/first-names-wordlist.py SSA_DIR EW_XLSX

SSA_DIR holds the US Social Security Administration's national baby-name files (yob1880.txt …),
unzipped from names.zip, and EW_XLSX is the ONS's baby names in England and Wales workbook:

  https://www.ssa.gov/oact/babynames/names.zip (the SSA refuses scripted downloads: use a browser)
  curl -A "letterbox-wordlists (github.com/Udzu/letterbox)" -o ew.xlsx "https://www.ons.gov.uk/file?uri=/peoplepopulationandcommunity/birthsdeathsandmarriages/livebirths/datasets/babynamesinenglandandwalesfrom1996/1996to2025/babynames1996to2025.xlsx"

Writes wordlists/first-names.txt: the US_TOP most common first names of people alive in the US in
YEAR, most common first, then first names common in Britain and Ireland that miss them: those in the
top EW_TOP for babies born in England and Wales since 1996 (in that order), then the hand-picked
extras below. Each spelling counts separately, and girls' and boys' names are counted together. Run
npm run build afterwards to update the Wordlists page.

The US ranking weights each year's births by a rough chance of being alive in YEAR at that age
(SURVIVAL, roughly the US period life table for both sexes), to approximate the living population.
"""

import html
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

SSA_DIR, EW_XLSX = sys.argv[1:3]
OUT = Path(__file__).parent.parent / "wordlists" / "first-names.txt"
YEAR = 2026
US_TOP = 1000
EW_TOP = 400

# (age, share still alive), interpolated linearly.
SURVIVAL = [(0, 1), (40, .97), (50, .94), (60, .88), (70, .77), (80, .55), (90, .2), (100, .02), (110, 0)]

# Common names in Britain and Ireland that both data sets miss: ones mostly given before 1996 (the
# ONS data starts then), and Scottish, Irish and Welsh names. Written without Irish fadas, like the
# SSA and ONS data.
EXTRA = """Nigel Gareth Clive Alistair Hamish Angus Fergus Iain Duncan Gwen Bronwen Lesley Gillian
Hilary Beverley Mavis Mandy Fiona Shona Morag Ailsa Elspeth Mhairi Siobhan Sinead Seamus Padraig
Eoin Ciaran Aisling Saoirse Mairead Dafydd Owain Oisin""".split()

# The SSA leaves out inner capitals.
SPELLINGS = {"Mckenzie": "McKenzie", "Mckenna": "McKenna"}


def survival(age):
    for (a0, s0), (a1, s1) in zip(SURVIVAL, SURVIVAL[1:]):
        if age <= a1:
            return s0 + (s1 - s0) * (age - a0) / (a1 - a0)
    return 0


def xlsx_rows(path, sheet):
    """The rows of a worksheet as lists of cell strings (enough for the ONS workbook)."""
    book = zipfile.ZipFile(path)
    strings = [html.unescape(re.sub(r"<[^>]+>", "", s)) for s in
               re.findall(r"<si>(.*?)</si>", book.read("xl/sharedStrings.xml").decode(), re.S)]
    for row in re.finditer(r"<row[^>]*>(.*?)</row>", book.read(f"xl/worksheets/{sheet}.xml").decode(), re.S):
        cells = []
        for cell in re.finditer(r'<c r="[A-Z]+\d+"([^>]*?)(?:/>|>(.*?)</c>)', row.group(1), re.S):
            value = re.search(r"<v>(.*?)</v>", cell.group(2) or "")
            value = value.group(1) if value else ""
            cells.append(strings[int(value)] if 't="s"' in cell.group(1) and value else value)
        yield cells


us = Counter()
for year in range(YEAR - SURVIVAL[-1][0], YEAR):
    weight = survival(YEAR - year)
    for line in open(Path(SSA_DIR) / f"yob{year}.txt"):
        name, sex, count = line.strip().split(",")
        us[name] += int(count) * weight
us = [SPELLINGS.get(name, name) for name, _ in us.most_common(US_TOP)]

ew = Counter()
for sheet in ("sheet4", "sheet5"):  # Table_1 (girls) and Table_2 (boys)
    for cells in xlsx_rows(EW_XLSX, sheet):
        if cells and cells[0] and cells[0] != "Name" and len(cells) > 2:
            ew[cells[0]] += sum(int(c) for c in cells[2::2] if c.isdigit())
ew = [name for name, _ in ew.most_common(EW_TOP)]
assert ew[0] in ("Oliver", "Olivia", "Jack", "Thomas", "Jessica", "Emily"), ew[:5]

seen = {n.lower() for n in us}
british = []
for name in ew + EXTRA:
    if name.lower() not in seen:
        seen.add(name.lower())
        british.append(name)

rule = "=" * 60
OUT.write_text(f"""# name: Common first names
# description: The 1,000 most common first names in the US, most common first, then common British and Irish ones.
# tag: language
# attribution: From [US Social Security baby names](https://www.ssa.gov/oact/babynames/limits.html) and, for Britain, [ONS baby names](https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/livebirths/datasets/babynamesinenglandandwalesfrom1996).

# {rule}
# The {US_TOP:,} most common first names in the US (Social Security
# baby names, weighted to the living population)
# {rule}

""" + "\n".join(us) + f"""

# {rule}
# Other common first names in Britain and Ireland: England and
# Wales's top {EW_TOP} since 1996 (ONS), then older, Scottish, Irish and Welsh names
# {rule}

""" + "\n".join(british) + "\n", encoding="utf-8")
print(f"US: {len(us)}, British and Irish: {len(british)}")
