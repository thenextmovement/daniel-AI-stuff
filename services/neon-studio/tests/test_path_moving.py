import json
import unittest
from copy import deepcopy
import test_path_splitting
from geometry import transform


class MoveTests(unittest.TestCase):
    def setUp(self):
        fixture = test_path_splitting.SplitIntegrationTests()
        fixture.setUp()
        self.store, self.project, self.before = fixture.store, fixture.project, fixture.drawing

    def draw(self, settings):
        return self.store.drawing(self.project['id'], json.dumps(settings))

    def test_group_moves_exactly_without_moving_other_paths_or_changing_lengths(self):
        before = self.before
        original = deepcopy(self.store.model(self.project['id']))
        settings = {**before['settings'], 'pathOffsets': {'double:0': [4, -8], 'double:1': [4, -8]}}
        after = self.draw(settings)
        scale = before['settings']['scale']
        for i in range(3):
            expected = transform(before['paths'][i], 1, 4*scale, -8*scale) if i < 2 else before['paths'][i]
            for a, b in zip(after['paths'][i], expected):
                self.assertEqual(a[0], b[0])
                for p, q in zip(a[1:], b[1:]):
                    for x, y in zip(p, q): self.assertAlmostEqual(x, y, places=8)
        self.assertEqual(after['pathColors'], before['pathColors'])
        self.assertAlmostEqual(after['neonMeters'], before['neonMeters'], places=9)
        self.assertGreaterEqual(after['minGap'], 14.9)
        self.assertEqual(self.store.model(self.project['id']), original)
        self.assertEqual(self.draw(before['settings']), before)

    def test_split_children_inherit_offset_once_and_move_independently(self):
        split = self.store.split_paths(self.project['id'], ['double:0'], self.before['settings'])['drawing']
        offsets = {'double:0': [3, 7], 'double:0~1': [5, -2]}
        after = self.draw({**split['settings'], 'pathOffsets': offsets})
        scale = split['settings']['scale']
        for key, delta in [('double:0~1', [8, 5]), ('double:0~2', [3, 7])]:
            i = after['pathKeys'].index(key)
            for axis in range(2):
                self.assertAlmostEqual(after['paths'][i][0][1][axis]-split['paths'][i][0][1][axis], delta[axis]*scale)
        self.assertGreaterEqual(after['minGap'], 14.9)

    def test_moving_all_paths_keeps_position_and_proportional_resize(self):
        offsets = {key: [10, 20] for key in self.before['pathKeys']}
        after = self.draw({**self.before['settings'], 'pathOffsets': offsets})
        scale = after['settings']['scale']
        self.assertAlmostEqual(after['bounds'][0]-self.before['bounds'][0], 10*scale)
        self.assertAlmostEqual(after['width'], self.before['width'])
        resized = self.draw({**after['settings'], 'scale': scale*2})
        for axis in range(2): self.assertAlmostEqual(resized['paths'][0][0][1][axis], after['paths'][0][0][1][axis]*2)

    def test_uv_print_stays_put_and_only_remaining_neon_moves(self):
        settings = {**self.before['settings'], 'shape':'rectangle', 'uvStrokes':[{'op':'add','radius':15,'points':[[50,47.5]]}]}
        before = self.draw(settings)
        after = self.draw({**settings, 'pathOffsets': {'double:0':[0,40]}})
        self.assertEqual(after['uv'], before['uv'])
        self.assertAlmostEqual(after['neonMeters'], before['neonMeters'])
        i = before['pathKeys'].index('double:0')
        self.assertAlmostEqual(after['paths'][i][0][1][1]-before['paths'][i][0][1][1], 40*before['settings']['scale'])

    def test_split_uses_moved_intersections(self):
        # Move the distant vertical stroke onto the curve. The old crossing is hidden.
        settings = {**self.before['settings'], 'shape':'rectangle', 'hiddenPaths':['double:1'], 'pathOffsets': {'double:2':[-100,0]}}
        result = self.store.split_paths(self.project['id'], ['double:0'], settings)
        self.assertGreater(result['count'], 0)
        self.assertIn('double:2~1', result['drawing']['pathKeys'])
        self.assertAlmostEqual(result['drawing']['neonMeters'], self.draw(settings)['neonMeters'])

    def test_edited_curves_and_lengths_survive_reopening(self):
        before = self.before
        commands = deepcopy(before['pathEditSources'][0]['commands'])
        commands[1][-1][0] += 12
        settings = {**before['settings'], 'pathShapes': {before['pathKeys'][0]: commands}}
        edited = self.draw(settings)
        self.assertNotEqual(edited['pathLengthsMm'][0], before['pathLengthsMm'][0])
        self.assertEqual(edited['pathLengthsMm'][1:], before['pathLengthsMm'][1:])
        self.assertAlmostEqual(sum(edited['pathLengthsMm']), edited['neonMeters']*1000)
        self.assertEqual(self.draw(edited['settings'])['pathEditSources'][0]['commands'], commands)
        self.assertEqual(self.draw(before['settings']), before)

    def test_target_width_after_hiding_outermost_line(self):
        edited = self.draw({**self.before['settings'], 'hiddenPaths':['double:2'],
                            'geometricSizing':True, 'scale':None, 'width':400, 'shape':'rectangle'})
        self.assertAlmostEqual(edited['width'], 400)

    def test_invalid_offsets_are_rejected(self):
        for offsets in ([], {'missing':[0,0]}, {'double:0':[1]}, {'double:0':[float('nan'),0]}, {'double:0':['4',0]}):
            with self.subTest(offsets=offsets), self.assertRaises(ValueError):
                self.draw({**self.before['settings'], 'pathOffsets':offsets})


if __name__ == '__main__': unittest.main()
