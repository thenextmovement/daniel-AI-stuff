import copy,unittest
from geometry import build_geometry, KAPPA, path_length, path_bounds
from manufacturing import normalize_dot, inspect
from cloud_ai import drawing_model, Review

SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><path id="bold" d="M0 0 L30 0 L30 30 Z" fill="none" stroke="red"/><path id="thin" d="M40 0 C60 0 60 30 40 30" fill="none" stroke="blue"/><path id="dot" d="M70 0 L70 1" fill="none" stroke="blue"/></svg>'
PLAN=[{'name':'Bold','mode':'double','reason':'Breite Buchstaben','path_ids':['bold'],'dot_ids':[]},{'name':'Thin','mode':'single','reason':'Dünne Schrift','path_ids':['thin','dot'],'dot_ids':['dot']}]
class ManufacturingTests(unittest.TestCase):
 def test_already_drawn_closed_centerline_is_not_skeletonized_again(self):
  svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100"><path id="D" d="M0 0 L0 80 C60 80 60 0 0 0 Z" fill="none" stroke="blue"/></svg>'
  plan=[{'name':'Deutschland','mode':'single','reason':'Dünne Schrift','path_ids':['D'],'dot_ids':[]}]
  model,modes=drawing_model({'svg':svg,'line_plan':plan})
  original=copy.deepcopy(model['modes']['double'][0]['commands'])
  d=build_geometry(model,{'width':600,'mode':'single','partModes':modes,'shape':'rectangle'})
  self.assertEqual(len(d['paths']),1)
  self.assertEqual([c[0] for c in d['paths'][0]],[c[0] for c in original])
  self.assertEqual(d['names'],['Deutschland'])
  self.assertEqual(model['modes']['double'][0]['commands'],original)
 def test_mixed_plan_survives_import_and_measures_actual_paths(self):
  model,modes=drawing_model({'svg':SVG,'line_plan':PLAN})
  d=build_geometry(model,{'width':600,'mode':'single','partModes':modes,'shape':'rectangle'})
  self.assertEqual(set(d['pathModes']),{'single','double'})
  self.assertEqual(d['modeLabel'],'Gemischt')
  dot=d['paths'][next(i for i,n in enumerate(d['names']) if n=='Thin · Punkt')]
  self.assertAlmostEqual(path_length(dot),20)
  self.assertAlmostEqual(d['neonMeters'],sum(map(path_length,d['paths']))/1000,places=7)
  self.assertGreaterEqual(d['minGap'],14.9)
 def test_missing_duplicate_or_unknown_plan_rejected(self):
  for plan in ([],PLAN[:1],PLAN+[PLAN[0]],[{**PLAN[0],'path_ids':['unknown']},PLAN[1]]):
   with self.assertRaises(Review):drawing_model({'svg':SVG,'line_plan':plan})
 def test_dot_only_grows_upward_and_does_not_mutate_original(self):
  item={'role':'dot','mode':'single','commands':[['m',[10,5]],['l',[10,6]]],'length':1}
  before=copy.deepcopy(item);new=normalize_dot(item,2)
  self.assertEqual(item,before);self.assertEqual(new['commands'],[['m',[10,6]],['l',[10,-4]]])
  self.assertEqual(normalize_dot({**item,'role':'logo'},2)['commands'],item['commands'])
  double=normalize_dot({**item,'mode':'double'},2)
  self.assertEqual(double['commands'][-1],['h']);self.assertAlmostEqual(path_length(double['commands']),3.14159,delta=.02)
  self.assertAlmostEqual(path_bounds(double['commands'])[3],6)
 def test_double_dot_keeps_design_proportions_at_different_sizes(self):
  item={'role':'dot','mode':'double','commands':[['m',[9,4]],['l',[11,4]],['l',[11,6]],['l',[9,6]],['h']]}
  before=copy.deepcopy(item)
  for scale in (.5,1,2,10):
   dot=normalize_dot(item,scale)
   self.assertEqual(path_bounds(dot['commands']),[9,4,11,6])
   self.assertAlmostEqual(path_length(dot['commands']),2*3.14159,delta=.02)
  self.assertEqual(item,before)
 def drawing(self,paths):
  return {'paths':paths,'names':['Path '+str(i) for i in range(len(paths))],'pathModes':['single']*len(paths),
   'settings':{'tube':6,'gap':15},'width':130,'neonMeters':sum(map(path_length,paths))/1000,'neonMaterialMeters':sum(map(path_length,paths))*1.1/1000}
 def test_straight_strokes_spacing_and_fixed_padding(self):
  d=self.drawing([[['m',[0,0]],['l',[100,0]]],[['m',[0,4]],['l',[100,4]]]])
  r=inspect(d)
  self.assertEqual(r['minimumSpacing'],4);self.assertIsNone(r['minimumRadius']);self.assertEqual(r['recommendedWidth'],250)
  self.assertFalse(r['approved'])
 def test_spacing_size_separate_from_tight_curve_and_local_corners(self):
  d=self.drawing([[['m',[0,0]],['l',[100,0]]],[['m',[0,4]],['l',[100,4]]],
   [['m',[0,50]],['c',[0,50.55],[.45,51],[1,51]],['l',[1,90]]]])
  r=inspect(d)
  self.assertEqual(r['spacingWidth'],250)
  self.assertGreater(r['unchangedPathWidth'],1000)
  self.assertIsNone(r['recommendedWidth'])
 def test_quarter_circle_radius_and_sharp_corners(self):
  r=10;k=KAPPA*r
  d=self.drawing([[['m',[r,0]],['c',[r,k],[k,r],[0,r]]]])
  a=inspect(d,{'bendRadius':20,'cutLength':10})
  self.assertAlmostEqual(a['minimumRadius'],r,delta=.12);self.assertGreater(a['recommendedWidth'],130)
  self.assertEqual(a['corners'],0)
  d=self.drawing([[['m',[0,0]],['l',[30,0]],['l',[30,30]]]])
  self.assertEqual(inspect(d)['corners'],1)
 def test_crossings_and_short_paths_are_not_global_scale_demands(self):
  d=self.drawing([[['m',[0,0]],['l',[100,0]]],[['m',[50,-5]],['l',[50,5]]]])
  r=inspect(d);self.assertEqual(r['junctions'],1);self.assertEqual(len(r['shortPaths']),0);self.assertIsNone(r['recommendedWidth'])
  self.assertEqual(r['unchangedPathWidth'],150);self.assertTrue(r['needsLocalCorrection'])
 def test_cut_is_per_piece_not_per_command(self):
  d=self.drawing([[['m',[0,0]],['l',[6,0]],['l',[12,0]],['m',[0,30]],['l',[4,30]]]])
  r=inspect(d)
  self.assertEqual([p['length'] for p in r['shortPaths']],[4])
  self.assertEqual(r['recommendedWidth'],300)
  with self.assertRaises(ValueError):inspect(d,{'cutLength':9})
 def test_parallel_sides_of_one_closed_i_and_neighbouring_letters(self):
  outline=[['m',[0,0]],['l',[0,40]],['l',[7,40]],['l',[7,0]],['h']]
  d=self.drawing([outline])
  for tube in (6,8):
   d['settings']['tube']=tube
   r=inspect(d)
   self.assertEqual(r['minimumSpacing'],7)
   self.assertEqual(r['requiredSpacing'],tube+2)
   self.assertTrue(any('innerhalb der Kontur' in reason for reason in r['reasons']))
  d=self.drawing([outline,[['m',[13,0]],['l',[13,40]]]])
  self.assertEqual(inspect(d)['minimumSpacing'],6)
 def test_size_variants_rebuilds_and_verifies_grown_motif(self):
  from cloud_jobs import size_variants
  import json
  case=self
  class Store:
   def drawing(self,model,options):
    width=json.loads(options)['width'];size=(width-30)/20
    d=case.drawing([[['m',[0,0]],['l',[size,0]]]]);d['width']=width
    return d
  widths,reports=size_variants(Store(),'model',{},dict(widths_mm=[600],smallest_requested=True))
  self.assertEqual(widths,[600,250])
  self.assertFalse(any(r['shortPaths'] for r in reports))
 def test_eps_windows_preview_is_not_used_as_artwork(self):
  import shutil,struct
  from cloud_ai import eps_pdf
  from vector_import import render_pdf_page
  if not shutil.which('gs'):self.skipTest('Ghostscript fehlt')
  ps=b'%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 50 50\n0 0 moveto 50 50 lineto stroke showpage\n'
  header=bytes.fromhex('c5d0d3c6')+struct.pack('<II',30,len(ps))+bytes(18)
  pdf=eps_pdf(header+ps+b'preview')
  self.assertTrue(pdf.startswith(b'%PDF'));self.assertEqual(render_pdf_page(pdf)[1],1)
  with self.assertRaises(Review):eps_pdf(header+ps[:10])
 def test_invalid_profile(self):
  for value in (float('nan'),0,'25',True):
   with self.assertRaises(ValueError):inspect(self.drawing([]),{'bendRadius':value})
 def test_proportional_dot_still_requires_manufacturing_review(self):
  dot=normalize_dot({'role':'dot','mode':'double','commands':[['m',[0,0]],['l',[0,1]]]},1)
  d=self.drawing([dot['commands']]);d['pathRoles']=['dot']
  result=inspect(d,{'bendRadius':25})
  self.assertIsNone(result['recommendedWidth'])
  self.assertTrue(result['needsLocalCorrection'])
  self.assertFalse(result['approved'])
  self.assertTrue(any('Kreisradius' in w for w in result['warnings']))
  self.assertEqual(len(result['shortPaths']),1)
 def test_tight_curve_with_unresolved_corner_is_not_a_size_recommendation(self):
  d=self.drawing([[['m',[0,0]],['c',[0,1],[1,1],[1,0]],['l',[100,0]]]])
  result=inspect(d)
  self.assertGreater(result['unchangedPathWidth'],1000)
  self.assertIsNone(result['recommendedWidth'])
