"""The editable contour is the rendered curve, including after repeated drags."""
import io, sys, unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import geometry as g
from shapely.geometry import box, Polygon, LineString
from vector_import import analyze_vector

class VisibleOutlineTests(unittest.TestCase):
    def test_outward_move_relaxes_handles_without_moving_neighbours(self):
        # Short curve meeting a long deleted-run bridge in the Kraftpartner
        # contour. Translating its old handles stops after only 0.95 mm.
        path=[g.M(100,50),g.L(160,50),g.L(160,115),g.L(152.116816,105.605510),
              g.C(146.447603,104.748395,140.833944,103.553677,135.299085,102.058762),
              g.C(133.978921,101.701737,132.665387,101.322989,131.350622,100.946538),
              g.L(100,100),g.L(100,50),['h']]
        point=[135.299085,102.058762];target=[point[0],point[1]+10]
        protected=box(105,55,155,80)
        _,old=g.edit_outline_anchor(path,'move',point,target,protected,radius=3,visible=True)
        self.assertTrue(old['constrained'])
        result,info=g.edit_outline_anchor(path,'move',point,target,protected,radius=3,visible=True,auto_handles=True)
        self.assertFalse(info['constrained'])
        np.testing.assert_allclose(info['point'],target,atol=1e-7)
        self.assertEqual(result[:4],path[:4]);self.assertEqual(result[6:],path[6:])
        before=list(g.segments(path));after=list(g.segments(result))
        self.assertEqual(len(before),len(after))
        for i,((_,a),(_,b)) in enumerate(zip(before,after)):
            if i!=4:np.testing.assert_array_equal(a[0],b[0])
        poly=Polygon(g.sample_path(result,500))
        self.assertTrue(poly.is_valid);self.assertTrue(poly.covers(protected))
        for _,p in after[3:5]:
            t=np.linspace(0,1,2001)[:,None];u=1-t
            v=3*(u*u*(p[1]-p[0])+2*u*t*(p[2]-p[1])+t*t*(p[3]-p[2]))
            a=6*(u*(p[2]-2*p[1]+p[0])+t*(p[3]-2*p[2]+p[1]))
            k=np.abs(v[:,0]*a[:,1]-v[:,1]*a[:,0])/np.maximum(np.linalg.norm(v,axis=1)**3,1e-12)
            self.assertLessEqual(max(k),1/3+1e-5)

    def test_auto_handles_still_limit_inward_move_for_clearance(self):
        path=[g.M(0,0),g.L(200,0),g.L(200,100),
              g.C(200,116,180,134,180,150),g.C(190,153,200,157,200,160),
              g.L(200,300),g.L(0,300),g.L(0,0),['h']]
        protected=box(15,15,175,285)
        result,info=g.edit_outline_anchor(path,'move',[180,150],[40,150],protected,radius=3,visible=True,auto_handles=True)
        self.assertTrue(info['constrained'])
        self.assertIn(info['constraint'],('clearance','radius','intersection'))
        baseline=protected.intersection(Polygon(g.sample_path(path,400)))
        self.assertTrue(Polygon(g.sample_path(result,400)).buffer(.004).covers(baseline))
        self.assertEqual(result[:3],path[:3]);self.assertEqual(result[5:],path[5:])

    def test_unsmoothed_junction_cannot_bypass_clearance_check(self):
        # Unlike a C1 junction, this used to skip whole-curve coverage and let
        # the boolean union invent a shelf between two visible anchors.
        path=[g.M(0,0),g.L(200,0),g.L(200,100),
              g.C(200,116,180,134,180,150),g.C(190,153,200,157,200,160),
              g.L(200,300),g.L(0,300),g.L(0,0),['h']]
        protected=box(15,15,195,110).union(box(15,180,200,285))
        result,info=g.edit_outline_anchor(path,'move',[180,150],[40,150],protected,radius=3,visible=True)
        self.assertTrue(info['constrained'])
        baseline=protected.intersection(Polygon(g.sample_path(path,400)))
        self.assertTrue(Polygon(g.sample_path(result,400)).buffer(.004).covers(baseline))
        self.assertEqual(result[:3],path[:3]);self.assertEqual(result[5:],path[5:])

    def test_visible_move_is_reversible_without_postprocessing_bends(self):
        path=[g.M(0,0),g.L(200,0),g.L(200,100),
              g.C(200,116,200,134,200,150),g.C(200,153,200,157,200,160),
              g.L(200,300),g.L(0,300),g.L(0,0),['h']]
        protected=box(15,15,180,90).union(box(15,180,180,285))
        current=path
        for _ in range(5):
            current,info=g.edit_outline_anchor(current,'move',[200,150],[198,150],protected,radius=3,visible=True)
            self.assertFalse(info['constrained'])
            current,_=g.edit_outline_anchor(current,'move',[198,150],[200,150],protected,radius=3,visible=True)
        for (_,a),(_,b) in zip(g.segments(path),g.segments(current)):
            np.testing.assert_allclose(a,b,atol=1e-9)
        self.assertEqual(len(path),len(current))

    def test_unrelated_tight_curve_does_not_block_drag(self):
        path=[g.M(0,0),g.L(200,0),g.L(200,100),
              g.C(200,116,200,134,200,150),g.C(200,153,200,157,200,160),
              g.L(200,300),g.L(2,300),g.C(.9,300,0,299.1,0,298),g.L(0,0),['h']]
        result,info=g.edit_outline_anchor(path,'move',[200,150],[198,150],box(15,15,180,285),radius=3,visible=True)
        self.assertFalse(info['constrained'])
        self.assertEqual(result[6:],path[6:])

    def test_visible_controls_do_not_depend_on_preview_envelope(self):
        # First activation and the first preview must expose identical anchors.
        points=[(100+90*np.cos(t),100+90*np.sin(t)) for t in np.linspace(0,2*np.pi,121)]
        path=[g.M(*points[0]),*[g.L(*p) for p in points[1:]],['h']]
        visible=g.visible_outline_controls(path)
        checked=g.visible_outline_controls(path,Polygon(points).buffer(-.01))
        self.assertEqual(visible,checked)
        self.assertLess(len(visible),len(path))
        self.assertLessEqual(LineString(g.sample_path(visible,300)).hausdorff_distance(LineString(points)),.04)

    def test_preview_commit_replay_share_visible_curve_and_gap(self):
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><path fill="none" stroke="black" d="M20 20H180V80H20Z"/></svg>'
        model=analyze_vector(svg,'visible.svg');settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        insert=dict(kind='anchor',action='insert',point=[80,-15],visibleContour=True)
        moved=dict(kind='anchor',action='move',point=[80,-15],target=[80,-20],visibleContour=True,fixedNeighbors=True,autoHandles=True)
        preview=g.build_geometry(model,{**settings,'outlineEdits':[insert],'outlinePreview':moved})
        committed=g.build_geometry(model,{**settings,'outlineEdits':[insert,moved]})
        self.assertEqual(preview['outer'],committed['outer'])
        self.assertEqual(preview['outer'],preview['outlineVisibleControls'])
        self.assertEqual(preview['outer'],preview['outlineControls'])
        self.assertGreaterEqual(preview['minGap'],14.99)
        import pdfplumber
        from export_pdf import make_pdf
        with pdfplumber.open(io.BytesIO(make_pdf(committed))) as pdf:
            outline=next(p for p in pdf.pages[0].curves if all(abs(c-17/255)<1e-5 for c in p['stroking_color']))
            self.assertAlmostEqual(outline['width']*25.4/72,committed['width'],delta=.03)
            self.assertAlmostEqual(outline['height']*25.4/72,committed['height'],delta=.03)
        # A subsequent inward drag is checked on the same curve and keeps
        # all unrelated endpoints fixed, including after reload/replay.
        stop=g.build_geometry(model,{**settings,'outlineEdits':[insert,moved], 'outlinePreview':{**moved,'point':[80,-20],'target':[80,20]}})
        self.assertTrue(stop['outlinePreview']['constrained'])
        self.assertEqual(stop['outer'],stop['outlineVisibleControls'])
        self.assertGreaterEqual(stop['minGap'],14.99)

if __name__=='__main__':unittest.main()
