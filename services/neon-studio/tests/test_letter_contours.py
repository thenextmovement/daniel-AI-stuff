import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from shapely.geometry import LineString, Polygon, box
from geometry import _full_shape, _letter_bands, sample_path


class LetterContourTests(unittest.TestCase):
    def test_logo_and_tall_letter_keep_their_own_clearance(self):
        logo=LineString([(0,60),(30,0),(60,60),(30,120),(0,60)])
        letters=[box(x,top,x+30,85).exterior for x,top in ((85,35),(135,35),(185,10),(235,35),(285,35))]
        lines=[logo,*letters]
        names=['Logosymbol']+['Schriftzug CPRO']*len(letters)
        bands=_letter_bands(lines,names,18)
        poly=Polygon(sample_path(_full_shape(lines,18,3,20,bands=bands),128))
        self.assertTrue(poly.is_valid)
        for line in lines:
            self.assertTrue(poly.covers(line))
            self.assertGreaterEqual(poly.exterior.distance(line),17.9)
        for x in (80,115,140,260,280):
            cross=poly.intersection(LineString([(x,-100),(x,200)])).bounds
            self.assertAlmostEqual(cross[1],17,delta=.1)
            self.assertAlmostEqual(cross[3],103,delta=.1)
        self.assertEqual(_letter_bands(lines,['Logosymbol']*len(lines),18),[])
