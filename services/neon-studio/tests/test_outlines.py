"""Generic bitmap fixtures for Double Line; no production logo coordinates."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import numpy as np
from PIL import Image,ImageDraw
from skimage.measure import find_contours
from shapely.geometry import LineString,Polygon
from shapely.ops import unary_union
from outlines import trace_outlines
from geometry import sample_path


def trace(image):
    mask=np.array(image,bool)
    contours=[np.fliplr(q) for q in find_contours(mask,.5,fully_connected='high')]
    return trace_outlines(mask,contours),contours


class OutlineTests(unittest.TestCase):
    def test_rectangle_is_four_straight_edges_with_sharp_corners(self):
        image=Image.new('1',(240,200));ImageDraw.Draw(image).rectangle((35,30,195,160),fill=1)
        paths,_=trace(image)
        self.assertEqual(len(paths),1)
        self.assertEqual([c[0] for c in paths[0]],['m','l','l','l','l','h'])
        self.assertEqual(Polygon(sample_path(paths[0],100)).bounds,(34.5,29.5,195.5,160.5))

    def test_curved_ring_keeps_both_boundaries_and_smooth_arcs(self):
        image=Image.new('1',(240,240));d=ImageDraw.Draw(image)
        d.ellipse((30,30,210,210),fill=1);d.ellipse((65,65,175,175),fill=0)
        paths,contours=trace(image)
        self.assertEqual(len(paths),2)
        for p in paths:
            self.assertEqual(p[-1],['h'])
            self.assertTrue(Polygon(sample_path(p,120)).is_valid)
            self.assertTrue(any(c[0]=='c' for c in p))
            self.assertLessEqual(len(p),14)
        a=unary_union([LineString(sample_path(p,120)) for p in paths])
        b=unary_union([LineString(q) for q in contours])
        self.assertLess(a.hausdorff_distance(b),1.6)

    def test_curves_caps_and_holes_remain_faithful_at_other_scales_and_rotations(self):
        for scale,angle in ((1,0),(2,0),(1,19)):
            with self.subTest(scale=scale,angle=angle):
                im=Image.new('1',(240,240));d=ImageDraw.Draw(im)
                d.rectangle((30,35,55,205),fill=1)
                d.ellipse((35,55,195,185),fill=1)
                d.rectangle((30,95,115,130),fill=1)
                d.ellipse((75,85,165,155),fill=0)
                if scale>1:im=im.resize((240*scale,240*scale),Image.Resampling.NEAREST)
                if angle:im=im.rotate(angle)
                paths,contours=trace(im)
                self.assertEqual(len(paths),2)
                self.assertTrue(all(Polygon(sample_path(p,120)).is_valid for p in paths))
                a=unary_union([LineString(sample_path(p,120)) for p in paths])
                b=unary_union([LineString(q) for q in contours])
                self.assertLess(a.hausdorff_distance(b),2.5)


if __name__=='__main__':unittest.main()
