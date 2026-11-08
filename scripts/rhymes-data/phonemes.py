"""Phoneme conversion for the Rhymes data: CMUdict, Wiktionary IPA and enPR, all to one General American
phoneme set.

The phoneme set is CMUdict's 39 phonemes. A pronunciation is a tuple of phonemes; vowels carry a stress
digit (0 unstressed, 1 primary, 2 secondary), and " " marks a word boundary in a phrase. In the data file
each phoneme is one ASCII character (CODES), with a stress digit after a vowel only when it's stressed.
"""

import re
from itertools import product

# --- The phoneme set and its one-character codes

VOWELS = {"AA": "A", "AE": "a", "AH": "V", "AO": "O", "AW": "W", "AY": "Y", "EH": "E", "ER": "R", "EY": "e",
          "IH": "I", "IY": "i", "OW": "o", "OY": "Q", "UH": "U", "UW": "u"}
CONSONANTS = {"B": "b", "CH": "C", "D": "d", "DH": "D", "F": "f", "G": "g", "HH": "h", "JH": "J", "K": "k",
              "L": "l", "M": "m", "N": "n", "NG": "N", "P": "p", "R": "r", "S": "s", "SH": "S", "T": "t",
              "TH": "T", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "Z"}
CODES = {**VOWELS, **CONSONANTS, " ": " "}

# IPA for display (AH and ER depend on stress)
IPA = {"AA": "ɑ", "AE": "æ", "AO": "ɔ", "AW": "aʊ", "AY": "aɪ", "EH": "ɛ", "EY": "eɪ", "IH": "ɪ", "IY": "i",
       "OW": "oʊ", "OY": "ɔɪ", "UH": "ʊ", "UW": "u", "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f",
       "G": "ɡ", "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ",
       "S": "s", "SH": "ʃ", "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ", " ": " "}


class Unparsed(ValueError):
    pass


def is_vowel(p):
    return p[-1].isdigit()


def encode(pron):
    return "".join(CODES[p[:-1]] + (p[-1] if p[-1] in "12" else "") if is_vowel(p) else CODES[p] for p in pron)


def to_ipa(pron):
    out = []
    for p in pron:
        if not is_vowel(p):
            out.append(IPA[p])
            continue
        base, s = p[:-1], p[-1]
        v = {"AH": "ʌ" if s in "12" else "ə", "ER": "ɝ" if s in "12" else "ɚ"}.get(base) or IPA[base]
        out.append({"1": "ˈ", "2": "ˌ"}.get(s, "") + v)
    return "".join(out)


# --- Normalisation shared by all sources

PRE_R = {"IY": "IH", "EY": "EH", "OW": "AO", "UW": "UH"}  # vowels General American doesn't contrast before r


def normalise(pron):
    """CMUdict's conventions: one vowel for each pre-r set, IH before NG, ER for unstressed ə + r unless a
    stressed vowel follows (delivery, but around), and no R after ER."""
    p, out, i = list(pron), [], 0
    while i < len(p):
        x = p[i]
        nxt = p[i + 1] if i + 1 < len(p) else None
        after = p[i + 2] if i + 2 < len(p) else None
        if is_vowel(x) and nxt == "R" and x[:-1] in PRE_R:
            x = PRE_R[x[:-1]] + x[-1]
        elif is_vowel(x) and nxt == "NG" and x[:-1] == "IY":
            x = "IH" + x[-1]
        if x == "AH0" and nxt == "R" and not (after and is_vowel(after) and after[-1] in "12"):
            x = "ER0"
        if x[:-1] == "ER" and is_vowel(x) and nxt == "R" and not (after and is_vowel(after) and after[-1] in "12"):
            out.append(x)
            i += 2
            continue
        out.append(x)
        i += 1
    return tuple(out)


def stress_pattern(pron):
    """The stress digits of a pronunciation's vowels, such as ("1", "0") for happy."""
    return tuple(p[-1] for p in pron if is_vowel(p))


def _stressable(word):
    """The index of the vowel to stress in a word with no stress marks: its only full vowel, ignoring
    first a final i or ɪ (happy, sanctions), and then any ɪ, ʊ or ɚ (scalar), or the first of these if
    that's all there is (tickler). Returns -1 if the word
    only has schwas (a function word in a phrase), or None if it can't tell."""
    vs = [i for i, x in enumerate(word) if is_vowel(x)]
    full = [i for i in vs if word[i] != "AH0"]
    if not full:
        return -1
    last = vs[-1]
    no_final = [i for i in full if not (i == last and word[i][:-1] in ("IY", "IH"))]
    no_weak = [i for i in no_final if word[i][:-1] not in ("IH", "UH", "ER")]
    for candidates in (full, no_final, no_weak):
        if len(candidates) == 1:
            return candidates[0]
        if not candidates:  # only weak vowels (tickler): English tends to stress the first
            return (no_final or full)[0]
    return None


def add_stress(pron, patterns=()):
    """Stress a pronunciation that has no stress marks at all. If exactly one of the stress patterns
    given (from other pronunciations of the word) has as many vowels, use it; otherwise stress what
    looks like the only full vowel of each word. Returns None if neither works."""
    if any(is_vowel(p) and p[-1] in "12" for p in pron):
        return pron
    vowels = [i for i, p in enumerate(pron) if is_vowel(p)]
    fits = {pt for pt in patterns if len(pt) == len(vowels) and "1" in pt}
    if len(fits) == 1:
        out = list(pron)
        for i, d in zip(vowels, fits.pop()):
            out[i] = out[i][:-1] + d
        return tuple(out)
    words, cur = [], []
    for p in pron:
        if p == " ":
            words.append(cur)
            cur = []
        else:
            cur.append(p)
    words.append(cur)
    for w in words:
        k = _stressable(w)
        if k is None:
            return None
        if k >= 0:
            w[k] = w[k][:-1] + "1"
    return tuple(p for k, w in enumerate(words) for p in ([" "] if k else []) + w)


# --- CMUdict


def from_arpabet(s):
    """A CMUdict pronunciation, or None for the few with several vowels and no stress at all. If one
    only has secondary stress, the first secondary stress becomes primary."""
    pron = list(s.split())
    vowels = [i for i, p in enumerate(pron) if is_vowel(p)]
    if len(vowels) > 1 and not any(pron[i].endswith("1") for i in vowels):
        secondary = [i for i in vowels if pron[i].endswith("2")]
        if not secondary:
            return None
        pron[secondary[0]] = pron[secondary[0]][:-1] + "1"
    return normalise(tuple(pron))


# --- Wiktionary IPA

IPA_VOWELS = [
    ("ɛəɹ", "EH R"), ("eəɹ", "EH R"), ("ɔəɹ", "AO R"), ("oəɹ", "AO R"), ("ʊəɹ", "UH R"), ("ɪəɹ", "IH R"),
    ("ɝ", "ER"), ("ɚ", "ER"), ("ɜɹ", "ER"), ("ɜ", "ER"),
    ("eɪ", "EY"), ("ei", "EY"), ("aɪ", "AY"), ("ai", "AY"), ("aj", "AY"), ("ɑɪ", "AY"), ("äɪ", "AY"),
    ("ʌʊ", "AW"), ("æʊ", "AW"), ("ɐʊ", "AW"), ("ʌɪ", "AY"), ("ɐɪ", "AY"),  # Canadian raising
    ("ɛɚ", "EH R"), ("eɚ", "EH R"), ("ɪɚ", "IH R"), ("ʊɚ", "UH R"), ("ɔɚ", "AO R"), ("oɚ", "AO R"),
    ("aʊ", "AW"), ("au", "AW"), ("ɔɪ", "OY"), ("oɪ", "OY"), ("oʊ", "OW"), ("ou", "OW"),
    ("i", "IY"), ("ɪ", "IH"), ("e", "EH"), ("ɛ", "EH"), ("æ", "AE"), ("ɑ", "AA"), ("a", "AA"), ("ä", "AA"),
    ("ɔ", "AO"), ("o", "OW"), ("ʊ", "UH"), ("u", "UW"), ("ʌ", "AH"), ("ə", "AH"),
]
IPA_CONSONANTS = [
    ("tʃ", "CH"), ("dʒ", "JH"), ("l̩", "AH L"), ("n̩", "AH N"), ("m̩", "AH M"), ("ŋ̍", "AH NG"),
    ("p", "P"), ("b", "B"), ("t", "T"), ("d", "D"), ("k", "K"), ("ɡ", "G"), ("g", "G"), ("f", "F"),
    ("v", "V"), ("θ", "TH"), ("ð", "DH"), ("s", "S"), ("z", "Z"), ("ʃ", "SH"), ("ʒ", "ZH"), ("h", "HH"),
    ("m", "M"), ("n", "N"), ("ŋ", "NG"), ("l", "L"), ("ɹ", "R"), ("r", "R"), ("j", "Y"), ("w", "W"),
    ("x", "K"), ("ʔ", "T"),
]
IPA_TOKENS = sorted(IPA_VOWELS + IPA_CONSONANTS, key=lambda t: -len(t[0]))
IPA_DROP = set("ːˑ̯͜͡ʰ̥̪̞̝̠̟̬ʷ̻̆̊͆̚ˠ|")  # narrow detail that doesn't change the phoneme
IPA_REPLACE = [("⁽", "("), ("⁾", ")"), ("₍", "("), ("₎", ")"), ("‿", " "), ("ɝɹ", "ɝ"), ("ɚɹ", "ɚ"),
               ("ɫ", "l"), ("ʍ", "w"), ("ɨ", "ɪ"), ("ᵻ", "ɪ"), ("ɪ̈", "ɪ"), ("ɘ", "ə"), ("ɱ", "m"),
               ("ɹ̩", "ɚ"), ("ɻ", "ɹ"), ("ɒ", "ɑ"), ("ʧ", "tʃ"), ("ʤ", "dʒ")]


def ipa_bodies(ipa):
    """The phonemic /…/ transcriptions in a Wiktionary IPA string (phonetic [ ] ones are ignored)."""
    return [b.strip() for m in re.findall(r"/([^/]+)/", ipa) for b in m.split(",") if b.strip()]


def expand_optional(s, limit=4):
    """Expand optional (…) parts into all variants (or just the shortest and longest if there are many)."""
    groups = re.findall(r"\(([^()]*)\)", s)
    parts = re.split(r"\([^()]*\)", s)
    if any("(" in x or ")" in x for x in parts):
        raise Unparsed("unbalanced parentheses")
    if not groups:
        return [s]
    choices = list(product([False, True], repeat=len(groups))) if len(groups) <= limit else [
        (False,) * len(groups), (True,) * len(groups)]
    return ["".join([parts[0]] + [(g if use else "") + rest for g, use, rest in zip(groups, c, parts[1:])])
            for c in choices]


def from_ipa(body, word="", patterns=()):
    """Convert one phonemic IPA transcription (without slashes) to a list of pronunciations. If it has
    no stress marks, the stress patterns of other pronunciations of the word can help (add_stress)."""
    if body.startswith("-") or body.endswith("-"):
        raise Unparsed("fragment")
    s = re.sub(r"\([ɹr]\)", "ɹ", body)  # optional r means "in rhotic accents"
    for a, b in IPA_REPLACE:
        s = s.replace(a, b)
    s = "".join(ch for ch in s if ch not in IPA_DROP).replace("-", " ")
    s = s.replace("ɾ", "d" if "d" in word.lower() and "t" not in word.lower() else "t")  # flap: t or d
    s = re.sub("̃(?=[mnŋ])", "", s).replace("̃", "n")  # nasal vowels
    out = []
    for v in expand_optional(s):
        pron, stress, i = [], "0", 0
        while i < len(v):
            c = v[i]
            if c in "ˈˌ":
                stress = "1" if c == "ˈ" else "2"
                i += 1
            elif c == ".":  # syllable break: symbols on either side don't combine
                i += 1
            elif c == " ":
                if pron and pron[-1] != " ":
                    pron.append(" ")
                i += 1
            else:
                for t, ph in IPA_TOKENS:
                    if v.startswith(t, i):
                        for p in ph.split():
                            if p in VOWELS:
                                pron.append(p + ("3" if t == "ʌ" and stress == "0" else stress))
                                stress = "0"
                            else:
                                pron.append(p)
                        i += len(t)
                        break
                else:
                    raise Unparsed(f"symbol {c}")
        while pron and pron[-1] == " ":
            pron.pop()
        if not any(is_vowel(p) for p in pron):
            raise Unparsed("no vowel")
        stressed = add_stress(tuple(pron), patterns)
        if stressed is None:
            raise Unparsed("no stress")
        out.append(normalise(tuple("AH2" if p == "AH3" else p for p in stressed)))
    return out


# --- British (RP) to General American, for Wiktionary entries with no American pronunciation

IPA_NUCLEUS = re.compile("[ɑɒɔɜəɛeɪʊiuæʌoa]+")
R_CANDIDATE = re.compile("(ɑ|ɔ|ə|ɪə|ʊə)$")


def uk_to_us(body, word):
    """Convert an RP transcription (without slashes) to General American IPA, or raise Unparsed. Lost r's
    come from (ɹ) notation if the transcription uses it, and otherwise from the spelling."""
    s = body.replace("ɛː", "ɛə").replace("eː", "ɛə").replace("ɛ(ə)", "ɛə")  # SQUARE, old and new notation
    s = s.replace("ː", "").replace("̯", "").replace("ɐ", "ʌ").replace("əʊ", "oʊ")
    if re.search(r"\([ɹr]\)", s):
        s = re.sub(r"\([ɹr]\)", "ɹ", s)
    else:
        s = restore_r(s, word)
    s = re.sub("ɜ(?!ɹ)", "ɜɹ", s)
    s = re.sub("[ɛe]ə?ɹ", "ɛɹ", s)
    s = re.sub("[ɛe]ə", "ɛɹ", s)  # SQUARE always has r
    s = s.replace("ɪəɹ", "ɪɹ").replace("ʊəɹ", "ʊɹ").replace("ɔəɹ", "ɔɹ").replace("ɜɹ", "ɝ")
    s = re.sub("ɑ(?=[fθs]|n[stdʃ]|mp)", "æ", s)  # BATH (ɑ here is never LOT: that's still ɒ)
    s = s.replace("ɒ", "ɑ")
    if re.search("(y|ie|ey|i)$", word.lower()):
        s = re.sub("(?<![aeoɔɑəʊɛ])ɪ$", "i", s)  # happY
    return s


def restore_r(s, word):
    """Restore the r's of non-rhotic RP from the spelling, by lining up the IPA vowels with the spelling's
    vowel groups and giving an r to vowels followed by an r that isn't followed by a sounded vowel."""
    w = word.lower()
    w = re.sub("([^aeiouy])re(s|d)?$", r"\1er\2", w)  # centre, acres
    w = re.sub("([aeiouy]r)e(s|d)?$", r"\1\2", w)  # fire, cured
    w = re.sub("([^aeiouy])e$", r"\1", w)  # silent e
    w = re.sub("([^aeiouytd])ed$", r"\1d", w)  # corked
    w = re.sub("([^aeiouyszxhgc])es$", r"\1s", w)  # lakes
    groups = list(re.finditer("[aeiou]+y?|(?<![aeiou])y(?![aeiou])|y$", w))
    r_after = [bool(re.match("r+(?![aeiouy])", w[g.end():])) for g in groups]
    s = re.sub("ɜ(?!ɹ)", "ɜɹ", s)  # NURSE always has r
    if not any(r_after):
        return re.sub("([ɪʊ])ə(?![ɹr])", lambda m: "iə" if m.group(1) == "ɪ" else "uə", s)
    nuclei = list(IPA_NUCLEUS.finditer(s))
    cands = [m for m in nuclei if R_CANDIDATE.search(m.group()) and s[m.end():m.end() + 1] not in ("ɹ", "r")]
    if not cands:
        return s
    if len(nuclei) != len(groups):
        raise Unparsed("can't line up the spelling to restore r")
    out, last = "", 0
    for m, r in zip(nuclei, r_after):
        out += s[last:m.end()]
        if r and m in cands:
            out += "ɹ"
        last = m.end()
    return out + s[last:]


# --- enPR

ENPR = sorted([
    ("o͝o", "ʊ"), ("ŏŏ", "ʊ"), ("o͞o", "u"), ("ōō", "u"), ("oi", "ɔɪ"), ("ou", "aʊ"), ("ûr", "ɝ"),
    ("hw", "w"), ("ch", "tʃ"), ("sh", "ʃ"), ("zh", "ʒ"), ("ng", "ŋ"), ("kh", "x"), ("TH", "TH"),
    ("ä", "ɑ"), ("ă", "æ"), ("ǎ", "æ"), ("ā", "eɪ"), ("ĕ", "ɛ"), ("ě", "ɛ"), ("ē", "i"), ("ĭ", "ɪ"),
    ("ǐ", "ɪ"), ("i", "ɪ"), ("ī", "aɪ"), ("ŏ", "ɑ"), ("ǒ", "ɑ"), ("ō", "oʊ"), ("ô", "ɔ"), ("ŭ", "ʌ"),
    ("ǔ", "ʌ"), ("ə", "ə"), ("â", "ɛ"), ("ê", "ɛ"), ("î", "ɪ"), ("û", "ɝ"), ("ü", "u"), ("ɴ", "n"),
    ("b", "b"), ("d", "d"), ("f", "f"), ("g", "ɡ"), ("h", "h"), ("j", "dʒ"), ("k", "k"), ("l", "l"),
    ("m", "m"), ("n", "n"), ("p", "p"), ("r", "ɹ"), ("s", "s"), ("t", "t"), ("v", "v"), ("w", "w"),
    ("y", "j"), ("z", "z"),
], key=lambda t: -len(t[0]))
ENPR_VOWELS = set("ɑæeɛiɪaoɔʌəʊuɝ")
ENPR_PRIMARY = "ʹ′'’´ˊ"
ENPR_SECONDARY = "″ʺ"


def from_enpr(enpr):
    """Convert enPR to IPA, one string for each reading of "th" (enPR writes θ and ð the same)."""
    if re.match(r"\s*[-—‒]|.*-\s*$", enpr):
        raise Unparsed("fragment")
    s = enpr.replace("th", "TH")
    out, last_vowel, i = [], None, 0
    while i < len(s):
        c = s[i]
        if c in ENPR_PRIMARY + ENPR_SECONDARY:  # marks follow the stressed syllable
            if last_vowel is None:
                raise Unparsed("stress mark before a vowel")
            out.insert(last_vowel, "ˈ" if c in ENPR_PRIMARY else "ˌ")
            last_vowel = None
            i += 1
        elif c in "ˈˌ()":  # IPA-style marks precede the syllable
            out.append(c)
            i += 1
        elif c in "-·• ":
            out.append(" " if c == " " else "")
            i += 1
        else:
            for t, v in ENPR:
                if s.startswith(t, i):
                    if v[0] in ENPR_VOWELS:
                        last_vowel = len(out)
                    out.append(v)
                    i += len(t)
                    break
            else:
                raise Unparsed(f"enPR symbol {c}")
    words = []
    for w in "".join(out).split(" "):  # several primary marks in a word: keep the first
        k = w.find("ˈ")
        words.append(w if k < 0 else w[:k + 1] + w[k + 1:].replace("ˈ", "ˌ"))
    ipa = " ".join(words)
    n = ipa.count("TH")
    if n > 3:
        raise Unparsed("too many th")
    readings = []
    for choice in product("θð", repeat=n):
        r = ipa
        for ch in choice:
            r = r.replace("TH", ch, 1)
        readings.append(r)
    return readings


def guess_th(word, readings):
    """Of the readings of an enPR "th", pick the one that matches the spelling best: ð in function words
    (the, this, though) and before a final -e, -er(s), -ern, -ed or -es (breathe, father, northern), θ
    otherwise."""
    w = word.lower()
    want = []
    for m in re.finditer("th", w):
        before, after = w[:m.start()], w[m.end():]
        voiced = (not before and re.fullmatch("e[ymn]?|is|at|ose|ere|ese|ough|us|an|ither", after)) or \
            re.fullmatch("e|ers?|ern|ed|es", after)
        want.append("ð" if voiced else "θ")
    for r in readings:
        if [c for c in r if c in "θð"] == want:
            return r
    return readings[0]
