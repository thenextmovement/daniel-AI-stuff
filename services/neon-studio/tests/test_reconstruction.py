"""Raster-only fixtures for structural strokes; never use production logo vectors."""
import io,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
import numpy as np
from PIL import Image,ImageDraw
from geometry import sample_path,segments
from shapely.geometry import LineString,Point,box
from shapely.ops import unary_union
from tracing import analyze_image
from reconstruction import cubic_fit


def shoulder(scale=1,angle=0):
    image=Image.new('RGB',(400*scale,400*scale),'white');d=ImageDraw.Draw(image)
    d.line([(90*scale,70*scale),(90*scale,320*scale)],fill='black',width=30*scale)
    t=np.linspace(0,1,100)[:,None]
    p=(1-t)**3*np.array([90,160])+3*(1-t)**2*t*np.array([90,105])+3*(1-t)*t*t*np.array([165,90])+t**3*np.array([220,90])
    band=LineString(p*scale).buffer(15*scale,cap_style=2)
    d.polygon(list(band.exterior.coords),fill='black')
    if angle:image=image.rotate(angle,resample=Image.Resampling.BICUBIC,fillcolor='white')
    b=io.BytesIO();image.save(b,'PNG');return b.getvalue()


class ReconstructionTests(unittest.TestCase):
    def test_curved_stroke_shares_the_terminal_of_its_stem(self):
        from centerlines import centerline_paths
        # A rounded, acute turn at a common cap. Its medial-axis junction is
        # below the cap even though the two drawn strokes start together.
        source=[[['m',[60,310]],['l',[50,50]]],
                [['m',[50,50]],['c',[85,145],[155,245],[210,260]],['c',[245,270],[236,120],[210,50]]]]
        ground=unary_union([LineString(sample_path(p,200)) for p in source])
        for scale,angle in ((1,0),(2,0),(1,17),(1,-32)):
            with self.subTest(scale=scale,angle=angle):
                shape=unary_union([LineString(np.array(sample_path(p,200))*scale).buffer(15*scale) for p in source])
                im=Image.new('L',(350*scale,350*scale));dr=ImageDraw.Draw(im)
                dr.polygon(list(shape.exterior.coords),fill=255)
                if angle:im=im.rotate(angle,resample=Image.Resampling.BICUBIC)
                from scipy import ndimage
                # The source is solid: remove subpixel holes introduced by
                # rotating its raster fixture, without changing its outline.
                mask=ndimage.binary_fill_holes(np.asarray(im)>127)
                paths,_,_=centerline_paths(mask)
                self.assertEqual(len(paths),2)
                stem=next(p for p in paths if [c[0] for c in p]==['m','l'])
                branch=next(p for p in paths if p is not stem)
                ends=np.array([stem[0][1],stem[-1][-1]])
                self.assertLess(min(np.linalg.norm(np.array(p)-ends,axis=1).min()
                                    for p in (branch[0][1],branch[-1][-1])),.02,
                                'A shared cap must become a shared endpoint, not an interior junction')
                a=np.deg2rad(angle);rot=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]])
                center=(350*scale-1)/2
                points=np.vstack([sample_path(p,200) for p in paths])
                normalized=((points-center)@rot.T+center)/scale
                # Free round caps can shift by a few raster pixels; the
                # shared endpoint itself must still agree exactly above.
                self.assertLess(max(ground.distance(Point(p)) for p in normalized),5)
                self.assertLessEqual(len(branch),8,'Fit a few smooth curves, not pixel segments')
                self.assertGreater(ndimage.map_coordinates(mask.astype(float),[points[:,1],points[:,0]],order=1).mean(),.99)

    def test_straight_branches_remain_connected_after_stem_merge(self):
        from centerlines import centerline_paths
        source=[[['m',[50,300]],['c',[60,210],[55,140],[40,60]]],
                [['m',[50,110]],['l',[120,220]],['l',[175,110]]],
                [['m',[190,300]],['l',[175,40]]]]
        shape=unary_union([LineString(sample_path(p,150)).buffer(12) for p in source])
        im=Image.new('L',(350,350));dr=ImageDraw.Draw(im)
        dr.polygon(list(shape.exterior.coords),fill=255)
        for hole in shape.interiors:dr.polygon(list(hole.coords),fill=0)
        paths,_,_=centerline_paths(np.asarray(im)>127)
        actual=unary_union([LineString(sample_path(p,200)) for p in paths])
        self.assertEqual(actual.buffer(.1).geom_type,'Polygon','Merged stems must retain their straight branches')

    def test_tiny_branch_keeps_its_existing_route(self):
        from centerlines import branch_into_stem
        q=np.column_stack([np.arange(5.,25.),np.arange(5.,25.)])
        mask=np.ones((32,32),dtype=bool)
        stem=[['m',[5,2]],['l',[5,29]]]
        self.assertIsNone(branch_into_stem(q,1,stem,mask,0))

    def test_wide_branch_joins_stem_in_its_own_direction(self):
        from centerlines import centerline_paths
        source=[[['m',[62,310]],['c',[55,230],[68,120],[42,55]]],
                [['m',[50,90]],['c',[105,145],[155,245],[210,260]],['c',[245,270],[236,120],[210,50]]]]
        for scale,angle in ((1,0),(2,0),(1,17)):
            with self.subTest(scale=scale,angle=angle):
                shape=unary_union([LineString(np.array(sample_path(p,150))*scale).buffer(15*scale) for p in source])
                im=Image.new('L',(350*scale,350*scale));dr=ImageDraw.Draw(im)
                dr.polygon(list(shape.exterior.coords),fill=255)
                if angle:im=im.rotate(angle,resample=Image.Resampling.BICUBIC)
                paths,_,_=centerline_paths(np.asarray(im)>127)
                self.assertEqual(len(paths),2)
                stem=next(p for p in paths if [c[0] for c in p]==['m','l'])
                branch=next(p for p in paths if p is not stem)
                stem_line=LineString(sample_path(stem,100))
                joint=min((branch[0][1],branch[-1][-1]),key=lambda p:stem_line.distance(Point(p)))
                a=np.deg2rad(angle);rot=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]])
                center=(350*scale-1)/2
                point=((np.array(joint)-center)@rot.T+center)/scale
                self.assertLess(np.linalg.norm(point-[50,90]),16,'Do not bend the branch sideways into a low skeleton junction')
                self.assertLess(stem_line.distance(Point(joint)),.02)

    def test_bowl_with_spaced_branch_preserves_one_continuous_stem(self):
        from centerlines import centerline_paths
        # Slightly uneven hand-drawn stem, with a bowl and a separate side arm.
        # No glyph/template recognition: only rasterized, constructed strokes.
        source=[[['m',[90,310]],['c',[90,250],[84,180],[72,110]],['l',[60,50]]],
                [['m',[60,50]],['c',[55,20],[160,40],[165,70]],['c',[170,110],[130,150],[82,180]]],
                [['m',[87,215]],['l',[170,245]]]]
        for scale,angle in ((1,0),(2,0),(1,17)):
            with self.subTest(scale=scale,angle=angle):
                shape=unary_union([LineString(np.array(sample_path(p,150))*scale).buffer(15*scale) for p in source])
                im=Image.new('L',(350*scale,350*scale));dr=ImageDraw.Draw(im)
                dr.polygon(list(shape.exterior.coords),fill=255)
                for hole in shape.interiors:dr.polygon(list(hole.coords),fill=0)
                if angle:im=im.rotate(angle,resample=Image.Resampling.BICUBIC)
                paths,_,_=centerline_paths(np.asarray(im)>127)
                self.assertEqual(len(paths),3,'Stem, open bowl, and side arm')
                self.assertTrue(all(p[-1][0]!='h' for p in paths),'The stem side must not remain in a closed bowl')
                lines=[p for p in paths if [c[0] for c in p]==['m','l']]
                self.assertEqual(len(lines),2)
                stem=max(lines,key=lambda p:np.linalg.norm(np.array(p[0][1])-p[1][1]))
                self.assertGreater(np.linalg.norm(np.array(stem[0][1])-stem[1][1])/scale,235)
                actual=[LineString(sample_path(p,200)) for p in paths]
                self.assertEqual(unary_union(actual).buffer(.1).geom_type,'Polygon','All three strokes must stay connected')
                from scipy import ndimage
                samples=np.vstack([np.array(line.coords) for line in actual])
                ink=ndimage.map_coordinates((np.asarray(im)>127).astype(float),[samples[:,1],samples[:,0]],order=1)
                self.assertGreater(ink.mean(),.99,'No stroke may shortcut outside the original ink')

    def test_small_open_arc_angular_stroke_and_stem_bowl(self):
        angles=np.deg2rad(np.linspace(-65,245,100))
        arc=np.column_stack([31+15*np.cos(angles),31+22*np.sin(angles)])
        bowl=[['m',[17,10]],['l',[30,10]],['c',[52,10],[52,32],[30,32]],['l',[17,32]]]
        shapes={'arc':[arc], 'angular':[np.array([[17,54],[17,10],[44,54],[44,10]])],
                'stem-bowl':[np.array([[17,10],[17,54]]),np.array(sample_path(bowl,100))]}
        for name,strokes in shapes.items():
            ground=unary_union([LineString(q) for q in strokes])
            for scale,angle in ((1,0),(2,0),(1,17)):
                with self.subTest(shape=name,scale=scale,angle=angle):
                    im=Image.new('L',(80*scale,80*scale));dr=ImageDraw.Draw(im)
                    for q in strokes:
                        band=LineString(q*scale).buffer(3*scale,cap_style=2,join_style=1)
                        if name=='angular':band=band.intersection(box(0,10*scale,80*scale,54*scale))
                        dr.polygon(list(band.exterior.coords),fill=255)
                    if angle:im=im.rotate(angle,resample=Image.Resampling.BICUBIC)
                    raw=io.BytesIO();im.save(raw,'PNG')
                    paths=[p['commands'] for p in analyze_image(raw.getvalue())['modes']['single']]
                    self.assertEqual(len(paths),2 if name=='stem-bowl' else 1,'No spurious branches or missing bowl')
                    if name=='angular':self.assertEqual([c[0] for c in paths[0]],['m','l','l','l'])
                    if name=='stem-bowl':
                        stems=[p for p in paths if [c[0] for c in p]==['m','l']]
                        self.assertEqual(len(stems),1,'One continuous straight stem')
                        # The 44 px source includes a half-stroke inset at caps.
                        self.assertGreater(np.linalg.norm(np.array(stems[0][0][1])-stems[0][1][1])/scale,37)
                    if name!='angular':self.assertTrue(any(c[0]=='c' for p in paths for c in p),'Real curves must remain')
                    radians=np.deg2rad(angle);rot=np.array([[np.cos(radians),-np.sin(radians)],[np.sin(radians),np.cos(radians)]])
                    center=(80*scale-1)/2
                    lines=[LineString(((np.array(sample_path(p,160))-center)@rot.T+center)/scale) for p in paths]
                    self.assertLess(max(ground.distance(Point(p)) for line in lines for p in line.coords),2.25)
                    if name=='stem-bowl':self.assertLess(lines[0].distance(lines[1]),.02)

    def test_long_outline_edges_do_not_bow_from_raster_corner_tangents(self):
        from reconstruction import fit_boundary
        # Opposite endpoints can sit on alternate sides of a pixel staircase.
        edge=np.column_stack([np.r_[.5,np.zeros(98),0.],np.arange(100.)])
        path=fit_boundary(edge,1.2)
        self.assertEqual([c[0] for c in path],['m','l'])
        curved=edge.copy();curved[:,0]+=8*np.sin(np.linspace(0,np.pi,len(edge)))
        curve=fit_boundary(curved,1.2)
        self.assertTrue(any(c[0]=='c' for c in curve),'A real bend must remain curved')

    def test_branched_straight_strokes_ignore_flat_cap_skeleton_bends(self):
        source=[[(90,60),(90,330)],[(90,255),(260,105)],[(177,178),(270,330)]]
        ground=unary_union([LineString(p) for p in source])
        for scale,angle in ((1,0),(2,0),(1,17)):
            with self.subTest(scale=scale,angle=angle):
                im=Image.new('RGB',(400*scale,400*scale),'white');dr=ImageDraw.Draw(im)
                for points in source:
                    band=LineString(np.array(points)*scale).buffer(14*scale,cap_style=3)
                    # Horizontal caps on oblique strokes distort their pixel skeleton.
                    top=points[-1][1] if points[-1][1]<points[0][1] else 60
                    band=band.intersection(box(0,top*scale,400*scale,330*scale))
                    dr.polygon(list(band.exterior.coords),fill='black')
                if angle:im=im.rotate(angle,resample=Image.Resampling.BICUBIC,fillcolor='white')
                raw=io.BytesIO();im.save(raw,'PNG');paths=analyze_image(raw.getvalue())['modes']['single']
                self.assertEqual(len(paths),3,'Continue each straight stroke through its branch')
                a=np.deg2rad(angle);rot=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]])
                lines=[]
                for path in paths:
                    self.assertEqual([c[0] for c in path['commands']],['m','l'])
                    points=(np.array(sample_path(path['commands'],100))/scale-199.5)@rot.T+199.5
                    self.assertLess(max(ground.distance(Point(p)) for p in points),3)
                    lines.append(LineString(points))
                shape=unary_union(lines)
                for p in ((90,100),(90,300),(140,211),(230,131),(230,265)):
                    self.assertLess(shape.distance(Point(p)),3,'A stroke is missing or off center')
                self.assertEqual(sum(a.distance(b)<.02 for i,a in enumerate(lines) for b in lines[i+1:]),2)

    def test_short_loop_tail_is_preserved_in_two_continuous_routes(self):
        source=[[['m',[80,110]],['c',[110,60],[240,70],[240,150]],['l',[240,320]]],
                [['m',[240,185]],['c',[210,185],[70,175],[70,250]],['c',[70,325],[180,335],[240,280]]]]
        for scale,angle in ((1,0),(2,0),(1,17)):
            with self.subTest(scale=scale,angle=angle):
                im=Image.new('RGB',(400*scale,400*scale),'white');dr=ImageDraw.Draw(im)
                for path in source:
                    polygon=LineString(np.array(sample_path(path,100))*scale).buffer(14*scale,cap_style=2)
                    dr.polygon(list(polygon.exterior.coords),fill='black')
                if angle:im=im.rotate(angle,resample=Image.Resampling.BICUBIC,fillcolor='white')
                raw=io.BytesIO();im.save(raw,'PNG');m=analyze_image(raw.getvalue())
                paths=m['modes']['single'];self.assertEqual(len(paths),2)
                self.assertTrue(all(p['commands'][-1][0]!='h' for p in paths))
                a=np.deg2rad(angle);rot=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]])
                lines=[LineString((np.array(sample_path(p['commands'],200))/scale-199.5)@rot.T+199.5) for p in paths]
                shape=unary_union(lines)
                self.assertLess(shape.distance(Point(240,306)),3,'The short tail was lost')
                for y in (170,210,260):self.assertLess(shape.distance(Point(240,y)),3)
                self.assertLess(lines[0].distance(lines[1]),.02,'Bowl and stem must connect')
                self.assertLessEqual(sum(len(p['commands'])-1 for p in paths),12)

    def test_arch_has_tangent_continuity_and_tracks_source_center(self):
        source=[['m',[90,310]],['l',[90,170]],['c',[90,70],[260,70],[260,170]],['l',[260,310]]]
        im=Image.new('RGB',(400,400),'white');dr=ImageDraw.Draw(im)
        band=LineString(sample_path(source,150)).buffer(14,cap_style=2)
        dr.polygon(list(band.exterior.coords),fill='black')
        raw=io.BytesIO();im.save(raw,'PNG');m=analyze_image(raw.getvalue())
        paths=m['modes']['single'];self.assertEqual(len(paths),1)
        pieces=list(segments(paths[0]['commands']))
        self.assertLessEqual(len(pieces),5)
        for (_,a),(_,b) in zip(pieces,pieces[1:]):
            va=a[-1]-a[-2];vb=b[1]-b[0]
            self.assertGreater(va@vb/np.linalg.norm(va)/np.linalg.norm(vb),.999)
        ground=LineString(sample_path(source,300))
        self.assertLess(max(ground.distance(Point(p)) for p in sample_path(paths[0]['commands'],200)),3)

    def test_shoulder_preserves_full_straight_stem(self):
        for scale,angle in ((1,0),(2,0),(1,17)):
            with self.subTest(scale=scale,angle=angle):
                m=analyze_image(shoulder(scale,angle));self.assertEqual(m['sourceKind'],'trace')
                a=np.deg2rad(angle);rot=np.array([[np.cos(a),-np.sin(a)],[np.sin(a),np.cos(a)]])
                linepieces=[];curves=0
                for item in m['modes']['single']:
                    for op,p in segments(item['commands']):
                        if op=='c':curves+=1;continue
                        p=(p/scale-199.5)@rot.T+199.5
                        if abs(p[0,0]-90)<3 and abs(p[1,0]-90)<3:linepieces.append(p)
                self.assertTrue(linepieces,'No straight stem reconstructed')
                p=np.concatenate(linepieces)
                self.assertLess(p[:,1].min(),96)
                self.assertGreater(p[:,1].max(),295)
                self.assertGreater(curves,0,'A curved shoulder must not be straightened')
                self.assertLessEqual(curves,6)

    def test_cubic_run_uses_few_smooth_segments(self):
        t=np.linspace(0,1,140)[:,None]
        source=(1-t)**3*np.array([0,100])+3*(1-t)**2*t*np.array([0,25])+3*(1-t)*t*t*np.array([75,0])+t**3*np.array([130,0])
        fitted=cubic_fit(source,1,[0,-1],[-1,0])
        self.assertLessEqual(len(fitted),3)
        for (oa,a),(ob,b) in zip(list(segments(fitted)),list(segments(fitted))[1:]):
            va=a[-1]-a[-2];vb=b[1]-b[0]
            self.assertGreater(va@vb/np.linalg.norm(va)/np.linalg.norm(vb),.999)

if __name__=='__main__':unittest.main()
