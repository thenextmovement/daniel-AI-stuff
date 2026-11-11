import io,json,tempfile,unittest
from cloud_data import Database,DurableStore,Conflict
from cloud_ai import validate_svg,validate_spec,Review
from cloud_trello import eligible,Trello,REQUEST,BOARD,named_fields
from cloud_exports import artifacts
from cloud_jobs import Jobs
import fitz
from PIL import Image
SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><path d="M10 50 C60 0 80 0 110 50 M120 10 L180 50" fill="none" stroke="#f333a5" stroke-width="1"/></svg>'
class CloudTests(unittest.TestCase):
 def test_reread_edited_copy_replaces_stale_full_glow_question(self):
  from unittest.mock import Mock,patch
  card={'id':'copy','name':'🤖 LED Neon 🤖','desc':'LED-Neon-Kontur',
        'attachments':[{'id':'1','name':'logo.png'},{'id':'3','name':'image.png'}]}
  p=self.db.enqueue('source','event',{'desc':'Full Glow'})
  p=self.db.save(p['id'],{'copy':'copy','reread':'copy','spec':{'issues':['Full Glow?']},
                           'selected_attachments':['old-id'],'generated_attachments':['3']})
  t=Mock();t.card.return_value=card
  jobs=Jobs(self.db,DurableStore(self.db),t)
  data={'svg':SVG.replace('<path ', '<path id="logo" '),'line_plan':[{'name':'Logo','mode':'single','path_ids':['logo']}],'widths_mm':[600],'colors':'Kaltweiß','issues':[]}
  with patch('cloud_jobs.generate',return_value=(data,{})) as generate:
   jobs.reread(p)
  t.card.assert_called_once_with('copy')
  snapshot=generate.call_args.args[1]
  self.assertEqual((snapshot['name'],snapshot['desc']),('LED Neon','LED-Neon-Kontur'))
  self.assertEqual([a['id'] for a in snapshot['attachments']],['1'])
  saved=self.db.get(p['id'])
  self.assertEqual((saved['status'],saved['spec']['issues'],saved['selected_attachments']),('draft',[],[]))
  self.assertTrue(saved['model'])
  t.call.assert_not_called()
 def test_review_and_watcher_failures_do_not_send_email(self):
  from unittest.mock import patch
  p=self.db.enqueue('no-mail-card','no-mail-event',{})
  jobs=Jobs(self.db,None,object())
  self.db.meta('alert_error','E-Mail-Ausführung nicht bestätigt.')
  with patch.dict('os.environ',{'NEON_ALERT_URL':'https://alerts.invalid','NEON_ALERT_KEY':'test-only'}),patch('requests.post') as send:
   jobs.fail(p['id'],'Mindestgröße prüfen.')
   jobs.alert({'id':'watcher'},'Trello-Abruf fehlgeschlagen.')
   send.assert_not_called()
  saved=self.db.get(p['id'])
  self.assertEqual(saved['status'],'review')
  self.assertEqual(saved['error'],'Mindestgröße prüfen.')
  self.assertEqual(self.db.meta('alert_error'),'')
 def test_saved_ai_closed_centerline_survives_restart_without_regeneration(self):
  from cloud_ai import drawing_model
  from geometry import build_geometry
  svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100"><path id="D" d="M0 0 L0 80 C60 80 60 0 0 0 Z" fill="none" stroke="blue"/></svg>'
  plan=[{'name':'Deutschland','mode':'single','reason':'Dünne Schrift','path_ids':['D'],'dot_ids':[]}]
  model,modes=drawing_model({'svg':svg,'line_plan':plan})
  for items in model['modes'].values():
   for item in items:item.pop('neonCenterline',None)
  info=DurableStore(self.db).add_model(model,'KI-Zeichnung.svg')
  p=self.db.enqueue('saved-ai','event',{})
  self.db.save(p['id'],{'model':info['id'],'spec':{'line_plan':plan},'settings':{'partModes':modes}})
  restored=DurableStore(Database(self.tmp.name)).model(info['id'])
  d=build_geometry(restored,{'width':600,'mode':'single','partModes':modes,'shape':'rectangle'})
  self.assertEqual(d['names'],['Deutschland'])
  self.assertEqual([c[0] for c in d['paths'][0]],[c[0] for c in model['modes']['double'][0]['commands']])
  # Normal outline imports without a generated line plan still convert on request.
  info2=DurableStore(self.db).add_model(model,'customer.svg')
  imported=DurableStore(Database(self.tmp.name)).model(info2['id'])
  self.assertFalse(imported['modes']['double'][0].get('neonCenterline'))
 def test_png_retry_on_generated_spacing_failure(self):
  from unittest.mock import Mock,patch
  from PIL import ImageDraw
  from cloud_trello import HOLDING
  png=io.BytesIO();im=Image.new('RGB',(140,100),'white')
  ImageDraw.Draw(im).line([(15,82),(67,12),(125,82)],fill='black',width=5);im.save(png,'PNG')
  card={'id':'source','name':'LED Neon | Smallest Size','attachments':[{'id':'png','name':'Hand.png','isUpload':True}]}
  p=self.db.enqueue('source','event',card)
  p=self.db.save(p['id'],{'copy':'copy','copy_verified':True})
  t=Mock();t.download.return_value=png.getvalue();t.card.return_value={'name':'🤖 LED Neon 🤖','idBoard':BOARD,'idList':HOLDING}
  jobs=Jobs(self.db,DurableStore(self.db),t)
  svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><g stroke="black" fill="none"><path id="a" d="M2 20 L198 20"/><path id="b" d="M2 20.05 L198 20.05"/></g></svg>'
  data={'svg':svg,'line_plan':[{'name':'Hand','mode':'single','path_ids':['a','b']}],
        'source_attachment_ids':['png'],'colors':'Kaltweiß','widths_mm':[],'smallest_requested':True,'customer_name':'Test'}
  with patch('cloud_jobs.generate',return_value=(data,{})),patch.object(jobs,'design_artifacts') as export:
   # Stop after rendering, before sending anything to Trello.
   def rendered(*args):
    files,quotes,drawings,spec=Jobs.design_artifacts(jobs,*args)
    self.assertEqual(len(files),3)
    self.assertEqual(spec['auto_minimum_mm'],drawings[0]['width'])
    self.assertTrue(all(c['id']=='cold-white' for c in drawings[0]['pathColors']))
    raise StopIteration
   export.side_effect=rendered
   with self.assertRaises(StopIteration):jobs.process(p)
  t.download.assert_called_once_with('source',card['attachments'][0])
  saved=self.db.get(p['id'])
  self.assertEqual(jobs.store.info(saved['model'])['name'],'Hand.png')
  self.assertEqual(set(saved['spec']['line_plan'][0]['path_ids']),set(saved['settings']['pathColors']))
 def test_png_centerlines_preserve_double_line_and_ambiguous_sources(self):
  from unittest.mock import Mock
  jobs=Jobs(self.db,None,Mock())
  for mode,ids in [('double',['png']),('single',['first','second'])]:
   record={'spec':{'line_plan':[{'mode':mode}],'source_attachment_ids':ids}}
   self.assertIsNone(jobs.png_centerlines(record,{}))
  jobs.t.download.assert_not_called()

 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Database(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def test_event_and_source_dedup_persist(self):
  a=self.db.enqueue('card','event-1',{});b=self.db.enqueue('card','event-2',{})
  self.assertEqual(a['id'],b['id']);self.assertEqual(len(Database(self.tmp.name).list()),1)

 def test_card_links_resolve_only_through_trello(self):
  class Fake(Trello):
   def __init__(self):self.reads=[]
   def fields(self,board,refresh=False):return []
   def call(self,method,path,**kwargs):
    self.reads.append((method,path));return {'id':'a'*24,'idBoard':BOARD}
  t=Fake()
  for reference in ('https://trello.com/c/AbCd1234',' https://www.trello.com/c/AbCd1234/17-led-neon?share=1#details ', 'AbCd1234'):
   self.assertEqual(t.card(reference)['id'],'a'*24)
   self.assertTrue(t.reads[-1][1].startswith('cards/AbCd1234?'))
  for reference in ('https://evil.example/c/AbCd1234','https://trello.com.evil.example/c/AbCd1234','https://user@trello.com/c/AbCd1234','https://trello.com:444/c/AbCd1234','https://trello.com/b/AbCd1234','file:///c/AbCd1234','../cards/AbCd1234',''):
   before=len(t.reads)
   with self.assertRaises(ValueError):t.card(reference)
   self.assertEqual(len(t.reads),before)
 def test_manual_link_and_watcher_share_one_canonical_project(self):
  card={'id':'a'*24,'idBoard':BOARD,'name':'LED Neon Flex | Test','attachments':[]}
  class Fake:
   def card(self,reference):return card
  jobs=Jobs(self.db,None,Fake())
  first=jobs.ingest('https://trello.com/c/AbCd1234','manual:link')
  second=jobs.ingest(card['id'],'action:event')
  third=jobs.ingest('https://trello.com/c/AbCd1234/title','manual:link-again')
  self.assertEqual(first['source'],card['id'])
  self.assertEqual({first['id'],second['id'],third['id']},{first['id']})
  self.assertEqual(len(self.db.pending()),1)
 def test_manual_original_and_robot_copy_open_saved_project_without_restarting(self):
  source='a'*24;copy='b'*24
  first=self.db.enqueue(source,'action:event',{})
  class Fake:
   def card(self,reference):
    return {'id':copy if 'Copy1234' in reference else source,'idBoard':'quentin','name':'🤖 LED Neon Test 🤖'}
  jobs=Jobs(self.db,None,Fake())
  for status in ('queued','generating','draft','ready','review'):
   saved=self.db.save(first['id'],{'copy':copy,'model':'saved-model','settings':{'gap':15},'error':'review detail'},status=status)
   for reference in ('https://trello.com/c/Orig1234/title','https://trello.com/c/Copy1234'):
    self.assertEqual(jobs.ingest(reference,'manual:'+reference),saved)
  self.assertEqual(len(self.db.list()),1)
 def test_manual_existing_project_not_limited_to_recent_200(self):
  source='a'*24
  first=self.db.enqueue(source,'old',{})
  for i in range(201):self.db.enqueue('other-'+str(i),'other-'+str(i),{})
  class Fake:
   def card(self,reference):return {'id':source,'idBoard':'quentin','name':'LED Neon Test'}
  self.assertEqual(Jobs(self.db,None,Fake()).ingest(source,'manual:old')['id'],first['id'])
 def test_manual_new_projects_preserve_scope(self):
  class Fake:
   def card(self,reference):return {'id':'a'*24,'idBoard':board,'name':title}
  jobs=Jobs(self.db,None,Fake())
  for board,title in ((BOARD,'3D Neon'),(BOARD,'Light Box'),('foreign','LED Neon'),(BOARD,'🤖 LED Neon')):
   with self.assertRaises(Review):jobs.ingest('a'*24,'manual:test')
  self.assertEqual(self.db.list(),[])

 def test_conflict_and_interruption_not_retried(self):
  p=self.db.enqueue('card','event',{});self.db.save(p['id'],{'copy_intent':True},status='copying')
  with self.assertRaises(Conflict):self.db.save(p['id'],{},expected=0)
  restarted=Database(self.tmp.name);restarted.recover_interrupted();reloaded=restarted.get(p['id']);self.assertEqual(reloaded['status'],'review');self.assertTrue(reloaded['copy_intent'])
 def test_restart_resumes_generation_only_with_known_copy_and_no_pending_upload(self):
  cases=[({'copy':'copy1'},'queued'),({},'review'),({'copy':'copy2','upload_intent':True},'review'),
         ({'copy':'copy3','pending_attachments':['file']},'review')]
  projects=[]
  for i,(data,status) in enumerate(cases):
   p=self.db.enqueue('source'+str(i),'event'+str(i),{})
   self.db.save(p['id'],data,status='generating')
   projects.append(p['id'])
  interruptions=self.db.recover_interrupted()
  self.assertEqual({p['id'] for p in interruptions},set(projects[1:]))
  self.assertEqual([self.db.get(key)['status'] for key in projects],[status for _,status in cases])
  self.assertEqual(self.db.get(projects[0])['copy'],'copy1')
 def test_svg_external_rejected(self):
  for svg in ('<!DOCTYPE svg><svg/>','<svg><image href="http://localhost"/></svg>','<svg onload="alert(1)"><path/></svg>'):
   with self.assertRaises(Review):validate_svg(svg)
  self.assertEqual(validate_svg(SVG),SVG)
 def test_copy_processing_and_review_titles(self):
  from unittest.mock import Mock
  from cloud_trello import HOLDING,PROCESSING,NEEDS_REVIEW
  t=Mock(spec=Trello)
  source={'id':'source','name':'LED Neon | Test','desc':'Beschreibung'}
  Trello.copy(t,source)
  self.assertEqual(t.call.call_args.kwargs['json']['name'],'🤖 '+PROCESSING+source['name']+' 🤖')
  jobs=Jobs(self.db,None,t)
  card={'idBoard':BOARD,'idList':HOLDING,'name':PROCESSING+source['name']}
  t.card.return_value=card
  jobs.mark_copy({'copy':'copy','source':'source'},NEEDS_REVIEW)
  self.assertEqual(t.call.call_args.kwargs['json']['name'],'🤖 '+NEEDS_REVIEW+source['name']+' 🤖')
  card['name']='🤖 '+NEEDS_REVIEW+source['name']+' 🤖'
  jobs.mark_copy({'copy':'copy','source':'source'},PROCESSING)
  self.assertEqual(t.call.call_args.kwargs['json']['name'],'🤖 '+PROCESSING+source['name']+' 🤖')
  self.assertFalse(eligible(card['name']))
  t.reset_mock()
  jobs.mark_copy({'copy':'source','source':'source'},PROCESSING)
  t.card.assert_not_called()
 def test_default_artwork_colours(self):
  from colors import artwork_neon_color
  for source,expected in [('#171916','cold-white'),('#83dc45','light-green'),('#079b55','dark-green'),('#ef3038','red')]:
   self.assertEqual(artwork_neon_color(source)['id'],expected)
 def test_review_comment_on_verified_copy(self):
  from unittest.mock import Mock
  from cloud_trello import PROCESSING,HOLDING
  t=Mock(spec=Trello);jobs=Jobs(self.db,None,t)
  p=self.db.enqueue('source','event',{})
  self.db.save(p['id'],{'copy':'copy','copy_verified':True,'spec':{'issues':['Welche Zeile? Zwei wurden genannt.']}})
  t.card.return_value={'idBoard':BOARD,'idList':HOLDING,'name':'🤖 '+PROCESSING+'LED Test 🤖'}
  jobs.fail(p['id'],'Bitte prüfen: Welche Zeile? Zwei wurden genannt.')
  msg='Noch zu klären\n• Welche Zeile? Zwei wurden genannt.'
  t.comment_once.assert_called_once_with('copy',msg,msg)
 def test_lone_customer_image_is_used(self):
  from unittest.mock import Mock
  from cloud_ai import generate
  t=Mock()
  t.download.side_effect=RuntimeError('selected')
  with self.assertRaisesRegex(RuntimeError,'selected'):
   generate(t,{'id':'source','attachments':[{'id':'art','name':'image.png','isUpload':True}]})
  self.assertEqual(t.download.call_count,1)
 def test_copy_compares_repeated_upload_contents(self):
  from unittest.mock import Mock
  src={'id':'src','name':'Logo','desc':'','attachments':[{'id':'a','isUpload':True,'name':'logo.png','bytes':1}],'idBoard':BOARD}
  copy={**src,'attachments':[dict(src['attachments'][0],id=k) for k in ('b','c')]}
  t=Mock(spec=Trello);t.card.return_value=copy;t.fields.return_value=[]
  t.download.side_effect=lambda card,a: b'x'
  # Pass the attachment gate and reach the independent request-ID check.
  with self.assertRaisesRegex(RuntimeError,'Request-ID'):Trello.verify_copy(t,src,'copy')
  t.download.side_effect=lambda card,a: b'y' if a['id']=='c' else b'x'
  with self.assertRaisesRegex(RuntimeError,'Anhänge'):Trello.verify_copy(t,src,'copy')
 def test_identical_customer_uploads_sent_once(self):
  from unittest.mock import Mock,patch
  from cloud_ai import generate
  import base64
  logo=io.BytesIO();image=Image.new('RGBA',(10,10),(255,255,255,0))
  image.putpixel((5,5),(255,255,255,255));image.save(logo,'PNG')
  card={'id':'src','name':'Logo','desc':'Single line','attachments':[
      {'id':str(i),'name':'logo.png','isUpload':True} for i in range(7)]}
  t=Mock();t.download.return_value=logo.getvalue()
  with patch.dict('os.environ',{'OPENAI_API_KEY':'test'}),patch('cloud_ai.requests.post',side_effect=RuntimeError('sent')) as post:
   with self.assertRaisesRegex(RuntimeError,'sent'):generate(t,card)
  content=post.call_args.kwargs['json']['input'][0]['content']
  images=[p for p in content if p['type']=='input_image']
  self.assertEqual(len(images),1)
  preview=Image.open(io.BytesIO(base64.b64decode(images[0]['image_url'].split(',')[1])))
  self.assertNotEqual(preview.getpixel((0,0)),preview.getpixel((5,5)))
 def test_two_quotes_are_separate_when_two_texts_are_ordered(self):
  from unittest.mock import Mock,patch
  from cloud_ai import generate
  t=Mock();image=io.BytesIO();Image.new('RGB',(20,10)).save(image,'PNG');t.download.return_value=image.getvalue()
  card={'id':'source','name':'2 Quotes | LED Neon Flex | 180cm','desc':
        'Die zwei Schilder wie PAD1, aber anderen Text: "amazon rme contractor point" "amazon rme red-tag area" jeweils 1 Stück',
        'attachments':[{'id':'art','name':'logo.png','isUpload':True}]}
  first={'excluded_regions':[], 'design_name':'Contractor Point','source_attachment_ids':['art'],'svg':SVG}
  second={**first,'design_name':'Red-Tag Area','svg':SVG.replace('M10 50','M20 50')}
  def run(response):
   with patch.dict('os.environ',{'OPENAI_API_KEY':'test'}),patch('cloud_ai.requests.post') as post:
    post.return_value.json.return_value={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(response)}]}]}
    return generate(t,card)[0]
  with self.assertRaises(Review):run(first)
  self.assertEqual(len(run({'designs':[first,second]})['designs']),2)
  card['desc']='Ein Motiv in zwei Größen anbieten.'
  self.assertNotIn('designs',run(first))
  card['desc']='Contractor Point und Red-Tag Area bitte separat anbieten.'
  self.assertEqual(len(run({'designs':[first,second]})['designs']),2)
 def test_omitted_tagline_cannot_return_in_vector_or_png_recovery(self):
  from cloud_ai import apply_motif_exclusions, drawing_model
  from unittest.mock import Mock
  svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none"><path id="a" stroke="blue" d="M0 0 L30 0"/><path id="b" stroke="cyan" d="M40 0 L70 0"/><path id="c" stroke="red" d="M0 80 L70 80"/></g></svg>'
  description='CARRIER in blue; 4YOU in ice blue. Ignore the tagline.'
  design={'svg':svg,'line_plan':[{'name':n,'mode':'double','path_ids':[key]} for key,n in zip('abc',['CARRIER','4YOU','Tagline'])],
          'excluded_regions':[{'name':'Tagline','evidence':'Ignore the tagline','path_ids':['c']}]}
  apply_motif_exclusions(design,description)
  model,modes=drawing_model(design)
  self.assertEqual({i['name'] for i in model['modes']['double']},{'CARRIER','4YOU'})
  self.assertEqual(set(modes.values()),{'double'})
  self.assertNotIn('id="c"',design['svg'])
  for region in design['line_plan']:region['mode']='single'
  design['source_attachment_ids']=['src']
  snapshot={'id':'card','attachments':[{'id':'src','name':'logo.png','isUpload':True}]}
  trello=Mock()
  self.assertIsNone(Jobs(self.db,Mock(),trello).png_centerlines({'spec':design},snapshot))
  trello.download.assert_not_called()
  with self.assertRaises(Review):apply_motif_exclusions(design,'Keep the tagline.')
 def test_scope(self):
  self.assertTrue(eligible('LED Neon Flex | Anfrage'))
  for title in ('3D Neon | Kunde','Light Box | Kunde','🤖 LED Neon'):self.assertFalse(eligible(title))
 def test_specs_require_dimensions(self):
  spec={'customer_name':'Test','colors':'Pink','widths_mm':[700]}
  self.assertEqual(validate_spec(spec)['usage'],'Innen')
  with self.assertRaises(Review):validate_spec({**spec,'widths_mm':[]})
 def test_manual_minimum_width_validation_and_fallback(self):
  spec={'customer_name':'Test','colors':'Pink','widths_mm':[],'minimum_width_mm':1105}
  self.assertEqual(validate_spec(spec)['widths_mm'],[1105])
  self.assertEqual(validate_spec({**spec,'widths_mm':[1200,1500]})['widths_mm'],[1200,1500])
  for value in (True,'1105',float('nan'),float('inf'),79,20001):
   with self.subTest(value=value),self.assertRaises(Review):validate_spec({**spec,'minimum_width_mm':value})
  with self.assertRaisesRegex(Review,'Mindestbreite'):validate_spec({**spec,'widths_mm':[1000,1200]})
  self.assertIsNone(validate_spec({**spec,'minimum_width_mm':None,'widths_mm':[800]})['minimum_width_mm'])
 def test_manual_minimum_save_reload_and_clear(self):
  from cloud_server import CloudHandler
  from http.server import ThreadingHTTPServer
  from threading import Thread
  from urllib.request import Request,urlopen
  from urllib.error import HTTPError
  from unittest.mock import patch
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg')
  settings={'mode':'single','width':1200,'gap':15,'shape':'shape','radius':3}
  p=self.db.enqueue('minimum-save','event',{})
  p=self.db.save(p['id'],{'model':info['id'],'settings':settings,'spec':{'customer_name':'Test','colors':'Pink','widths_mm':[1200]}},status='draft')
  class QuietHandler(CloudHandler):
   def log_message(self,*args):pass
  server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
  server.db=self.db;server.store=store;server.jobs=Jobs(self.db,store,object())
  thread=Thread(target=server.serve_forever,daemon=True);thread.start()
  token='test-only-minimum-token-not-a-secret'
  base='http://127.0.0.1:'+str(server.server_port)
  try:
   with patch.dict('os.environ',{'NEON_SERVICE_TOKEN':token}):
    for minimum in (1105,None):
     payload={'id':p['id'],'revision':p['revision'],'model':info['id'],'settings':settings,'spec':{**p['spec'],'minimum_width_mm':minimum}}
     req=Request(base+'/cloud/save',json.dumps(payload).encode(),{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
     with urlopen(req) as response:self.assertEqual(response.status,200)
     p=Database(self.tmp.name).get(p['id'])
     self.assertEqual(p['spec']['minimum_width_mm'],minimum)
     with urlopen(Request(base+'/cloud/project?id='+p['id'],headers={'Authorization':'Bearer '+token})) as response:
      self.assertEqual(json.load(response)['spec']['minimum_width_mm'],minimum)
    payload['revision']=p['revision'];payload['spec']['minimum_width_mm']=True
    with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/cloud/save',json.dumps(payload).encode(),{'Authorization':'Bearer '+token,'Content-Type':'application/json'}))
    self.assertEqual(error.exception.code,400)
    self.assertEqual(self.db.get(p['id'])['revision'],p['revision'])
  finally:server.shutdown();server.server_close();thread.join()
 def test_trello_display_size_and_stock_colors(self):
  from cloud_trello import size_field,color_field
  self.assertEqual(size_field(680,222.6),'68x23cm')
  self.assertEqual(size_field(685,220),'69x22cm')
  self.assertEqual(color_field('Hellgrün + Dunkelgrün + Zitronengelb + Goldgelb + Dunkelblau + Eisblau'),'Grün + Gelb + Goldgelb + Blau + Eisblau')

 def test_manual_minimum_is_exported_without_changing_technical_drawing(self):
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg')
  d=store.drawing(info['id'],json.dumps({'mode':'single','width':1200,'gap':15,'shape':'shape','radius':3}))
  spec=validate_spec({'customer_name':'Test','colors':'Pink','widths_mm':[1200]})
  before,_=artifacts([d],spec)
  files,_=artifacts([d],{**spec,'minimum_width_mm':1105})
  doc=fitz.open(stream=files[0][2],filetype='pdf')
  self.assertIn('Mindestbreite (manuell)',doc[0].get_text())
  self.assertIn('110,50 cm',doc[0].get_text())
  self.assertIn('120,00',doc[0].get_text())
  pix=doc[0].get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
  self.assertEqual(Image.open(io.BytesIO(files[1][2])).tobytes(),pix.samples)
  self.assertEqual(files[2][2],before[2][2])
 def test_publish_manual_minimum_transfers_comment_artifacts_and_actual_size(self):
  from cloud_trello import HOLDING,READY,FIELDS
  class Fake:
   def __init__(self):
    self.data={'idBoard':BOARD,'idList':HOLDING,'attachments':[],'customFieldItems':[]};self.comments=[];self.uploads=[]
   def card(self,id):return self.data
   def field(self,id,key,value):
    self.data['customFieldItems']=[f for f in self.data['customFieldItems'] if f['idCustomField']!=key]
    if value:self.data['customFieldItems'].append({'idCustomField':key,'value':{'text':value}})
   def comment_once(self,id,text,marker):self.comments.append(text)
   def call(self,method,path,**kwargs):
    if method=='POST':
     item={'id':str(len(self.uploads)+1)};self.data['attachments'].append(item);self.uploads.append(kwargs['files']['file'])
     if path.endswith('?setCover=true'):self.data['idAttachmentCover']=item['id']
     return item
    if method=='PUT':self.data.update(kwargs['json']);return self.data
    raise AssertionError((method,path))
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg');t=Fake()
  p=self.db.enqueue('minimum-card','minimum-event',{'name':'LED Neon Test'})
  p=self.db.save(p['id'],{'copy':'copy','model':info['id'],'settings':{'mode':'single','width':1200,'gap':15,'shape':'shape','radius':3},'spec':{'customer_name':'Test','colors':'Pink','widths_mm':[1200],'minimum_width_mm':1105}},status='draft')
  Jobs(self.db,store,t).publish(p)
  self.assertEqual(self.db.get(p['id'])['status'],'ready')
  self.assertEqual(t.data['idList'],READY)
  self.assertIn('Mindestbreite (manuell): 110,50 cm',t.comments[0])
  self.assertEqual(len(t.uploads),3)
  self.assertIn('110,50 cm',fitz.open(stream=t.uploads[0][1],filetype='pdf')[0].get_text())
  size=next(x['value']['text'] for x in t.data['customFieldItems'] if x['idCustomField']==FIELDS[0][1])
  self.assertTrue(size.startswith('120x'),size)
  first_ids=[a['id'] for a in t.data['attachments']]
  self.assertEqual(t.uploads[int(t.data['idAttachmentCover'])-1][0],'technische_zeichnung.jpg')
  t.data['attachments'].append({'id':'original'})
  Jobs(self.db,store,t).publish(self.db.get(p['id']))
  ids=[a['id'] for a in t.data['attachments']]
  self.assertIn(t.data['idAttachmentCover'],ids[4:])
  self.assertEqual(t.uploads[int(t.data['idAttachmentCover'])-1][0],'technische_zeichnung.jpg')
  self.assertEqual(ids[:4],first_ids+['original'])
  self.assertEqual(len(set(ids)),7)
  self.assertEqual([f[0] for f in t.uploads[:3]],[f[0] for f in t.uploads[3:]])
  self.assertNotIn(' → ',t.comments[-1])
  saved=self.db.get(p['id'])
  updated={**saved['spec'],'minimum_first':True,'minimum_width_mm':950,
           'requested_widths_mm':[1250],'widths_mm':[950,1250],'sized_widths_mm':[950,1250],
           'pricing_options':{'additional_cost_usd':20}}
  self.db.save(p['id'],{'spec':updated})
  result=Jobs(self.db,store,t).publish(p)
  self.assertIn('Größe 1: 120x',t.comments[-1])
  self.assertIn(' → 95x',t.comments[-1])
  self.assertIn('Preis 2 (USD): leer → '+result['quotes'][1]['total_usd'],t.comments[-1])
  self.assertEqual(result['spec']['widths_mm'],[950,1250])
  self.assertEqual(float(result['quotes'][0]['additional_cost_usd']),20)
  updated.update(requested_widths_mm=[],widths_mm=[950],sized_widths_mm=[950])
  self.db.save(p['id'],{'spec':updated})
  Jobs(self.db,store,t).publish(p)
  self.assertIn('Größe 2: 125x',t.comments[-1])
  self.assertFalse(any(x['idCustomField'] in FIELDS[1] for x in t.data['customFieldItems']))

  second={**saved,'spec':{**updated,'design_name':'Zweizeilig','minimum_width_mm':600,'widths_mm':[600],'sized_widths_mm':[600]}}
  self.db.save(p['id'],{'spec':{**updated,'design_name':'Einzeilig'},
                        'additional_designs':[{k:second[k] for k in ('model','spec','settings')}]})
  result=Jobs(self.db,store,t).publish(p)
  self.assertEqual(len(result['quotes']),2)
  for i,label in enumerate(('Einzeilig','Zweizeilig')):
   batch=t.uploads[-6:][3*i:3*i+3]
   self.assertTrue(all(f[0].startswith(f'Design_{i+1}_') for f in batch))
   self.assertIn(label,fitz.open(stream=batch[0][1],filetype='pdf')[0].get_text())
   self.assertIn(label,t.comments[-1])
  self.assertTrue(any(f['idCustomField']==FIELDS[1][1] and f['value']['text'].startswith('60x') for f in t.data['customFieldItems']))

 def test_smallest_review_keeps_usage_and_overrides_can_be_below_geometry(self):
  from cloud_ai import size_only_issue
  from cloud_jobs import size_variants
  from unittest.mock import patch
  self.assertTrue(size_only_issue('„Smallest Size“ und „Auf Anfrage“ nennen keine konkrete Breite.'))
  self.assertFalse(size_only_issue('Smallest Size ohne Maße und Einsatz innen oder außen ungeklärt.'))
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg')
  with patch('cloud_jobs.minimum_size',return_value={'recommendedWidth':1800}):
   widths,_=size_variants(store,info['id'],{'mode':'single','shape':'rectangle'},
                          {'widths_mm':[1400],'minimum_first':True,'minimum_width_mm':950})
  self.assertEqual(widths,[950,1400])

 def test_publish_rejects_actual_drawing_below_manual_minimum_before_upload(self):
  from cloud_trello import HOLDING
  from unittest.mock import Mock
  p=self.db.enqueue('small-card','small-event',{'name':'LED Neon Test'})
  p=self.db.save(p['id'],{'copy':'copy','model':'model','settings':{'width':1200},'spec':{'customer_name':'Test','colors':'Pink','widths_mm':[1200],'minimum_width_mm':1100}},status='draft')
  store=Mock();store.drawing.return_value={'exportable':True,'paths':[['M',0,0]],'width':1000}
  store.size_probe.return_value={'width':80,'paths':[[['m',[0,0]],['l',[44,0]]]]}
  t=Mock();t.card.return_value={'idBoard':BOARD,'idList':HOLDING}
  with self.assertRaisesRegex(Review,'Mindestbreite'):Jobs(self.db,store,t).publish(p)
  t.call.assert_not_called();t.comment_once.assert_not_called()
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
 def test_acrylic_sheet_sizes_and_single_package(self):
  from geometry import acrylic_split
  from neon_pricing import drawing_price
  for w,h,n in [(2400,1200,1),(1200,2400,1),(2401,1200,2),(1201,2400,2),(5000,1000,3),(4000,2000,4),(3000,2500,5)]:
   outline=[['m',[0,0]],['l',[w,0]],['l',[w,h]],['l',[0,h]],['h']]
   split=acrylic_split(outline,[0,0,w,h])
   self.assertEqual(len(split['pieces']) if split else 1,n)
   if split:
    self.assertTrue(split['seams'])
    for dims in split['pieces']:
     self.assertLessEqual(max(dims),2400.000001)
     self.assertLessEqual(min(dims),1200.000001)
   drawing={'width':w,'height':h,'acrylicSplit':split,'neonMeters':5}
   for options,count in [({},1),({'controllers':0},1),({'controllers':3},3)]:
    q=drawing_price(drawing,options)
    self.assertEqual(q['items'][0]['controllers'],count)
    self.assertEqual(len(q['packages']),1)
    self.assertEqual(q['packages'][0]['dimensions_cm'][2],str(6+4*(n-1)))
 def test_mixed_sheet_orientation_uses_straight_partial_cuts(self):
  from geometry import acrylic_split
  from shapely.geometry import Polygon,LineString
  from shapely.ops import split,snap
  from neon_pricing import drawing_price
  points=[(0,0),(2600,0),(2600,1200),(1500,2350),(1150,2490),(550,2490)]
  outline=[['m',points[0]],*(['l',pt] for pt in points[1:]),['h']]
  polygon=Polygon(points)
  plan=acrylic_split(outline,polygon.bounds)
  self.assertEqual(len(plan['pieces']),3)
  regions=[polygon]
  for (_,start),(_,end) in plan['seams']:
   self.assertTrue(start[0]==end[0] or start[1]==end[1])
   line=LineString([start,end])
   regions=[piece for region in regions for piece in split(snap(region,line,1e-7),line).geoms]
  self.assertEqual(len(regions),3)
  for region in regions:
   a,b,c,d=region.bounds
   self.assertLessEqual(min(c-a,d-b),1200.000001)
   self.assertLessEqual(max(c-a,d-b),2400.000001)
  q=drawing_price(dict(width=2600,height=2490,neonMeters=5,acrylicSplit=plan),{})
  self.assertEqual(len(q['packages']),1)
  self.assertLessEqual(float(q['packages'][0]['dimensions_cm'][1]),130.000001)
 def test_split_appears_in_offer(self):
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg')
  d=store.drawing(info['id'],json.dumps({'mode':'single','width':3000,'gap':15,'shape':'shape'}))
  spec=validate_spec({'customer_name':'Test','colors':'Pink','widths_mm':[3000],'controllers':0})
  files,quotes=artifacts([d],spec)
  self.assertTrue(d['acrylicSplit']['seams'])
  self.assertEqual(len(quotes[0]['packages']),1)
  self.assertEqual(quotes[0]['items'][0]['controllers'],1)
  self.assertIn('Acrylteile',fitz.open(stream=files[0][2],filetype='pdf')[0].get_text())
 def test_three_outputs_and_durable_model(self):
  store=DurableStore(self.db);info=store.add(SVG.encode(),'Test.svg')
  store=DurableStore(Database(self.tmp.name))
  d=store.drawing(info['id'],json.dumps({'mode':'single','width':700,'gap':15,'shape':'shape','radius':3}))
  spec=validate_spec({'customer_name':'Test Kunde','colors':'Pink','widths_mm':[700]})
  files,quotes=artifacts([d],spec)
  self.assertEqual([f[0] for f in files],['auto_quote_Test_Kunde.pdf','image.png','technische_zeichnung.jpg'])
  text=fitz.open(stream=files[0][2],filetype='pdf')[0].get_text()
  self.assertIn('70,00',text);self.assertIn('USD',text)
  self.assertNotIn('Option 1',text)
  second=store.drawing(info['id'],json.dumps({'mode':'single','width':1000,'gap':15,'shape':'shape','radius':3}))
  multiple,_=artifacts([d,second],{**spec,'widths_mm':[700,1000]},'Motiv')
  with fitz.open(stream=multiple[0][2],filetype='pdf') as doc:
   self.assertEqual([page.get_text().splitlines()[1] for page in doc],
                    ['Test Kunde · Motiv · Option 1','Test Kunde · Motiv · Option 2'])
  self.assertGreater(Image.open(io.BytesIO(files[1][2])).width,1000)
  self.assertGreater(Image.open(io.BytesIO(files[2][2])).width,1500)
  self.assertGreaterEqual(float(quotes[0]['shipping_usd']),45)
  self.assertGreater(float(quotes[0]['total_usd']),0)
if __name__=='__main__':unittest.main()
