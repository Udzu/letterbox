"""Build the Country code TLDs word list.

Usage: python3 scripts/cctlds-wordlist.py DB TLDS

DB is IANA's root zone database page, https://www.iana.org/domains/root/db (saved as HTML), and
TLDS is https://data.iana.org/TLD/tlds-alpha-by-domain.txt, the list of delegated TLDs:

  curl -A "letterbox-wordlists (github.com/Udzu/letterbox)" -o db.html https://www.iana.org/domains/root/db
  curl -A "letterbox-wordlists (github.com/Udzu/letterbox)" -o tlds.txt https://data.iana.org/TLD/tlds-alpha-by-domain.txt

Writes wordlists/cctlds.txt; run npm run build afterwards to update the Wordlists page.

The list has every active country code TLD, without the leading dot, leaving out codes that are
reserved but not delegated (such as bl and um): the Latin ones A to Z, then the internationalised
ones grouped by script. Update the month in the attribution when rerunning.
"""
import re, sys, html, collections, unicodedata, pathlib
t = open(sys.argv[1], encoding='utf-8').read()
delegated = {l.strip().lower() for l in open(sys.argv[2]) if not l.startswith('#')}
groups = collections.defaultdict(list)
for r in re.findall(r'<tr>(.*?)</tr>', t, re.S):
    cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)]
    if len(cells) < 7 or 'Country Code' not in cells[2] or cells[1] != 'Active': continue
    href = re.search(r'/domains/root/db/([^"]+)\.html|/domains/root/db/([^"]+)"', r)
    ace = (href.group(1) or href.group(2))
    assert ace in delegated, ace
    label = unicodedata.normalize('NFC', cells[6].split('||', 1)[1])
    groups[cells[5].split(' (')[0]].append(label)
latin = sorted(groups.pop('Latin'))
assert latin and groups
print(len(latin), sum(map(len, groups.values())))
out = ["# name: Country code TLDs",
"# description: Country code top-level domains in use, without the dot: Latin ones, then internationalised ones.",
"# tag: geography",
"# attribution: From IANA's [root zone database](https://www.iana.org/domains/root/db), November 2026.",
"", "# " + "="*28, "# Latin (two-letter, A to Z)", "# " + "="*28, ""] + latin
out += ["", "# " + "="*44, "# Internationalised, by script (alphabetical)", "# " + "="*44]
for s in sorted(groups):
    out += ["", f"# {s}"] + sorted(groups[s])
open(pathlib.Path(__file__).parent.parent / 'wordlists' / 'cctlds.txt', 'w', encoding='utf-8').write("\n".join(out) + "\n")
