import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import Store
from vector_import import analyze_vector
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image,ImageDraw

class PDFPrepareTests(unittest.TestCase):
    def test_enclosing_page_clip_preserves_original_curves(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(300,200))
        p=c.beginPath();p.rect(0,0,300,200);c.clipPath(p,stroke=0)
        p=c.beginPath();p.moveTo(20,100);p.curveTo(80,170,180,30,280,100)
        c.drawPath(p,stroke=1);c.save()
        with patch('server.analyze_image',side_effect=AssertionError('Original vectors required')):
            preview=Store().prepare(raw.getvalue(),'enclosed.pdf')
        self.assertEqual(preview['kind'],'vector');self.assertEqual(len(preview['paths']),1)
        self.assertIn('C',preview['paths'][0]['d'])

    def test_clipping_falls_back_to_visible_pixels_then_page_switches_to_vectors(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(300,200))
        p=c.beginPath();p.rect(80,50,140,100);c.clipPath(p,stroke=0)
        c.setLineWidth(12);c.line(20,100,280,100);c.showPage()
        c.line(30,40,180,90);c.save()
        s=Store();preview=s.prepare(raw.getvalue(),'clipped.pdf')
        self.assertEqual(preview['kind'],'pdf-raster');self.assertEqual(preview['pageCount'],2)
        self.assertIn('Originalpfade werden dabei nicht',preview['importNote'])
        image=s.prepared[preview['id']]['image']
        self.assertEqual(image.getpixel((200,600))[:3],(255,255,255))
        self.assertEqual(image.getpixel((900,600))[:3],(0,0,0))
        project=s.trace_selection(preview['id'],[p['id'] for p in preview['parts']])
        self.assertEqual(project['sourceKind'],'trace')
        self.assertIn('PDF',project['sourceLabel'])
        next_page=s.vector_page(preview['id'],1)
        self.assertEqual(next_page['kind'],'vector');self.assertEqual(len(next_page['paths']),1)
        fallback=s.vector_page(next_page['id'],1,True)
        self.assertEqual(fallback['kind'],'pdf-raster')

    def test_image_pdf_and_text_pdf_open_selection(self):
        image=Image.new('RGB',(400,200),'white');ImageDraw.Draw(image).ellipse((40,30,350,170),fill='black')
        for mode in ('text','image'):
            with self.subTest(mode=mode):
                raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(400,200))
                if mode=='text':c.setFont('Helvetica',40);c.drawString(30,80,'LOGO')
                else:c.drawImage(ImageReader(image),0,0,400,200)
                c.save();s=Store();result=s.prepare(raw.getvalue(),'logo.pdf')
                self.assertEqual(result['kind'],'pdf-raster');self.assertGreater(len(result['parts']),0)

    def test_oversized_file_and_more_than_1000_paths_preserve_vectors(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(1000,1000))
        for i in range(1100):c.line(20+i%100*8,20+i//100*8,24+i%100*8,24+i//100*8)
        c.save();data=raw.getvalue().replace(b'startxref',b'%'+b' '*21*1024*1024+b'\nstartxref')
        with patch('server.analyze_image',side_effect=AssertionError('Original vectors required')):
            preview=Store().prepare(data,'large.pdf')
        self.assertEqual(preview['kind'],'vector');self.assertEqual(len(preview['paths']),1100)

    def test_large_paper_uses_bounded_rendering(self):
        raw=io.BytesIO();c=canvas.Canvas(raw,pagesize=(40000,20000))
        c.setFont('Helvetica',3000);c.drawString(1000,8000,'LOGO');c.save()
        preview=Store().prepare(raw.getvalue(),'large-page.pdf')
        self.assertLessEqual(max(preview['width'],preview['height']),1800)
        self.assertGreater(len(preview['parts']),0)

if __name__=='__main__':unittest.main()
