"""Neon mockups: recover illuminated strokes, never their photographic halo."""
import base64
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store
from tracing import analyze_image, prepare_image
from geometry import sample_path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, Point


def png(image):
    raw=io.BytesIO();image.save(raw,'PNG');return raw.getvalue()


def illuminated_strokes(color=(255,105,0), background=4, colored_core=False):
    x=np.linspace(55,445,250)
    routes=[np.column_stack([x,90+18*np.sin((x-55)/390*np.pi)]),
            np.column_stack([x,125+18*np.sin((x-55)/390*np.pi)]),
            np.column_stack([x,210-35*np.sin((x-55)/390*np.pi)])]
    layer=Image.new('L',(500,280));draw=ImageDraw.Draw(layer)
    for q in routes:draw.line([tuple(p) for p in q],fill=255,width=1)
    distance=ndimage.distance_transform_edt(np.asarray(layer)==0)
    core=np.clip(3.5-distance,0,1)
    glow=.7*np.exp(-distance/7)+.4*np.exp(-distance/17)
    core_color=np.array(color) if colored_core else np.array([255,255,255])
    rgb=background+glow[:,:,None]*np.array(color)+core[:,:,None]*core_color
    return Image.fromarray(np.clip(rgb,0,255).astype('uint8')),routes,distance


class NeonVisualizationTests(unittest.TestCase):
    def test_closed_neon_ring_remains_one_smooth_closed_path(self):
        from centerlines import neon_centerline_paths
        y,x=np.mgrid[:240,:300]
        mask=abs(np.hypot(x-150,y-120)-80)<5
        paths,_,_=neon_centerline_paths(mask)
        self.assertEqual(len(paths),1)
        self.assertEqual(sum(command[0]=='h' for command in paths[0]),1)
        points=np.asarray(sample_path(paths[0],120))
        self.assertLess(float(abs(np.linalg.norm(points-[150,120],axis=1)-80).max()),1)

    def test_tight_neon_bend_is_one_smooth_stroke_without_a_false_branch(self):
        # A narrow reversal such as the middle of a handwritten 3. Its rounded
        # tube outline has a medial-axis spur, although the tube has no branch.
        commands=[['m',[80,85]],['c',[190,-10],[240,15],[202,72]],
                  ['c',[180,105],[145,125],[120,145]],
                  ['c',[236,105],[246,209],[133,265]],
                  ['c',[80,292],[49,270],[84,237]]]
        route=np.asarray(sample_path(commands,150))
        layer=Image.new('L',(300,320));ImageDraw.Draw(layer).line([tuple(p) for p in route],fill=255,width=1)
        distance=ndimage.distance_transform_edt(np.asarray(layer)==0)
        core=np.clip(5-distance,0,1)
        glow=.7*np.exp(-distance/7)+.4*np.exp(-distance/17)
        image=Image.fromarray(np.clip(glow[:,:,None]*[255,105,0]+core[:,:,None]*255,0,255).astype('uint8'))
        model=analyze_image(png(image));paths=model['modes']['single']
        self.assertEqual(model.get('suggestedMode'),'single')
        self.assertEqual(len(paths),1,'A tube bend must not become a T junction')
        path=paths[0]['commands'];actual=LineString(sample_path(path,120))
        self.assertLess(actual.hausdorff_distance(LineString(route)),5)
        previous=None;point=np.asarray(path[0][1],float)
        for command in path[1:]:
            if command[0]=='h':continue
            end=np.asarray(command[-1],float)
            incoming=np.asarray(command[1],float)-point
            outgoing=end-np.asarray(command[-2],float) if command[0]=='c' else end-point
            if previous is not None and min(np.linalg.norm(previous),np.linalg.norm(incoming))>1e-6:
                cosine=previous@incoming/np.linalg.norm(previous)/np.linalg.norm(incoming)
                self.assertGreater(cosine,.995,'Curve joins must not introduce visible kinks')
            previous=outgoing;point=end

    def test_glow_is_excluded_and_separate_strokes_stay_separate(self):
        for color in ((255,105,0),(20,100,255),(255,25,160),(255,255,255)):
            with self.subTest(color=color):
                image,routes,distance=illuminated_strokes(color)
                _,labels,preview=prepare_image(png(image))
                self.assertEqual(preview.get('suggestedMode'),'single')
                self.assertEqual(len(preview['parts']),3,'The halo must not join adjacent strokes')
                self.assertLess(float(distance[labels>0].max()),6)
                self.assertGreater(int((labels>0).sum()),1500)
                model=analyze_image(png(image))
                self.assertEqual(model.get('suggestedMode'),'single')
                self.assertEqual(len(model['modes']['single']),3)
                expected=sum(LineString(q).length for q in routes)
                actual=sum(p['length'] for p in model['modes']['single'])
                self.assertAlmostEqual(actual/expected,1,delta=.025)
                for p in model['modes']['single']:
                    recovered=LineString(sample_path(p['commands'],80))
                    self.assertLess(min(recovered.hausdorff_distance(LineString(q)) for q in routes),3)

    def test_selection_preserves_core_detection_and_emitted_color(self):
        for additions in (None,False):
            image,_,_=illuminated_strokes()
            store=Store();preview=store.prepare(png(image),'customer-mockup.png')
            _,labels,_=store.prepared[preview['id']]
            # Remove the underline using the same pixel mask the browser sends.
            selected=(labels>0).astype('uint8');selected[170:]=0
            mask=base64.b64encode(selected.tobytes()).decode()
            extra=None if additions is None else base64.b64encode(np.zeros_like(selected).tobytes()).decode()
            project=store.trace_selection(preview['id'],pixel_mask=mask,additions=extra)
            self.assertEqual(project.get('suggestedMode'),'single')
            model=store.model(project['id'])
            self.assertEqual(len(model['modes']['single']),2)
            for p in model['modes']['single']:
                color=tuple(int(p['sourceColor'][i:i+2],16) for i in (1,3,5))
                self.assertGreater(color[0],200)
                self.assertGreater(color[1],50)
                self.assertLess(color[1],180)
                self.assertLess(color[2],40,'Sample tube colour, not the white clipped core')

    def test_real_neon_crossbars_and_crossings_are_preserved(self):
        fixtures=[([(80,65),(80,255)],[(80,155),(115,155)]),
                  ([(60,65),(235,255)],[(235,65),(60,255)]),
                  ([(105,65),(145,205),(185,65)],[(145,205),(145,230)])]
        for strokes in fixtures:
            with self.subTest(strokes=strokes):
                layer=Image.new('L',(300,320));draw=ImageDraw.Draw(layer)
                for stroke in strokes:draw.line(stroke,fill=255,width=1)
                distance=ndimage.distance_transform_edt(np.asarray(layer)==0)
                core=np.clip(5-distance,0,1)
                glow=.7*np.exp(-distance/7)+.4*np.exp(-distance/17)
                image=Image.fromarray(np.clip(glow[:,:,None]*[255,105,0]+core[:,:,None]*255,0,255).astype('uint8'))
                model=analyze_image(png(image))
                self.assertEqual(model.get('suggestedMode'),'single')
                lines=[LineString(sample_path(p['commands'],100)) for p in model['modes']['single']]
                if strokes==fixtures[-1]:
                    self.assertGreaterEqual(len(lines),3,'A genuine Y stem must not become a hairpin')
                for stroke in strokes:
                    for start,end in zip(stroke,stroke[1:]):
                        for point in np.linspace(start,end,60):
                            self.assertLess(min(line.distance(Point(point)) for line in lines),3)

    def test_flat_logos_and_broad_lit_shapes_do_not_switch_to_single(self):
        flat=Image.new('RGB',(500,280),(8,8,8));draw=ImageDraw.Draw(flat)
        draw.line([(60,90),(440,90)],fill='white',width=8)
        draw.line([(60,170),(440,170)],fill=(170,40,20),width=8)
        flat=flat.resize((497,278),Image.Resampling.LANCZOS)
        y,x=np.mgrid[:280,:500]
        disk=np.clip(48-np.hypot(x-250,y-140),0,1)
        halo=.8*np.exp(-np.maximum(0,np.hypot(x-250,y-140)-48)/12)
        bright=Image.fromarray(np.clip(halo[:,:,None]*[255,100,0]+disk[:,:,None]*255,0,255).astype('uint8'))
        for image in (flat,bright):
            with self.subTest(size=image.size):
                _,_,preview=prepare_image(png(image))
                self.assertIsNone(preview.get('suggestedMode'))
                self.assertIsNone(analyze_image(png(image)).get('suggestedMode'))


if __name__=='__main__':unittest.main()
