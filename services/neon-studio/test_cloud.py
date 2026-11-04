import io,json,tempfile,unittest
from cloud_data import Database,DurableStore,Conflict
from cloud_ai import validate_svg,validate_spec,Review
from cloud_trello import eligible
from cloud_exports import artifacts
import fitz
from PIL import Image
SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><path d="M10 50 C60 0 80 0 110 50 M120 10 L180 50" fill="none" stroke="#f333a5" stroke-width="1"/></svg>'
class CloudTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Database(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def test_event_and_source_dedup_persist(self):
  a=self.db.enqueue('card','event-1',{});b=self.db.enqueue('card','event-2',{})
  self.assertEqual(a['id'],b['id']);self.assertEqual(len(Database(self.tmp.name).list()),1)
 def test_conflict_and_interruption_not_retried(self):
  p=self.db.enqueue('card','event',{});self.db.save(p['id'],{'copy_intent':True},status='copying')
  with self.assertRaises(Conflict):self.db.save(p['id'],{},expected=0)
  restarted=Database(self.tmp.name);restarted.recover_interrupted();reloaded=restarted.get(p['id']);self.assertEqual(reloaded['status'],'review');self.assertTrue(reloaded['copy_intent'])
 def test_svg_external_rejected(self):
  for svg in ('<!DOCTYPE svg><svg/>','<svg><image href="http://localhost"/></svg>','<svg onload="alert(1)"><path/></svg>'):
   with self.assertRaises(Review):validate_svg(svg)
  self.assertEqual(validate_svg(SVG),SVG)
 def test_scope(self):
  self.assertTrue(eligible('LED Neon Flex | Anfrage'))
  for title in ('3D Neon | Kunde','Light Box | Kunde','🤖 LED Neon'):self.assertFalse(eligible(title))
 def test_specs_require_dimensions(self):
  spec={'customer_name':'Test','colors':'Pink','widths_mm':[700]}
  self.assertEqual(validate_spec(spec)['usage'],'Innen')
  with self.assertRaises(Review):validate_spec({**spec,'widths_mm':[]})
 def test_color_array_from_model_is_normalized(self):
  spec=validate_spec({'customer_name':'Test','colors':['Pink','Eisblau'],'widths_mm':[800]})
  self.assertEqual(spec['colors'],'Pink + Eisblau')
 def test_three_outputs_and_durable_model(self):
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg')
  store=DurableStore(Database(self.tmp.name))
  d=store.drawing(info['id'],json.dumps({'mode':'single','width':700,'gap':15,'shape':'shape','radius':3}))
  spec=validate_spec({'customer_name':'Test Kunde','colors':'Pink','widths_mm':[700]})
  files,quotes=artifacts([d],spec)
  self.assertEqual([f[0] for f in files],['auto_quote_Test_Kunde.pdf','image.png','technische_zeichnung.jpg'])
  text=fitz.open(stream=files[0][2],filetype='pdf')[0].get_text()
  self.assertIn('70,00',text);self.assertIn('USD',text)
  self.assertGreater(Image.open(io.BytesIO(files[1][2])).width,1000)
  self.assertGreater(Image.open(io.BytesIO(files[2][2])).width,1500)
  self.assertGreater(float(quotes[0]['total_usd']),0)
if __name__=='__main__':unittest.main()
