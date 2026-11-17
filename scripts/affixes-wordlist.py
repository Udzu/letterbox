"""Build the English affixes word list.

Usage: python3 scripts/affixes-wordlist.py

Fetches the sizes of Wiktionary's categories of English terms using each affix ("English terms prefixed
with un-", including the per-sense ones like "... with un- (negative)" and per-part-of-speech ones like
"English adjectives suffixed with -ful"), and writes wordlists/affixes.txt: the prefixes and then the
suffixes used by at least MIN_TERMS terms, most terms first, then a few hand-picked infixes, interfixes
and the circumfix. Run npm run build afterwards to update the Wordlists page.
"""

import json
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

OUT = Path(__file__).parent.parent / "wordlists" / "affixes.txt"
API = "https://en.wiktionary.org/w/api.php"
USER_AGENT = "letterbox-wordlists/1.0 (https://github.com/Udzu/letterbox)"
MIN_TERMS = 50

KINDS = ["prefixed", "suffixed"]
POS = ["terms", "words", "adjectives", "nouns", "verbs", "adverbs"]

# Affixes above the cutoff left out by hand: drug-naming stems and a slur.
EXCLUDED = {"cef-", "-zumab", "-umab", "-olol", "-tard"}

HEADER = """# name: English affixes
# description: Prefixes and then suffixes, most productive first, then a few infixes, interfixes and a circumfix.
# tag: language
# attribution: Ranked by the number of terms in [Wiktionary](https://en.wiktionary.org/)'s categories for each affix. Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), like Wiktionary.
"""

EXTRAS = """
# ============================================================
# Infixes (expletives inserted into words: abso-bloody-lutely)
# ============================================================

-bloody-
-fucking-
-freaking-

# ============================================================
# Interfixes (joining parts of compounds: speed-o-meter)
# ============================================================

-o-
-s-
-i-

# ============================================================
# Circumfix (en-light-en)
# ============================================================

en- -en
"""


def categories(prefix):
    """{category name: number of pages} for the categories whose names start with prefix."""
    found, cont = {}, {}
    while True:
        query = {"action": "query", "list": "allcategories", "acprefix": prefix, "acprop": "size",
                 "aclimit": "500", "format": "json", **cont}
        request = urllib.request.Request(f"{API}?{urllib.parse.urlencode(query)}", headers={"User-Agent": USER_AGENT})
        data = json.load(urllib.request.urlopen(request))
        found |= {c["*"]: c["pages"] for c in data["query"]["allcategories"]}
        if "continue" not in data:
            return found
        cont = data["continue"]
        time.sleep(0.5)


NAME = re.compile(r"^English \w+(?: \w+)? (prefixed|suffixed) with (\S+)(?: \(.*\))?$")
counts = {kind: Counter() for kind in KINDS}
for pos in POS:
    for kind in KINDS:
        for name, pages in categories(f"English {pos} {kind} with ").items():
            if m := NAME.match(name):
                counts[m[1]][m[2]] += pages

sections = []
for kind, title in [("prefixed", "Prefixes"), ("suffixed", "Suffixes")]:
    affixes = sorted((a for a, n in counts[kind].items() if n >= MIN_TERMS and a not in EXCLUDED),
                     key=lambda a: (-counts[kind][a], a))
    rule = "=" * 60
    sections.append(f"\n# {rule}\n# {title} (used by {MIN_TERMS} or more terms)\n# {rule}\n\n" + "\n".join(affixes) + "\n")
    print(f"{title}: {len(affixes)}")

OUT.write_text(HEADER + "".join(sections) + EXTRAS, encoding="utf-8")
