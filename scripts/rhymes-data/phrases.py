"""Stress for phrase pronunciations built from their words' pronunciations (in the data file's codes).

Function words (articles, prepositions, conjunctions, pronouns, auxiliaries, and the placeholders
that Wiktionary uses in idioms, like one's and someone) are unstressed. The last other word, or a
final particle (give up, log in), takes the primary stress, and earlier words keep theirs as
secondary stress. Compounds stressed on their first word (hot dog) are treated the same, so they
rhyme on their last word.
"""

import re

FUNCTION_WORDS = set("""
a an the
of to in on at by for with from into onto upon about as than via per off out up down over
and or but nor if that
i me my mine you your yours he him his she her hers it its we us our ours they them their theirs
one's oneself someone someone's somebody somebody's something anyone anyone's anything
who whom whose which
is are was were be been being am do does did has have had will would shall should can could may
might must 's 'd 'll 're 've
""".split())
PARTICLES = set("up down out off in on over away back around about through along by apart aside".split())


def stressed_word(parts):
    """The index of the word that takes the primary stress."""
    for i in range(len(parts) - 1, -1, -1):
        word = parts[i].lower()
        if word not in FUNCTION_WORDS or (i == len(parts) - 1 and word in PARTICLES):
            return i
    return len(parts) - 1


def phrase_pronunciation(parts, codes):
    """A phrase's pronunciation from its words and their pronunciations (in codes)."""
    main = stressed_word(parts)
    out = []
    for i, (word, code) in enumerate(zip(parts, codes)):
        if i == main:
            out.append(code)
        elif word.lower() in FUNCTION_WORDS and not (i == len(parts) - 1 and word.lower() in PARTICLES):
            out.append(re.sub("[12]", "", code))
        else:
            out.append(code.replace("1", "2"))
    return " ".join(out)
