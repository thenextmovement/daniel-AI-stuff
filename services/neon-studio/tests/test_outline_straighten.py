import io
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server, pdfplumber
from geometry import build_geometry, straighten_outline, sample_path, M, L, C
from shapely.geometry import Polygon, LineString
from tracing import analyze_image
from export_pdf import make_pdf


class OutlineStraightenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model=analyze_image((ROOT/'assets/B_KITE.png').read_bytes())
        cls.settings=dict(shape='shape',width=1650,gap=15,depth=20,radius=3)
        cls.base=build_geometry(cls.model,cls.settings)
        cls.edit=[v/cls.base['settings']['scale'] for v in [-30,740,30,1090]]

    def test_local_recess_and_closing_seam_preserve_other_curves(self):
        curve=C(120,30,120,70,100,100)
        path=[M(0,0),L(100,0),curve,L(0,100),L(0,70),
              C(0,60,15,60,15,50),C(15,40,0,40,0,30),L(0,0),['h']]
        for p in (path,[M(15,50),*path[6:-1],*path[1:6],['h']]):
            result,preview=straighten_outline(p,[-5,20,20,80],3)
            self.assertIn(curve,result)
            self.assertEqual(preview['after'],'M 0.00000 80.00000 L 0.00000 20.00000')
            poly=Polygon(sample_path(result,200))
            self.assertTrue(poly.is_valid)
            self.assertTrue(poly.covers(Polygon(sample_path(p,200))))
            self.assertEqual(result[-1],['h'])
        # Cutting within rounded shoulders retains smooth tangent transitions.
        curved,_=straighten_outline(path,[-5,35,20,65],3)
        self.assertEqual(curved[1][0],'c')
        self.assertEqual(curved[3][0],'c')
        self.assertTrue(Polygon(sample_path(curved,200)).is_valid)

    def test_invalid_or_ambiguous_selection_does_not_cut_acrylic(self):
        path=[M(0,0),L(100,0),L(100,100),L(0,100),L(0,0),['h']]
        for rect in ([1,1,2,2],[-1,-1,101,101],[-1,20,101,80],
                     [-1,20,1,80],[-1,-1,20,20],[0,0,0,2],[0,0,float('nan'),2]):
            with self.subTest(rect=rect),self.assertRaises(ValueError):
                straighten_outline(path,rect,3)

    def test_preview_apply_resize_and_reset_preserve_neon_and_clearance(self):
        preview=build_geometry(self.model,{**self.settings,'outlinePreview':self.edit})
        applied=build_geometry(self.model,{**self.settings,'outlineEdits':[self.edit]})
        self.assertEqual(preview['outer'],applied['outer'])
        self.assertIsNotNone(preview['outlinePreview'])
        self.assertIsNone(applied['outlinePreview'])
        self.assertNotEqual(applied['outer'],self.base['outer'])
        for d in (preview,applied):
            self.assertEqual(d['paths'],self.base['paths'])
            self.assertEqual(d['neonMeters'],self.base['neonMeters'])
            outline=Polygon(sample_path(d['outer'],400))
            self.assertTrue(outline.is_valid)
            for p in d['paths']:
                line=LineString(sample_path(p,400))
                self.assertTrue(outline.covers(line))
                self.assertGreaterEqual(outline.exterior.distance(line),14.9)
            self.assertEqual(d['width'],self.base['width'])
            self.assertEqual(d['height'],self.base['height'])
        resized=build_geometry(self.model,{**self.settings,'width':2200,'outlineEdits':[self.edit]})
        self.assertAlmostEqual(resized['width'],2200,places=4)
        reset=build_geometry(self.model,{**self.settings,'outlineEdits':[]})
        self.assertEqual(reset['outer'],self.base['outer'])
        with self.assertRaisesRegex(ValueError,'Konturkorrektur 1'):
            build_geometry(self.model,{**self.settings,'shape':'rectangle','outlineEdits':[self.edit]})

    def test_pdf_contains_the_edited_outline_at_one_to_one_scale(self):
        applied=build_geometry(self.model,{**self.settings,'outlineEdits':[self.edit]})
        with pdfplumber.open(io.BytesIO(make_pdf(applied))) as pdf:
            page=pdf.pages[0]
            paths=page.curves+page.lines+page.rects
            self.assertEqual(len(paths),len(applied['paths'])+1)
            outline=next(p for p in paths if all(abs(c-17/255)<1e-5 for c in p['stroking_color']))
            self.assertAlmostEqual(outline['width']*25.4/72,applied['width'],places=3)
            # The replacement runs vertically at the left page margin, 10 mm.
            pts=outline['pts']
            self.assertAlmostEqual(pts[0][0]*25.4/72,10,places=3)
            self.assertAlmostEqual(pts[1][0]*25.4/72,10,places=3)
            self.assertAlmostEqual(abs(pts[1][1]-pts[0][1])*25.4/72,350,places=3)


if __name__=='__main__':unittest.main()
