"""Suggest YouTube links for the songs in a playlist sheet, for checking by hand.

Usage: uv run --with yt-dlp python scripts/youtube-links.py SHEET_CSV OUTPUT_CSV [--limit N] [--rows N,N,...]

SHEET_CSV is a playlist sheet exported as CSV, with columns named "Song name", "Performer name" and
"YouTube link" (and optionally one with "songwriter" in its name). For each song without a link, searches
YouTube for "<song> <performer>" (and "<song> <songwriters>" if nothing matches well) and scores the
top results:
- the title contains the song name (ignoring case, accents and punctuation, with Cyrillic transliterated):
  +3, or something close to it (as with variant transliterations): +2
- the channel is the performer's auto-generated "<performer> - Topic" channel (official releases, so
  usually the exact recording): +5, or (close to) the performer's own channel: +4, or the performer is
  named in the title: +3
- words suggesting a different recording or not the song (live, cover, karaoke, lyrics, fan, ...) that
  aren't in the song name: -2 each, and -2 for videos over 8 minutes
Search results don't always name the channel, so --previous OUTPUT_CSV adds an earlier run's suggestions
(with their titles and channels) to each song's candidates.
The best result is kept with a confidence: high (6 or more: title and performer match), medium (3 to 5)
or low. OUTPUT_CSV has a row per song in the sheet's order (sheet row number, year, song, performer,
the existing link, then the suggestion, its confidence, title, channel and duration, and two runner-up
links); a .txt file next to it has just the links (existing, or suggested with high confidence, else
blank), one per line, to paste into the sheet's link column.
"""

import argparse
import csv
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from concurrent.futures import ThreadPoolExecutor

import yt_dlp

RESULTS = 6
SUSPECT = ["live", "cover", "karaoke", "tutorial", "lesson", "reaction", "reactions", "remix", "slowed",
           "sped up", "8d", "nightcore", "instrumental", "backing track", "1 hour", "loop", "how to play",
           "chords", "lyrics", "lyric", "text", "fan", "stripped", "acoustic", "piano version", "guitar version"]


# a rough Russian/Ukrainian transliteration, to compare YouTube's Cyrillic titles with the sheet's Latin ones
CYRILLIC = dict(zip("абвгґдеєжзиіїйклмнопрстуфхцчшщъыьэюяё",
                    ["a", "b", "v", "g", "g", "d", "e", "ye", "zh", "z", "i", "i", "yi", "y", "k", "l", "m", "n", "o",
                     "p", "r", "s", "t", "u", "f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya", "yo"]))


def fold(s):
    """Lower case, without accents or punctuation, with single spaces, and Cyrillic transliterated."""
    s = "".join(CYRILLIC.get(c, c) for c in s.lower())
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("&", " and ")
    s = re.sub(r"['’]", "", s)  # soldier's and soldiers' both become soldiers
    return " ".join(re.sub(r"[^\w\s]", " ", s).split())


def contains(text, phrase):
    return bool(phrase) and re.search(rf"\b{re.escape(phrase)}\b", text) is not None


def score(entry, song, performer):
    title, channel = fold(entry.get("title") or ""), fold(entry.get("channel") or entry.get("uploader") or "")
    s = 0
    if contains(title, song):
        s += 3
    elif song and close(title, song):
        s += 2
    # performers like "Bing Crosby & Danny Kaye" also match channels for their first-named act
    acts = [performer] + [fold(a) for a in re.split(r"\s*(?:&|,| and | feat\.? | with )\s*", performer) if a]
    topic = channel.endswith(" topic")
    channel = re.sub(r" topic$", "", channel)
    if channel and any(SequenceMatcher(None, channel, a).ratio() >= 0.85 for a in acts if a):
        s += 5 if topic else 4
    elif any(contains(title, a) for a in acts if a):
        s += 3
    for word in SUSPECT:
        if contains(title, word) and not contains(song, word):
            s -= 2
    if (entry.get("duration") or 0) > 8 * 60:
        s -= 2
    return s


def close(text, phrase):
    """Whether some run of words in text is at least 80% similar to phrase."""
    words, n = text.split(), len(phrase.split())
    return any(SequenceMatcher(None, " ".join(words[i:i + n]), phrase).ratio() >= 0.8
               for i in range(max(1, len(words) - n + 1)))


def query(text):
    options = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(options) as ydl:
        try:
            info = ydl.extract_info(f"ytsearch{RESULTS}:{text}", download=False)
        except Exception as e:  # noqa: BLE001 - one failed search shouldn't stop the rest
            print(f"{text}: {e}", file=sys.stderr)
            return []
    return [e for e in info.get("entries") or [] if e and e.get("id")]


def search(song, performer, songwriters="", previous=()):
    """The results for "<song> <performer>", and if none scores high, "<song> <songwriters>" too
    (which finds songs whose performer is misspelt), plus any previous candidates, best first, as
    (score, entry)."""
    found = query(f"{song} {performer}")
    ids = {e["id"] for e in found}
    entries = found + [e for e in previous if e["id"] not in ids]
    rank = lambda es: sorted(((score(e, fold(song), fold(performer)), e) for e in es), key=lambda x: -x[0])
    results = rank(entries)
    if songwriters and (not results or results[0][0] < 6):
        seen = {e["id"] for e in entries}
        results = rank(entries + [e for e in query(f"{song} {songwriters}") if e["id"] not in seen])
    return results


def confidence(s):
    return "high" if s >= 6 else "medium" if s >= 3 else "low"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet")
    parser.add_argument("output")
    parser.add_argument("--limit", type=int, help="only search for the first N songs without links")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--rows", help="only search for these sheet rows (comma-separated row numbers)")
    parser.add_argument("--previous", action="append", default=[], help="an earlier run's OUTPUT_CSV (repeatable)")
    args = parser.parse_args()

    # earlier suggestions, by sheet row, as search entries
    previous = {}
    for path in args.previous:
        with open(path, encoding="utf8") as f:
            for p in list(csv.DictReader(f)):
                if not p["Suggested link"]:
                    continue
                m, s = (p["Duration"].split(":") + ["0"])[:2] if p["Duration"] else (0, 0)
                previous.setdefault(int(p["Row"]), []).append({
                    "id": p["Suggested link"].rsplit("/", 1)[1], "title": p["Title"], "channel": p["Channel"],
                    "duration": int(m) * 60 + int(s) if p["Duration"] else None})

    with open(args.sheet, encoding="utf8") as f:
        rows = list(csv.reader(f))
    header = rows[0]
    col = {name: header.index(name) for name in ["Song name", "Performer name", "YouTube link"]}
    year = header.index("Year") if "Year" in header else None
    writers = next((i for i, h in enumerate(header) if "songwriter" in h.lower()), None)
    songs = [(n, r) for n, r in enumerate(rows[1:], start=2) if any(r) and r[col["Song name"]].strip()]
    todo = [(n, r) for n, r in songs if not r[col["YouTube link"]].strip()]
    if args.rows:
        wanted = {int(n) for n in args.rows.split(",")}
        todo = [(n, r) for n, r in todo if n in wanted]
    todo = todo[: args.limit]

    def run(item):
        n, r = item
        return n, search(r[col["Song name"]].strip(), r[col["Performer name"]].strip(),
                         r[writers].strip() if writers is not None else "", previous.get(n, []))

    found = {}
    with ThreadPoolExecutor(args.threads) as pool:
        for i, (n, results) in enumerate(pool.map(run, todo), start=1):
            found[n] = results
            if i % 25 == 0:
                print(f"{i}/{len(todo)}", file=sys.stderr)

    url = lambda e: f"https://youtu.be/{e['id']}"
    counts = {"high": 0, "medium": 0, "low": 0, "none": 0}
    with open(args.output, "w", encoding="utf8", newline="") as f, \
         open(re.sub(r"\.csv$", "", args.output) + ".txt", "w", encoding="utf8") as links:
        out = csv.writer(f)
        out.writerow(["Row", "Year", "Song", "Performer", "Existing link", "Suggested link", "Confidence",
                      "Title", "Channel", "Duration", "Runner-up 1", "Runner-up 2"])
        for n, r in songs:
            existing = r[col["YouTube link"]].strip()
            results = found.get(n, [])
            best = results[0] if results else None
            level = confidence(best[0]) if best else ("" if existing or n not in found else "none")
            if level:
                counts[level] += 1
            duration = best[1].get("duration") if best else None
            out.writerow([n, r[year] if year is not None else "", r[col["Song name"]], r[col["Performer name"]], existing,
                          url(best[1]) if best else "", level, best[1].get("title", "") if best else "",
                          (best[1].get("channel") or best[1].get("uploader") or "") if best else "",
                          f"{int(duration) // 60}:{int(duration) % 60:02}" if duration else "",
                          *([url(e) for _, e in results[1:3]] + ["", ""])[:2]])
            links.write((existing or (url(best[1]) if best and level == "high" else "")) + "\n")
    print(f"Searched {len(todo)} songs: " + ", ".join(f"{v} {k}" for k, v in counts.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
