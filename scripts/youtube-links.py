"""Suggest YouTube links for the songs in a playlist sheet, for checking by hand.

Usage: uv run --with yt-dlp python scripts/youtube-links.py SHEET_CSV OUTPUT_CSV [--limit N] [--rows N,N,...]

SHEET_CSV is a playlist sheet exported as CSV, with columns named "Song name" (or "Song"), "Performer name"
(or "Artist") and "YouTube link" (and optionally "Album", "ISRC", "Apple ID", and one with "songwriter" in its
name). For each song without a link, searches
YouTube and YouTube Music (which often finds the official track when YouTube doesn't) for
"<song> <performer>" (and YouTube for "<song> <songwriters>" if nothing matches well) and scores the
top results:
- the title contains the song name (ignoring case, accents and punctuation, with Cyrillic transliterated):
  +3, or something close to it (as with variant transliterations): +2
- the channel is the performer's auto-generated "<performer> - Topic" channel (official releases, so
  usually the exact recording): +5, or (close to) the performer's own channel: +4, or the performer is
  named in the title: +3
- the album matches too (for YouTube Music results, when the sheet has albums): +3
- words suggesting a different recording or not the song (live, cover, karaoke, lyrics, fan, ...) that
  aren't in the song name: -2 each, and -2 for videos over 8 minutes (unless the expected length is known)
With an "ISRC" column, YouTube Music is also searched for the ISRC, which often (but not always) finds the
exact recording: such results get +2 if their title matches too. With an "Apple ID" column, each track's
length is looked up on Apple Music (iTunes lookup API), and results within 3 seconds of it get +3 (within 10
seconds: +1), and those more than 15% off get -3: this tells apart recordings of the same classical piece.
Classical titles are written in many ways ("2. Adagio" or "II. Adagio"), so a title with at least 75% of
the song name's words counts as close (+2).
Search results don't always name the channel, so --previous OUTPUT_CSV adds an earlier run's suggestions
(with their titles and channels) to each song's candidates.
The best result is kept with a confidence: high (6 or more: title and performer match), medium (3 to 5)
or low. OUTPUT_CSV has a row per song in the sheet's order (sheet row number, year, song, performer,
the existing link, then the suggestion, its confidence, title, channel and duration, two runner-up
links, its album if known, the Apple Music length and whether the ISRC search found it); a .txt file next to it has just the links (existing, or suggested with high confidence, else
blank), one per line, to paste into the sheet's link column.
"""

import argparse
import csv
import re
import sys
import unicodedata
from urllib.parse import quote
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


def core(song):
    """The song name without bracketed extras: "Kenya (2000 Remastered Version)" → "Kenya"."""
    return re.sub(r"\s*[(\[][^)\]]*[)\]]", "", song).strip() or song


def first_act(performer):
    """The first-named act: "Cedar Walton, George Coleman & Sam Jones" → "Cedar Walton"."""
    return re.split(r"\s*(?:&|,| and | feat\.? | with )\s*", performer)[0] or performer


def overlap(title, phrase):
    """The share of phrase's words (ignoring roman/arabic movement numbers) that are in title."""
    words = [w for w in phrase.split() if not re.fullmatch(r"[ivx]+|\d", w)]
    have = set(title.split())
    return sum(w in have for w in words) / len(words) if words else 0


def score(entry, song, performer, album="", short="", length=None):
    title, channel = fold(entry.get("title") or ""), fold(entry.get("channel") or entry.get("uploader") or "")
    s = 0
    if contains(title, song) or contains(title, short):
        s += 3
    elif song and (close(title, song) or (short and close(title, short)) or overlap(title, short or song) >= 0.75):
        s += 2
    if s and entry.get("isrc"):
        s += 2
    # the same song from the same album (known for YouTube Music results): the same recording, not a
    # rerelease or another take (but not another track from that album)
    if s and album and entry.get("album") and (fold(entry["album"]) == album or close(fold(entry["album"]), album)):
        s += 3
    # performers like "Bing Crosby & Danny Kaye" also match channels for their first-named act
    # (performer isn't folded yet, so that it can be split at commas)
    acts = [fold(performer)] + [fold(a) for a in re.split(r"\s*(?:&|,| and | feat\.? | with )\s*", performer) if a]
    topic = channel.endswith(" topic")
    channel = re.sub(r" topic$", "", channel)
    if channel and any(SequenceMatcher(None, channel, a).ratio() >= 0.85 for a in acts if a):
        s += 5 if topic else 4
    elif any(contains(title, a) for a in acts if a):
        s += 3
    for word in SUSPECT:
        if contains(title, word) and not contains(song, word):
            s -= 2
    duration = entry.get("duration")
    if length and duration:
        off = abs(duration - length)
        s += 3 if off <= 3 else 1 if off <= 10 else -3 if off > 0.15 * length else 0
    elif (duration or 0) > 8 * 60:
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


MUSIC_RESULTS = 3


def music_query(text, results=MUSIC_RESULTS):
    """The top YouTube Music song results for text (the same video IDs as YouTube's). Its search results
    don't name the artist, so each one is looked up for its title, channel and duration."""
    options = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(options) as ydl:
        try:
            info = ydl.extract_info(f"https://music.youtube.com/search?q={quote(text)}#songs", download=False)
            ids = [e["id"] for e in (info.get("entries") or [])[:results] if e and e.get("id")]
        except Exception as e:  # noqa: BLE001 - one failed search shouldn't stop the rest
            print(f"{text} (YouTube Music): {e}", file=sys.stderr)
            return []
    entries = []
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
        for i in ids:
            try:
                e = ydl.extract_info(f"https://www.youtube.com/watch?v={i}", download=False)
                entries.append({"id": i, "title": e.get("title"), "channel": e.get("channel"), "duration": e.get("duration"),
                                "album": e.get("album")})
            except Exception as ex:  # noqa: BLE001
                print(f"{i}: {ex}", file=sys.stderr)
    return entries


def search(song, performer, songwriters="", previous=(), album="", isrc="", length=None):
    """The results for "<song> <performer>" (without bracketed extras like "(feat. …)" or "(Remastered)",
    and with just the first-named performer), on YouTube Music also with the album if known, and if none
    scores high, "<song> <songwriters>" too (which finds songs whose performer is misspelt), plus any
    previous candidates, best first, as (score, entry)."""
    text = f"{core(song)} {first_act(performer)}"
    found = query(text)
    for q in ([f"{text} {core(album)}"] if album else []) + [text]:
        found += [e for e in music_query(q) if e["id"] not in {f["id"] for f in found}]
    if isrc:
        hits = music_query(isrc, 2)
        for e in found:  # already found by name, and by ISRC too
            if e["id"] in {h["id"] for h in hits}:
                e["isrc"] = True
        found += [{**e, "isrc": True} for e in hits if e["id"] not in {f["id"] for f in found}]
    ids = {e["id"] for e in found}
    entries = found + [e for e in previous if e["id"] not in ids]
    rank = lambda es: sorted(((score(e, fold(song), performer, fold(core(album)), fold(core(song)), length), e) for e in es),
                             key=lambda x: -x[0])
    results = rank(entries)
    if songwriters and (not results or results[0][0] < 6):
        seen = {e["id"] for e in entries}
        results = rank(entries + [e for e in query(f"{song} {songwriters}") if e["id"] not in seen])
    return results


def apple_lengths(ids):
    """Track lengths in seconds from Apple Music, by Apple ID (100 per lookup)."""
    import json, urllib.request
    lengths = {}
    ids = [i for i in ids if i]
    for i in range(0, len(ids), 100):
        url = "https://itunes.apple.com/lookup?country=gb&id=" + ",".join(ids[i:i + 100])
        for r in json.load(urllib.request.urlopen(url)).get("results", []):
            if r.get("trackTimeMillis"):
                lengths[str(r["trackId"])] = r["trackTimeMillis"] / 1000
    return lengths


def mmss(seconds):
    return f"{int(seconds) // 60}:{int(seconds) % 60:02}"


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
    named = lambda *names: next((header.index(n) for n in names if n in header), None)
    col = {"Song name": named("Song name", "Song"), "Performer name": named("Performer name", "Artist"),
           "YouTube link": named("YouTube link")}
    if None in col.values():
        sys.exit(f"{args.sheet}: needs song, performer and YouTube link columns")
    isrc, apple = named("ISRC"), named("Apple ID")
    year = header.index("Year") if "Year" in header else None
    album = header.index("Album") if "Album" in header else None
    writers = next((i for i, h in enumerate(header) if "songwriter" in h.lower()), None)
    songs = [(n, r) for n, r in enumerate(rows[1:], start=2) if any(r) and r[col["Song name"]].strip()]
    todo = [(n, r) for n, r in songs if not r[col["YouTube link"]].strip()]
    if args.rows:
        wanted = {int(n) for n in args.rows.split(",")}
        todo = [(n, r) for n, r in todo if n in wanted]
    todo = todo[: args.limit]
    lengths = apple_lengths([r[apple].strip() for _, r in todo]) if apple is not None else {}

    def run(item):
        n, r = item
        return n, search(r[col["Song name"]].strip(), r[col["Performer name"]].strip(),
                         r[writers].strip() if writers is not None else "", previous.get(n, []),
                         r[album].strip() if album is not None else "",
                         r[isrc].strip() if isrc is not None else "",
                         lengths.get(r[apple].strip()) if apple is not None else None)

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
                      "Title", "Channel", "Duration", "Runner-up 1", "Runner-up 2", "Album", "Apple duration", "ISRC match"])
        for n, r in songs:
            existing = r[col["YouTube link"]].strip()
            results = found.get(n, [])
            best = results[0] if results else None
            level = confidence(best[0]) if best else ("" if existing or n not in found else "none")
            if level:
                counts[level] += 1
            duration = best[1].get("duration") if best else None
            length = lengths.get(r[apple].strip()) if apple is not None else None
            out.writerow([n, r[year] if year is not None else "", r[col["Song name"]], r[col["Performer name"]], existing,
                          url(best[1]) if best else "", level, best[1].get("title", "") if best else "",
                          (best[1].get("channel") or best[1].get("uploader") or "") if best else "",
                          mmss(duration) if duration else "",
                          *([url(e) for _, e in results[1:3]] + ["", ""])[:2], (best[1].get("album") or "") if best else "",
                          mmss(length) if length else "", "yes" if best and best[1].get("isrc") else ""])
            links.write((existing or (url(best[1]) if best and level == "high" else "")) + "\n")
    print(f"Searched {len(todo)} songs: " + ", ".join(f"{v} {k}" for k, v in counts.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
