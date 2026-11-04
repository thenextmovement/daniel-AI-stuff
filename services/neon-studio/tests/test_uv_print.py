import base64
import copy
import io
import unittest
import server
import numpy as np
from shapely.geometry import box, Polygon, LineString
from PIL import Image, ImageDraw
from geometry import build_geometry, path_length, sample_path
from vector_import import analyze_vector
from uv_print import subtract_mask
from export_pdf import make_pdf
from pypdf import PdfReader

SVG=b'''<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><path fill="#ee6622" d="M0 0H100V10H0Z M0 40H100V50H0Z" fill-rule="evenodd"/></svg>'''

class UVPrintTests(unittest.TestCase):
    def test_partial_bezier_and_line_length(self):
        line=[['m',[0,0]],['l',[100,0]]]
        clipped=subtract_mask(line,box(20,-10,70,10))
        self.assertAlmostEqual(path_length(clipped),50,places=4)
        curve=[['m',[0,0]],['c',[0,50],[100,50],[100,0]]]
        self.assertEqual(subtract_mask(curve,box(200,200,300,300)),curve)
        clipped=subtract_mask(curve,box(50,-10,110,100))
        self.assertTrue(any(c[0]=='c' for c in clipped))
        self.assertAlmostEqual(path_length(clipped),path_length(curve)/2,places=4)

    def test_uv_print_keeps_backing_and_excludes_neon(self):
        model=analyze_vector(SVG,'test.svg');original=copy.deepcopy(model['modes']['double'])
        opts={'mode':'double','shape':'shape','scale':1,'gap':15,'depth':30}
        before=build_geometry(model,opts)
        stroke={'op':'add','radius':15,'points':[[0,45],[100,45]]}
        after=build_geometry(model,{**opts,'uvStrokes':[stroke]})
        self.assertAlmostEqual(after['neonMeters'],before['neonMeters']/2,places=4)
        self.assertAlmostEqual(after['height'],before['height'],places=2)
        self.assertIsNotNone(after['uv']);self.assertEqual(model['modes']['double'],original)
        self.assertIn('fill="#ee6622"',base64.b64decode(model['image'].split(',')[1]).decode())
        erased=build_geometry(model,{**opts,'uvStrokes':[stroke,{**stroke,'op':'erase'}]})
        self.assertEqual(erased['paths'],before['paths']);self.assertIsNone(erased['uv'])
        # The UV PDF contains fill operators and no neon/backing strokes.
        uv=PdfReader(io.BytesIO(make_pdf(after,{'kind':'uv'}))).pages[0].get_contents().get_data()
        cnc=PdfReader(io.BytesIO(make_pdf(after,{'kind':'cnc'}))).pages[0].get_contents().get_data()
        self.assertIn(b'f*',uv);self.assertNotIn(b'\nS\n',uv)
        self.assertIn(b'\nS\n',cnc);self.assertNotIn(b'\nf\n',cnc);self.assertNotIn(b'\nf*\n',cnc)
        single=build_geometry(model,{**opts,'mode':'single','uvStrokes':[stroke]})
        self.assertLess(single['neonMeters'],after['neonMeters'])
        self.assertIsNotNone(single['uv']);self.assertEqual(model['modes']['double'],original)

    def test_compound_fills_keep_counters_and_stroke_parts(self):
        import pypdfium2 as pdfium
        from vector_import import vector_preview
        from uv_print import filled_shape
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><path fill="#ee6622" fill-rule="evenodd" d="M10 10H90V50H10Z M30 20H70V40H30Z"/><path d="M15 55H35 M65 55H85" fill="none" stroke="blue"/></svg>'
        model=analyze_vector(svg,'counter.svg');preview=vector_preview(model)
        self.assertEqual(len(preview['paths']),len({p['id'] for p in preview['paths']}))
        original=copy.deepcopy(model['modes']['double'])
        single=build_geometry(model,{'mode':'single','scale':1})
        self.assertTrue(all(p['single'] for p in model['parts']))
        self.assertEqual(model['modes']['double'],original)
        result=build_geometry(model,{'mode':'double','scale':1,'uvStrokes':[{'op':'add','radius':100,'points':[[40,20]]}]})
        pdf=pdfium.PdfDocument(make_pdf(result,{'kind':'uv'}));im=pdf[0].render(scale=1).to_pil().convert('RGB')
        # Full artwork starts 25 mm from the left/top (10 mm PDF margin + 15 mm backing gap).
        self.assertGreater(im.getpixel((int(65*72/25.4),int(45*72/25.4)))[1],240)
        self.assertLess(im.getpixel((int(30*72/25.4),int(30*72/25.4)))[1],150)
        same=[['m',[0,0]],['l',[10,0]],['l',[10,10]],['l',[0,10]],['h'],['m',[2,2]],['l',[8,2]],['l',[8,8]],['l',[2,8]],['h']]
        self.assertAlmostEqual(filled_shape(same,False).area,100)
        self.assertAlmostEqual(filled_shape(same,True).area,64)

    def test_forms_mode_excludes_background_keeps_counters_and_erases(self):
        from uv_print import uv_geometry
        from shapely.geometry import Point
        # A colored page, an orange ring and a second separate symbol.
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><path fill="#240106" d="M0 0H100V60H0Z"/><path fill="#ee6622" fill-rule="evenodd" d="M10 10H40V50H10Z M20 20H30V40H20Z"/><path fill="blue" d="M60 10H90V50H60Z"/></svg>'
        model=analyze_vector(svg,'background.svg')
        stroke={'op':'add','radius':35,'points':[[25,30]]}
        mask,support,clip=uv_geometry(model,[stroke],[0,0],'forms')
        self.assertTrue(clip.covers(Point(15,30)))
        self.assertFalse(clip.covers(Point(25,30))) # counter, not page ink
        self.assertFalse(clip.covers(Point(5,30))) # painted background
        _,_,original=uv_geometry(model,[stroke],[0,0],'original')
        self.assertTrue(original.covers(Point(5,30)))
        erase={'op':'erase','radius':6,'points':[[15,30]]}
        _,_,erased=uv_geometry(model,[stroke,erase],[0,0],'forms')
        self.assertFalse(erased.covers(Point(15,30)))
        self.assertTrue(erased.covers(Point(15,15)))
        opts={'shape':'rectangle','scale':1,'uvStrokes':[stroke]}
        a=build_geometry(model,{**opts,'uvMode':'original'})
        b=build_geometry(model,{**opts,'uvMode':'forms'})
        self.assertAlmostEqual(a['neonMeters'],b['neonMeters'])
        self.assertNotEqual(a['uv']['clipData'],b['uv']['clipData'])
        import pypdfium2 as pdfium
        rendered=pdfium.PdfDocument(make_pdf(b,{'kind':'uv'}))[0].render(scale=1).to_pil().convert('RGB')
        # Page artwork origin = 10 mm export margin + 15 mm backing margin.
        self.assertGreater(min(rendered.getpixel((int(30*72/25.4),int(55*72/25.4)))),240)
        self.assertLess(rendered.getpixel((int(40*72/25.4),int(55*72/25.4)))[1],150)

    def test_raster_forms_preserve_holes_and_do_not_fill_brush(self):
        from uv_print import uv_geometry
        from shapely.geometry import Point
        # Trace models group outer and inner paths under the same component.
        outer=[['m',[10,10]],['l',[90,10]],['l',[90,50]],['l',[10,50]],['h']]
        inner=[['m',[30,20]],['l',[70,20]],['l',[70,40]],['l',[30,40]],['h']]
        model={'sourceKind':'trace','imageBounds':[0,0,100,60], 'modes':{'double':[{'commands':outer,'partId':'ring'},{'commands':inner,'partId':'ring'}]}}
        _,_,clip=uv_geometry(model,[{'op':'add','radius':100,'points':[[50,30]]}],[0,0],'forms')
        self.assertTrue(clip.covers(Point(15,30)))
        self.assertFalse(clip.covers(Point(50,30)))
        self.assertFalse(clip.covers(Point(5,30)))

    def test_images_and_uv_only_resize(self):
        image=Image.new('RGBA',(160,100),(0,0,0,0));draw=ImageDraw.Draw(image)
        draw.rectangle((10,10,150,25),fill='#ff6622');draw.rectangle((10,70,150,85),fill='#3366ff')
        data=io.BytesIO();image.save(data,'PNG');model=server.analyze_image(data.getvalue())
        opts={'shape':'rectangle','scale':1,'uvStrokes':[{'op':'add','radius':200,'points':[[70,40]]}]}
        result=build_geometry(model,opts)
        self.assertTrue(result['exportable']);self.assertEqual(result['neonMeters'],0);self.assertEqual(result['paths'],[])
        self.assertIsNone(result['uv']['artwork']);self.assertEqual(result['uv']['image'],model['image'])
        doubled=build_geometry(model,{**opts,'scale':2})
        self.assertAlmostEqual(doubled['width']-30,2*(result['width']-30),places=4)
        self.assertGreater(len(make_pdf(result,{'kind':'uv'})),100)

if __name__=='__main__':unittest.main()
