import io
import sys
import unittest
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server, pdfplumber
from geometry import build_geometry, move_outline_point, sample_path, segments, M, L, C
from vector_import import analyze_vector
from export_pdf import make_pdf
from shapely.geometry import Polygon, box

SVG=b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><path fill="none" stroke="black" d="M20 20H180V80H20Z"/></svg>'

class OutlinePointTests(unittest.TestCase):
    def test_lift_endpoint_to_make_edge_horizontal_and_keep_other_curves(self):
        # Long sloping edge leading into a rounded recess, like the word boundary.
        curve=C(400,0,400,200,350,200)
        path=[M(0,0),L(350,0),curve,L(300,200),C(280,200,280,140,260,140),
              L(20,100),C(0,100,0,70,0,50),L(0,0),['h']]
        result,_=move_outline_point(path,[260,140],[260,100],3,box(25,20,250,80))
        self.assertIn(curve,result)
        self.assertEqual(result[-1],['h'])
        poly=Polygon(sample_path(result,400))
        self.assertTrue(poly.is_valid)
        self.assertTrue(poly.covers(box(25,20,250,80)))
        straight=[p for op,p in segments(result) if op=='l' and np.linalg.norm(p[-1]-p[0])>200]
        self.assertTrue(any(abs(p[-1,1]-100)<.02 and abs(p[0,1]-100)<.02 for p in straight))
        self.assertNotEqual(result,path)

    def test_invalid_point_moves_cannot_cross_neon_or_self_intersect(self):
        path=[M(0,0),L(100,0),L(100,100),L(0,100),['h']]
        for target in ([-100,80],[float('nan'),0]):
            with self.subTest(target=target),self.assertRaises(ValueError):
                move_outline_point(path,[100,0],target,3,box(15,15,85,85))
        limited,info=move_outline_point(path,[100,0],[50,70],3,box(15,15,85,85))
        self.assertTrue(info['constrained'])
        self.assertTrue(Polygon(sample_path(limited,300)).buffer(.04).covers(box(15,15,85,85)))
        with self.assertRaises(ValueError):move_outline_point(path,[50,50],[60,50],3,box(15,15,85,85))

    def test_new_corners_are_rounded_using_the_selected_radius(self):
        path=[M(0,0),L(100,0),L(100,100),L(0,100),['h']]
        a,_=move_outline_point(path,[100,0],[120,-20],3,box(15,15,85,85))
        b,_=move_outline_point(path,[100,0],[120,-20],8,box(15,15,85,85))
        self.assertNotEqual(a,b)
        self.assertTrue(any(c[0]=='c' for c in a))
        for result in (a,b):
            self.assertTrue(Polygon(sample_path(result,300)).is_valid)
            # No sharp vertex at the requested corner: radius trims it back.
            self.assertGreater(Polygon(sample_path(result,300)).exterior.distance(__import__('shapely').geometry.Point(120,-20)),.5)

    def test_preview_apply_reset_and_pdf_keep_neon_and_one_to_one_scale(self):
        model=analyze_vector(SVG,'points.svg')
        settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        base=build_geometry(model,settings)
        point=base['outer'][1][-1]
        edit=dict(kind='point',point=point,target=[point[0]-10,point[1]-10])
        preview=build_geometry(model,{**settings,'outlinePreview':edit})
        applied=build_geometry(model,{**settings,'outlineEdits':[edit]})
        self.assertEqual(preview['outer'],applied['outer'])
        self.assertEqual(preview['outlinePreview']['kind'],'point')
        self.assertNotEqual(base['outer'],applied['outer'])
        self.assertGreaterEqual(applied['minGap'],14.9)
        self.assertEqual(base['paths'],applied['paths'])
        self.assertEqual(base['neonMeters'],applied['neonMeters'])
        self.assertEqual(base['outer'],build_geometry(model,{**settings,'outlineEdits':[]})['outer'])
        with pdfplumber.open(io.BytesIO(make_pdf(applied))) as pdf:
            shapes=pdf.pages[0].curves+pdf.pages[0].lines
            outline=next(s for s in shapes if all(abs(c-17/255)<1e-5 for c in s['stroking_color']))
            self.assertAlmostEqual(outline['width']*25.4/72,applied['width'],delta=.03)
            self.assertAlmostEqual(outline['height']*25.4/72,applied['height'],delta=.03)

    def test_stored_movement_survives_resize_gap_and_radius_changes(self):
        model=analyze_vector(SVG,'points.svg')
        settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        base=build_geometry(model,settings)
        point=base['outer'][1][-1]
        edit=dict(kind='point',point=point,target=[point[0]-10,point[1]-10])
        for change in (dict(scale=2),dict(radius=5),dict(gap=20),dict(gapSides={'left':25,'right':10})):
            with self.subTest(change=change):
                plain=build_geometry(model,{**settings,**change})
                applied=build_geometry(model,{**settings,**change,'outlineEdits':[edit]})
                self.assertNotEqual(plain['outer'],applied['outer'])
                self.assertEqual(plain['paths'],applied['paths'])
                self.assertEqual(plain['neonMeters'],applied['neonMeters'])
                self.assertTrue(applied['exportable'])
                self.assertGreaterEqual(applied['minGap'],min(change.get('gapSides',{}).values(),default=change.get('gap',15))-.1)

if __name__=='__main__':unittest.main()
