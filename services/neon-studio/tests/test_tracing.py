"""Quality regressions use fresh raster pixels, not logo names or saved paths."""
import io
import sys
import unittest
from pathlib import Path
import math
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import server
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Point
from tracing import analyze_image
from geometry import sample_path


def raster(strokes, rotate=0):
    image=Image.new('RGB',(400,400),'white');draw=ImageDraw.Draw(image)
    for points in strokes:
        draw.line(points,fill='black',width=32,joint='curve')
    if rotate:image=image.rotate(rotate,resample=Image.Resampling.BICUBIC,fillcolor='white')
    raw=io.BytesIO();image.save(raw,'PNG')
    return raw.getvalue()


class TraceQualityTests(unittest.TestCase):
    def test_enclosed_color_fill_keeps_frame_and_inner_mark(self):
        from tracing import _mask, prepare_image, selected_image
        from scipy import ndimage
        for rim, fill in (((245,245,245),(25,155,55)), ((20,30,80),(230,165,40))):
            for background in ((0,0,0,0), (100,100,100,255)):
                with self.subTest(rim=rim,background=background):
                    im=Image.new('RGBA',(300,300),background);dr=ImageDraw.Draw(im)
                    dr.ellipse((30,30,270,270),fill=(*rim,255))
                    dr.ellipse((55,55,245,245),fill=(*fill,255))
                    dr.arc((90,90,210,210),30,210,fill=(*rim,255),width=18)
                    # A colour gradient must remain one interior, not many bands.
                    rgba=np.array(im)
                    inside=np.all(rgba[:,:,:3]==fill,axis=2)
                    variation=np.linspace(-15,15,300)[:,None,None]
                    shaded=np.clip(rgba[:,:,:3].astype(float)+variation,0,255).astype('uint8')
                    rgba[inside,:3]=shaded[inside]
                    im=Image.fromarray(rgba)
                    mask,_=_mask(im)
                    self.assertFalse(mask[150,150])
                    self.assertTrue(mask[40,150])
                    self.assertTrue(mask[200,150])
                    self.assertEqual(ndimage.label(mask)[1],2)
                    raw=io.BytesIO();im.save(raw,'PNG')
                    image,labels,preview=prepare_image(raw.getvalue())
                    selected=selected_image(image,labels,[p['id'] for p in preview['parts']])
                    # Preparing/selecting an upload must not erase the recovered details.
                    after,_=_mask(Image.open(io.BytesIO(selected)))
                    np.testing.assert_array_equal(mask,after)
                    model=analyze_image(selected)
                    self.assertEqual(len(model['modes']['single']),2)
                    self.assertEqual(len(model['modes']['double']),3)
                    self.assertTrue(all(p['method']=='centerline' for p in model['modes']['single']))

    def test_adjacent_colors_and_gradients_do_not_create_interior_cuts(self):
        from tracing import _mask
        im=Image.new('RGBA',(300,300));dr=ImageDraw.Draw(im)
        dr.rectangle((50,50,250,250),fill=(250,250,250,255))
        dr.rectangle((150,50,250,250),fill=(10,160,70,255))
        mask,_=_mask(im)
        self.assertEqual(int(mask.sum()),201*201)
        rgba=np.array(im)
        rgba[50:251,50:251,:3]=np.linspace((240,240,240),(10,160,70),201).astype('uint8')[None,:,:]
        gradient,_=_mask(Image.fromarray(rgba))
        np.testing.assert_array_equal(mask,gradient)

    def test_bright_logo_is_separated_from_textured_lighting(self):
        from tracing import _mask
        y,x=np.mgrid[:300,:600]
        glow=75*np.exp(-((x-570)**2+(y-30)**2)/15000)
        texture=3*np.sin(x*.3)*np.cos(y*.4)
        gray=np.clip(25+glow+texture,0,255).astype('uint8')
        im=Image.fromarray(np.repeat(gray[:,:,None],3,axis=2))
        dr=ImageDraw.Draw(im)
        dr.rectangle((80,120,110,210),fill='white')
        dr.rectangle((400,120,430,210),fill='white')
        mask,rect=_mask(im)
        self.assertEqual(rect,[80,120,431,211])
        self.assertEqual(int(mask.sum()),2*31*91)

    def test_flat_background_preserves_different_logo_colors(self):
        from tracing import _mask
        im=Image.new('RGB',(600,300),(20,20,20));dr=ImageDraw.Draw(im)
        dr.rectangle((80,120,110,210),fill=(90,20,20))
        dr.rectangle((400,120,430,210),fill='white')
        mask,rect=_mask(im)
        self.assertEqual(rect,[80,120,431,211])
        self.assertEqual(int(mask.sum()),2*31*91)

    def test_angular_strokes_do_not_grow_spurs_or_bend(self):
        fixtures=[[(85,310),(85,80),(285,310),(285,80)],
                  [(75,80),(185,310),(305,80)],
                  [(75,310),(190,80),(305,310)]]
        for points in fixtures:
            for angle in (0,17):
                with self.subTest(points=points,angle=angle):
                    model=analyze_image(raster([points],angle))
                    paths=model['modes']['single']
                    self.assertEqual(model['sourceKind'],'trace')
                    self.assertEqual(len(paths),1)
                    a=math.radians(angle)
                    ground=[]
                    for x,y in points:
                        x-=199.5;y-=199.5
                        ground.append((199.5+x*math.cos(a)+y*math.sin(a),199.5-x*math.sin(a)+y*math.cos(a)))
                    actual=LineString(sample_path(paths[0]['commands'],100))
                    self.assertLess(max(LineString(ground).distance(Point(p)) for p in actual.coords),4)
                    self.assertLess(actual.hausdorff_distance(LineString(ground)),22)
                    self.assertLessEqual(len(paths[0]['commands']),5)

    def test_solid_slender_bar_remains_single_open_line(self):
        im=Image.new('RGB',(200,400),'white');ImageDraw.Draw(im).rectangle((80,50,115,350),fill='black')
        raw=io.BytesIO();im.save(raw,'PNG');m=analyze_image(raw.getvalue())
        p=m['modes']['single'];self.assertEqual(len(p),1)
        self.assertEqual(p[0]['method'],'centerline')
        self.assertEqual([c[0] for c in p[0]['commands']],['m','l'])

    def test_closed_ring_is_a_smooth_closed_centerline(self):
        image=Image.new('RGB',(400,400),'white');draw=ImageDraw.Draw(image)
        draw.ellipse((60,60,340,340),fill='black');draw.ellipse((100,100,300,300),fill='white')
        raw=io.BytesIO();image.save(raw,'PNG');model=analyze_image(raw.getvalue())
        paths=model['modes']['single'];self.assertEqual(len(paths),1)
        self.assertEqual(paths[0]['commands'][-1][0],'h')
        self.assertLessEqual(len(paths[0]['commands']),7)
        points=np.array(sample_path(paths[0]['commands'],100))
        self.assertLess(np.max(abs(np.linalg.norm(points-[200,200],axis=1)-120)),2)

    def test_open_round_stroke_does_not_become_a_polygon(self):
        image=Image.new('RGB',(400,400),'white')
        ImageDraw.Draw(image).arc((60,60,340,340),0,180,fill='black',width=24)
        raw=io.BytesIO();image.save(raw,'PNG');model=analyze_image(raw.getvalue())
        paths=model['modes']['single'];self.assertEqual(len(paths),1)
        self.assertTrue(any(c[0]=='c' for c in paths[0]['commands']))
        points=np.array(sample_path(paths[0]['commands'],100))
        self.assertLess(np.max(abs(np.linalg.norm(points-[200,200],axis=1)-128)),3)

    def test_small_round_stroke_keeps_curves(self):
        from centerlines import centerline_paths
        for radius in (12,20):
            with self.subTest(radius=radius):
                image=Image.new('1',(100,100),0)
                ImageDraw.Draw(image).arc((50-radius,50-radius,50+radius,50+radius),180,360,fill=1,width=6)
                paths,_,_=centerline_paths(np.array(image,bool))
                self.assertEqual(len(paths),1)
                self.assertTrue(any(c[0]=='c' for c in paths[0]))
                points=np.array(sample_path(paths[0],100))
                self.assertLess(np.max(abs(np.linalg.norm(points-[50,50],axis=1)-(radius-2.5))),2)

    def test_filled_disk_uses_declared_silhouette_not_a_cross(self):
        im=Image.new('RGB',(400,400),'white');ImageDraw.Draw(im).ellipse((70,70,330,330),fill='black')
        raw=io.BytesIO();im.save(raw,'PNG');m=analyze_image(raw.getvalue())
        self.assertEqual(len(m['modes']['single']),1)
        route=m['modes']['single'][0]
        self.assertEqual(route.get('method'),'silhouette')
        self.assertEqual(route['commands'][-1][0],'h')
        self.assertGreater(route['length'],780)
        self.assertIn('Silhouette',m['traceNote'])

    def test_nova_letter_strokes_are_reconstructed_without_master(self):
        m=analyze_image((ROOT/'assets/NOVA_Test.png').read_bytes())
        self.assertEqual(m['sourceKind'],'trace')
        for part in m['parts']:
            paths=[p for p in m['modes']['single'] if p['partId']==part['id']]
            if part['bounds'][1]>850:
                self.assertLessEqual(len(paths),4)
                self.assertLessEqual(sum(len(p['commands']) for p in paths),14)
            else:
                self.assertTrue(all(p.get('method')=='silhouette' for p in paths))
        self.assertLessEqual(len(m['modes']['single']),9)

    def test_double_curves_stay_close_to_uploaded_boundaries(self):
        from tracing import _mask
        from skimage.measure import find_contours
        from shapely.ops import unary_union
        raw=(ROOT/'assets/NOVA_Test.png').read_bytes();m=analyze_image(raw)
        mask,_=_mask(Image.open(io.BytesIO(raw)))
        boundary=unary_union([LineString(np.fliplr(q)) for q in find_contours(mask,.5)])
        result=unary_union([LineString(sample_path(p['commands'],120)) for p in m['modes']['double']])
        self.assertLess(result.hausdorff_distance(boundary),3)
        self.assertTrue(all(part['double']>0 for part in m['parts']))

    def test_curves_and_straight_branches_keep_shared_junctions(self):
        from shapely.ops import unary_union
        im=Image.new('RGB',(400,400),'white');dr=ImageDraw.Draw(im)
        dr.line([(80,335),(80,65),(185,65)],width=25,fill='black')
        dr.arc((110,65,260,215),270,450,fill='black',width=25)
        dr.line([(185,203),(80,203),(255,335)],fill='black',width=25)
        raw=io.BytesIO();im.save(raw,'PNG');m=analyze_image(raw.getvalue())
        curves=[LineString(sample_path(p['commands'],150)).buffer(.25) for p in m['modes']['single']]
        self.assertEqual(unary_union(curves).geom_type,'Polygon')

    def test_row_alignment_keeps_straight_caps_but_does_not_stretch_curves(self):
        from geometry import path_bounds
        from tracing import _load_image,_mask
        raw=(ROOT/'assets/NOVA_Test.png').read_bytes();m=analyze_image(raw)
        extents=[]
        for part in m['parts']:
            if part['bounds'][1]<850:continue
            paths=[p['commands'] for p in m['modes']['single'] if p['partId']==part['id']]
            if any(c[0]=='c' for p in paths for c in p):continue
            bounds=np.array([path_bounds(p) for p in paths])
            extents.append([bounds[:,1].min(),bounds[:,3].max()])
        self.assertLess(np.ptp(np.array(extents),axis=0).max(),.01)
        n=[p for p in m['modes']['single'] if p['partId']=='part-4'][0]['commands']
        self.assertAlmostEqual(n[0][1][1],n[2][1][1],places=7)
        self.assertAlmostEqual(n[1][1][1],n[3][1][1],places=7)
        ring=next(p['commands'] for p in m['modes']['single'] if p['partId']=='part-3')
        mask,_=_mask(_load_image(raw));bounds=next(p['bounds'] for p in m['parts'] if p['id']=='part-3')
        x=int((bounds[0]+bounds[2]-1)/2)
        ys=np.flatnonzero(mask[bounds[1]:bounds[3],x])+bounds[1]
        runs=np.split(ys,np.flatnonzero(np.diff(ys)>1)+1)
        self.assertEqual(len(runs),2)
        actual=path_bounds(ring)
        self.assertAlmostEqual(actual[1],(runs[0][0]+runs[0][-1])/2,delta=1.5)
        self.assertAlmostEqual(actual[3],(runs[1][0]+runs[1][-1])/2,delta=1.5)

if __name__=='__main__':unittest.main()
