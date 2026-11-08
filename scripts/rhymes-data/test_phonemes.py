"""Tests for phonemes.py: python3 -m unittest discover scripts/rhymes-data"""

import unittest

from phonemes import Unparsed, encode, from_arpabet, from_enpr, from_ipa, guess_th, ipa_bodies, to_ipa, uk_to_us


def ipa(body, word=""):
    return sorted(encode(p) for p in from_ipa(body, word))


def uk(body, word):
    return ipa(uk_to_us(body, word), word)


def enpr(s, word):
    return ipa(guess_th(word, from_enpr(s)), word)


class CMUdict(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(encode(from_arpabet("K AE1 T")), "ka1t")
        self.assertEqual(encode(from_arpabet("HH AH1 M B AH2 G")), "hV1mbV2g")

    def test_pre_r(self):
        self.assertEqual(encode(from_arpabet("HH IY1 R OW0")), "hI1ro")
        self.assertEqual(encode(from_arpabet("G UW1 R UW2")), "gU1ru2")

    def test_er(self):
        self.assertEqual(encode(from_arpabet("D IH0 L IH1 V AH0 R IY0")), "dIlI1vRi")
        self.assertEqual(encode(from_arpabet("AH0 R AW1 N D")), "VrW1nd")

    def test_display(self):
        self.assertEqual(to_ipa(from_arpabet("HH AH1 M B AH2 G")), "hˈʌmbˌʌɡ")
        self.assertEqual(to_ipa(from_arpabet("B ER1 D ER0")), "bˈɝdɚ")


class IPA(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(ipa("ˈkæt"), ["ka1t"])
        self.assertEqual(ipa("ˈdɪk.ʃəˌnɛ.ɹi"), ["dI1kSVnE2ri"])

    def test_monosyllable_stress(self):
        self.assertEqual(ipa("kæt"), ["ka1t"])
        self.assertEqual(ipa("ðə"), ["DV"])
        with self.assertRaises(Unparsed):
            ipa("kætoʊ")

    def test_guessed_stress(self):
        self.assertEqual(ipa("flʌfi"), ["flV1fi"])
        self.assertEqual(ipa("sæŋkʃɪnz"), ["sa1NkSInz"])
        self.assertEqual(ipa("skeɪ.lɚ"), ["ske1lR"])
        self.assertEqual(ipa("ɚli"), ["R1li"])
        self.assertEqual(ipa("tɪkəlɚ faɪl"), ["tI1kVlR fY1l"])
        with self.assertRaises(Unparsed):
            ipa("bɑɹloʊ")
        # from another pronunciation of the word with as many vowels
        self.assertEqual(sorted(encode(p) for p in from_ipa("bɑɹloʊ", "Barlow", [("1", "0")])), ["bA1rlo"])
        with self.assertRaises(Unparsed):
            from_ipa("bɑɹloʊ", "Barlow", [("1",), ("0", "1", "0")])

    def test_raising_and_r(self):
        self.assertEqual(ipa("mʌʊs"), ["mW1s"])
        self.assertEqual(ipa("wʌɪ(ə)ɹ"), ["wY1R", "wY1r"])
        self.assertEqual(ipa("ðɛɚ"), ["DE1r"])
        self.assertEqual(ipa("ɪɚ"), ["I1r"])
        self.assertEqual(ipa("ˈwiː.ɚ"), ["wi1R"])

    def test_optional(self):
        self.assertEqual(ipa("ˈɪn(t)ʃ"), ["I1nC", "I1nS"])
        self.assertEqual(ipa("ˈfɑ.ðɚ"), ipa("ˈfɑ.ðə(ɹ)"))

    def test_rhotics(self):
        self.assertEqual(ipa("dɪˈlɪv.ə.ɹi"), ipa("dɪˈlɪv.ɚ.i"))
        self.assertEqual(ipa("ˈfɝɹi"), ["fR1i"])
        self.assertEqual(ipa("nɪɹ"), ipa("niɹ"))
        self.assertEqual(ipa("ˈwɛɹi"), ipa("ˈweɹi"))
        self.assertEqual(ipa("hɔɹs"), ipa("hoɹs"))
        self.assertEqual(ipa("əˈɹaʊnd"), ["VrW1nd"])

    def test_syllabic(self):
        self.assertEqual(ipa("ˈbɑtl̩"), ["bA1tVl"])
        self.assertEqual(ipa("ˈbʌʔn̩"), ["bV1tVn"])

    def test_narrow_detail(self):
        self.assertEqual(ipa("ˈpaʊ̯nd"), ["pW1nd"])
        self.assertEqual(ipa("ˈθiŋ"), ["TI1N"])
        self.assertEqual(ipa("ˈwɔɾɚ", "water"), ["wO1tR"])
        self.assertEqual(ipa("t͡ʃɑɹm"), ["CA1rm"])

    def test_strut(self):
        self.assertEqual(ipa("dʌvz"), ["dV1vz"])
        self.assertEqual(ipa("ˈhʌmbʌɡ"), ["hV1mbV2g"])
        self.assertEqual(ipa("ˈkɒt"), ["kA1t"])

    def test_phrase(self):
        self.assertEqual(ipa("ˈaɪs ˌkɹim"), ["Y1s kri2m"])

    def test_fragment(self):
        with self.assertRaises(Unparsed):
            ipa("-ɾi")

    def test_bodies(self):
        self.assertEqual(ipa_bodies("/twɛlfθ/ [tʰw̥ɛɫfθ]"), ["twɛlfθ"])
        self.assertEqual(ipa_bodies("/a/, /b/"), ["a", "b"])


class British(unittest.TestCase):
    def test_r_notation(self):
        self.assertEqual(uk("ˈlɑː(ɹ)v", "larve"), ["lA1rv"])
        self.assertEqual(uk("mɪskənˈd͡ʒɛkt͡ʃə(ɹ)", "misconjecture"), ["mIskVnJE1kCR"])

    def test_restore_r(self):
        self.assertEqual(uk("ˈfɑːðə", "father"), ["fA1DR"])
        self.assertEqual(uk("ˈkɒmə", "comma"), ["kA1mV"])
        self.assertEqual(uk("kɑːd", "card"), ["kA1rd"])
        self.assertEqual(uk("ˈsɛntə", "centre"), ["sE1ntR"])
        self.assertEqual(uk("ʃɔː", "shore"), ["SO1r"])
        self.assertEqual(uk("ʃɔː", "shaw"), ["SO1"])
        self.assertEqual(uk("nɪə", "near"), ["nI1r"])
        self.assertEqual(uk("aɪˈdɪə", "idea"), ["Ydi1V"])
        self.assertEqual(uk("wɜːd", "word"), ["wR1d"])
        self.assertEqual(uk("kɛə", "care"), ["kE1r"])
        self.assertEqual(uk("kɛː", "care"), ["kE1r"])
        self.assertEqual(uk("bækˈtɪəɹɪsaɪd", "bactericide"), ["baktI1rIsYd"])
        self.assertEqual(uk("kɔːkt", "corked"), ["kO1rkt"])

    def test_vowels(self):
        self.assertEqual(uk("ˈjəʊdə", "Yoda"), ["jo1dV"])
        self.assertEqual(uk("dɑːns", "dance"), ["da1ns"])
        self.assertEqual(uk("pɑːθ", "path"), ["pa1T"])
        self.assertEqual(uk("kɒst", "cost"), ["kA1st"])
        self.assertEqual(uk("pɑːz", "parse"), ["pA1rz"])
        self.assertEqual(uk("ˈhæpɪ", "happy"), ["ha1pi"])
        self.assertEqual(uk("nɔɪ", "noy"), ["nQ1"])


class EnPR(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(enpr("kăt", "cat"), ["ka1t"])
        self.assertEqual(enpr("dĭk'shə-nĕr-ē", "dictionary"), ["dI1kSVnEri"])
        self.assertEqual(enpr("ăn″tĭ-kwâr′ē-ən", "antiquarian"), ["a2ntIkwE1riVn"])
        self.assertEqual(enpr("wo͝ofʹər", "woofer"), ["wU1fR"])
        self.assertEqual(enpr("wûrd", "word"), ["wR1d"])

    def test_fragment(self):
        with self.assertRaises(Unparsed):
            from_enpr("-năzh")
        with self.assertRaises(Unparsed):
            from_enpr("ĕs-")

    def test_th(self):
        self.assertEqual(enpr("fä'thər", "father"), ["fA1DR"])
        self.assertEqual(enpr("brēth", "breathe"), ["bri1D"])
        self.assertEqual(enpr("brĕth", "breath"), ["brE1T"])
        self.assertEqual(enpr("thĭn", "thin"), ["TI1n"])
        self.assertEqual(enpr("thĭs", "this"), ["DI1s"])


if __name__ == "__main__":
    unittest.main()
