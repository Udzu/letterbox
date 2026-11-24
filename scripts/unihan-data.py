"""Build the CJK ideograph data for the Unicode page: readings, radicals and strokes, from Unihan.

Usage: python3 scripts/unihan-data.py UNIHAN_DIR

UNIHAN_DIR holds the files from Unihan.zip, which is downloaded and unpacked there first if they're
missing. Writes unicode/readings.txt: a header of "# key: value" lines, then a line for each ideograph
with a reading or a radical, in codepoint order, with tab-separated fields (trailing empty ones left out):

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

Readings within a field are separated by spaces.
"""

import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

VERSION = "18.0.0"
URL = f"https://www.unicode.org/Public/{VERSION}/ucd/Unihan.zip"
FILES = ["Unihan_Readings.txt", "Unihan_IRGSources.txt", "Unihan_OtherMappings.txt", "Unihan_DictionaryLikeData.txt"]
READINGS = ["kMandarin", "kCantonese", "kJapanese", "kHangul", "kVietnamese"]
OUT = Path(__file__).parent.parent / "unicode" / "readings.txt"

HEADER = f"""\
# name: CJK ideograph readings
# description: Mandarin, Cantonese, Japanese, Korean and Vietnamese readings, radicals and stroke counts of CJK ideographs, from Unihan in Unicode {VERSION[:-2]} (see scripts/unihan-data.py for the format).
# attribution: From the [Unihan database](https://www.unicode.org/charts/unihan.html), © Unicode, Inc., under the [Unicode License v3](https://www.unicode.org/license.txt).
"""


def download():
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
        rows.append("\t".join([f"{cp - previous:x}", *readings, radical, strokes, common, str(frequency or "")]).rstrip("\t"))
        previous = cp
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(HEADER + "\n".join(rows) + "\n", encoding="utf-8")
    print(f"{len(rows)} ideographs; " + ", ".join(f"{counts[k]} {k}" for k in READINGS) + f"; {OUT.stat().st_size:,} bytes",
          file=sys.stderr)


if __name__ == "__main__":
    DIR = Path(sys.argv[1])
    main()
