import unittest
from unittest.mock import Mock, patch
from cloud_ai import Review
from cloud_jobs import size_variants

class ReferenceSizingTests(unittest.TestCase):
    def test_no_reference_never_computes_minimum(self):
        with patch('cloud_jobs.minimum_size', side_effect=AssertionError('formula called')):
            with self.assertRaisesRegex(Review,'[Rr]eferenz'):
                size_variants(Mock(), 'model', {}, {'smallest_requested':True,'widths_mm':[]})

    def test_requested_size_is_not_silently_enlarged(self):
        store=Mock();store.drawing.return_value={'width':900}
        with patch('cloud_jobs.measure',return_value={'recommendedWidth':800}):
            widths,_=size_variants(store,'model',{}, {'widths_mm':[900]})
        self.assertEqual(widths,[900])

if __name__=='__main__':unittest.main()

class EvidenceValidationTests(unittest.TestCase):
    def setUp(self):
        import reference_matching as rm
        self.rm=rm
        self.ref=next(r for r in rm.REFERENCES.values() if r['size_eligible'])
        self.choice=dict(matched=True,reference_id=self.ref['id'],confidence=.95,
            same_line_construction=True,same_print_roles=True,similar_detail_density=True,
            similar_layout=True,connected_backboard=True,style='follow',reason='Vergleichbare Schrift, Details und Verteilung der Neonlinien.')
    def validate(self,choice):
        return self.rm.validate_match({'size':choice},True,False,{choice.get('reference_id')})
    def test_transfers_documented_width_not_model_value(self):
        result=self.validate({**self.choice,'width_mm':123})
        self.assertEqual(result['size']['width_mm'],self.ref['dimensions_cm'][0][0]*10)
    def test_requested_dimensions_are_not_minimum_evidence(self):
        ref=next(r for r in self.rm.REFERENCES.values() if not r['size_eligible'])
        with self.assertRaises(Review):self.validate({**self.choice,'reference_id':ref['id']})
    def test_no_match_unknown_id_and_weak_or_mismatched_evidence_stop(self):
        for edit in ({'matched':False},{'reference_id':'invented'},{'confidence':.89},
                     {'same_line_construction':False},{'same_print_roles':False},
                     {'similar_detail_density':False},{'similar_layout':False},{'confidence':float('nan')}):
            with self.subTest(edit=edit),self.assertRaises(Review):self.validate({**self.choice,**edit})
    def test_cut_selection_uses_contour_eligibility(self):
        result=self.rm.validate_match({'cut':self.choice},False,True,{self.ref['id']})
        self.assertEqual(result['cut']['style'],'follow')
    def test_no_reference_never_downloads_or_mutates_a_manual_rectangle(self):
        result=self.rm.select(Mock(),Mock(),Mock(),{'spec':{'minimum_width_mm':500,'shape':'rectangle'},'settings':{}},{})
        self.assertEqual(result,{})
    def test_cache_invalidates_for_changed_paths(self):
        import json
        store=Mock();store.model.return_value={'paths':[[1,2]]}
        db=Mock();db.meta.return_value=json.dumps({'size':{'width_mm':500}})
        record={'model':'model','settings':{},'spec':{'smallest_requested':True,'shape':'rectangle'}}
        self.rm.select(Mock(),store,db,record,{})
        key=db.meta.call_args.args[0]
        store.model.return_value={'paths':[[1,3]]}
        self.rm.select(Mock(),store,db,record,{})
        self.assertNotEqual(key,db.meta.call_args.args[0])
    def test_reference_contour_has_no_artificial_shelf(self):
        from shapely.geometry import LineString,Point,Polygon
        from geometry import _full_shape,sample_path
        # Low sloping word next to a tall Y-like component: old text band bridges the empty top.
        lines=[LineString([(0,0),(30,10),(30,40),(0,40),(0,0)]),
               LineString([(40,15),(70,20),(70,40),(40,40),(40,15)]),
               LineString([(80,-20),(90,0),(100,-20),(105,-20),(93,10),(93,40),(87,40),(87,10),(75,-20),(80,-20)])]
        old=_full_shape(lines,3,2,10,bands=[(-3,-23,108,43)])
        new=_full_shape(lines,3,2,10,bands=[(-3,-23,108,43)],reference_follow=True)
        old=Polygon(sample_path(old));new=Polygon(sample_path(new))
        self.assertTrue(old.contains(Point(50,0)))
        self.assertFalse(new.contains(Point(50,0)))
        self.assertEqual(new.geom_type,'Polygon')
        for line in lines:self.assertTrue(new.covers(line) and new.exterior.distance(line)>=2.9)

class ExportReferenceGateTests(unittest.TestCase):
    def setup_handler(self):
        from cloud_server import CloudHandler
        from types import SimpleNamespace
        from contextlib import nullcontext
        handler=object.__new__(CloudHandler)
        db=Mock();db.get.return_value={'revision':1,'spec':{},'snapshot':{}}
        jobs=Mock();jobs.project_lock.return_value=nullcontext()
        store=Mock();store.drawing.side_effect=lambda model,settings:{'width':__import__('json').loads(settings)['width']}
        handler.server=SimpleNamespace(db=db,jobs=jobs,store=store)
        return handler
    def test_export_without_match_is_blocked(self):
        handler=self.setup_handler()
        with patch('reference_matching.select',side_effect=Review('Keine Referenz')),patch('reference_matching.check_contour') as gate:
            with self.assertRaises(Review):handler.verify_export({'id':'m','settings':{}},{'width':500},{'project':'p','revision':1,'spec':{}})
            gate.assert_not_called()
    def test_export_checks_each_variant_and_replaces_client_claims(self):
        handler=self.setup_handler()
        match={'cut':{'style':'follow'},'size':{'width_mm':500}}
        options={'project':'p','revision':1,'formats':['quote'],'spec':{'widths_mm':[500,900],'reference_width_mm':123,'auto_minimum_mm':123}}
        with patch('reference_matching.select',return_value=match),patch('cloud_jobs.size_variants') as sizes,patch('reference_matching.check_contour') as gate:
            handler.verify_export({'id':'m','settings':{'referenceContour':'follow'}},{'width':500},options)
            self.assertEqual([c.args[1]['width'] for c in gate.call_args_list],[500,900])
            self.assertEqual(options['spec']['reference_width_mm'],500)
            self.assertIsNone(options['spec']['auto_minimum_mm'])
            self.assertEqual(sizes.call_count,2)
    def test_fixed_board_keeps_explicit_dimensions_without_minimum_gate(self):
        handler=self.setup_handler()
        with patch('reference_matching.select',return_value={}),patch('cloud_jobs.size_variants',side_effect=AssertionError('fixed dimensions must stay')):
            handler.verify_export({'id':'m','settings':{'fixedBoard':{'width_mm':500,'height_mm':300}}},{'width':500},{'project':'p','revision':1,'spec':{'fixed_board':{'width_mm':500,'height_mm':300},'shape':'rectangle','widths_mm':[500]}})

    def test_four_quote_sizes_and_distinct_preview_are_checked_separately(self):
        handler=self.setup_handler()
        with patch('reference_matching.select',return_value={}),patch('cloud_jobs.size_variants') as sizes,patch('reference_matching.check_contour'):
            handler.verify_export({'id':'m','settings':{}},{'width':500},{'project':'p','revision':1,'formats':['quote'],'spec':{'widths_mm':[600,700,800,900]}})
            self.assertEqual([c.args[3]['widths_mm'] for c in sizes.call_args_list],[[500],[600],[700],[800],[900]])

    def test_export_cannot_retain_old_contour_with_new_reference(self):
        handler=self.setup_handler()
        with patch('reference_matching.select',return_value={'cut':{'style':'follow'}}):
            with self.assertRaisesRegex(Review,'Vorschau'):
                handler.verify_export({'id':'m','settings':{}},{'width':500},{'project':'p','revision':1,'spec':{}})

class ReferenceAvailabilityTests(unittest.TestCase):
    def test_unavailable_supplier_card_does_not_hide_other_references(self):
        import reference_matching as rm
        from cloud_trello import ServiceError
        refs=list(rm.REFERENCES.values())[:2]
        db=Mock();db.meta.return_value=None
        store=Mock();store.model.return_value={'paths':[]}
        with patch.object(rm,'REFERENCES',{r['id']:r for r in refs}),patch.object(rm,'reference_image',side_effect=[ServiceError('Trello HTTP 404'),'image']),patch.object(rm,'drawing_image',return_value=b'image'),patch.object(rm,'png_url',return_value='image'),patch.object(rm,'ask',return_value={}) as ask,patch.object(rm,'validate_match',return_value={}):
            rm.select(Mock(),store,db,{'model':'m','settings':{},'spec':{'widths_mm':[500],'shape':'shape'}},{})
            self.assertEqual(len(ask.call_args.args[1]),2)
