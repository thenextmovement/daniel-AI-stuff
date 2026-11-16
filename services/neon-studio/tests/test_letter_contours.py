import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from shapely.geometry import LineString, Polygon, box
from geometry import L, M, _full_shape, _letter_bands, _review_cut_to_shape, sample_path


class LetterContourTests(unittest.TestCase):
    def test_export_repairs_flat_or_excessive_recess(self):
        def contour(dip):
            return [M(0,0), L(30,0), L(40,dip), L(50,0), L(80,0),
                    L(80,60), L(0,60), ['h']]
        expected = contour(5)
        reference = Polygon(sample_path(expected))
        neon = [LineString([(18,30),(62,30)])]
        self.assertIs(_review_cut_to_shape(expected, reference, neon, 18), expected)
        for dip in (0, 12):
            with self.subTest(dip=dip):
                repaired = _review_cut_to_shape(contour(dip), reference, neon, 18)
                self.assertTrue(Polygon(sample_path(repaired)).equals(reference))
        with self.assertRaisesRegex(ValueError, 'Neonabstand'):
            _review_cut_to_shape(expected, reference, neon, 25)

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
        recesses=[]
        for x in (80,115,125,140,260,280):
            cross=poly.intersection(LineString([(x,-100),(x,200)])).bounds
            recesses.extend([cross[1]-17,103-cross[3]])
        self.assertGreater(max(recesses),.5)
        self.assertLessEqual(max(recesses),8.7)
        self.assertGreaterEqual(min(recesses),-.1)
        self.assertEqual(_letter_bands(lines,['Logosymbol']*len(lines),18),[])

    def test_anonymous_svg_with_two_rows_steps_down_to_the_longer_row(self):
        lines=[box(0,0,40,88).exterior]
        lines.extend(box(x,10,x+16,38).exterior for x in range(70,166,24))
        lines.extend(box(x,67,x+16,87).exterior for x in range(70,336,24))
        names=[f'Vektorpfad {i+1}' for i in range(len(lines))]
        bands=_letter_bands(lines,names,18)
        poly=Polygon(sample_path(_full_shape(lines,18,3,20,bands=bands),128))
        def upper_at(x):
            return poly.intersection(LineString([(x,-100),(x,200)])).bounds[1]
        for x in (78,102,126,150):
            self.assertAlmostEqual(upper_at(x),-8,delta=.1)
        for x in (198,222,246,270,294,318):
            self.assertAlmostEqual(upper_at(x),49,delta=.1)
        for line in lines:
            self.assertTrue(poly.covers(line))
            self.assertGreaterEqual(poly.exterior.distance(line),17.9)
