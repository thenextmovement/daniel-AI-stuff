import io
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
for name in ('neon-studio-deps', 'python-deps'):
    sys.path.insert(0, str(ROOT.parent.parent / 'work' / name))

from PIL import Image, ImageDraw
import pdfplumber
from shapely.geometry import Polygon, LineString
from tracing import analyze_image
from geometry import build_geometry, sample_path
from export_pdf import make_pdf


def neon_vectors(page, drawing):
    expected=[tuple(int(c['color'][i:i+2],16)/255 for i in (1,3,5)) for c in drawing['pathColors']]
    return [p for p in page.curves+page.rects+page.lines
            if p['stroking_color'] and any(all(abs(a-b)<1e-5 for a,b in zip(p['stroking_color'],color)) for color in expected)]


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'assets/B_KITE.png').read_bytes()
        cls.model = analyze_image(cls.source)

    def drawing(self, **changes):
        return build_geometry(self.model, {'mode': 'double', 'shape': 'bottom', 'width': 600,
            'gap': 15, 'tube': 6, 'depth': 20, 'radius': 3, **changes})

    def test_colors_from_raster_preserve_geometry_and_export_as_colored_strokes(self):
        im=Image.new('RGBA',(250,180),(0,0,0,0));dr=ImageDraw.Draw(im)
        dr.line([(30,30),(30,130),(80,130)],fill='#ff7711',width=16)
        dr.ellipse((130,30,210,130),outline='#125bdc',width=14)
        raw=io.BytesIO();im.save(raw,'PNG');model=analyze_image(raw.getvalue())
        for mode in ('single','double'):
            d=build_geometry(model,{'mode':mode,'shape':'rectangle'})
            self.assertEqual({c['source'] for c in d['pathColors']},{'#ff7711','#125bdc'})
            self.assertEqual({c['color'] for c in d['pathColors']},{'#ff7711','#125bdc'})
            with pdfplumber.open(io.BytesIO(make_pdf(d))) as pdf:
                self.assertEqual(len(neon_vectors(pdf.pages[0],d)),len(d['paths']))
        before=self.drawing();key=before['pathKeys'][0]
        changed=self.drawing(pathColors={key:'warm-white',before['pathKeys'][1]:'pink'})
        self.assertEqual(changed['paths'],before['paths'])
        self.assertEqual(changed['outer'],before['outer'])
        self.assertEqual(changed['neonMeters'],before['neonMeters'])
        self.assertEqual(changed['pathColors'][0]['english'],'Warm white')
        self.assertEqual(changed['pathColors'][0]['color'],'#000000')
        self.assertEqual(changed['pathColors'][1]['name'],'Pink')
        with pdfplumber.open(io.BytesIO(make_pdf(changed,{'kind':'drawing'}))) as pdf:
            self.assertIn('Warm white (black lines)',pdf.pages[0].extract_text())
            self.assertEqual(len(neon_vectors(pdf.pages[0],changed)),len(changed['paths']))
            for vector in neon_vectors(pdf.pages[0],changed):
                self.assertFalse(vector['fill'])
                self.assertAlmostEqual(vector['linewidth'],72/25.4,places=5)
        hidden=self.drawing(pathColors={key:'warm-white'},hiddenPaths=[key])
        self.assertEqual(hidden['hiddenPaths'][0]['color']['id'],'warm-white')
        single=self.drawing(pathColors={key:'warm-white'},mode='single')
        self.assertNotIn('warm-white',[c['id'] for c in single['pathColors']])
        self.assertEqual(self.drawing()['pathColors'],before['pathColors'])

    def test_color_validation_and_white_neon_convention(self):
        from colors import line_color
        for value in ({'double:0':'pink;bad'},{'unknown':'pink'},[],{'double:0':None},{'double:0':{}},{'double:0':'#fff'}):
            with self.subTest(value=value),self.assertRaises(ValueError):self.drawing(pathColors=value)
        for color in ('#000000','#ffffff'):
            self.assertEqual(line_color(color)['id'],'cold-white')
            self.assertEqual(line_color(color)['color'],'#000000')
        self.assertEqual(line_color('#123456')['color'],'#123456')
        self.assertEqual(line_color('#123456','warm-white')['english'],'Warm white')

    def test_bkite_reference_matches_physical_geometry(self):
        d = self.drawing()
        self.assertEqual(self.model['sourceKind'], 'master')
        self.assertEqual(len(d['paths']), 9)
        self.assertTrue(all(p[-1][0] == 'h' for p in d['paths']))
        self.assertAlmostEqual(d['width'], 600, places=3)
        self.assertAlmostEqual(d['height'], 820.5432372525719, places=3)
        self.assertAlmostEqual(d['neonMeters'], 8.350440568552678, places=5)

    def test_large_widths_and_manual_intermediate_size_keep_physical_clearance(self):
        from copy import deepcopy
        from geometry import path_length
        # Wide fixture so the independently bounded height stays below 20 m.
        model=deepcopy(self.model)
        for mode in model['modes'].values():
            for item in mode:
                item['commands']=[[c[0],*[[x,y*.2] for x,y in c[1:]]] for c in item['commands']]
                item['length']=path_length(item['commands'])
        measurements=[]
        for width in (2000,2345.6,2500,3400,20000):
            d=build_geometry(model,dict(width=width,shape='rectangle',gap=15,tube=6))
            self.assertAlmostEqual(d['width'],width,places=6)
            self.assertAlmostEqual(d['minGap'],15,places=5)
            self.assertEqual(d['settings']['tube'],6)
            measurements.append(d['neonMeters']/(width-30))
            raw=make_pdf(d)
            from pypdf import PdfReader
            page=PdfReader(io.BytesIO(raw)).pages[0]
            unit=float(page.get('/UserUnit',1))
            self.assertLessEqual(float(page.mediabox.width),14400)
            self.assertAlmostEqual(float(page.mediabox.width)*unit*25.4/72,width+30,places=2)
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                # Re-read exported neon curves; no reliance on stored lengths.
                total=sum(path_length(o['path']) for o in neon_vectors(pdf.pages[0],d))
            self.assertAlmostEqual(total*unit*25.4/72/1000,d['neonMeters'],places=4)
        self.assertLess(max(measurements)-min(measurements),1e-10)
        with self.assertRaises(ValueError):
            build_geometry(model,dict(width=20001))

    def test_single_has_real_centerlines_and_shorter_length(self):
        d = self.drawing(mode='single')
        self.assertEqual(len(d['paths']), 15)
        self.assertTrue(all(p[-1][0] != 'h' for p in d['paths']))
        self.assertLess(d['neonMeters'], self.drawing()['neonMeters'] * .7)

    def test_material_meters_apply_allowance_once_to_visible_geometry(self):
        from geometry import path_length
        for mode in ('single', 'double'):
            for width in (600, 2000, 3400):
                before = self.drawing(mode=mode, width=width)
                for hidden in ([], before['pathKeys'][:1], before['pathKeys']):
                    d = self.drawing(**{**before['settings'], 'hiddenPaths': hidden})
                    geometric = sum(path_length(p) for p in d['paths']) / 1000
                    self.assertAlmostEqual(d['neonMeters'], geometric, places=7)
                    self.assertAlmostEqual(d['neonMaterialMeters'], geometric * 1.10, places=7)

    def test_straighten_one_curve_preserves_other_segments_and_remeasures(self):
        from copy import deepcopy
        from geometry import path_length
        original=deepcopy(self.model)
        before=self.drawing()
        index,segment=next((i,j) for i,p in enumerate(before['paths']) for j,c in enumerate(p) if c[0]=='c')
        key=before['pathKeys'][index]
        after=build_geometry(self.model,{**before['settings'],'straightened':{key:[segment]}})
        expected=deepcopy(before['paths'])
        expected[index][segment]=['l',expected[index][segment][-1]]
        self.assertEqual(after['paths'],expected)
        self.assertEqual(self.model,original)
        self.assertAlmostEqual(after['neonMeters'],sum(path_length(p) for p in after['paths'])/1000,places=8)
        self.assertLess(after['neonMeters'],before['neonMeters'])
        restored=build_geometry(self.model,{**before['settings'],'straightened':{}})
        self.assertEqual(restored['paths'],before['paths'])
        # Mode switches cannot apply a double-line edit to a single-line path.
        single=build_geometry(self.model,{**after['settings'],'mode':'single'})
        single_original=build_geometry(self.model,{**before['settings'],'mode':'single'})
        self.assertEqual(single['paths'],single_original['paths'])
        unrelated=next(p['id'] for p in self.model['parts'] if p['id']!=before['pathPartIds'][index])
        mixed=build_geometry(self.model,{**after['settings'],'partModes':{unrelated:'single'}})
        self.assertEqual(mixed['paths'][mixed['pathKeys'].index(key)],after['paths'][index])
        with pdfplumber.open(io.BytesIO(make_pdf(after))) as pdf:
            self.assertTrue(pdf.pages[0].curves or pdf.pages[0].lines)

    def test_hidden_path_excluded_from_geometry_length_and_pdf_without_moving_others(self):
        from copy import deepcopy
        from geometry import path_length
        original=deepcopy(self.model)
        before=self.drawing()
        key=before['pathKeys'][0]
        after=build_geometry(self.model,{**before['settings'],'hiddenPaths':[key]})
        self.assertEqual(after['pathKeys'],before['pathKeys'][1:])
        for got,want in zip(after['paths'],before['paths'][1:]):
            for a,b in zip(got,want):
                self.assertEqual(a[0],b[0])
                for p,q in zip(a[1:],b[1:]):
                    for v,w in zip(p,q):self.assertAlmostEqual(v,w,places=8)
        self.assertAlmostEqual(after['neonMeters'],before['neonMeters']-path_length(before['paths'][0])/1000,places=8)
        self.assertNotEqual(after['outer'],before['outer'])
        self.assertEqual(after['hiddenPaths'][0]['key'],key)
        self.assertEqual(self.model,original)
        with pdfplumber.open(io.BytesIO(make_pdf(after))) as pdf:
            blue=neon_vectors(pdf.pages[0],after)
            self.assertEqual(len(blue),len(after['paths']))
        restored=build_geometry(self.model,{**after['settings'],'hiddenPaths':[]})
        self.assertEqual(restored['paths'],before['paths'])
        single=build_geometry(self.model,{**after['settings'],'mode':'single'})
        self.assertEqual(len(single['paths']),15)
        self.assertEqual(single['hiddenPaths'][0]['key'],key)
        unrelated=next(p['id'] for p in self.model['parts'] if p['id']!=before['pathPartIds'][0])
        mixed=build_geometry(self.model,{**after['settings'],'partModes':{unrelated:'single'}})
        self.assertNotIn(key,mixed['pathKeys'])
        self.assertIn('single',mixed['pathModes'])

    def test_all_hidden_retains_recovery_list_but_cannot_export(self):
        before=self.drawing()
        after=build_geometry(self.model,{**before['settings'],'hiddenPaths':before['pathKeys']})
        self.assertEqual(after['paths'],[])
        self.assertEqual(after['outer'],[])
        self.assertEqual(after['neonMeters'],0)
        self.assertEqual(len(after['hiddenPaths']),len(before['paths']))
        self.assertFalse(after['exportable'])
        with self.assertRaises(ValueError):make_pdf(after)
        restored=build_geometry(self.model,{**after['settings'],'hiddenPaths':[]})
        self.assertEqual(restored['paths'],before['paths'])
        for invalid in ('double:0',['unknown'],[None],[{}]):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                self.drawing(hiddenPaths=invalid)

    def test_hiding_until_only_a_vertical_line_remains_can_be_restored(self):
        before=self.drawing(mode='single')
        index=next(i for i,p in enumerate(before['paths']) if len(p)==2 and p[0][1][0]==p[1][1][0])
        hidden=[key for i,key in enumerate(before['pathKeys']) if i!=index]
        after=build_geometry(self.model,{**before['settings'],'hiddenPaths':hidden})
        self.assertTrue(after['exportable'])
        for old,new in zip(sample_path(before['paths'][index]),sample_path(after['paths'][0]),strict=True):
            for a,b in zip(old,new):self.assertAlmostEqual(a,b,places=9)
        self.assertLess(after['width'],80)
        again=build_geometry(self.model,{**after['settings'],'radius':2})
        self.assertEqual(again['paths'],after['paths'])
        restored=build_geometry(self.model,{**again['settings'],'hiddenPaths':[]})
        self.assertEqual(restored['paths'],before['paths'])

    def test_straighten_rejects_invalid_curve_references(self):
        for value in ([],{'unknown':[1]},{'double:0':[-1]},{'double:0':[0]},{'double:0':[True]},{'double:0':[99999]},{'double:0':'1'}):
            with self.subTest(value=value),self.assertRaises(ValueError):
                self.drawing(straightened=value)

    def test_notch_changes_do_not_change_neon_geometry(self):
        a, b = self.drawing(depth=8), self.drawing(depth=30)
        self.assertEqual(a['paths'], b['paths'])
        self.assertEqual(a['neonMeters'], b['neonMeters'])
        self.assertNotEqual(a['outer'], b['outer'])

    def test_full_shape_limits_recesses_without_moving_neon(self):
        shallow = self.drawing(shape='shape', depth=10)
        deep = self.drawing(shape='shape', depth=45)
        self.assertEqual(shallow['paths'], deep['paths'])
        self.assertNotEqual(shallow['outer'], deep['outer'])
        self.assertAlmostEqual(shallow['width'],600,places=6)
        self.assertAlmostEqual(deep['width'],600,places=6)
        from shapely.geometry import Point
        for drawing, limit in ((shallow, 10), (deep, 45), (self.drawing(shape='shape', depth=0), 0), (self.drawing(shape='shape', depth=80), 80)):
            polygon = Polygon(sample_path(drawing['outer'], 100))
            hull = polygon.convex_hull.exterior
            self.assertLessEqual(max(hull.distance(Point(p)) for p in polygon.exterior.coords), limit + .15)

    def test_mixed_modes_keep_other_components_and_exact_length(self):
        self.assertEqual(len(self.model['parts']), 7)
        b_paths=[p for p in self.model['modes']['double'] if p['name'].startswith('B ')]
        self.assertEqual(len(b_paths), 3)
        self.assertEqual(len({p['partId'] for p in b_paths}), 1)
        original = self.drawing()
        part = self.model['parts'][-1]['id']
        mixed = build_geometry(self.model, {**original['settings'], 'partModes': {part: 'single'}})
        expected = [p for p in self.model['modes']['double'] if p['partId'] != part]
        expected += [p for p in self.model['modes']['single'] if p['partId'] == part]
        self.assertEqual(len(mixed['paths']), len(expected))
        self.assertEqual(mixed['modeLabel'], 'Gemischt')
        self.assertAlmostEqual(mixed['neonMeters'], sum(p['length'] for p in expected)*original['settings']['scale']/1000, places=7)
        for name, path, pid in zip(original['names'], original['paths'], original['pathPartIds']):
            if pid != part:
                self.assertEqual(path, mixed['paths'][mixed['names'].index(name)])
        for overrides in ({part:'invalid'}, {'unknown':'single'}, []):
            with self.assertRaises(ValueError):
                self.drawing(partModes=overrides)
        with pdfplumber.open(io.BytesIO(make_pdf(mixed, {'kind':'drawing'}))) as pdf:
            self.assertIn('Mixed', pdf.pages[0].extract_text())

    def test_missing_component_cannot_silently_disappear_in_export(self):
        from copy import deepcopy
        model=deepcopy(self.model)
        part=model['parts'][-1]
        model['modes']['single']=[p for p in model['modes']['single'] if p['partId']!=part['id']]
        part['single']=0
        drawing=build_geometry(model, {'partModes':{part['id']:'single'}})
        self.assertFalse(drawing['exportable'])
        self.assertTrue(any('fehlen Linien' in note for note in drawing['notices']))
        with self.assertRaises(ValueError):
            make_pdf(drawing)

    def test_nova_is_traced_and_components_can_be_mixed(self):
        model = analyze_image((ROOT/'assets/NOVA_Test.png').read_bytes())
        self.assertEqual(model['sourceKind'], 'trace')
        self.assertEqual(len(model['parts']), 6)
        for mode in ('single', 'double'):
            self.assertTrue(all(p['partId'] in {p['id'] for p in model['parts']} for p in model['modes'][mode]))
        overrides = {p['id']:'single' for p in model['parts'] if p['bounds'][1] > 850}
        d = build_geometry(model, {'shape':'shape', 'depth':15, 'partModes':overrides})
        self.assertEqual(d['modeLabel'], 'Gemischt')
        self.assertTrue(Polygon(sample_path(d['outer'],80)).is_valid)
        self.assertGreater(d['minGap'], 14.9)

    def test_padding_changes_preserve_scaled_neon_and_grow_backing(self):
        a = self.drawing()
        b = build_geometry(self.model, {**a['settings'], 'gap': 30})
        self.assertAlmostEqual(b['neonMeters'], a['neonMeters'], places=8)
        for old,new in zip(a['paths'],b['paths']):
            for first,second in zip(sample_path(old),sample_path(new)):
                self.assertAlmostEqual(first[0], second[0], places=7)
                self.assertAlmostEqual(first[1], second[1], places=7)
        self.assertAlmostEqual(b['width'], a['width']+30, places=5)
        self.assertAlmostEqual(b['height'], a['height']+30, places=5)

    def test_whole_sign_resizing_scales_neon_and_backing_equally(self):
        a = self.drawing()
        settings={**a['settings']}
        for key in ('width','scale','gap','tube','depth','radius','reserve'):
            settings[key]*=2
        b=build_geometry(self.model,settings)
        self.assertAlmostEqual(b['neonMeters'], a['neonMeters']*2, places=7)
        self.assertAlmostEqual(b['width'], a['width']*2, places=6)
        self.assertAlmostEqual(b['height'], a['height']*2, places=6)

    def test_all_shapes_have_one_closed_containing_outline(self):
        for shape in ('rectangle', 'bottom', 'shape'):
            for mode in ('single', 'double'):
                with self.subTest(shape=shape, mode=mode):
                    d = self.drawing(shape=shape, mode=mode)
                    poly = Polygon(sample_path(d['outer'], 80))
                    self.assertEqual(d['outer'][-1][0], 'h')
                    self.assertTrue(poly.is_valid)
                    for p in d['paths']:
                        route = LineString(sample_path(p, 80))
                        self.assertTrue(poly.covers(route))
                        self.assertGreaterEqual(poly.exterior.distance(route), 14.90)

    def test_geometric_length_scales_with_motif(self):
        a = self.drawing()
        b = self.drawing(width=1200, gap=30, tube=12, depth=40, radius=6)
        self.assertAlmostEqual(b['neonMeters'], a['neonMeters']*2, places=5)

    def test_another_image_is_not_replaced_by_master(self):
        im = Image.new('RGB', (300, 220), 'white')
        dr = ImageDraw.Draw(im)
        dr.line([(60, 35), (60, 180), (220, 180)], fill='black', width=18)
        b = io.BytesIO(); im.save(b, 'PNG')
        model = analyze_image(b.getvalue())
        self.assertEqual(model['sourceKind'], 'trace')
        for mode in ('single', 'double'):
            d = build_geometry(model, {'mode': mode, 'width': 600, 'shape': 'rectangle'})
            self.assertGreater(d['neonMeters'], 0)
            self.assertLess(len(d['paths']), 5)

        centerline=LineString([(60,35),(60,180),(220,180)])
        for route in model['modes']['single']:
            for point in sample_path(route['commands'],100):
                from shapely.geometry import Point
                self.assertLess(centerline.distance(Point(point)),5)

    def test_empty_and_invalid_images_fail_explicitly(self):
        b = io.BytesIO(); Image.new('RGB', (150, 150), 'white').save(b, 'PNG')
        for raw in (b.getvalue(), b'not an image'):
            with self.subTest(length=len(raw)), self.assertRaises(ValueError):
                analyze_image(raw)

    def test_invalid_physical_dimensions_fail(self):
        for changes in ({'width': 0}, {'width': float('nan')}, {'gap': -1},
                        {'tube': 0}, {'depth': 20001}, {'mode': 'unknown'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.drawing(**changes)

    def test_cnc_pdf_is_stroked_vectors_in_mm_without_annotations(self):
        d = self.drawing()
        raw = make_pdf(d, {'kind': 'cnc', 'title': 'B KITE'})
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            page = pdf.pages[0]
            self.assertEqual(page.chars, [])
            self.assertEqual(page.images, [])
            vectors=page.curves+page.rects+page.lines
            self.assertEqual(len(vectors), 10)
            for curve in vectors:
                self.assertFalse(curve['fill'])
                self.assertAlmostEqual(curve['linewidth'], 72/25.4, places=5)
            points = [pt for curve in vectors for pt in curve['pts']]
            self.assertAlmostEqual((max(x for x,y in points)-min(x for x,y in points))*25.4/72, 600, places=3)

    def test_info_pdf_includes_dimensions_and_neon_excluding_backing(self):
        raw = make_pdf(self.drawing(), {'kind': 'drawing', 'dimensions': True,
            'meters': True, 'title': 'B KITE', 'note': 'Testauftrag'})
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
            self.assertIn('60.00 cm', text)
            self.assertIn('60.00 x 82.05 cm', text)
            self.assertIn('Neon-Length: 9.19 m', text)
            self.assertIn('Double Line / Drawing 1:1', text)
            self.assertIn('Excludes backing outline and cables.', text)
            self.assertIn('Existing vector artwork', text)
            self.assertNotIn('Außen', text)
            self.assertNotIn('Zeichnung', text)
            self.assertNotIn('netto', text)
            self.assertNotIn('Verschnitt', text)
            self.assertIn('(8.35 m +10%)', text)
            self.assertIn('Backing: Cut to Shape - bottom only',text)
            self.assertIn('Neon path to acrylic edge: 1.50 cm',text)
            self.assertNotIn('Zuschlag', text)
            self.assertIn('Testauftrag', text)
            self.assertFalse(any(page.images for page in pdf.pages))

    def test_annotations_scale_with_sign_without_changing_physical_paths(self):
        from copy import deepcopy
        from geometry import path_length
        from pypdf import PdfReader
        model=deepcopy(self.model)
        # Landscape fixture reaches 20 m width without exceeding the height cap.
        for mode in model['modes'].values():
            for item in mode:
                item['commands']=[[c[0],*[[y,x] for x,y in c[1:]]] for c in item['commands']]
        title_sizes=[]
        for width in (600,2000,20000):
            d=build_geometry(model,dict(width=width,shape='rectangle'))
            raw=make_pdf(d,{'kind':'drawing','title':'Test sign'})
            page=PdfReader(io.BytesIO(raw)).pages[0]
            unit=float(page.get('/UserUnit',1))
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                page=pdf.pages[0]
                title_sizes.append(page.chars[0]['size']*unit/max(d['width'],d['height']))
                blue=neon_vectors(page,d)
                self.assertEqual(len(blue),len(d['paths']))
                self.assertAlmostEqual(sum(path_length(o['path']) for o in blue)*unit*25.4/72/1000,d['neonMeters'],places=4)
                for path in blue:self.assertAlmostEqual(path['linewidth']*unit,72/25.4,places=4)
                for char in page.chars:
                    self.assertGreaterEqual(char['x0'],0)
                    self.assertLessEqual(char['x1'],page.width)
                    self.assertGreaterEqual(char['top'],0)
                    self.assertLessEqual(char['bottom'],page.height)
        self.assertLess(max(title_sizes)-min(title_sizes),1e-7)

    def test_long_custom_text_stays_on_small_drawing_page(self):
        raw = make_pdf(self.drawing(width=80), {'kind': 'custom',
            'title': 'W' * 120, 'note': 'W' * 600})
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            page = pdf.pages[0]
            for char in page.chars:
                self.assertGreaterEqual(char['x0'], 0)
                self.assertLessEqual(char['x1'], page.width)
                self.assertGreaterEqual(char['top'], 0)
                self.assertLessEqual(char['bottom'], page.height)

if __name__ == '__main__':
    unittest.main()
