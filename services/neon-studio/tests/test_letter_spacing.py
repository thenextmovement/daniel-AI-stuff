import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from geometry import path_bounds, path_length
from minimum_size import PROFILE, measure, target_width
from server import Store


class LetterSpacingTests(unittest.TestCase):
    def test_two_gaps_adjusted_together_at_fixed_width(self):
        store = Store()
        items, parts = [], []
        for i, x in enumerate([0, 30, 35, 60, 65, 100]):
            path = [['m', [x, 0]], ['l', [x, 20]]]
            item = dict(name='Schriftzug Test', partId=str(i), commands=path,
                        length=path_length(path), sourceColor='#ffffff')
            items.append(item)
            parts.append(dict(id=str(i), name=item['name'], bounds=path_bounds(path), single=1, double=1))
        model = dict(modes=dict(single=items, double=items), parts=parts, sourceKind='master',
                     sourceLabel='Test', traceNote='', imageBounds=[0, 0, 100, 20], image='')
        token = store.add_model(model, 'test.png')['id']
        options = dict(PROFILE, mode='double', shape='rectangle', width=136)
        report = target_width(store, token, options, 136)
        proposal = report['proposal']
        self.assertEqual(len(report['issues']), 2)
        self.assertEqual(proposal['remaining'], 0)
        self.assertAlmostEqual(sum(map(abs, proposal['horizontalMoves'].values())), 6, places=3)
        options['pathOffsets'] = proposal['offsets']
        final = store.drawing(token, json.dumps(options))
        self.assertAlmostEqual(final['width'], 136)
        self.assertGreaterEqual(measure(final)['minimumSpacing'], 8)
        self.assertEqual(target_width(store, token, options, 136)['issues'], [])
