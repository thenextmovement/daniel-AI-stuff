"""Editable contours must stay simple without sacrificing the protected envelope."""
import sys
import io
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import geometry as g
from shapely.geometry import LineString, Polygon, box
from vector_import import analyze_vector

SVG=b'<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><path fill="none" stroke="black" d="M20 20H180V80H20Z"/></svg>'

class SparseOutlineTests(unittest.TestCase):
    def test_drag_keeps_short_curve_neighbours_fixed(self):
        path=[g.M(0,0),g.L(200,0),g.L(200,100),
              g.C(200,116,200,134,200,150),g.C(200,153,200,157,200,160),
              g.L(200,300),g.L(0,300),g.L(0,0),['h']]
        protected=box(15,15,200,100).union(box(15,180,200,285))
        result,info=g.edit_outline_anchor(path,'move',[200,150],[170,150],protected,radius=3)
        self.assertFalse(info['constrained'])
        self.assertEqual(info['point'],[170,150])
        self.assertEqual(result[:3],path[:3])
        self.assertEqual(result[5:],path[5:])
        self.assertEqual(result[3],['c',[200,116],[170,134],[170,150]])
        self.assertEqual(result[4],['c',[170,153],[200,157],[200,160]])
        self.assertTrue(Polygon(g.sample_path(result,400)).buffer(.003).covers(protected))
        rounded=g.rounded_editable_outline(result,protected,3)
        self.assertTrue(Polygon(g.sample_path(rounded,400)).buffer(.001).covers(protected))
        # Old operations retain their original group movement when replayed.
        _,legacy=g.edit_outline_anchor(path,'move',[200,150],[170,150],protected,radius=3,fixed_neighbors=False)
        self.assertTrue(legacy['constrained'])
        self.assertGreater(legacy['point'][0],199)

    def test_delete_whole_notch_across_closed_seam(self):
        # The rectangle selects a complete indentation, including the start/end
        # of the closed path. Validate the final bridge, not intermediate deletes.
        points=[[130,150],[180,149],[190,145],[190,130],[200,130],
                [200,0],[0,0],[0,300],[200,300],[200,170],
                [198,168],[192,168],[190,160],[185,153],[130,151]]
        path=[g.M(*points[0])]+[g.L(*p) for p in points[1:]]+[['h']]
        selected=points[:5]+points[9:]
        protected=box(15,15,200,115).union(box(15,185,200,285))
        result,_=g.edit_outline_anchor(path,'delete',selected[0],selected[0],protected,delete_points=selected)
        self.assertEqual(len(list(g.segments(result))),4)
        self.assertTrue(Polygon(g.sample_path(result)).equals(box(0,0,200,300)))
        rounded=g.rounded_editable_outline(result,protected,3)
        self.assertTrue(Polygon(g.sample_path(rounded,400)).buffer(.001).covers(protected))

    def test_delete_separate_runs_retains_unselected_edges(self):
        points=[[0,0],[30,0],[60,0],[100,0],[100,100],[60,100],[30,100],[0,100]]
        path=[g.M(*points[0])]+[g.L(*p) for p in points[1:]]+[['h']]
        selected=[points[i] for i in (1,2,5,6)]
        result,_=g.edit_outline_anchor(path,'delete',selected[0],selected[0],box(10,10,90,90),delete_points=selected)
        self.assertEqual(len(list(g.segments(result))),4)
        self.assertTrue(Polygon(g.sample_path(result)).equals(box(0,0,100,100)))
        with self.assertRaisesRegex(ValueError,'vier Konturpunkte'):
            g.edit_outline_anchor(path,'delete',points[0],points[0],box(10,10,90,90),delete_points=points[:5])

    def test_batch_delete_does_not_cut_into_protected_neon(self):
        points=[[0,0],[100,0],[200,0],[200,50],[200,100],[100,100],[0,100],[0,50]]
        path=[g.M(*points[0])]+[g.L(*p) for p in points[1:]]+[['h']]
        with self.assertRaisesRegex(ValueError,'Randabstand'):
            g.edit_outline_anchor(path,'delete',points[2],points[2],box(10,10,190,90),delete_points=points[2:4])

    def test_batch_delete_uses_safe_curve_when_chord_clips_clearance(self):
        points=[[0,0],[200,0],[200,100],[170,100],[160,105],[140,110],
                [120,107],[100,110],[80,116],[60,114],[40,112],[0,110]]
        selected=points[4:11]
        protected=box(20,20,160,104)
        # Test both winding directions and a removed run across the closing seam.
        for ordered in (points,list(reversed(points)),points[7:]+points[:7]):
            with self.subTest(start=ordered[0],next=ordered[1]):
                path=[g.M(*ordered[0])]+[g.L(*p) for p in ordered[1:]]+[['h']]
                result,_=g.edit_outline_anchor(path,'delete',selected[0],selected[0],protected,
                                              delete_points=selected,visible=True)
                parts=list(g.segments(result));poly=Polygon(g.sample_path(result,400))
                self.assertEqual(len(parts),len(points)-len(selected))
                self.assertEqual(sum(op=='c' for op,_ in parts),1)
                self.assertTrue(poly.is_valid)
                self.assertTrue(poly.buffer(.006).covers(protected))
                self.assertEqual({tuple(p[0]) for _,p in parts},
                                 {tuple(p) for p in points if p not in selected})
                # Every edge outside the selected run stays byte-for-byte intact.
                for op,p in parts:
                    if op=='l':
                        self.assertTrue(any(old_op==op and np.array_equal(old,p)
                                            for old_op,old in g.segments(path)))
                rounded=g.rounded_editable_outline(result,protected,3)
                self.assertTrue(Polygon(g.sample_path(rounded,400)).buffer(.001).covers(protected))

    def test_batch_preview_replays_and_scales_as_one_edit(self):
        model=analyze_vector(SVG,'anchors.svg')
        settings=dict(shape='rectangle',scale=2,gap=15,radius=3)
        points=[[40,-7.5],[80,-7.5],[120,-7.5]]
        edits=[dict(kind='anchor',action='insert',point=p) for p in points]
        delete=dict(kind='anchor',action='delete',point=points[0],points=points)
        before=g.build_geometry(model,{**settings,'outlineEdits':edits})
        preview=g.build_geometry(model,{**settings,'outlineEdits':edits,'outlinePreview':delete})
        applied=g.build_geometry(model,{**settings,'outlineEdits':edits+[delete]})
        self.assertEqual(preview['outer'],applied['outer'])
        self.assertEqual(preview['outlineControls'],applied['outlineControls'])
        self.assertEqual(len(preview['outlineControls']),len(before['outlineControls'])-3)
        self.assertEqual(preview['paths'],before['paths'])
        self.assertEqual(preview['neonMeters'],before['neonMeters'])
        self.assertGreaterEqual(preview['minGap'],14.99)
        resized=g.build_geometry(model,{**settings,'scale':4,'outlineEdits':edits+[delete]})
        self.assertTrue(resized['exportable'])
        self.assertGreaterEqual(resized['minGap'],14.99)

    def test_smooth_bend_needs_only_two_endpoints(self):
        points=g.sample_path([g.M(0,0),g.C(0,100,100,0,100,100)],200)
        fitted=g.fit_curve(points,.3,refine=True)
        self.assertEqual(len(fitted),2)
        self.assertLess(LineString(points).hausdorff_distance(LineString(g.sample_path(fitted,400))),.3)

    def test_round_contour_has_few_editable_anchors(self):
        # Sampling density must not determine the number of user controls.
        theta=np.linspace(0,2*np.pi,401)
        ring=[g.M(50,0)]+[g.L(50*np.cos(t),50*np.sin(t)) for t in theta[1:]]+[['h']]
        self.assertTrue(hasattr(g,'compact_outline'),'A sparse curve representation is required')
        compact=g.compact_outline(ring)
        self.assertLess(len(compact),18)
        self.assertTrue(any(c[0]=='c' for c in compact))
        self.assertLess(LineString(g.sample_path(compact,300)).hausdorff_distance(LineString(g.sample_path(ring))),.2)

    def test_insert_then_delete_on_straight_edge_preserves_shape(self):
        model=analyze_vector(SVG,'anchors.svg');settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        base=g.build_geometry(model,settings)
        self.assertIn('outlineControls',base)
        # Top of the 190 x 90 mm plate, in its fixed motif coordinate system.
        added=g.build_geometry(model,{**settings,'outlineEdits':[dict(kind='anchor',action='insert',point=[80,-15])]})
        self.assertEqual(len(added['outlineControls']),len(base['outlineControls'])+1)
        self.assertEqual(added['outer'],base['outer'])
        removed=g.build_geometry(model,{**settings,'outlineEdits':[
            dict(kind='anchor',action='insert',point=[80,-15]),
            dict(kind='anchor',action='delete',point=[80,-15])]})
        self.assertEqual(len(removed['outlineControls']),len(base['outlineControls']))
        self.assertLess(Polygon(g.sample_path(removed['outer'],300)).hausdorff_distance(Polygon(g.sample_path(base['outer'],300))),.2)
        self.assertEqual(removed['paths'],base['paths'])
        self.assertEqual(removed['neonMeters'],base['neonMeters'])

    def test_insert_after_move_does_not_refit_the_visible_contour(self):
        model=analyze_vector(SVG,'anchors.svg');settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        edits=[dict(kind='anchor',action='insert',point=[80,-15]),dict(kind='anchor',action='move',point=[80,-15],target=[80,-25])]
        before=g.build_geometry(model,{**settings,'outlineEdits':edits})
        after=g.build_geometry(model,{**settings,'outlineEdits':edits+[dict(kind='anchor',action='insert',point=[175,30])]})
        self.assertEqual(after['outer'],before['outer'])
        self.assertEqual(len(after['outlineControls']),len(before['outlineControls'])+1)

    def test_inward_drag_stops_at_clearance_and_keeps_axis(self):
        model=analyze_vector(SVG,'anchors.svg');settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        base=g.build_geometry(model,settings)
        self.assertIn('outlineControls',base)
        # Insert a control in a straight edge, then try pulling it through neon.
        edits=[dict(kind='anchor',action='insert',point=[80,-15])]
        moved=g.build_geometry(model,{**settings,'outlineEdits':edits,'outlinePreview':dict(kind='anchor',action='move',point=[80,-15],target=[80,30])})
        self.assertTrue(moved['outlinePreview']['constrained'])
        self.assertAlmostEqual(moved['outlinePreview']['point'][0],80,places=5)
        poly=Polygon(g.sample_path(moved['outer'],500))
        self.assertTrue(poly.is_valid)
        for p in moved['paths']:
            self.assertGreaterEqual(poly.exterior.distance(LineString(g.sample_path(p,500))),14.99)
        self.assertEqual(moved['paths'],base['paths'])
        self.assertEqual(moved['neonMeters'],base['neonMeters'])

    def test_delete_redundant_point_after_automatic_clearance_repair(self):
        # A moved cage may cross the envelope; its displayed contour is repaired.
        # Removing a collinear insertion must not reject that pre-existing overlap.
        cage=[g.M(0,0),g.L(200,0),g.L(200,100),g.L(100,100),g.L(0,100),g.L(0,0),['h']]
        protected=box(20,20,180,103)
        result,_=g.edit_outline_anchor(cage,'delete',[100,100],[100,100],protected)
        self.assertEqual(len(result),len(cage)-1)
        self.assertLess(Polygon(g.sample_path(result)).hausdorff_distance(Polygon(g.sample_path(cage))),1e-8)
        final=g.rounded_editable_outline(result,protected,3)
        self.assertTrue(Polygon(g.sample_path(final,400)).buffer(.001).covers(protected))

    def test_lift_corner_makes_long_edge_horizontal(self):
        path=[g.M(0,0),g.L(350,0),g.C(400,0,400,200,350,200),g.L(300,200),
              g.C(280,200,280,140,260,140),g.L(20,100),g.C(0,100,0,70,0,50),g.L(0,0),['h']]
        protected=box(25,20,250,80)
        result,info=g.edit_outline_anchor(path,'move',[260,140],[260,100],protected)
        self.assertEqual(info['point'],[260,100])
        self.assertFalse(info['constrained'])
        self.assertTrue(any(op=='l' and abs(p[0,1]-100)<.001 and abs(p[-1,1]-100)<.001
                            and np.linalg.norm(p[-1]-p[0])>200 for op,p in g.segments(result)))
        final=g.rounded_editable_outline(result,protected,3)
        self.assertTrue(Polygon(g.sample_path(final,400)).covers(protected))

    def test_inserted_edge_point_makes_one_smooth_local_bend(self):
        # Two neon sections flank a free gap in a long straight plate edge.
        # Moving the inserted point must not cut diagonally through either one
        # and rely on a boolean union to invent hidden stair-step corners.
        path=[g.M(0,0),g.L(200,0),g.L(200,150),g.L(200,300),g.L(0,300),g.L(0,0),['h']]
        protected=box(20,10,200,110).union(box(20,190,200,290))
        result,info=g.edit_outline_anchor(path,'move',[200,150],[150,150],protected,radius=3)
        self.assertTrue(info['constrained'])
        self.assertLess(info['point'][0],190)  # Still a useful inward edit.
        self.assertEqual(info['point'][1],150)  # Shift keeps its axis.
        self.assertTrue(Polygon(g.sample_path(result,400)).buffer(.003).covers(protected))
        curves=[pts for op,pts in g.segments(result) if op=='c']
        self.assertEqual(len(curves),2)
        self.assertTrue(np.allclose(curves[0][-1],curves[1][0]))
        for pts in curves:
            self.assertAlmostEqual(pts[1,0],pts[0,0])
            self.assertAlmostEqual(pts[-2,0],pts[-1,0])
        # A second drag cannot make the two curved flanks cross the envelope.
        again,_=g.edit_outline_anchor(result,'move',info['point'],[100,150],protected,radius=3)
        self.assertTrue(Polygon(g.sample_path(again,400)).buffer(.003).covers(protected))

    def test_preview_apply_and_pdf_use_same_contour(self):
        import pdfplumber
        from export_pdf import make_pdf
        model=analyze_vector(SVG,'anchors.svg');settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        edits=[dict(kind='anchor',action='insert',point=[80,-15])]
        move=dict(kind='anchor',action='move',point=[80,-15],target=[80,-25],fixedNeighbors=True)
        preview=g.build_geometry(model,{**settings,'outlineEdits':edits,'outlinePreview':move})
        applied=g.build_geometry(model,{**settings,'outlineEdits':edits+[move]})
        self.assertEqual(preview['outer'],applied['outer'])
        self.assertEqual(preview['outlineControls'],applied['outlineControls'])
        with pdfplumber.open(io.BytesIO(make_pdf(applied))) as pdf:
            shapes=pdf.pages[0].curves+pdf.pages[0].lines
            outline=next(s for s in shapes if all(abs(c-17/255)<1e-5 for c in s['stroking_color']))
            self.assertAlmostEqual(outline['width']*25.4/72,applied['width'],delta=.03)
            self.assertAlmostEqual(outline['height']*25.4/72,applied['height'],delta=.03)

    def test_outward_move_replays_after_resize_and_settings_changes(self):
        model=analyze_vector(SVG,'anchors.svg');settings=dict(shape='rectangle',scale=1,gap=15,radius=3)
        self.assertIn('outlineControls',g.build_geometry(model,settings))
        edits=[dict(kind='anchor',action='insert',point=[80,-15]),dict(kind='anchor',action='move',point=[80,-15],target=[80,-25])]
        for change in ({},{'scale':2},{'gap':20},{'radius':8}):
            with self.subTest(change=change):
                result=g.build_geometry(model,{**settings,**change,'outlineEdits':edits})
                plain=g.build_geometry(model,{**settings,**change})
                self.assertTrue(result['exportable'])
                self.assertNotEqual(result['outer'],plain['outer'])
                self.assertEqual(result['paths'],plain['paths'])
                self.assertGreaterEqual(result['minGap'],change.get('gap',15)-.01)

if __name__=='__main__':unittest.main()
