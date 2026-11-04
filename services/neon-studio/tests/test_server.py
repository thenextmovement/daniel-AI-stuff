import base64
import json
import sys
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import create_server


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=create_server(0)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()

    def request(self,path,payload=None,headers=None):
        data=json.dumps(payload).encode() if payload is not None else None
        req=urllib.request.Request(self.url+path,data=data,headers={'Content-Type':'application/json',**(headers or {})})
        return urllib.request.urlopen(req,timeout=10)

    def test_upload_real_bkite_and_export(self):
        image=base64.b64encode((ROOT/'assets/B_KITE.png').read_bytes()).decode()
        with self.request('/api/upload',{'data':image,'name':'Renamed-logo.png'}) as response:
            project=json.load(response)
        self.assertEqual(project['sourceKind'],'master')
        with self.request('/api/geometry',{'id':project['id'],'settings':{'mode':'single'}}) as response:
            drawing=json.load(response)
        self.assertEqual(len(drawing['paths']),15)
        with self.request('/api/geometry',{'id':project['id'],'settings':{'mode':'single'},'preview':True}) as response:
            preview=json.load(response)
        self.assertEqual(preview['outlineControls'],[])
        self.assertEqual(preview['outlineVisibleControls'],[])
        for key in drawing.keys()-{'outlineControls','outlineVisibleControls','renderMs'}:
            self.assertEqual(preview[key],drawing[key],key)
        with self.request('/api/export',{'id':project['id'],'settings':{'mode':'single'},'options':{'kind':'cnc'}}) as response:
            self.assertEqual(response.headers['Content-Type'],'application/pdf')
            self.assertTrue(response.read().startswith(b'%PDF-'))

    def test_selection_precedes_tracing_and_excluded_pixels_stay_out(self):
        image=base64.b64encode((ROOT/'assets/NOVA_Test.png').read_bytes()).decode()
        with self.request('/api/prepare',{'data':image,'name':'Fresh.png'}) as response:
            prepared=json.load(response)
        self.assertEqual(len(prepared['parts']),6)
        self.assertTrue(prepared['labels'].startswith('data:image/png;base64,'))
        self.assertNotIn('modes',prepared)
        for selection in ([],[999],[True],'all'):
            with self.assertRaises(urllib.error.HTTPError):
                self.request('/api/trace-selection',{'id':prepared['id'],'selected':selection})
        with self.request('/api/trace-selection',{'id':prepared['id'],'selected':[1]}) as response:
            project=json.load(response)
        with self.request('/api/geometry',{'id':project['id'],'settings':{'mode':'single'}}) as response:
            drawing=json.load(response)
        self.assertEqual(len(drawing['parts']),1)
        self.assertEqual(len(drawing['paths']),1)
        self.assertAlmostEqual(drawing['width']/drawing['height'],1,delta=.02)
        with self.request('/api/trace-selection',{'id':prepared['id'],'selected':[1,2,3,4,5,6]}) as response:
            project=json.load(response)
        with self.request('/api/geometry',{'id':project['id'],'settings':{'mode':'single'}}) as response:
            self.assertEqual(len(json.load(response)['parts']),6)

    def test_invalid_upload_has_useful_error_and_service_remains_available(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/upload',{'data':'broken','name':'B_KITE.png'})
        self.assertEqual(error.exception.code,400)
        self.assertIn('error',json.load(error.exception))
        with self.request('/health') as response:self.assertEqual(json.load(response)['app'],'neon-studio')

    def test_pixel_selection_cuts_inside_connected_form_without_removing_rest(self):
        import io
        import numpy as np
        from PIL import Image, ImageDraw
        image=Image.new('RGB',(400,300),'white');draw=ImageDraw.Draw(image)
        draw.rectangle((50,120,350,160),fill='black')
        draw.rectangle((260,60,350,160),fill='black')
        raw=io.BytesIO();image.save(raw,'PNG')
        with self.request('/api/prepare',{'data':base64.b64encode(raw.getvalue()).decode()}) as response:
            prepared=json.load(response)
        self.assertEqual(len(prepared['parts']),1)
        mask=np.ones((300,400),dtype='uint8');mask[:,240:]=0
        for invalid in ('broken',base64.b64encode(bytes(120000)).decode(),base64.b64encode(bytes([2])*120000).decode()):
            with self.assertRaises(urllib.error.HTTPError):
                self.request('/api/trace-selection',{'id':prepared['id'],'mask':invalid})
        with self.request('/api/trace-selection',{'id':prepared['id'],'mask':base64.b64encode(mask.tobytes()).decode()}) as response:
            project=json.load(response)
        decoded=Image.open(io.BytesIO(base64.b64decode(project['image'].split(',')[1])))
        self.assertEqual(decoded.size,(190,41))
        with self.request('/api/geometry',{'id':project['id'],'settings':{'mode':'single'}}) as response:
            drawing=json.load(response)
        self.assertEqual(len(drawing['parts']),1)
        self.assertEqual(len(drawing['paths']),1)

    def test_color_recovery_keeps_missed_pixels_and_respects_exclusion_mask(self):
        import io
        import numpy as np
        from PIL import Image,ImageDraw
        image=Image.new('RGB',(240,180),'white');draw=ImageDraw.Draw(image)
        draw.rectangle((30,30,60,140),fill='black')
        # Low-contrast detail the initial automatic mask deliberately misses.
        draw.rectangle((130,60,200,90),fill=(245,245,245))
        raw=io.BytesIO();image.save(raw,'PNG')
        with self.request('/api/prepare',{'data':base64.b64encode(raw.getvalue()).decode()}) as response:
            prepared=json.load(response)
        self.assertEqual(len(prepared['parts']),1)
        extra=np.zeros((180,240),dtype='uint8');extra[60:91,130:201]=1
        mask=np.ones_like(extra);mask[:,180:]=0
        encode=lambda m:base64.b64encode(m.tobytes()).decode()
        with self.request('/api/trace-selection',{'id':prepared['id'],'mask':encode(mask),'additions':encode(extra)}) as response:
            project=json.load(response)
        model=self.server.store.model(project['id'])
        self.assertEqual(len(model['parts']),2)
        self.assertEqual(model['parts'][1]['bounds'],[130,60,180,91])
        preview=Image.open(io.BytesIO(base64.b64decode(project['image'].split(',')[1]))).convert('RGBA')
        self.assertEqual(preview.getpixel((110,40))[:3],(245,245,245))
        for invalid in ('broken',encode(np.full_like(extra,2))):
            with self.assertRaises(urllib.error.HTTPError):
                self.request('/api/trace-selection',{'id':prepared['id'],'mask':encode(mask),'additions':invalid})

    def test_cross_origin_requests_are_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/example',{}, {'Origin':'https://unrelated.example'})
        self.assertEqual(error.exception.code,403)

    def test_path_traversal_cannot_read_workspace_files(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request('/../PLAN.md')
        self.assertEqual(error.exception.code,404)

if __name__=='__main__':unittest.main()
