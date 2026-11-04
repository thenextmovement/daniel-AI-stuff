import io
import sys
import unittest
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server, pdfplumber
from geometry import build_geometry, local_outline_depth, sample_path, M, L, C
from vector_import import analyze_vector
from export_pdf import make_pdf
from shapely.geometry import Polygon, LineString, box

# Independent notches on all four sides, with true vector paths as input.
SVG=b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200"><path fill="none" stroke="black" d="M10 10H80V60H120V10H190V80H140V120H190V190H120V140H80V190H10V120H60V80H10Z"/></svg>'

class DepthRegionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model=analyze_vector(SVG,'notches.svg')
        cls.settings=dict(shape='shape',scale=1,gap=15,depth=20,radius=3)
        cls.base=build_geometry(cls.model,cls.settings)
        cls.rect=[45,-25,135,70] # Top notch only, in motif coordinates.

    def drawing(self,depth,**settings):
        return build_geometry(self.model,{**self.settings,**settings,'depthRegions':[dict(rect=self.rect,depth=depth)]})

    def test_shallower_and_deeper_are_local_and_preserve_neon(self):
        before=Polygon(sample_path(self.base['outer'],250))
        for depth in (0,5,40,500):
            with self.subTest(depth=depth):
                d=self.drawing(depth);after=Polygon(sample_path(d['outer'],250))
                self.assertTrue(after.is_valid)
                self.assertEqual(d['paths'],self.base['paths'])
                self.assertEqual(d['neonMeters'],self.base['neonMeters'])
                self.assertGreater(after.symmetric_difference(before).area,10)
                self.assertLess(after.symmetric_difference(before).difference(box(*self.rect).buffer(.03)).area,.001)
                self.assertGreaterEqual(d['minGap'],14.9)
                self.assertEqual(d['activeDepthRegions'],[0])
                self.assertAlmostEqual(d['width'],self.base['width'],places=4)
                self.assertAlmostEqual(d['height'],self.base['height'],places=4)
        shallow=Polygon(sample_path(self.drawing(5)['outer'],250))
        deep=Polygon(sample_path(self.drawing(40)['outer'],250))
        self.assertGreater(shallow.area,deep.area)

    def test_outside_bezier_is_retained_exactly(self):
        curve=C(120,30,120,70,100,100)
        base=[M(0,0),L(100,0),curve,L(0,100),L(0,70),L(15,50),L(0,30),L(0,0),['h']]
        target=[M(0,0),L(100,0),curve,L(0,100),L(0,0),['h']]
        d=local_outline_depth(base,target,[-5,20,20,80],3,box(25,10,90,90))
        self.assertIn(curve,d)
        self.assertTrue(Polygon(sample_path(d,250)).is_valid)

    def test_large_depth_change_has_a_smooth_transition_not_a_step(self):
        # Same geometry as two adjacent words with different recess depths.
        # Exercise all selection edges and both shallower/deeper changes.
        for turn in range(4):
            for reverse in (False, True):
                with self.subTest(turn=turn, reverse=reverse):
                    matrix=np.linalg.matrix_power(np.array([[0,-1],[1,0]]),turn)
                    def rotate(path):
                        return [[op,*[list(matrix@p) for p in pts]] for op,*pts in path]
                    base=[M(0,60),L(800,60),L(800,300),L(0,300),['h']]
                    target=[M(0,0),L(800,0),L(800,300),L(0,300),['h']]
                    if reverse:base,target=target,base
                    corners=np.array([[-10,-10],[400,-10],[400,310],[-10,310]])@matrix.T
                    rect=[*corners.min(axis=0),*corners.max(axis=0)]
                    protected=Polygon(np.array([[10,90],[790,90],[790,290],[10,290]])@matrix.T)
                    result=local_outline_depth(rotate(base),rotate(target),rect,3,protected)
                    poly=Polygon(sample_path(result,250))
                    self.assertTrue(poly.is_valid)
                    self.assertTrue(poly.buffer(.04).covers(protected))
                    original=Polygon(sample_path(rotate(base),250))
                    self.assertLess(poly.symmetric_difference(original).difference(box(*rect).buffer(.03)).area,.001)
                    pts=np.array(sample_path(result,250))@matrix
                    for a,b in zip(pts,pts[1:]):
                        if 200<min(a[0],b[0]) and max(a[0],b[0])<401 and max(a[1],b[1])<61:
                            # A 60 mm height change must spread into a ramp;
                            # rounding only the two 3 mm corners leaves a step.
                            self.assertLessEqual(abs(b[1]-a[1]),.85*abs(b[0]-a[0])+.0001)

    def test_transition_keeps_clearance_next_to_a_protruding_motif(self):
        # A nearby motif protrudes above the requested local depth. The bridge
        # must retain its clearance without a vertical step at the boundary.
        base=[M(0,0),L(800,0),L(800,300),L(0,300),['h']]
        target=[M(0,60),L(800,60),L(800,300),L(0,300),['h']]
        protected=box(10,90,790,290).union(box(280,5,335,100))
        result=local_outline_depth(base,target,[-10,-10,400,310],3,protected)
        poly=Polygon(sample_path(result,250))
        self.assertTrue(poly.is_valid)
        self.assertTrue(poly.buffer(.04).covers(protected))
        pts=np.array(sample_path(result,250))
        transition=[(a,b) for a,b in zip(pts,pts[1:]) if 345<min(a[0],b[0]) and max(a[0],b[0])<401 and max(a[1],b[1])<61]
        self.assertTrue(transition)
        self.assertTrue(any(.25<a[1]<55 for a,b in transition))
        for a,b in transition:
            self.assertLessEqual(abs(b[1]-a[1]),3*abs(b[0]-a[0])+.0001)

    def test_resize_side_gaps_reset_and_dormant_regions(self):
        resized=self.drawing(5,scale=2)
        baseline=build_geometry(self.model,{**self.settings,'scale':2})
        self.assertEqual(resized['paths'],baseline['paths'])
        self.assertAlmostEqual(resized['neonMeters'],2*self.base['neonMeters'],places=7)
        self.assertGreaterEqual(resized['minGap'],14.9)
        sides=self.drawing(40,gapSides={'left':30,'top':22,'right':8,'bottom':11})
        self.assertTrue(all(c['ok'] for c in sides['checks']))
        self.assertEqual(self.base['outer'],build_geometry(self.model,{**self.settings,'depthRegions':[]})['outer'])
        for shape in ('rectangle','bottom'):
            self.assertEqual(self.drawing(5,shape=shape)['outer'],build_geometry(self.model,{**self.settings,'shape':shape})['outer'])
        off=build_geometry(self.model,{**self.settings,'depthRegions':[dict(rect=[1000,1000,1010,1010],depth=5)]})
        self.assertEqual(off['outer'],self.base['outer']);self.assertEqual(off['activeDepthRegions'],[])
        for regions in (None,{},[None],[{'rect':self.rect,'depth':-1}],[{'rect':[0,0,0,1],'depth':5}],[{'rect':self.rect,'depth':float('nan')}]):
            with self.subTest(regions=regions),self.assertRaises(ValueError):
                build_geometry(self.model,{**self.settings,'depthRegions':regions})

    def test_export_keeps_local_contour_and_one_to_one_dimensions(self):
        drawing=self.drawing(5)
        with pdfplumber.open(io.BytesIO(make_pdf(drawing))) as pdf:
            shapes=pdf.pages[0].curves+pdf.pages[0].lines+pdf.pages[0].rects
            self.assertEqual(len(shapes),len(drawing['paths'])+1)
            outline=next(s for s in shapes if all(abs(c-17/255)<1e-5 for c in s['stroking_color']))
            self.assertAlmostEqual(outline['width']*25.4/72,drawing['width'],places=3)
            self.assertAlmostEqual(outline['height']*25.4/72,drawing['height'],places=3)
            # Compare every exported endpoint (PDF y is reversed; pts is top-down).
            expected=[cmd[-1] for cmd in drawing['outer'] if cmd[0]!='h']
            actual=[(x*25.4/72,y*25.4/72) for x,y in outline['pts']]
            self.assertEqual(len(actual),len(expected))
            for a,e in zip(actual,expected):
                self.assertAlmostEqual(a[0]-actual[0][0],e[0]-expected[0][0],places=3)
                self.assertAlmostEqual(a[1]-actual[0][1],e[1]-expected[0][1],places=3)

if __name__=='__main__':unittest.main()
