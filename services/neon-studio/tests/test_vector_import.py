import base64
import copy
import io
import sys
import unittest
import numpy as np
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
import pdfplumber
from geometry import build_geometry, path_bounds, path_length
from tracing import analyze_image
from vector_import import analyze_vector
from export_pdf import make_pdf

SVG=b'''<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40">
 <g transform="translate(5 0)"><path d="M10 10 C20 0 30 20 40 10 L60 25" stroke="#db6b30" fill="none" stroke-width="2"/></g>
 <path d="M70 10 L90 10 L90 30 Z" stroke="#244de2" fill="none"/>
</svg>'''


class VectorImportTests(unittest.TestCase):
    def test_selected_stroked_outlines_become_centerlines_without_changing_logo(self):
        # A six-mm-wide I, a ring with a separately stroked counter, and a logo.
        svg=b'''<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60">
        <g fill="none" stroke="#db6b30"><path d="M5 5H11V55H5Z"/>
        <circle cx="40" cy="30" r="20"/><circle cx="40" cy="30" r="14"/>
        <path d="M70 5C95 5 95 55 70 55Z"/></g></svg>'''
        model=analyze_vector(svg,'outlined.svg')
        original=sorted(copy.deepcopy(model['modes']['double']),key=lambda p:path_bounds(p['commands'])[0])
        ids=[p['partId'] for p in original]
        options=dict(mode='double',shape='rectangle',scale=1)
        selected=build_geometry(model,{**options,'partModes':dict.fromkeys(ids[:3],'single')})
        self.assertEqual(selected['modeLabel'],'Gemischt')
        self.assertEqual(sorted(model['modes']['double'],key=lambda p:path_bounds(p['commands'])[0]),original)
        # At native scale the I lies on x=8, and the O has radius 17.
        letter_paths=[p for p,part in zip(selected['paths'],selected['pathPartIds']) if part==ids[0]]
        self.assertEqual(len(letter_paths),1)
        x0,y0,x1,y1=path_bounds(letter_paths[0])
        self.assertLess(x1-x0,.15)
        self.assertAlmostEqual(y1-y0,44,delta=.5)
        ring_paths=[p for p,part in zip(selected['paths'],selected['pathPartIds']) if part==ids[1]]
        self.assertEqual(len(ring_paths),1)
        self.assertAlmostEqual(path_length(ring_paths[0]),106.814,delta=.8)
        logo=selected['paths'][selected['pathPartIds'].index(ids[3])]
        self.assertEqual([c[0] for c in logo],[c[0] for c in original[3]['commands']])
        np.testing.assert_allclose([v for c in logo for v in c[1:]],[v for c in original[3]['commands'] for v in c[1:]],atol=1e-9)
        # Back to defaults/Double restores every original path, even after caching.
        restored=build_geometry(model,options)
        for path,part in zip(restored['paths'],restored['pathPartIds']):
            expected=next(p['commands'] for p in original if p['partId']==part)
            np.testing.assert_allclose([v for c in path for v in c[1:]],[v for c in expected for v in c[1:]],atol=1e-9)
        unchanged_single=build_geometry(model,{**options,'mode':'single'})
        self.assertEqual(unchanged_single['paths'],restored['paths'])
        repeated=build_geometry(model,{**options,'partModes':dict.fromkeys(ids[:3],'single')})
        self.assertEqual(repeated['pathKeys'],selected['pathKeys'])
        self.assertEqual(repeated['paths'],selected['paths'])

    def test_outlined_conversion_keeps_open_strokes_and_cached_path_keys(self):
        svg=b'''<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="60mm" viewBox="0 0 50 60">
        <g fill="none" stroke="black"><path d="M5 5H11V55H5Z"/>
        <path d="M25 5H31V55H25Z"/><path d="M40 5L40 55"/></g></svg>'''
        model=analyze_vector(svg,'strokes.svg')
        original=sorted(copy.deepcopy(model['modes']['double']),key=lambda p:path_bounds(p['commands'])[0])
        ids=[p['partId'] for p in original];options=dict(mode='double',shape='rectangle',scale=1)
        first=build_geometry(model,{**options,'partModes':{ids[0]:'single'}})
        key=next(k for k,i in zip(first['pathKeys'],first['pathPartIds']) if i==ids[0])
        changed=build_geometry(model,{**options,'partModes':dict.fromkeys(ids,'single'),'pathColors':{key:'red'}})
        self.assertIn(key,changed['pathKeys'])
        self.assertEqual(changed['pathColors'][changed['pathKeys'].index(key)]['id'],'red')
        open_path=changed['paths'][changed['pathPartIds'].index(ids[2])]
        np.testing.assert_allclose([v for c in open_path for v in c[1:]],[v for c in original[2]['commands'] for v in c[1:]],atol=1e-9)
        self.assertLess(len(changed['paths'][changed['pathPartIds'].index(ids[1])]),len(original[1]['commands']))

    def test_svg_upload_preserves_cubic_controls_color_and_physical_units(self):
        store=server.Store()
        with patch('server.analyze_image',side_effect=AssertionError('No raster tracing')):
            prepared=store.prepare(SVG,'Logo.SVG')
            self.assertEqual(prepared['kind'],'vector')
            self.assertFalse(store.models)
            project=store.trace_selection(prepared['id'],prepared['suggested'])
        model=store.model(project['id'])
        self.assertEqual(project['sourceKind'],'vector')
        self.assertFalse(project['vectorHasFills'])
        self.assertAlmostEqual(project['nativeWidthMm'],75,places=4)
        path=model['modes']['single'][0]
        self.assertEqual(path['sourceColor'],'#db6b30')
        self.assertEqual([c[0] for c in path['commands']],['m','c','l'])
        for point,expected in zip(path['commands'][1][1:],([10,-7.11324865],[20,12.88675135],[30,2.88675135])):
            for a,b in zip(point,expected):self.assertAlmostEqual(a,b,places=4)
        drawing=build_geometry(model,{'mode':'single','scale':1,'width':111.2,'shape':'rectangle'})
        self.assertAlmostEqual(drawing['width'],105,places=4)  # 75 mm artwork + 15 mm per side
        self.assertAlmostEqual(drawing['neonMeters'],sum(p['length'] for p in model['modes']['single'])/1000,places=7)
        with pdfplumber.open(io.BytesIO(make_pdf(drawing))) as pdf:
            colored=[p for p in pdf.pages[0].curves if p['stroking_color'][0]>.8]
            self.assertEqual(len(colored),1)
            self.assertEqual([c[0] for c in colored[0]['path']],['m','c','l'])
            self.assertFalse(colored[0]['fill'])

    def test_filled_svg_imports_contours_without_claiming_they_are_centerlines(self):
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="40mm" viewBox="0 0 100 40"><path fill="#db6b30" fill-rule="evenodd" d="M10 5H90V35H10Z M20 10V30H80V10Z"/></svg>'
        model=analyze_vector(svg,'logo.svg')
        self.assertTrue(model['vectorHasFills'])
        self.assertEqual(len(model['modes']['double']),2)
        self.assertTrue(all(p['commands'][-1][0]=='h' for p in model['modes']['double']))
        self.assertTrue(build_geometry(model,{'mode':'double','shape':'rectangle'})['exportable'])
        original=copy.deepcopy(model['modes']['double'])
        single=build_geometry(model,{'mode':'single','scale':1})
        self.assertTrue(single['exportable'])
        self.assertLess(single['neonMeters'],sum(p['length'] for p in original)/1000)
        self.assertEqual(model['modes']['double'],original)

    def test_pdf_userunit_rotation_and_colors_preserve_native_length(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(100*mm,50*mm))
        c.setStrokeColorRGB(1,.5,0);p=c.beginPath();p.moveTo(10*mm,10*mm);p.curveTo(20*mm,30*mm,40*mm,0,60*mm,20*mm);c.drawPath(p);c.save()
        model=analyze_vector(raw.getvalue(),'curve.pdf')
        writer=PdfWriter(clone_from=PdfReader(io.BytesIO(raw.getvalue())))
        writer.pages[0][NameObject('/UserUnit')]=NumberObject(2);writer.pages[0].rotate(90)
        altered=io.BytesIO();writer.write(altered)
        second=analyze_vector(altered.getvalue(),'curve.pdf')
        self.assertEqual(second['modes']['single'][0]['sourceColor'],'#ff8000')
        self.assertAlmostEqual(second['modes']['single'][0]['length'],2*model['modes']['single'][0]['length'],places=5)
        self.assertAlmostEqual(second['nativeWidthMm'],2*model['nativeHeightMm'],places=5)

    def test_unsupported_content_has_explicit_errors(self):
        for element in ('<image href="file:///etc/passwd"/>','<text>Hello</text>','<clipPath/>','<script/>'):
            with self.subTest(element=element),self.assertRaises(ValueError):
                analyze_vector(('<svg xmlns="http://www.w3.org/2000/svg">'+element+'</svg>').encode(),'x.svg')
        raw=io.BytesIO();c=canvas.Canvas(raw);p=c.beginPath();p.rect(10,10,50,50);c.clipPath(p);c.line(0,0,100,100);c.save()
        with self.assertRaisesRegex(ValueError,'Schnittmasken'):analyze_vector(raw.getvalue(),'clip.pdf')
        raw=io.BytesIO();c=canvas.Canvas(raw);c.drawString(10,10,'Text only');c.save()
        with self.assertRaisesRegex(ValueError,'Keine Vektorpfade'):analyze_vector(raw.getvalue(),'text.pdf')

    def test_selection_excludes_frame_and_dimensions_without_changing_curves(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(150*mm,100*mm))
        c.rect(20*mm,20*mm,100*mm,50*mm,stroke=1,fill=0)
        for x in (30,55,80):
            c.setStrokeColorRGB(1,.5,0);p=c.beginPath();p.moveTo(x*mm,30*mm);p.curveTo((x+5)*mm,65*mm,(x+12)*mm,30*mm,(x+20)*mm,60*mm);c.drawPath(p)
        c.line(20*mm,85*mm,120*mm,85*mm);c.drawString(20*mm,90*mm,'100 cm')
        c.save();store=server.Store()
        with patch('server.analyze_image',side_effect=AssertionError('No raster tracing')):
            prepared=store.prepare(raw.getvalue(),'Supplier.pdf')
            self.assertEqual(len(prepared['paths']),5)
            self.assertEqual(len(prepared['suggested']),3)
            before=store.prepared[prepared['id']]['model']
            original=[p for p in before['modes']['single'] if p['partId'] in prepared['suggested']]
            project=store.trace_selection(prepared['id'],prepared['suggested'])
        after=store.model(project['id'])['modes']['single']
        for a,b in zip(original,after):
            self.assertAlmostEqual(a['length'],b['length'],places=9)
            self.assertEqual(a['sourceColor'],b['sourceColor'])
            # Translation is allowed, scale/control vectors must stay identical.
            ax,ay=a['commands'][0][1];bx,by=b['commands'][0][1]
            for aa,bb in zip(a['commands'],b['commands']):
                self.assertEqual(aa[0],bb[0])
                for (x,y),(u,v) in zip(aa[1:],bb[1:]):
                    self.assertAlmostEqual(x-ax,u-bx,places=9);self.assertAlmostEqual(y-ay,v-by,places=9)
        self.assertFalse(project['vectorHasFills'])
        self.assertAlmostEqual(project['nativeWidthMm'],70,places=4)
        for bad in ([],None,['missing'],[True],'all'):
            with self.subTest(bad=bad),self.assertRaises(ValueError):store.trace_selection(prepared['id'],bad)

    def test_visible_coreldraw_style_layer_is_allowed_but_hidden_layers_are_not(self):
        from pypdf.generic import DictionaryObject, ArrayObject, TextStringObject, DecodedStreamObject
        raw=io.BytesIO();c=canvas.Canvas(raw);c.line(10,10,100,100);c.save()
        def layered(hidden):
            writer=PdfWriter(clone_from=PdfReader(io.BytesIO(raw.getvalue())))
            group=writer._add_object(DictionaryObject({NameObject('/Type'):NameObject('/OCG'),NameObject('/Name'):TextStringObject('Layer 1')}))
            default=DictionaryObject({NameObject('/ON'):ArrayObject([] if hidden else [group]),NameObject('/OFF'):ArrayObject([group] if hidden else [])})
            writer._root_object[NameObject('/OCProperties')]=DictionaryObject({NameObject('/OCGs'):ArrayObject([group]),NameObject('/D'):default})
            page=writer.pages[0];page['/Resources'][NameObject('/Properties')]=DictionaryObject({NameObject('/Layer'):group})
            stream=DecodedStreamObject();stream.set_data(b'/OC /Layer BDC\n'+page.get_contents().get_data()+b'\nEMC')
            page[NameObject('/Contents')]=writer._add_object(stream)
            out=io.BytesIO();writer.write(out);return out.getvalue()
        self.assertEqual(len(analyze_vector(layered(False),'layer.pdf')['parts']),1)
        with self.assertRaisesRegex(ValueError,'ausgeblendete'):analyze_vector(layered(True),'layer.pdf')
        # PDF-compatible Illustrator files use the same original path reader.
        self.assertEqual(len(server.Store().prepare(layered(False),'logo.ai')['paths']),1)
        with self.assertRaisesRegex(ValueError,'Vektorformat'):server.Store().prepare(b'%!PS EPS header','logo.eps')

    def test_page_selection_and_fill_flag_follow_selected_paths(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(100*mm,100*mm))
        c.line(10*mm,10*mm,50*mm,20*mm);c.showPage()
        c.rect(10*mm,10*mm,40*mm,40*mm,fill=1);c.line(60*mm,10*mm,90*mm,90*mm);c.save()
        store=server.Store();first=store.prepare(raw.getvalue(),'two.pdf')
        second=store.vector_page(first['id'],1)
        self.assertEqual(first['pageCount'],2);self.assertEqual(second['pageIndex'],1)
        self.assertEqual(len(second['paths']),2)
        ids=[p['id'] for p in second['paths'] if not p['filled']]
        chosen=store.trace_selection(second['id'],ids)
        self.assertFalse(chosen['vectorHasFills'])
        for invalid in (-1,2,True,'1'):
            with self.subTest(page=invalid),self.assertRaises(ValueError):store.vector_page(second['id'],invalid)

    def test_transparent_margin_does_not_turn_opaque_background_into_artwork(self):
        image=Image.new('RGBA',(320,180),(0,0,0,0));draw=ImageDraw.Draw(image)
        draw.rectangle((0,0,290,160),fill='white')
        draw.rectangle((40,30,75,125),fill='#db6b30');draw.rectangle((140,35,180,125),fill='#244de2')
        raw=io.BytesIO();image.save(raw,'PNG');model=analyze_image(raw.getvalue())
        self.assertEqual({p['sourceColor'] for p in model['modes']['double']},{'#db6b30','#244de2'})
        self.assertEqual(len(model['parts']),2)
        # White artwork that happens to touch an edge must not be removed.
        image=Image.new('RGBA',(320,180),(0,0,0,0));draw=ImageDraw.Draw(image);draw.rectangle((0,0,30,120),fill='white')
        raw=io.BytesIO();image.save(raw,'PNG');model=analyze_image(raw.getvalue())
        self.assertEqual({p['sourceColor'] for p in model['modes']['double']},{'#ffffff'})


if __name__=='__main__':unittest.main()
