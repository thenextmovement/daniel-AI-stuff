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
 def test_poll_finds_labels_without_actions_and_deduplicates_after_restart(self):
  from unittest.mock import Mock
  from cloud_trello import READY
  p=self.db.enqueue('source','initial',{})
  self.db.save(p['id'],{'copy':'copy'},status='ready')
  label={'id':'label','name':'Updates AutoQuote'}
  card={'id':'copy','idBoard':BOARD,'idList':READY,'idLabels':['label'],'labels':[label]}
  t=Mock();t.card.return_value=card
  t.call.side_effect=lambda method,path,**kw: [card] if path.startswith('lists/') else []
  jobs=Jobs(self.db,None,t);jobs.poll()
  saved=self.db.get(p['id'])
  self.assertEqual(saved['status'],'queued')
  self.assertEqual(saved['reread'],'copy')
  t.update_status.assert_called_once_with('copy','processing')
  # Even a failed job must not run repeatedly while its trigger remains set.
  self.db.save(p['id'],{},status='review')
  jobs=Jobs(self.db,None,t);jobs.poll()
  self.assertEqual(t.update_status.call_count,1)
  card['labels']=[];card['idLabels']=[];jobs.poll()
  card['labels']=[label];card['idLabels']=['label'];jobs.poll()
  self.assertEqual(t.update_status.call_count,2)
  self.assertNotEqual(self.db.get(p['id'])['update_action']['id'],saved['update_action']['id'])

 def test_update_status_labels_preserve_unrelated_labels(self):
  from unittest.mock import Mock
  t=Trello.__new__(Trello)
  labels=[{'id':'processing','name':'Auto-Update Processing, please wait.'},
          {'id':'completed','name':'Auto Update Completed'}]
  current=['completed','customer']
  def call(method,path,**kw):
   if path.startswith('boards/'):return labels
   if method=='GET':return {'idLabels':current[:]}
   if method=='POST':current.append(kw['json']['value']);return {}
   if method=='DELETE':current.remove(path.rsplit('/',1)[1]);return {}
  t.call=Mock(side_effect=call)
  t.update_status('copy','processing')
  self.assertEqual(set(current),{'processing','customer'})
  t.update_status('copy','completed')
  self.assertEqual(set(current),{'completed','customer'})
  t.update_status('copy',None)
  self.assertEqual(current,['customer'])

 def test_update_label_queues_existing_copy_once_and_only_in_ready(self):
  from unittest.mock import Mock
  from cloud_trello import READY
  p=self.db.enqueue('source','initial',{})
  p=self.db.save(p['id'],{'copy':'copy'},status='ready')
  card={'id':'copy','idBoard':BOARD,'idList':READY,'idLabels':['label']}
  t=Mock();t.card.return_value=card
  jobs=Jobs(self.db,None,t)
  action={'id':'update1','date':'2026-11-22T12:00:00Z','type':'addLabelToCard',
          'data':{'card':{'id':'copy'},'label':{'id':'label','name':'Updates AutoQuote'}}}
  jobs.queue_update(action)
  saved=self.db.get(p['id'])
  t.update_status.assert_called_once_with('copy','processing')
  self.assertEqual(saved['status'],'queued')
  self.assertEqual(saved['reread'],'copy')
  self.assertEqual(saved['update_action']['id'],'update1')
  jobs.queue_update(action)
  self.assertEqual(self.db.get(p['id'])['revision'],saved['revision'])
  self.db.save(p['id'],{},status='ready');card['idList']='other'
  jobs.queue_update({**action,'id':'update2'})
  self.assertEqual(self.db.get(p['id'])['status'],'ready')
  t.copy.assert_not_called()
  card['idList']=READY
  jobs.queue_update({**action,'id':'update3'})
  self.assertEqual(self.db.get(p['id'])['update_action']['id'],'update3')
  self.assertEqual(t.update_status.call_count,2)

 def test_update_executes_reread_publish_then_removes_label(self):
  from unittest.mock import Mock
  p=self.db.enqueue('source','initial',{})
  p=self.db.save(p['id'],{'copy':'copy','reread':'copy','update_action':{'id':'event','date':'2026-11-22T12:00:00Z','label':'label'}})
  t=Mock();jobs=Jobs(self.db,None,t)
  self.db.meta('update_labels',json.dumps({'copy':{'id':'claim','date':'2026-11-22T12:00:00Z'}}))
  jobs.reread=Mock(side_effect=lambda p:self.db.save(p['id'],{'reread':None},status='draft'))
  jobs.publish=Mock(side_effect=lambda p,**kw:self.db.save(p['id'],{},status='ready'))
  jobs.execute(p)
  jobs.reread.assert_called_once();jobs.publish.assert_called_once()
  t.update_status.assert_called_once_with('copy','completed')
  t.call.assert_called_once_with('DELETE','cards/copy/idLabels/label')
  self.assertEqual(self.db.get(p['id'])['update_since'],'2026-11-22T12:00:00Z')
  self.assertEqual(json.loads(self.db.meta('update_labels')), {})

 def test_failed_update_never_marks_completed_or_removes_trigger(self):
  from unittest.mock import Mock
  p=self.db.enqueue('source','initial',{})
  p=self.db.save(p['id'],{'copy':'copy','reread':'copy','update_action':{'id':'event','date':'2026-11-22T12:00:00Z','label':'label'}})
  t=Mock();jobs=Jobs(self.db,None,t)
  jobs.reread=Mock(side_effect=Review('Kontur konnte nicht erstellt werden.'))
  jobs.publish=Mock()
  jobs.execute(p)
  jobs.publish.assert_not_called();t.call.assert_not_called()
  t.update_status.assert_called_once_with('copy',None)
  t.comment_once.assert_called_once()
  self.assertEqual(self.db.get(p['id'])['status'],'review')

 def test_label_reread_includes_new_comments_and_preserves_original_uploads(self):
  from unittest.mock import Mock,patch
  from cloud_trello import READY
  card={'id':'copy','idBoard':BOARD,'idList':READY,'name':'🤖 LED Neon 🤖','desc':'Acryl anpassen',
        'attachments':[{'id':'1','name':'logo.png'},{'id':'3','name':'image.png'}]}
  p=self.db.enqueue('source','event',{})
  p=self.db.save(p['id'],{'copy':'copy','reread':'copy','generated_attachments':['3'],
                        'update_since':'2026-11-21T12:00:00Z',
                        'update_action':{'id':'event','date':'2026-11-22T12:00:00Z','label':'label'}})
  t=Mock();t.card.return_value=card
  t.call.return_value=[{'id':str(i),'date':date,'data':{'text':text}} for i,(date,text) in enumerate([
    ('2026-11-20T12:00:00Z','alter Wunsch'),('2026-11-22T11:00:00Z','Neon Studio project Revision 8'),
    ('2026-11-22T11:30:00Z','Acryl oben gerade verbinden'),('2026-11-22T13:00:00Z','späterer Wunsch')])]
  jobs=Jobs(self.db,DurableStore(self.db),t)
  data={'svg':SVG.replace('<path ', '<path id="logo" '),'line_plan':[{'name':'Logo','mode':'single','path_ids':['logo']}],'widths_mm':[600],'colors':'Kaltweiß','issues':[]}
  with patch('cloud_jobs.generate',return_value=(data,{})) as gen:jobs.reread(p)
  snapshot=gen.call_args.args[1]
  self.assertIn('Acryl oben gerade verbinden',snapshot['desc'])
  for excluded in ('alter Wunsch','Neon Studio project','späterer Wunsch'):self.assertNotIn(excluded,snapshot['desc'])
  self.assertEqual([a['id'] for a in snapshot['attachments']],['1'])
  self.assertTrue(all(call.args[0]=='GET' for call in t.call.call_args_list))

 def test_ingest_creates_verified_copy_before_worker_starts_and_deduplicates(self):
  from unittest.mock import Mock
  source={'id':'source','idBoard':BOARD,'name':'LED Neon Flex | waiting','desc':'customer details'}
  t=Mock();t.card.return_value=source;t.copy.return_value={'id':'copy','url':'https://trello.com/c/copy'}
  jobs=Jobs(self.db,None,t)
  first=jobs.ingest('source','action:first')
  self.assertEqual(first['status'],'queued')
  self.assertEqual(first.get('copy'),'copy')
  self.assertTrue(first.get('copy_verified'))
  t.verify_copy.assert_called_once_with(source,'copy')
  jobs.ingest('source','action:again')
  t.copy.assert_called_once_with(source)
 def test_failed_ingest_copy_is_not_blindly_repeated(self):
  from unittest.mock import Mock
  source={'id':'source','idBoard':BOARD,'name':'LED Neon Flex | waiting','desc':''}
  t=Mock();t.card.return_value=source;t.copy.side_effect=TimeoutError('ambiguous response')
  jobs=Jobs(self.db,None,t)
  with self.assertRaises(TimeoutError):jobs.ingest('source','action:first')
  saved=self.db.for_card('source')
  self.assertTrue(saved.get('copy_intent'))
  self.assertEqual(saved['status'],'review')
  jobs.ingest('source','action:again')
  t.copy.assert_called_once()
 def test_worker_runs_three_distinct_projects_and_does_not_repeat_pending_jobs(self):
  import threading
  from concurrent.futures import ThreadPoolExecutor
  from unittest.mock import Mock
  jobs=Jobs(self.db,None,Mock())
  projects=[self.db.enqueue(str(i),str(i),{}) for i in range(4)]
  release=threading.Event();three_started=threading.Event();seen=[];guard=threading.Lock()
  def process(p):
   with guard:
    seen.append(p['id'])
    if len(seen)==3:three_started.set()
   release.wait(5)
   self.db.save(p['id'],{},status='ready')
  jobs.process=process
  with ThreadPoolExecutor(max_workers=3) as pool:
   active={}
   try:
    jobs.dispatch(pool,active)
    self.assertTrue(three_started.wait(2))
    jobs.dispatch(pool,active)
    self.assertEqual(len(active),3)
    self.assertEqual(len(seen),3)
   finally:release.set()
   for f in active.values():f.result(timeout=3)
   jobs.dispatch(pool,active)
   for f in active.values():f.result(timeout=3)
  self.assertCountEqual(seen,[p['id'] for p in projects])
  jobs.execute(projects[0])
  self.assertEqual(len(seen),4)
 def test_project_locks_isolate_unrelated_uploads(self):
  import threading
  from unittest.mock import Mock
  jobs=Jobs(self.db,None,Mock())
  acquired=threading.Event()
  def other():
   with jobs.project_lock('other'):acquired.set()
  with jobs.project_lock('first'):
   self.assertIs(jobs.project_lock('first'),jobs.project_lock('first'))
   t=threading.Thread(target=other);t.start()
   self.assertTrue(acquired.wait(1))
  t.join(1)
 def test_fixed_acrylic_keeps_motif_size_centering_and_shipping(self):
  from unittest.mock import Mock
  from geometry import path_bounds
  jobs=Jobs(self.db,DurableStore(self.db),Mock())
  data={'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 30"><path id="word" d="M0 0 L200 0 L200 30 L0 30 Z" fill="none" stroke="blue"/></svg>',
        'line_plan':[{'name':'Schriftzug Test','mode':'double','path_ids':['word']}],
        'customer_name':'Test','colors':'Kaltweiß','widths_mm':[900],
        'fixed_board':{'width_mm':1240,'height_mm':290,'motif_width_mm':900},
        'smallest_requested':True,'minimum_first':True}
  record=jobs.design_record(data)
  jobs.size_design(record,{'name':'Smallest Size + 90 cm','desc':''})
  files,quotes,variants,spec=jobs.design_artifacts(record,{})
  d=variants[0];a,b,c,e=path_bounds(d['paths'][0]);x,y,xx,yy=d['bounds']
  self.assertAlmostEqual(d['width'],1240,places=5)
  self.assertAlmostEqual(d['height'],290,places=5)
  self.assertAlmostEqual(c-a+6,900,places=5)
  self.assertAlmostEqual((a+c)/2,(x+xx)/2,places=5)
  self.assertAlmostEqual((b+e)/2,(y+yy)/2,places=5)
  self.assertEqual(d['modeLabel'],'Double Line')
  self.assertEqual(spec['widths_mm'],[1240])
  self.assertEqual(quotes[0]['shipping_usd'],'140')
  with fitz.open(stream=files[0][2],filetype='pdf') as pdf:
   text=''.join(page.get_text() for page in pdf)
  for dimension in ('90,00','124,00','29,00'):self.assertIn(dimension,text)
  record['settings']['fixedBoard']['width_mm']=1500
  record['settings']['width']=1500
  d2=jobs.store.drawing(record['model'],json.dumps(record['settings']))
  self.assertAlmostEqual(d2['neonMeters'],d['neonMeters'],places=5)
  self.assertAlmostEqual(d2['width'],1500,places=5)

 def test_fixed_board_ai_result_overrides_smallest_title(self):
  from unittest.mock import Mock,patch
  from cloud_ai import generate
  t=Mock();image=io.BytesIO();Image.new('RGB',(20,10)).save(image,'PNG');t.download.return_value=image.getvalue()
  card={'id':'source','name':'LED Neon Flex | Smallest Size + 90 cm Breite','desc':'Acryl 124 x 29 cm; Neon 90 cm Double Line',
        'attachments':[{'id':'art','name':'logo.png','isUpload':True}]}
  design={'svg':SVG,'source_attachment_ids':['art'],'excluded_regions':[],
          'fixed_board':{'width_mm':1240,'height_mm':290,'motif_width_mm':900}}
  with patch.dict('os.environ',{'OPENAI_API_KEY':'test'}),patch('cloud_ai.requests.post') as post:
   post.return_value.json.return_value={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(design)}]}]}
   result,_=generate(t,card)
  self.assertEqual(result['widths_mm'],[1240])
  self.assertFalse(result['minimum_first'])
  self.assertFalse(result['smallest_requested'])
  self.assertEqual(result['shape'],'rectangle')
 def test_fixed_board_does_not_hide_collisions_or_expand_requested_dimensions(self):
  from unittest.mock import Mock
  from minimum_size import minimum_size
  jobs=Jobs(self.db,DurableStore(self.db),Mock())
  data={'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 1"><path id="word" d="M0 0 L200 0 L200 1 L0 1 Z" fill="none" stroke="blue"/></svg>',
        'line_plan':[{'name':'Schriftzug Test','mode':'double','path_ids':['word']}],
        'customer_name':'Test','colors':'Kaltweiß','widths_mm':[900],
        'fixed_board':{'width_mm':1240,'height_mm':290,'motif_width_mm':900}}
  record=jobs.design_record(data);jobs.size_design(record,{'name':'Smallest Size','desc':''})
  files,quotes,variants,spec=jobs.design_artifacts(record,{})
  self.assertEqual(variants[0]['width'],1240)
  self.assertTrue(spec['issues'])
  self.assertTrue(quotes[0]['total_usd'])
  report=minimum_size(jobs.store,record['model'],record['settings'])
  self.assertTrue(report['fixedSize'])
  self.assertFalse(report['fixedSizeValid'])
  record['settings']['fixedBoard']['height_mm']=80
  record['settings']['fixedBoard']['width_mm']=850
  with self.assertRaisesRegex(ValueError,'Platte'):
   jobs.store.drawing(record['model'],json.dumps(record['settings']))

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
 def test_compact_retry_keeps_order_and_uses_only_verified_smaller_geometry(self):
  from unittest.mock import Mock,patch
  from minimum_size import minimum_size
  jobs=Jobs(self.db,DurableStore(self.db),Mock())
  def design(height):
   return {'svg':f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><path id="outline" d="M0 0 L200 0 L200 {height} L0 {height} Z" stroke="blue" fill="none"/></svg>',
           'design_name':'Test','source_attachment_ids':['art'],'smallest_requested':True,'widths_mm':[],
           'colors':'Blau','line_plan':[{'name':'Schriftzug Test','mode':'double','path_ids':['outline']}]}
  data=design(2);record=jobs.design_record(data)
  before=minimum_size(jobs.store,record['model'],record['settings'])['recommendedWidth']
  with patch('cloud_jobs.generate',return_value=(design(2.08),{})) as generate:
   improved=jobs.compact_designs({'name':'Smallest Size','desc':''},[data],[record])
  self.assertEqual(generate.call_count,1)
  after=minimum_size(jobs.store,improved[0]['model'],improved[0]['settings'])['recommendedWidth']
  self.assertLess(after,before)
  self.assertEqual(improved[0]['spec']['colors'],'Blau')
  for candidate in (design(8),design(1),{**design(8),'colors':'Rot'},{**design(8),'line_plan':None},
                    {**design(8),'svg':design(8)['svg'].replace('stroke="blue"','stroke="red"')}):
   with patch('cloud_jobs.generate',return_value=(candidate,{})):
    self.assertEqual(jobs.compact_designs({'name':'Smallest Size','desc':''},[data],[record])[0]['model'],record['model'])
  with patch('cloud_jobs.generate',side_effect=TimeoutError):
   self.assertEqual(jobs.compact_designs({'name':'Smallest Size','desc':''},[data],[record])[0]['model'],record['model'])
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
    self.assertEqual(len(files),4)
    self.assertEqual(spec['auto_minimum_mm'],drawings[0]['width'])
    self.assertTrue(all(c['id']=='cold-white' for c in drawings[0]['pathColors']))
    raise StopIteration
   export.side_effect=rendered
   with self.assertRaises(StopIteration):jobs.process(p)
  t.download.assert_called_once_with('source',card['attachments'][0])
  saved=self.db.get(p['id'])
  self.assertEqual(jobs.store.info(saved['model'])['name'],'Hand.png')
  self.assertEqual(set(saved['spec']['line_plan'][0]['path_ids']),set(saved['settings']['pathColors']))
 def test_open_question_allows_draft_with_valid_price_inputs(self):
  spec={'customer_name':'Test','colors':'Warmweiß','widths_mm':[750],'issues':['Ist Warmweiß richtig?']}
  self.assertTrue(validate_spec(spec,draft=True)['download_draft'])
  with self.assertRaises(Review):validate_spec(spec)
  with self.assertRaises(Review):validate_spec({**spec,'widths_mm':[]},draft=True)
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
  Fake.copy=lambda self,source: {'id':'copy','url':'https://trello.com/c/copy'}
  Fake.verify_copy=lambda self,source,copy: None
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
 def test_review_reason_without_spec_issues(self):
  from unittest.mock import Mock
  from cloud_trello import PROCESSING,HOLDING
  t=Mock(spec=Trello);jobs=Jobs(self.db,None,t)
  p=self.db.enqueue('source','event',{})
  self.db.save(p['id'],{'copy':'copy','copy_verified':True})
  t.card.return_value={'idBoard':BOARD,'idList':HOLDING,'name':'🤖 '+PROCESSING+'LED Test 🤖'}
  reason='Nicht alle Neonpfade haben eine Linienart.'
  jobs.fail(p['id'],reason,public_reason=reason)
  msg='Auto-Quote angehalten: '+reason
  t.comment_once.assert_called_once_with('copy',msg,msg)
  t.reset_mock()
  jobs.fail(p['id'],'internal-only')
  self.assertNotIn('internal-only',str(t.comment_once.call_args))
  self.assertIn('Studio-Projekt',str(t.comment_once.call_args))
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
 def test_unreadable_svg_uses_matching_pngs_for_separate_font_quotes(self):
  from unittest.mock import Mock,patch
  from cloud_ai import generate
  t=Mock();files={}
  for index,stem in enumerate(['SciFi','NeoTokyo']):
   out=io.BytesIO();Image.new('RGB',(10,10),(index,0,0)).save(out,'PNG')
   files[stem+'.png']=out.getvalue();files[stem+'.svg']=b'<svg><mask/></svg>'
  card=dict(id='card',name='Smallest Size + 23 cm Höhe',desc='2 Fonts so please make 2 Quotes',
            attachments=[dict(id=k,name=k,isUpload=True) for k in files])
  t.download.side_effect=lambda _,a:files[a['id']]
  designs=[dict(design_name=k,source_attachment_ids=[k],svg=SVG.replace('M10',f'M{10+i}'),excluded_regions=[]) for i,k in enumerate(files) if k.endswith('.png')]
  with patch.dict('os.environ',{'OPENAI_API_KEY':'test'}),patch('cloud_ai.requests.post') as post:
   def reply(data):post.return_value.json.return_value={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(data)}]}]}
   reply(designs[0])
   with self.assertRaisesRegex(Review,'bestellten Designs'):generate(t,card)
   reply({'designs':designs});result,_=generate(t,card)
   self.assertEqual(sum(x['type']=='input_image' for x in post.call_args.kwargs['json']['input'][0]['content']),2)
   self.assertTrue(all(d['heights_mm']==[230] and not d['widths_mm'] and d['size_axis']=='height' for d in result['designs']))
   with self.assertRaisesRegex(Review,'reine Pfade'):generate(t,card,['SciFi.svg'])
 def test_explicit_height_in_size_field_and_title_priority(self):
  from cloud_ai import requested_heights
  self.assertEqual(requested_heights('Smallest Size','Angefragte Groesse: 23 cm Höhe'),[230])
  self.assertEqual(requested_heights('23,5 cm hoch','Size: 30 cm Höhe'),[235])
  self.assertEqual(requested_heights('Smallest Size + 100 cm','Size: 23 cm Höhe'),[])
  self.assertEqual(requested_heights('100 cm Breite','Size: 23 cm Höhe'),[])
 def test_exclude_divider_and_only_the_text_below(self):
  from cloud_ai import apply_motif_exclusions
  names=['Schriftzug OBEN','Horizontale Trennlinie','Schriftzug UNTEN','Logo']
  design=dict(excluded_regions=[],svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'+''.join(
    f'<path id="p{i}" d="M 2 {y} L 65 {y}" fill="none" stroke="red"/>' for i,y in enumerate([5,40,68,90]))+'</svg>',
    line_plan=[dict(name=n,path_ids=['p'+str(i)],mode='single') for i,n in enumerate(names)])
  apply_motif_exclusions(design,'Please ignore the line and all text under the line')
  self.assertEqual([r['name'] for r in design['line_plan']],[names[0],names[3]])
 def test_incomplete_drawing_retries_same_source_once(self):
  from unittest.mock import Mock,patch
  from cloud_ai import generate
  image=io.BytesIO();Image.new('RGB',(20,10)).save(image,'PNG')
  t=Mock();t.download.return_value=image.getvalue()
  card={'id':'card','name':'Logo','desc':'','attachments':[{'id':'art','name':'logo.png','isUpload':True}]}
  partial={'status':'incomplete','incomplete_details':{'reason':'max_output_tokens'}}
  design={'source_attachment_ids':['art'],'svg':SVG,'excluded_regions':[]}
  done={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(design)}]}]}
  for final in (partial,done):
   with patch.dict('os.environ',{'OPENAI_API_KEY':'test'}),patch('cloud_ai.requests.post') as post:
    post.return_value.json.side_effect=[partial,final]
    if final is partial:
     with self.assertRaisesRegex(Review,'zwei Versuchen'):generate(t,card)
    else:self.assertEqual(generate(t,card)[0]['source_attachment_ids'],['art'])
    a,b=[call.kwargs['json'] for call in post.call_args_list]
    self.assertEqual(a['input'],b['input'])
    self.assertGreater(b['max_output_tokens'],a['max_output_tokens'])
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
  third={**first,'design_name':'Third Sign','svg':SVG.replace('M10 50','M30 50')}
  card['desc']='3 Designs separat anbieten.'
  self.assertEqual(len(run({'designs':[first,second,third]})['designs']),3)
  with self.assertRaises(Review):run({'designs':[first,second]})
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
  self.assertEqual(t.data['pos'],'bottom')
  self.assertIn('Mindestbreite (manuell): 110,50 cm',t.comments[0])
  self.assertEqual(len(t.uploads),4)
  self.assertIn('110,50 cm',fitz.open(stream=t.uploads[0][1],filetype='pdf')[0].get_text())
  size=next(x['value']['text'] for x in t.data['customFieldItems'] if x['idCustomField']==FIELDS[0][1])
  self.assertTrue(size.startswith('120x'),size)
  first_ids=[a['id'] for a in t.data['attachments']]
  self.assertEqual(t.uploads[int(t.data['idAttachmentCover'])-1][0],'technische_zeichnung.jpg')
  t.data['attachments'].append({'id':'original'})
  t.data['pos']=12345
  Jobs(self.db,store,t).publish(self.db.get(p['id']))
  self.assertEqual(t.data['pos'],'bottom')
  ids=[a['id'] for a in t.data['attachments']]
  self.assertIn(t.data['idAttachmentCover'],ids[5:])
  self.assertEqual(t.uploads[int(t.data['idAttachmentCover'])-1][0],'technische_zeichnung.jpg')
  self.assertEqual(ids[:5],first_ids+['original'])
  self.assertEqual(len(set(ids)),9)
  self.assertEqual([f[0] for f in t.uploads[:4]],[f[0] for f in t.uploads[4:]])
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
   batch=t.uploads[-8:][4*i:4*i+4]
   self.assertTrue(all(f[0].startswith(f'Design_{i+1}_') for f in batch[:3]))
   self.assertEqual(batch[3][0],f'mockup{i+1}.jpg')
   self.assertIn(label,fitz.open(stream=batch[0][1],filetype='pdf')[0].get_text())
   self.assertIn(label,t.comments[-1])
  self.assertTrue(any(f['idCustomField']==FIELDS[1][1] and f['value']['text'].startswith('60x') for f in t.data['customFieldItems']))

  # More designs than Trello's four price slots still receive their own files and prices.
  extra=[{k:second[k] for k in ('model','spec','settings')} for _ in range(4)]
  for i,item in enumerate(extra,2):item['spec']={**item['spec'],'design_name':f'Motiv {i}'}
  self.db.save(p['id'],{'additional_designs':extra})
  result=Jobs(self.db,store,t).publish(p)
  self.assertEqual(self.db.get(p['id'])['status'],'ready')
  self.assertEqual(len(result['quotes']),5)
  self.assertEqual([f[0] for f in t.uploads[-20:] if f[0].startswith('mockup')],
                   [f'mockup{i}.jpg' for i in range(1,6)])
  self.assertIn('Design 5 · Motiv 5',t.comments[-1])
  self.assertIn('Alle weiteren Varianten',t.comments[-1])

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
  self.assertEqual([f[0] for f in files],['auto_quote_Test_Kunde.pdf','image.png','technische_zeichnung.jpg','mockup1.jpg'])
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
  import numpy as np
  mockup=np.asarray(Image.open(io.BytesIO(files[3][2])))
  ys,xs=np.where(mockup.max(axis=2)>200)
  self.assertGreater(len(xs),100)
  self.assertGreater(xs.min(),90);self.assertLess(xs.max(),1510)
  self.assertGreater(ys.min(),90);self.assertLess(ys.max(),910)
  from cloud_exports import mockup_image
  from colors import line_color
  for shade in ('cold-white','warm-white'):
   white={**d,'pathColors':[line_color(override=shade) for _ in d['paths']]}
   pixels=np.asarray(Image.open(io.BytesIO(mockup_image(white))))
   self.assertGreater((pixels.max(axis=2)>200).sum(),100)
   if shade=='warm-white':
    bright=pixels[pixels.max(axis=2)>200].mean(axis=0)
    self.assertGreater(bright[0],bright[2]+10)
  self.assertGreaterEqual(float(quotes[0]['shipping_usd']),45)
  self.assertGreater(float(quotes[0]['total_usd']),0)
if __name__=='__main__':unittest.main()
