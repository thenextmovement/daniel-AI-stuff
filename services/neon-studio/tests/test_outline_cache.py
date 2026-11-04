"""Dragging reuses checked contour history without reusing stale clearance."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import geometry as g
from vector_import import analyze_vector


class OutlineCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = analyze_vector(b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><path fill="none" stroke="black" d="M20 20H180V80H20Z"/></svg>', 'cache.svg')
        cls.insert = dict(kind='anchor', action='insert', point=[80, -15], visibleContour=True)
        cls.move = dict(kind='anchor', action='move', point=[80, -15], target=[80, -20], visibleContour=True, fixedNeighbors=True)
        cls.settings = dict(shape='rectangle', scale=1, gap=15, radius=3, outlineEdits=[cls.insert, cls.move])

    def setUp(self):
        g._checked_anchor_step.cache_clear()
        g._visible_outline_controls.cache_clear()

    def test_only_new_movement_is_checked_after_warming_history(self):
        g.build_geometry(self.model, self.settings)
        preview = {**self.move, 'point': [80, -20], 'target': [80, -23]}
        with patch.object(g, 'edit_outline_anchor', wraps=g.edit_outline_anchor) as edit:
            result = g.build_geometry(self.model, {**self.settings, 'outlinePreview': preview})
        self.assertEqual(edit.call_count, 1)
        self.assertGreaterEqual(result['minGap'], 14.99)

    def test_auto_handle_version_does_not_reuse_legacy_movement(self):
        settings = {**self.settings, 'outlinePreview': {**self.move, 'point': [80, -20], 'target': [80, -24]}}
        g.build_geometry(self.model, settings)
        settings['outlinePreview']['autoHandles'] = True
        with patch.object(g, 'edit_outline_anchor', wraps=g.edit_outline_anchor) as edit:
            g.build_geometry(self.model, settings)
        self.assertEqual(edit.call_count, 1)
        self.assertIs(edit.call_args.kwargs['auto_handles'], True)

    def test_returned_paths_and_highlight_cannot_change_cached_result(self):
        settings = {**self.settings, 'outlinePreview': {**self.move, 'point': [80, -20], 'target': [80, -24]}}
        result = g.build_geometry(self.model, settings)
        expected = copy.deepcopy(result)
        result['outer'][0][1][0] += 300
        result['outlineControls'][0][1][0] += 400
        result['outlinePreview']['point'][0] += 500
        again = g.build_geometry(self.model, settings)
        self.assertEqual(again, expected)

    def test_changed_gap_radius_and_scale_are_checked_again(self):
        g.build_geometry(self.model, self.settings)
        other = copy.deepcopy(self.model)
        # A different scale also changes the motif's protected envelope.
        variants = [{**self.settings, 'gap': 20}, {**self.settings, 'radius': 6},
                    {**self.settings, 'scale': 1.2}]
        for settings in variants:
            with self.subTest(settings=settings):
                with patch.object(g, 'edit_outline_anchor', wraps=g.edit_outline_anchor) as edit:
                    result = g.build_geometry(other, settings)
                self.assertGreaterEqual(edit.call_count, 2)
                self.assertGreaterEqual(result['minGap'], settings['gap'] - .1)

    def test_same_outer_dimensions_do_not_reuse_another_motifs_clearance(self):
        original = g.build_geometry(self.model, self.settings)
        other = analyze_vector(b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><path fill="none" stroke="black" d="M20 20H180V80H20Z M60 50H140"/></svg>', 'other.svg')
        with patch.object(g, 'edit_outline_anchor', wraps=g.edit_outline_anchor) as edit:
            result = g.build_geometry(other, self.settings)
        self.assertEqual(result['width'], original['width'])
        self.assertEqual(result['height'], original['height'])
        self.assertEqual(edit.call_count, 2)
        self.assertGreaterEqual(result['minGap'], 14.99)


if __name__ == '__main__':
    unittest.main()
