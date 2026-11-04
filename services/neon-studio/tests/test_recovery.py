import base64
import io
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Store
from PIL import Image, ImageDraw
import numpy as np


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        image = Image.new('RGBA', (260, 180), 'white')
        pen = ImageDraw.Draw(image)
        pen.rectangle((100, 30, 230, 150), fill='#1465e8')
        pen.line((20, 40, 70, 40, 70, 130), fill='#999999', width=8)
        self.image = image
        raw = io.BytesIO(); image.save(raw, 'PNG')
        self.store = Store()
        prepared = self.store.prepare(raw.getvalue(), 'local.png')
        mask = np.zeros((180, 260), np.uint8); mask[30:151, 100:231] = 1
        self.project = self.store.trace_selection(prepared['id'], pixel_mask=base64.b64encode(mask.tobytes()).decode())
        drawing = self.store.drawing(self.project['id'], json.dumps({'mode':'double','shape':'shape','width':600,'gap':15}))
        self.settings = {**drawing['settings'], 'pathColors':{'double:0':'#ff0000'}, 'partModes':{'part-1':'double'},
                         'depthRegions':[{'rect':[0, 0, 60, 60], 'depth':20}]}
        self.payload = {'rect':[10, 20, 90, 145], 'seed':[40, 40], 'tolerance':20}

    def test_original_survives_import_and_only_selected_region_is_added(self):
        source = self.store.recovery_source(self.project['id'])
        restored = Image.open(io.BytesIO(base64.b64decode(source['image'].split(',')[1])))
        self.assertEqual(restored.getpixel((40, 40))[:3], (153, 153, 153))
        before = deepcopy(self.store.model(self.project['id']))
        draft = self.store.recovery_preview(self.project['id'], self.payload, self.settings)
        self.assertGreater(draft['count'], 0)
        self.assertTrue(draft['paths'])
        result = self.store.recovery_apply(self.project['id'], draft['draft'], self.settings)
        merged = self.store.model(result['project']['id'])
        for mode in ('single', 'double'):
            old = before['modes'][mode]
            self.assertEqual(merged['modes'][mode][:len(old)], old)
            self.assertEqual(self.store.model(self.project['id'])['modes'][mode], old)
        old_drawing = self.store.drawing(self.project['id'], json.dumps(self.settings))
        drawing = result['drawing']
        for key in ('scale','pathColors','partModes','depthRegions'):
            self.assertEqual(drawing['settings'][key], old_drawing['settings'][key])
        self.assertEqual(drawing['pathData'][:len(old_drawing['pathData'])], old_drawing['pathData'])
        self.assertGreater(drawing['neonMeters'], old_drawing['neonMeters'])
        self.assertGreaterEqual(drawing['minGap'], 14.9)
        again = self.store.recovery_preview(result['project']['id'], self.payload, drawing['settings'])
        self.assertEqual(again['count'], 0, 'Repeating recovery must not add duplicate neon lengths')

    def test_cancel_is_immutable_and_stale_apply_rejected(self):
        count = len(self.store.models)
        draft = self.store.recovery_preview(self.project['id'], self.payload, self.settings)
        self.assertEqual(len(self.store.models), count)
        with self.assertRaisesRegex(ValueError, 'geändert'):
            self.store.recovery_apply(self.project['id'], draft['draft'], {**self.settings, 'gap':20})
        self.assertEqual(len(self.store.models), count)

    def test_uv_hidden_paths_and_curve_edits_survive_recovery(self):
        model = self.store.model(self.project['id'])
        curves = [i for i,c in enumerate(model['modes']['double'][0]['commands']) if c[0]=='c']
        settings = {**self.settings, 'hiddenPaths':['single:0'],
                    'straightened':{'double:0':curves[:1]},
                    'uvStrokes':[{'op':'add','radius':20,'points':[[60,110]]}]}
        old = self.store.drawing(self.project['id'], json.dumps(settings))
        draft = self.store.recovery_preview(self.project['id'], self.payload, settings)
        new = self.store.recovery_apply(self.project['id'], draft['draft'], settings)['drawing']
        for key in ('uvStrokes','hiddenPaths','straightened'):
            self.assertEqual(new['settings'][key], old['settings'][key])
        self.assertEqual(new['uv'], old['uv'])
        self.assertEqual(new['pathData'][:len(old['pathData'])], old['pathData'])

    def test_selection_boundary_does_not_become_a_neon_line(self):
        from geometry import path_length, sample_path
        from recovery import recover
        model = self.store.model(self.project['id'])
        payload = {**self.payload, 'rect':[30,20,60,60]}
        merged, keys = recover(model, payload)
        paths = [merged['modes']['double'][int(key.split(':')[1])]['commands'] for key in keys if key.startswith('double:')]
        self.assertEqual(len(paths), 2, 'Only the two true horizontal edges belong in this partial selection')
        self.assertAlmostEqual(sum(path_length(p) for p in paths), 60, delta=.5)
        for path in paths:
            points = np.asarray(sample_path(path, 50))
            self.assertLess(np.ptp(points[:,1]), .5, 'No vertical edges from the selection rectangle')
            self.assertGreaterEqual(points[:,0].min(), 29.99)
            self.assertLessEqual(points[:,0].max(), 60.01)

    def test_brush_selection_and_single_mode(self):
        mask = np.zeros((180, 260), np.uint8); mask[20:145, 10:90] = 1
        draft = self.store.recovery_preview(self.project['id'], {'mask':base64.b64encode(mask.tobytes()).decode(), 'seed':[40,40], 'tolerance':20}, {**self.settings,'mode':'single'})
        self.assertGreater(draft['count'], 0)
        for invalid in ({'rect':[90,20,10,145]}, {'seed':[500,1]}, {'tolerance':float('nan')}, {'mask':'AA=='}):
            with self.assertRaises(ValueError):
                self.store.recovery_preview(self.project['id'], {**self.payload, **invalid}, self.settings)

    def test_gradient_is_not_cut_at_the_picked_rgb_value(self):
        from recovery import selected_pixels
        pixels = np.full((100, 200, 3), 255, np.uint8)
        pixels[20:80, 20:180, 0] = 0
        pixels[20:80, 20:180, 1] = np.linspace(50, 170, 160).astype(np.uint8)
        pixels[20:80, 20:180, 2] = 255
        mask, _ = selected_pixels(Image.fromarray(pixels), {'rect':[10,10,190,90], 'seed':[40,50], 'tolerance':35})
        self.assertTrue(mask[50,160], 'A smooth gradient belongs to the same source region')
        self.assertFalse(mask[50,5], 'The visible edge to white must remain a boundary')


if __name__ == '__main__': unittest.main()
