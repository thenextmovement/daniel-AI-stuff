"""A raster crossing must preserve the flow of a drawn stroke."""
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from geometry import sample_path, segments
from tracing import analyze_image
from reconstruction import cubic_fit, unit


class ContinuousStrokeTests(unittest.TestCase):
    def test_nearby_cursive_joins_share_a_stem_without_an_s_bridge(self):
        # Crop of the e/n overlap from the line-art import regression. The two
        # bows meet the same stem at different heights, rather than crossing.
        image = Image.open(Path(__file__).parent / 'fixtures/cursive_retraced_n.png')
        for scale, profile in ((1, None), (2, None), (1, 'neon')):
            with self.subTest(scale=scale, profile=profile):
                raw = io.BytesIO()
                image.resize((image.width*scale, image.height*scale)).save(raw, 'PNG')
                paths = [p['commands'] for p in analyze_image(raw.getvalue(), trace_profile=profile)['modes']['single']]
                self.assertEqual(len(paths), 3, 'Keep the stem and its two returning bows; do not bridge the bows')
                stem = min(paths, key=lambda p: np.linalg.norm(np.array(p[0][-1])-[128*scale, 19*scale]))
                reference = np.asarray(sample_path(stem, 600))
                line = LineString(reference)
                joins = []
                for path in paths:
                    if path is stem:continue
                    pieces = list(segments(path))
                    a, b = pieces[0][1], pieces[-1][1]
                    point, tangent = min(((a[0], a[1]-a[0]), (b[-1], b[-1]-b[-2])),
                                         key=lambda pair: np.min(np.linalg.norm(reference-pair[0], axis=1)))
                    self.assertLess(line.distance(Point(point)), .02*scale)
                    j = int(np.argmin(np.linalg.norm(reference-point, axis=1)))
                    direction = reference[min(len(reference)-1, j+1)]-reference[max(0, j-1)]
                    self.assertGreater(abs(unit(tangent)@unit(direction)), .98, 'The bow must flow along the stem')
                    joins.append(point)
                self.assertGreater(np.linalg.norm(joins[0]-joins[1]), 15*scale, 'The joins must remain distinct')

    def test_cursive_retrace_has_no_sideways_shoulder(self):
        from centerlines import centerline_paths, neon_centerline_paths
        # An upstroke retraced into the next bowl, as in a handwritten i/u.
        source = [[['m', [64, 80]], ['c', [57, 116], [28, 178], [65, 191]],
                   ['c', [91, 200], [118, 156], [130, 133]], ['l', [151, 74]]],
                  [['m', [130, 133]], ['c', [123, 174], [129, 204], [155, 184]],
                   ['l', [182, 141]]]]
        ground = unary_union([LineString(sample_path(p, 160)) for p in source])
        band = ground.buffer(3.6)
        image = Image.new('L', (240, 240)); draw = ImageDraw.Draw(image)
        draw.polygon(list(band.exterior.coords), fill=255)
        for hole in band.interiors:draw.polygon(list(hole.coords), fill=0)
        for reconstruct in (centerline_paths, neon_centerline_paths):
            with self.subTest(profile=reconstruct.__name__):
                paths, _, _ = reconstruct(np.asarray(image)>128)
                self.assertEqual(len(paths), 2, 'The upstroke must continue through the merge')
                lines = [LineString(sample_path(p, 160)) for p in paths]
                self.assertLess(lines[0].distance(lines[1]), .01, 'The returning branch must stay attached')
                self.assertLess(unary_union(lines).hausdorff_distance(ground), 3.5)
                for path in paths:
                    pieces = list(segments(path))
                    for (_, a), (_, b) in zip(pieces, pieces[1:]):
                        self.assertGreater(unit(a[-1]-a[-2])@unit(b[1]-b[0]), .999)

    def test_almost_straight_curve_keeps_its_join_directions(self):
        # A short, almost straight span between curves still needs to respect
        # their tangents; replacing it by a line introduces two tiny corners.
        left, right = unit(np.array([1., .05])), unit(np.array([-1., .05]))
        path = cubic_fit(np.column_stack([np.linspace(0, 20, 50), np.zeros(50)]), .5, left, right)
        pieces = list(segments(path))
        first, last = pieces[0][1], pieces[-1][1]
        self.assertGreater(unit(first[1]-first[0])@left, .999999)
        self.assertGreater(unit(last[-2]-last[-1])@right, .999999)

    def test_handwritten_loop_continues_through_its_crossing(self):
        # One pen stroke with a self-crossing, not a closed oval plus a tail.
        source = [['m', [40, 235]], ['c', [80, 220], [100, 220], [150, 170]],
                  ['c', [200, 120], [220, 60], [150, 50]],
                  ['c', [80, 40], [100, 120], [150, 170]],
                  ['c', [200, 220], [240, 240], [290, 170]]]
        ground = LineString(sample_path(source, 200))
        for scale, angle, profile in ((1, 0, None), (2, 0, None), (1, 23, None), (1, 0, 'neon')):
            with self.subTest(scale=scale, angle=angle, profile=profile):
                image = Image.new('RGB', (310*scale, 310*scale), 'white')
                band = LineString(np.asarray(ground.coords)*scale).buffer(4*scale)
                draw = ImageDraw.Draw(image)
                draw.polygon(list(band.exterior.coords), fill='black')
                for hole in band.interiors:draw.polygon(list(hole.coords), fill='white')
                if angle:
                    image = image.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor='white')
                raw = io.BytesIO(); image.save(raw, 'PNG')
                paths = analyze_image(raw.getvalue(), trace_profile=profile)['modes']['single']
                self.assertEqual(len(paths), 1, 'The loop must follow the pen through the crossing, without short connector paths')
                path = paths[0]['commands']
                self.assertNotEqual(path[-1][0], 'h', 'The original pen stroke has two free ends')
                pieces = list(segments(path))
                for (_, a), (_, b) in zip(pieces, pieces[1:]):
                    va, vb = a[-1]-a[-2], b[1]-b[0]
                    cosine = va@vb / np.linalg.norm(va) / np.linalg.norm(vb)
                    self.assertGreater(cosine, .999, 'No extra corner at a fitted curve join')
                radians = np.deg2rad(angle)
                rotation = np.array([[np.cos(radians), -np.sin(radians)], [np.sin(radians), np.cos(radians)]])
                center = (310*scale-1)/2
                actual = (np.asarray(sample_path(path, 160))-center)@rotation.T+center
                self.assertLess(LineString(actual/scale).hausdorff_distance(ground), 3.5, 'Smoothing must still follow the source stroke')


if __name__ == '__main__':
    unittest.main()
