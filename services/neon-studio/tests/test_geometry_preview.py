"""Live slider responses retain the full physical contour and validation."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import geometry as g
import numpy as np
from shapely.geometry import LineString
from tracing import analyze_image


class GeometryPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = analyze_image((Path(__file__).resolve().parents[1] / 'assets/B_KITE.png').read_bytes())

    def test_slider_preview_changes_only_editing_handles(self):
        for changes in ({'width': 3000}, {'gap': 25}, {'radius': 9},
                        {'gapSides': {'left': 30, 'bottom': 8}},
                        {'hiddenPaths': ['double:0']}):
            settings = dict(shape='shape', mode='double', gap=15) | changes
            with self.subTest(changes=changes):
                final = g.build_geometry(self.model, settings)
                with patch.object(g, 'visible_outline_controls', side_effect=AssertionError('handles during preview')):
                    preview = g.build_geometry(self.model, settings, editable=False)
                self.assertEqual(preview['outlineControls'], [])
                self.assertEqual(preview['outlineVisibleControls'], [])
                for key in final.keys() - {'outlineControls', 'outlineVisibleControls'}:
                    self.assertEqual(preview[key], final[key], key)

    def test_preview_does_not_skip_invalid_settings(self):
        with self.assertRaises(ValueError):
            g.build_geometry(self.model, {'gap': 1}, editable=False)

    def test_indexed_distance_matches_both_directed_distances(self):
        x = np.linspace(0, 100, 900)
        a = LineString(np.column_stack((x, np.sin(x / 10))))
        for y in (np.sin(x / 10) + .03, np.cos(x / 10), np.zeros(len(x))):
            b = LineString(np.column_stack((x, y)))
            self.assertAlmostEqual(g._indexed_hausdorff(a, b), a.hausdorff_distance(b), places=12)
            self.assertAlmostEqual(g._indexed_hausdorff(b, a), b.hausdorff_distance(a), places=12)
        self.assertEqual(g._indexed_hausdorff(a, a), 0)


if __name__ == '__main__':
    unittest.main()
