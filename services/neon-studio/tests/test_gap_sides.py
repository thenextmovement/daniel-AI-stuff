import io
import sys
import unittest
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server,pdfplumber
from geometry import build_geometry,path_bounds,sample_path
from shapely.geometry import LineString,Polygon
from vector_import import analyze_vector
from export_pdf import make_pdf
SVG=b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200"><path fill="none" stroke="black" d="M10 10H80V50H120V10H190V80H150V120H190V190H120V150H80V190H10V120H50V80H10Z"/></svg>'

class SideGapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.model=analyze_vector(SVG,'fixture.svg')

    def test_gap_is_measured_to_path_without_tube_or_hidden_allowance(self):
        for shape in ('rectangle','bottom','shape'):
            for gap in (10,15,30):
                with self.subTest(shape=shape,gap=gap):
                    d=build_geometry(self.model,{'shape':shape,'gap':gap,'scale':1})
                    outline=Polygon(sample_path(d['outer'],400)).exterior
                    measured=min(outline.distance(LineString(sample_path(p,400))) for p in d['paths'])
                    self.assertAlmostEqual(measured,gap,delta=.1)
                    self.assertAlmostEqual(d['minGap'],measured,delta=.02)
                    self.assertAlmostEqual(d['width'],180+2*gap,places=4)
                    self.assertAlmostEqual(d['height'],180+2*gap,places=4)
                    for fixed_scale in (None,1):
                        a=build_geometry(self.model,{'shape':shape,'gap':gap,'scale':fixed_scale,'tube':6})
                        b=build_geometry(self.model,{'shape':shape,'gap':gap,'scale':fixed_scale,'tube':12,'reserve':5})
                        self.assertEqual(a['outer'],b['outer'])
                        self.assertEqual(a['paths'],b['paths'])
                        self.assertEqual(a['neonMeters'],b['neonMeters'])

    def test_per_side_clearances_preserve_neon_coordinates_and_metres(self):
        for shape in ('rectangle','bottom','shape'):
            base=build_geometry(self.model,{'shape':shape,'scale':1})
            changed=build_geometry(self.model,{'shape':shape,'scale':1,'gapSides':{'left':30,'right':8,'top':22,'bottom':11}})
            for before,after in zip(base['paths'],changed['paths'],strict=True):
                for a,b in zip(before,after,strict=True):
                    self.assertEqual(a[0],b[0])
                    np.testing.assert_allclose(a[1:],b[1:],atol=1e-9,rtol=0)
            self.assertEqual(base['neonMeters'],changed['neonMeters'])
            self.assertAlmostEqual(changed['width'],218,delta=.1)
            self.assertAlmostEqual(changed['height'],213,delta=.1)
            x0,y0,x1,y1=changed['bounds']
            self.assertAlmostEqual(x0,-30,delta=.1);self.assertAlmostEqual(y0,-22,delta=.1)
            self.assertTrue(all(c['ok'] for c in changed['checks']))

    def test_equal_side_overrides_match_global_and_dimensions_resize_correctly(self):
        for shape in ('rectangle','bottom','shape'):
            a=build_geometry(self.model,{'shape':shape,'gap':30})
            b=build_geometry(self.model,{'shape':shape,'gapSides':dict.fromkeys(('left','right','top','bottom'),30)})
            self.assertEqual(a['outer'],b['outer']);self.assertEqual(a['paths'],b['paths'])
            c=build_geometry(self.model,{'shape':shape,'width':800,'gapSides':{'left':30,'right':8}})
            self.assertAlmostEqual(c['width'],800,delta=.1)

    def test_asymmetric_corners_and_large_depth_are_valid(self):
        for sides in ({'left':2,'right':100,'top':2,'bottom':100},{'left':100,'right':2,'top':100,'bottom':2}):
            for shape in ('rectangle','shape','bottom'):
                result=build_geometry(self.model,{'shape':shape,'gapSides':sides,'depth':300,'depthSides':{'left':400,'bottom':500}})
                self.assertTrue(result['exportable'])
        for invalid in ({'left':1},{'top':101},{'right':float('nan')},{'other':15},[]):
            with self.assertRaises(ValueError):build_geometry(self.model,{'gapSides':invalid})

    def test_pdf_lists_actual_side_gaps(self):
        d=build_geometry(self.model,{'shape':'rectangle','gapSides':{'left':30,'top':8}})
        with pdfplumber.open(io.BytesIO(make_pdf(d,{'kind':'drawing'}))) as pdf:text=pdf.pages[0].extract_text()
        self.assertIn('Left: 3.00 cm',text);self.assertIn('Right: 1.50 cm',text);self.assertIn('Top: 0.80 cm',text)

if __name__=='__main__':unittest.main()
