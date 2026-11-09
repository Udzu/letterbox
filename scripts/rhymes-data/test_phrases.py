"""Tests for phrases.py: python3 -m unittest discover scripts/rhymes-data"""

import unittest

from phrases import phrase_pronunciation


class Phrases(unittest.TestCase):
    def test_last_content_word(self):
        self.assertEqual(phrase_pronunciation(["sliced", "bread"], ["slY1st", "brE1d"]), "slY2st brE1d")
        self.assertEqual(phrase_pronunciation(["hot", "dog"], ["hA1t", "dO1g"]), "hA2t dO1g")

    def test_function_words(self):
        self.assertEqual(phrase_pronunciation(["side", "of", "caution"], ["sY1d", "V1v", "kO1SVn"]), "sY2d Vv kO1SVn")
        self.assertEqual(phrase_pronunciation(["in", "one's", "hip", "pocket"], ["I1n", "wV1nz", "hI1p", "pA1kVt"]), "In wVnz hI2p pA1kVt")

    def test_final_particle(self):
        self.assertEqual(phrase_pronunciation(["word", "up"], ["wR1d", "V1p"]), "wR2d V1p")
        self.assertEqual(phrase_pronunciation(["log", "in"], ["lO1g", "I1n"]), "lO2g I1n")

    def test_final_function_word(self):
        self.assertEqual(phrase_pronunciation(["could", "use"], ["kU1d", "ju1z"]), "kUd ju1z")
        self.assertEqual(phrase_pronunciation(["come", "to"], ["kV1m", "tu1"]), "kV1m tu")

    def test_only_function_words(self):
        self.assertEqual(phrase_pronunciation(["as", "it", "were"], ["a1z", "I1t", "wR1"]), "az It wR1")

    def test_secondary_stress_kept(self):
        self.assertEqual(phrase_pronunciation(["dictionary", "attack"], ["dI1kSVnE2ri", "Vta1k"]), "dI2kSVnE2ri Vta1k")


if __name__ == "__main__":
    unittest.main()
