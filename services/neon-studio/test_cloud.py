import io,json,tempfile,unittest
from cloud_data import Database,DurableStore,Conflict
from cloud_ai import validate_svg,validate_spec,Review
from cloud_trello import eligible,Trello,REQUEST,BOARD,named_fields
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

 def test_ai_context_contains_named_fields_and_dropdown_labels(self):
  card={'field_definitions':[
   {'id':'size-q','name':'Size_1','type':'text'},
   {'id':'usage-q','name':'Usage','type':'list','options':[{'id':'outside-q','value':{'text':'Außen'}}]}],
   'customFieldItems':[
    {'idCustomField':'size-q','value':{'text':'80 x 30 cm'}},
    {'idCustomField':'usage-q','idValue':'outside-q'}]}
  self.assertEqual(named_fields(card),[
   {'name':'Size_1','type':'text','value':'80 x 30 cm'},
   {'name':'Usage','type':'list','value':'Außen'}])

 def test_copy_maps_cross_board_fields_and_dropdown_values(self):
  request_source='request-on-quentin'
  source={'name':'LED Neon Test','desc':'Same description','idBoard':'quentin','attachments':[],
   'field_definitions':[{'id':request_source,'name':'Nerdy-Forms_ID','type':'text'},{'id':'art-q','name':'Art','type':'list','options':[{'id':'led-q','value':{'text':'LED Neon'}}]}],
   'customFieldItems':[{'idCustomField':request_source,'value':{'text':'REQ-123'}},{'idCustomField':'art-q','idValue':'led-q'}]}
  target_defs=[{'id':REQUEST,'name':'Nerdy-Forms_ID','type':'text'},{'id':'art-home','name':'Art','type':'list','options':[{'id':'led-home','value':{'text':'LED Neon'}}]}]
  target={**source,'idBoard':BOARD,'customFieldItems':[]}
  class Fake(Trello):
   def __init__(self):self.writes=[]
   def card(self,id):return target
   def fields(self,board,refresh=False):return target_defs
   def call(self,method,path,**kwargs):
    self.writes.append((path,kwargs['json']))
    field=path.split('/')[-2];target['customFieldItems'].append({'idCustomField':field,**kwargs['json']})
  t=Fake();t.verify_copy(source,'copy')
  self.assertEqual(t.writes[0],('cards/copy/customField/'+REQUEST+'/item',{'value':{'text':'REQ-123'}}))
  self.assertEqual(t.writes[1],('cards/copy/customField/art-home/item',{'idValue':'led-home'}))
 def test_copy_does_not_accept_two_missing_request_ids(self):
  source={'name':'LED Neon Test','desc':'','idBoard':BOARD,'attachments':[],'customFieldItems':[],'field_definitions':[]}
  class Fake(Trello):
   def __init__(self):pass
   def card(self,id):return source
   def fields(self,board,refresh=False):return []
  with self.assertRaisesRegex(RuntimeError,'Request-ID'):Fake().verify_copy(source,'copy')
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
