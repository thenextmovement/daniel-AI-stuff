import base64
import io
import struct
import sys
import unittest
import zlib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import Store
from tracing import _load_image
from PIL import Image,ImageDraw


class ImageImportTests(unittest.TestCase):
    def test_screenshot_frame_does_not_turn_logo_panel_into_foreground(self):
        # An inset light logo canvas surrounded by a dark screenshot margin.
        # The old border median selected the entire panel and rejected it.
        for resized in (False,True):
            with self.subTest(resized=resized):
                image=Image.new('RGB',(640,160),(12,12,12));draw=ImageDraw.Draw(image)
                draw.rectangle((8,6,632,154),fill='white')
                draw.line([(50,30),(50,130),(200,130)],fill=(154,130,80),width=24)
                draw.line([(45,25),(45,125),(195,125)],fill=(10,35,65),width=24)
                draw.rectangle((350,25,390,130),fill=(10,35,65))
                if resized:image=image.resize((617,154),Image.Resampling.LANCZOS)
                raw=io.BytesIO();image.save(raw,'PNG')
                store=Store();prepared=store.prepare(raw.getvalue(),'screenshot.png')
                _,labels,_=store.prepared[prepared['id']]
                self.assertEqual(len(prepared['parts']),2)
                self.assertFalse(labels[0].any());self.assertFalse(labels[:,0].any())
                self.assertEqual(int(labels[80,250]),0,'The white panel is background')
                self.assertGreater(int(labels[80,360]),0,'The coloured logo stays selected')
                project=store.trace_selection(prepared['id'],[p['id'] for p in prepared['parts']])
                model=store.model(project['id'])
                self.assertEqual(len(model['parts']),2)
                for mode in ('single','double'):
                    self.assertTrue(model['modes'][mode])
                self.assertTrue(all(p['sourceColor']=='#0a2341' for p in model['modes']['double']))

    def test_large_pixel_png_opens_selection_then_traces(self):
        # Same dimensions as the reported LOGO_lang.png; only ~0.5 MB on disk.
        with Image.new('RGBA',(18358,2231),(0,0,0,0)) as image:
            ImageDraw.Draw(image).rectangle((1000,300,17300,1900),fill=(30,40,210,255))
            raw=io.BytesIO();image.save(raw,'PNG')
        store=Store();prepared=store.prepare(raw.getvalue(),'wide-logo.png')
        self.assertEqual((prepared['width'],prepared['height']),(1800,219))
        decoded=Image.open(io.BytesIO(base64.b64decode(prepared['image'].split(',')[1])))
        self.assertEqual(decoded.getpixel((0,0))[3],0)
        self.assertEqual(decoded.getpixel((900,100)),(30,40,210,255))
        project=store.trace_selection(prepared['id'],[p['id'] for p in prepared['parts']])
        model=store.model(project['id'])
        self.assertTrue(model['modes']['single']);self.assertTrue(model['modes']['double'])

    def test_additional_formats_and_empty_or_unusual_extension(self):
        for format in ('PNG','JPEG','WEBP','GIF','BMP','TIFF','ICO','AVIF'):
            with self.subTest(format=format):
                image=Image.new('RGB',(128,128),'white')
                ImageDraw.Draw(image).ellipse((20,20,100,100),fill='black')
                raw=io.BytesIO();image.save(raw,format)
                result=Store().prepare(raw.getvalue(),'logo')
                self.assertGreater(len(result['parts']),0)
                self.assertEqual((result['width'],result['height']),(128,128))

    def test_raster_over_twenty_megabytes_and_exif_orientation(self):
        with Image.new('RGB',(2800,2700),'white') as image:
            ImageDraw.Draw(image).rectangle((300,400,1500,1800),fill='black')
            raw=io.BytesIO();image.save(raw,'TIFF',compression='raw')
        self.assertGreater(len(raw.getvalue()),20*1024*1024)
        self.assertEqual(_load_image(raw.getvalue()).size,(1800,1736))
        image=Image.new('RGB',(300,100),'white');exif=Image.Exif();exif[274]=6
        raw=io.BytesIO();image.save(raw,'JPEG',exif=exif)
        self.assertEqual(_load_image(raw.getvalue()).size,(100,300))

    def test_palette_transparency_survives_resizing(self):
        image=Image.new('P',(2000,500),0)
        image.putpalette([0,0,0,220,30,20]+[0]*762)
        ImageDraw.Draw(image).rectangle((400,100,1600,400),fill=1)
        raw=io.BytesIO();image.save(raw,'PNG',transparency=0)
        decoded=_load_image(raw.getvalue())
        self.assertEqual(decoded.size,(1800,450))
        self.assertEqual(decoded.getpixel((0,0))[3],0)
        self.assertEqual(decoded.getpixel((900,225)),(220,30,20,255))

    def test_unreadable_and_excessive_resolution_have_distinct_errors(self):
        with self.assertRaisesRegex(ValueError,'Dateiformat'):_load_image(b'not an image')
        # Reject from the header before allocating a huge decoded image.
        header=struct.pack('>IIBBBBB',10001,10000,8,6,0,0,0)
        def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
        raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',b'')+chunk(b'IEND',b'')
        with self.assertRaisesRegex(ValueError,'100 Millionen Pixel'):_load_image(raw)


if __name__=='__main__':unittest.main()
