import sys
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from geometry import path_length, path_bounds
from path_splitting import find_splits, split_commands


class SplitTests(unittest.TestCase):
    def test_crossing_and_t_junction_preserve_curves_and_length(self):
        paths = {'a':[['m',[0,0]],['c',[0,10],[10,10],[10,0]]],
                 'b':[['m',[5,-2]],['l',[5,12]]],
                 'c':[['m',[8,0]],['l',[10,0]],['l',[12,0]]]}
        before = deepcopy(paths)
        cuts = find_splits(paths, ['a'], .01)
        self.assertEqual(set(cuts), {'a','b','c'})
        for key in ('a','b','c'):
            pieces = split_commands(paths[key], cuts[key])
            self.assertEqual(len(pieces), 2)
            self.assertAlmostEqual(sum(map(path_length,pieces)), path_length(paths[key]), places=7)
        self.assertTrue(all(any(c[0]=='c' for c in p) for p in split_commands(paths['a'],cuts['a'])))
        self.assertEqual(paths,before)

    def test_closed_seam_is_not_an_extra_piece(self):
        path = [['m',[0,0]],['l',[10,0]],['l',[10,10]],['l',[0,10]],['h']]
        pieces = split_commands(path, [[1,.5],[3,.5]])
        self.assertEqual(len(pieces),2)
        self.assertAlmostEqual(sum(map(path_length,pieces)),40)
        self.assertTrue(all(p[-1][0]!='h' for p in pieces))

    def test_near_parallel_paths_and_existing_endpoints_are_not_split(self):
        paths={'a':[['m',[0,0]],['l',[10,0]]],
               'b':[['m',[0,.2]],['l',[10,.2]]],
               'c':[['m',[10,0]],['l',[20,10]]]}
        self.assertEqual(find_splits(paths,['a'],.01),{})

    def test_self_crossing_is_split(self):
        paths={'a':[['m',[0,0]],['l',[10,10]],['l',[0,10]],['l',[10,0]]]}
        pieces=split_commands(paths['a'],find_splits(paths,['a'],.01)['a'])
        self.assertEqual(len(pieces),3)



class SplitIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store=server.Store()
        paths=[[['m',[0,0]],['c',[0,50],[100,50],[100,0]]],
               [['m',[50,-10]],['l',[50,60]]],
               [['m',[150,0]],['l',[150,60]]]]
        items=[{'name':f'Linie {i}','partId':f'p{i}','commands':p,'length':path_length(p),'sourceColor':'#123456'} for i,p in enumerate(paths)]
        model={'modes':{'double':items,'single':deepcopy(items)},'parts':[{'id':f'p{i}','name':f'Linie {i}','single':1,'double':1,'bounds':path_bounds(p)} for i,p in enumerate(paths)],'sourceKind':'master','sourceLabel':'Test','traceNote':'','imageBounds':[0,-10,150,70],'image':''}
        self.project=self.store.add_model(model,'test.png')
        self.drawing=self.store.drawing(self.project['id'],'{"mode":"double","shape":"shape","width":600,"gap":15,"pathColors":{"double:0":"dark-blue"}}')

    def test_sections_colors_hide_undo_and_export(self):
        import json,io
        from export_pdf import make_pdf
        import pdfplumber
        p=self.project['id'];before=self.drawing
        model_before=deepcopy(self.store.model(p))
        result=self.store.split_paths(p,['double:0'],before['settings']);after=result['drawing']
        self.assertEqual(result['count'],2)
        self.assertEqual(after['outer'],before['outer'])
        self.assertAlmostEqual(after['neonMeters'],before['neonMeters'],places=9)
        self.assertGreaterEqual(after['minGap'],14.9)
        self.assertEqual(after['pathColors'][0]['id'],'dark-blue')
        self.assertEqual(after['pathColors'][1]['id'],'dark-blue')
        changed={**after['settings'],'pathColors':{**after['settings']['pathColors'],'double:0~1':'cold-white'}}
        colored=self.store.drawing(p,json.dumps(changed))
        self.assertEqual([c['id'] for c in colored['pathColors'][:2]],['cold-white','dark-blue'])
        self.assertEqual(colored['paths'],after['paths'])
        with pdfplumber.open(io.BytesIO(make_pdf(colored,{'kind':'drawing'}))) as pdf:
            text=pdf.pages[0].extract_text()
            self.assertIn('Cool white',text)
            self.assertIn('Dark blue',text)
        hidden=self.store.drawing(p,json.dumps({**changed,'hiddenPaths':['double:0~1']}))
        self.assertNotIn('double:0~1',hidden['pathKeys'])
        self.assertIn('double:0~2',hidden['pathKeys'])
        self.assertLess(hidden['neonMeters'],colored['neonMeters'])
        self.assertEqual(self.store.split_paths(p,after['pathKeys'],after['settings'])['count'],0)
        restored=self.store.drawing(p,json.dumps(before['settings']))
        self.assertEqual(restored,before)
        self.assertEqual(self.store.model(p),model_before)
        # The mode switch retains original single paths, never split double outlines.
        single=self.store.drawing(p,json.dumps({**changed,'mode':'single'}))
        self.assertEqual(single['pathKeys'],['single:0','single:1','single:2'])

    def test_hidden_or_uv_connections_do_not_split_and_invalid_keys_fail(self):
        p=self.project['id'];settings=self.drawing['settings']
        self.assertEqual(self.store.split_paths(p,['double:0'],{**settings,'shape':'rectangle','hiddenPaths':['double:1']})['count'],0)
        uv={**settings,'uvStrokes':[{'op':'add','radius':15,'points':[[50,47.5]]}]}
        self.assertEqual(self.store.split_paths(p,['double:0'],uv)['count'],0)
        for keys in ([],['missing'],'double:0',[{}]):
            with self.assertRaises(ValueError):self.store.split_paths(p,keys,settings)


if __name__=="__main__":unittest.main()
