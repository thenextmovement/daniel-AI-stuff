import unittest
from shapely.geometry import LineString, Polygon
from geometry import _full_shape, sample_path


class BroadBridgeTests(unittest.TestCase):
    def test_stacked_rows_have_continuous_acrylic_across_gap(self):
        lines = [
            LineString([(0, 0), (300, 0), (300, 70), (0, 70), (0, 0)]),
            LineString([(20, 115), (280, 115), (280, 145), (20, 145), (20, 115)]),
        ]
        bands = [(15, -15, 285, 85), (35, 100, 265, 160)]
        path = _full_shape(lines, 15, 3, 20, bands=bands)
        outline = Polygon(sample_path(path, 120))
        self.assertTrue(outline.buffer(.1).covers(LineString([(25, 92), (275, 92)])))
        self.assertTrue(outline.is_valid)

    def test_already_touching_rows_also_get_full_width_support(self):
        from shapely.geometry import box
        # The first glyph descends to the footer, so components are already
        # connected before joining; the rest of the footer still needs support.
        lines = [box(0, 0, 30, 95).exterior, box(50, 0, 300, 70).exterior,
                 box(20, 115, 280, 145).exterior]
        outline = Polygon(sample_path(_full_shape(lines, 15, 3, 20,
            bands=[(15, -15, 285, 110), (35, 100, 265, 160)]), 120))
        for y in (85, 92, 105):
            self.assertTrue(outline.buffer(.1).covers(LineString([(25, y), (275, y)])))
        for line in lines:
            self.assertTrue(outline.covers(line))
            self.assertGreaterEqual(outline.exterior.distance(line), 14.9)

    def test_single_row_keeps_its_dimensions_and_clearance(self):
        from shapely.geometry import box
        lines = [box(0, 0, 80, 70).exterior, box(110, 0, 190, 70).exterior]
        outline = Polygon(sample_path(_full_shape(lines, 15, 3, 20), 120))
        for actual, expected in zip(outline.bounds, (-15, -15, 205, 85)):
            self.assertAlmostEqual(actual, expected, delta=.1)
        for line in lines:
            self.assertGreaterEqual(outline.exterior.distance(line), 14.9)
