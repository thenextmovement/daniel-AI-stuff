import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
for name in ('neon-studio-deps','python-deps'):sys.path.insert(0,str(ROOT.parent.parent/'work'/name))
from shapely.geometry import LineString,Polygon,box
from geometry import _full_shape,_side_inset,sample_path,build_geometry
from tracing import analyze_image

class DepthSideTests(unittest.TestCase):
    def test_inset_sides_and_sloping_faces(self):
        depths=dict(left=8,right=15,top=25,bottom=40)
        self.assertEqual(_side_inset(box(0,0,200,200),depths).bounds,(8,25,185,160))
        self.assertTrue(_side_inset(Polygon([(0,100),(100,0),(200,100),(100,200)]),depths).is_valid)

    def test_each_side_controls_only_its_own_recess(self):
        # Use disjoint recess corners, so the neon route has no self-touching necks.
        points=[(0,0),(80,0),(80,60),(120,60),(120,0),(200,0),(200,80),(140,80),(140,120),(200,120),(200,200),(120,200),(120,140),(80,140),(80,200),(0,200),(0,120),(60,120),(60,80),(0,80),(0,0)]
        line=LineString(points)
        def measure(depths):
            poly=Polygon(sample_path(_full_shape([line],3,1,20,depths),60))
            self.assertTrue(poly.is_valid);self.assertTrue(poly.covers(line))
            h=poly.intersection(LineString([(-10,100),(210,100)])).bounds
            v=poly.intersection(LineString([(100,-10),(100,210)])).bounds
            return dict(left=h[0]+3,right=203-h[2],top=v[1]+3,bottom=203-v[3])
        base=dict.fromkeys(('left','right','top','bottom'),20)
        before=measure(base)
        for side in base:
            after=measure({**base,side:8})
            self.assertLess(after[side],before[side]-8)
            self.assertLessEqual(after[side],8.1)
            for other in base:
                if other!=side:self.assertAlmostEqual(after[other],before[other],delta=.1)
        legacy=_full_shape([line],3,1,20)
        self.assertEqual(legacy,_full_shape([line],3,1,20,base))

    def test_engine_default_bottom_override_and_validation(self):
        model=analyze_image((ROOT/'assets/B_KITE.png').read_bytes())
        before=build_geometry(model)
        same=build_geometry(model,{'depthSides':dict.fromkeys(('left','right','top','bottom'),20)})
        self.assertEqual(before['outer'],same['outer'])
        changed=build_geometry(model,{'depthSides':{'bottom':8}})
        equivalent=build_geometry(model,{'depth':8})
        self.assertEqual(changed['outer'],equivalent['outer'])
        self.assertEqual(before['paths'],changed['paths']);self.assertEqual(before['neonMeters'],changed['neonMeters'])
        self.assertEqual(before['outer'],build_geometry(model,{'depthSides':{'top':8}})['outer'])
        for invalid in ([],{'side':4},{'left':-1},{'right':20001},{'top':float('nan')},{'bottom':None}):
            with self.assertRaises(ValueError):build_geometry(model,{'depthSides':invalid})

if __name__=='__main__':unittest.main()
