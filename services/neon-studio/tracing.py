"""Local image analysis, verified B-KITE master matching and generic trace drafts."""
import base64
import io
import json
import warnings
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
from scipy import ndimage
from skimage.measure import find_contours
from skimage.filters import threshold_otsu
from centerlines import centerline_paths, neon_centerline_paths, smooth_path
from outlines import trace_outlines
from shapely.geometry import LineString

from geometry import path_length, path_bounds, sample_path, transform

ASSETS=Path(__file__).resolve().parent/'assets'
# Bound decoding separately from the small working image used by the tracer.
Image.MAX_IMAGE_PIXELS=100_000_000


def _neon_core(image):
    """Recognise narrow luminous strokes with a fading halo on a dark canvas.

    A bright flat logo alone is not evidence of neon. Require an extended,
    decaying halo around the strokes before excluding it from the geometry.
    """
    rgba=np.asarray(image.convert('RGBA'))
    if (rgba[:,:,3]<128).mean()>.05:return None
    rgb=rgba[:,:,:3].astype(float)
    light=rgb @ np.array([.2126,.7152,.0722])
    border=np.concatenate([light[0],light[-1],light[:,0],light[:,-1]])
    background=float(np.median(border));peak=float(np.percentile(light,99.8))-background
    if background>80 or peak<80:return None
    contrast=light-background
    if np.mean(contrast<peak*.25)<.6:return None
    core=contrast>peak*.75
    labels,_=ndimage.label(core,structure=np.ones((3,3)))
    sizes=np.bincount(labels.ravel());keep=sizes>=max(8,core.size*.000005);keep[0]=False
    core=keep[labels]
    if core.sum()<24 or core.mean()>.2:return None
    inside=ndimage.distance_transform_edt(core)
    if inside.max()>min(core.shape)*.045:return None
    radius=max(2,float(np.percentile(inside[core],90)))
    outside=ndimage.distance_transform_edt(~core)
    near=(outside>=radius)&(outside<=max(6,radius*3))
    far=(outside>max(6,radius*3))&(outside<=max(12,radius*6))
    if not near.any() or not far.any():return None
    halo=(contrast[near]>max(5,peak*.025))&(contrast[near]<peak*.7)
    if halo.mean()<.65:return None
    if np.median(contrast[far])>np.median(contrast[near])*.8:return None
    return core


def _separate_enclosed_colors(rgb, mask):
    """Expose contrasting interiors of framed artwork before binary tracing.

    Alpha/background separation alone merges a frame, its coloured fill and
    any inset marks. Remove only strongly contrasting regions enclosed by a
    consistent rim. Adjacent colours and gradients that reach the outer edge
    stay together; no particular palette or logo geometry is assumed.
    """
    labels,_=ndimage.label(mask,structure=np.ones((3,3)))
    result=mask.copy()
    for index,slices in enumerate(ndimage.find_objects(labels),1):
        if slices is None:continue
        local=labels[slices]==index
        if local.sum()<64:continue
        pixels=rgb[slices]
        core=ndimage.binary_erosion(local,iterations=2)
        rim=core & ~ndimage.binary_erosion(core,iterations=2)
        if rim.sum()<12:continue
        color=np.median(pixels[rim],axis=0)
        rim_noise=np.max(np.abs(pixels[rim]-color),axis=1)
        noise=float(np.percentile(rim_noise,90))
        distance=np.max(np.abs(pixels-color),axis=2)
        if np.percentile(distance[local],99)<max(60,2*noise):continue
        threshold=max(32,noise+8,float(threshold_otsu(np.ceil(distance[local]).astype('uint8'))))
        different=local & (distance>threshold)
        regions,_=ndimage.label(different,structure=np.ones((3,3)))
        sizes=np.bincount(regions.ravel())
        enclosed=sizes>=max(16,local.sum()*.0005)
        boundary=local & ~ndimage.binary_erosion(local,iterations=2)
        enclosed[np.unique(regions[boundary])]=False
        enclosed[0]=False
        result[slices]&=~enclosed[regions]
    return result


def _mask(image):
    core=_neon_core(image)
    if core is not None:
        image.info['traceProfile']='neon'
        ys,xs=np.nonzero(core)
        return core,[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    rgba=np.array(image.convert('RGBA'))
    rgb=rgba[:,:,:3].astype(float)
    alpha=rgba[:,:,3]
    border=np.concatenate([rgb[0],rgb[-1],rgb[:,0],rgb[:,-1]])
    background=np.median(border,axis=0)
    if (alpha<128).mean()>.05:
        mask=alpha>128
        # Some PNGs wrap an opaque, flat background in a transparent margin.
        # Alpha alone then selects that background and erases coloured letters
        # as enclosed holes. Remove only the dominant border-connected colour;
        # isolated white marks and white-on-transparent artwork stay intact.
        border_alpha=np.concatenate([alpha[0],alpha[-1],alpha[:,0],alpha[:,-1]])
        opaque_border=border[border_alpha>128]
        if len(opaque_border)>len(border)*.25:
            bg=np.median(opaque_border,axis=0)
            if np.percentile(np.max(np.abs(opaque_border-bg),axis=1),90)<12:
                candidate=mask & (np.max(np.abs(rgb-bg),axis=2)<24)
                regions,_=ndimage.label(candidate)
                edge_ids=np.unique(np.concatenate([regions[0],regions[-1],regions[:,0],regions[:,-1]]))
                background_mask=np.isin(regions,edge_ids[edge_ids!=0])
                remainder=mask & ~background_mask
                if background_mask.mean()>.3 and remainder.sum()>=12:
                    mask=remainder
    else:
        distance=np.max(np.abs(rgb-background),axis=2)
        threshold=max(28,float(np.percentile(distance,99))*.18)
        # A lit/textured background can exceed a fixed distance from the median.
        # Use the image's foreground/background split only when the border itself
        # shows this variation. Flat-background multicolour logos keep all colours.
        border_distance=np.max(np.abs(border-background),axis=1)
        if np.percentile(border_distance,90)>threshold:
            threshold=max(threshold,float(threshold_otsu(np.ceil(distance).astype('uint8'))))
        mask=distance>threshold
        if mask.mean()>.85:
            # Screenshots can surround a plain logo canvas with dark UI chrome.
            # Before rejecting an almost full-image mask, check whether it is
            # actually one inset rectangular panel with a uniform inner rim.
            panels,_=ndimage.label(mask,structure=np.ones((3,3)))
            sizes=np.bincount(panels.ravel());index=int(sizes[1:].argmax()+1)
            y,x=ndimage.find_objects(panels)[index-1]
            if (sizes[index]>mask.size*.85 and np.mean(panels[y,x]==index)>.98
                    and y.start>0 and x.start>0 and y.stop<image.height and x.stop<image.width):
                # One pixel inside avoids the screenshot edge's resampling halo.
                panel=rgb[y.start+1:y.stop-1,x.start+1:x.stop-1]
                rim=np.concatenate([panel[0],panel[-1],panel[:,0],panel[:,-1]])
                panel_bg=np.median(rim,axis=0)
                if (np.max(np.abs(panel_bg-background))>threshold
                        and np.percentile(np.max(np.abs(rim-panel_bg),axis=1),90)<24):
                    panel_distance=np.max(np.abs(panel-panel_bg),axis=2)
                    panel_mask=panel_distance>max(28,float(np.percentile(panel_distance,99))*.18)
                    if panel_mask.sum()>=12 and panel_mask.mean()<.85:
                        mask=np.zeros(mask.shape,dtype=bool)
                        mask[y.start+1:y.stop-1,x.start+1:x.stop-1]=panel_mask
    mask=_separate_enclosed_colors(rgb,mask)
    labels,count=ndimage.label(mask)
    sizes=np.bincount(labels.ravel())
    keep=sizes>=max(5,mask.size*.000005); keep[0]=False
    mask=keep[labels]
    if mask.sum()<12 or mask.mean()>.85:
        raise ValueError('Kein klares Motiv erkannt. Bitte ein Logo mit einfarbigem Hintergrund wählen.')
    ys,xs=np.nonzero(mask)
    rect=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
    return mask,rect


def _signature(mask,rect):
    a,b,c,d=rect
    return np.array(Image.fromarray(mask[b:d,a:c]).resize((160,160),Image.Resampling.NEAREST),bool)


@lru_cache(maxsize=1)
def _reference():
    with Image.open(ASSETS/'B_KITE.png') as im:
        mask,rect=_mask(im)
    return _signature(mask,rect),rect,json.loads((ASSETS/'masters.json').read_text())


def _align_heights(paths,components):
    # Source-supported cap/baseline alignment. Row grouping uses the source
    # geometry, not recognised text, filenames or stored letter coordinates.
    for component in components:
        x0,y0,x1,y1=component['bounds'];r=component['radius'];height=y1-y0
        peers=[c for c in components if abs(c['bounds'][1]-y0)<height*.06 and abs(c['bounds'][3]-y1)<height*.06]
        local=component['mask'];ys,xs=np.nonzero(local)
        top_count=max(local[y].sum() for y in range(ys.min(),min(ys.min()+3,local.shape[0])))
        bottom_count=max(local[y].sum() for y in range(max(0,ys.max()-2),ys.max()+1))
        flat=top_count>r*1.3 and bottom_count>r*1.3 and height>6*r
        if not flat and len(peers)<3:continue
        top=float(np.median([c['bounds'][1]+c['radius'] for c in peers]))
        bottom=float(np.median([c['bounds'][3]-1-c['radius'] for c in peers]))
        group=[p['commands'] for p in paths if p['partId']==component['id']]
        # Stretching an entire curved glyph to the row's cap height moves its
        # centreline away from the source stroke. Only align angular linework.
        if any(cmd[0]=='c' for path in group for cmd in path):continue
        bounds=np.array([path_bounds(p) for p in group]);low=bounds[:,1].min();high=bounds[:,3].max()
        if high-low<1:continue
        # One affine transform keeps straight arms through junctions collinear.
        for path in group:
            for command in path:
                for point in command[1:]:point[1]=float(top+(point[1]-low)*(bottom-top)/(high-low))
        counts={}
        for path in group:
            if not all(c[0] in ('m','l') for c in path):continue
            for cmd in path:counts[tuple(cmd[1])]=counts.get(tuple(cmd[1]),0)+1
        for path in group:
            if not all(c[0] in ('m','l') for c in path):continue
            for end,neighbor in ((0,1),(-1,-2)):
                point=path[end][1];other=path[neighbor][1]
                if counts.get(tuple(point))!=1:continue
                target=top if point[1]<top+r*.7 else bottom if point[1]>bottom-r*.7 else None
                if target is None or abs(point[1]-other[1])<1e-6:continue
                point[0]+=float((target-point[1])*(point[0]-other[0])/(point[1]-other[1]));point[1]=target


def _trace(mask,neon=False):
    # Work on components at the uploaded resolution. Early downsampling creates
    # false branches even in a solid disk and loses short legitimate strokes.
    labels,count=ndimage.label(mask,structure=np.ones((3,3)))
    if count>250:raise ValueError('Zu viele Details. Bitte weniger Motivelemente auswählen.')
    modes={'single':[],'double':[]};alignment=[]
    for index,slices in enumerate(ndimage.find_objects(labels),1):
        if slices is None:continue
        y,x=slices;local=np.pad(labels[slices]==index,3)
        dx,dy=x.start-3,y.start-3
        holes=ndimage.binary_fill_holes(local)&~local
        hole_labels,_=ndimage.label(holes)
        sizes=np.bincount(hole_labels.ravel());tiny=(sizes<=4);tiny[0]=False
        local=local|tiny[hole_labels]
        contours=[np.fliplr(q) for q in find_contours(local,.5,fully_connected='high') if len(q)>=8]
        outlines=trace_outlines(local,contours)
        single,distance,routes=(neon_centerline_paths if neon else centerline_paths)(local)
        radii=np.concatenate([distance[q[:,1].astype(int),q[:,0].astype(int)] for q,_ in routes]) if routes else np.array([distance.max()])
        has_holes=bool(np.any(ndimage.binary_fill_holes(local)&~local))
        # A solid, broad shape has no unique useful centreline. Preserve its
        # silhouette as one route and disclose this choice instead of a cross/tree.
        broad=np.percentile(radii,90)/max(1,min(local.shape)-6)>.23
        variable=np.percentile(radii,90)/max(1,np.percentile(radii,10))>1.5
        collapsed=sum(LineString(q).length for q,_ in routes)<distance.max()*1.5
        solid=not has_holes and ((broad and variable) or collapsed or not single)
        method='silhouette' if solid else 'centerline'
        if solid:
            # Keep the established Single-Line silhouette independent of changes
            # to Double-Line tracing, just like the existing centreline engine.
            silhouettes=[smooth_path(q,1.2,True) for q in contours]
            silhouettes=[p for p in silhouettes if len(p)>2]
            single=[max(silhouettes,key=path_length)] if silhouettes else []
        if not solid:
            alignment.append(dict(id=f'part-{index}',bounds=[x.start,y.start,x.stop,y.stop],radius=float(np.median(radii)),mask=local))
        for mode,paths in (('single',single),('double',outlines)):
            for path in paths:
                modes[mode].append(dict(name=f"{'Silhouette' if mode=='single' and solid else 'Mittellinie' if mode=='single' else 'Umriss'} {len(modes[mode])+1}",
                    commands=transform(path,1,dx,dy),partId=f'part-{index}',method=method if mode=='single' else 'outline'))
    if not neon:_align_heights(modes['single'],alignment)
    if not modes['single'] or not modes['double']:
        raise ValueError('Die Linien konnten nicht zuverlässig erkannt werden. Bitte ein klareres Logo verwenden.')
    if max(map(len,modes.values()))>250:
        raise ValueError('Das Bild enthält zu viele Details. Bitte nur den Logobereich hochladen.')
    return modes


def _assign_parts(mask, modes, image, neon=False):
    """Keep holes and skeleton branches attached to their original raster component."""
    labels, count = ndimage.label(mask, structure=np.ones((3,3)))
    nearest = ndimage.distance_transform_edt(labels == 0, return_distances=False, return_indices=True)
    parts=[]
    rgb=np.asarray(image)[:,:,:3]
    component_colors={}
    for index, slices in enumerate(ndimage.find_objects(labels), 1):
        if slices is None: continue
        y,x=slices
        local=labels[slices]==index
        interior=ndimage.binary_erosion(local,iterations=2)
        pixels=rgb[slices][interior if interior.any() else local]
        if neon:
            # The core is often clipped to white. Its immediate fringe carries
            # the emitted hue, even under the selection's transparent pixels.
            pad=4
            y=slice(max(0,y.start-pad),min(mask.shape[0],y.stop+pad))
            x=slice(max(0,x.start-pad),min(mask.shape[1],x.stop+pad))
            local=labels[y,x]==index
            fringe=ndimage.binary_dilation(local,iterations=pad)&~local
            colors=rgb[y,x][fringe].astype(float)
            saturated=(colors.max(axis=1)-colors.min(axis=1))>colors.max(axis=1)*.3
            saturated&=colors.max(axis=1)>80
            if saturated.sum()>len(colors)*.2:
                pixels=colors[saturated]
                # Normalize halo brightness, retaining the hue and saturation.
                pixels=np.clip(pixels*255/np.maximum(1,pixels.max(axis=1,keepdims=True)),0,255)
        # Dominant colour family avoids antialiasing and photographic edge noise.
        bins=pixels.astype(int)//24
        _, inverse, counts=np.unique(bins,axis=0,return_inverse=True,return_counts=True)
        color=np.rint(np.median(pixels[inverse==counts.argmax()],axis=0)).astype(int)
        component_colors[f'part-{index}']='#'+''.join(f'{v:02x}' for v in color)
        sy,sx=slices
        parts.append(dict(id=f'part-{index}', name=f'Element {index}',
                          bounds=[sx.start,sy.start,sx.stop,sy.stop], single=0, double=0))
    lookup={part['id']:part for part in parts}
    for mode, paths in modes.items():
        for item in paths:
            points=np.round(sample_path(item['commands'],12)).astype(int)
            xs=np.clip(points[:,0],0,mask.shape[1]-1);ys=np.clip(points[:,1],0,mask.shape[0]-1)
            ids=labels[nearest[0,ys,xs],nearest[1,ys,xs]]
            part_id=item.get('partId') or f'part-{int(np.bincount(ids).argmax())}'
            item['partId']=part_id
            item['sourceColor']=component_colors[part_id]
            lookup[part_id][mode]+=1
    return parts


def _load_image(raw):
    if len(raw)>100*1024*1024:
        raise ValueError('Das Bild darf höchstens 100 MB groß sein.')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if min(source.size)<20:
                    raise ValueError('Das Bild ist zu klein. Mindestens 20 Pixel pro Seite erforderlich.')
                # Palette/1-bit images need RGBA for antialiased resizing. Other
                # formats shrink before EXIF/RGBA copies of the decoded image.
                frame=source.convert('RGBA') if source.mode in ('P','1') else source
                try:
                    frame.thumbnail((1800,1800),Image.Resampling.LANCZOS)
                    image=ImageOps.exif_transpose(frame).convert('RGBA')
                finally:
                    if frame is not source:frame.close()
    except (Image.DecompressionBombError,Image.DecompressionBombWarning):
        raise ValueError('Das Bild hat mehr als 100 Millionen Pixel. Bitte die Auflösung reduzieren; die Dateigröße ist nicht das Problem.') from None
    except UnidentifiedImageError:
        raise ValueError('Dieses Dateiformat ist nicht lesbar. Bitte als PNG, JPG, WebP, GIF, TIFF, BMP, SVG oder PDF exportieren.') from None
    except OSError:
        raise ValueError('Die Bilddatei konnte nicht vollständig gelesen werden. Bitte erneut aus dem Originalprogramm exportieren.') from None
    return image


def prepare_image(raw):
    image=_load_image(raw)
    mask,_=_mask(image)
    labels,count=ndimage.label(mask,structure=np.ones((3,3)))
    parts=[]
    for index,slices in enumerate(ndimage.find_objects(labels),1):
        if slices is None:continue
        y,x=slices;parts.append(dict(id=index,bounds=[x.start,y.start,x.stop,y.stop]))
    # Lossless integer component IDs for the selection canvas, never antialiased.
    colors=np.stack([labels&255,(labels>>8)&255,(labels>>16)&255],axis=2).astype('uint8')
    def encoded(im):
        data=io.BytesIO();im.save(data,'PNG')
        return 'data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()
    preview=dict(image=encoded(image),labels=encoded(Image.fromarray(colors)),
                 width=image.width,height=image.height,parts=parts)
    if image.info.get('traceProfile')=='neon':
        preview.update(suggestedMode='single',importNote='Neon-Visualisierung erkannt: Die hellen Leuchtkerne werden als Single Line übernommen. Der Lichtschein wird weggelassen. Prüfe die grüne Auswahl und entferne bei Bedarf unerwünschte Stellen.')
    return image,labels,preview


def selection_mask(image,labels,selected=None,pixel_mask=None,additions=None):
    def decode(value):
        if not isinstance(value,str) or len(value)>((labels.size+2)//3)*4:
            raise ValueError('Ungültige Auswahlmaske. Bitte die Auswahl erneut zeichnen.')
        try:decoded=base64.b64decode(value,validate=True)
        except ValueError:raise ValueError('Ungültige Auswahlmaske.') from None
        values=np.frombuffer(decoded,dtype='uint8')
        if values.size!=labels.size or np.any(values>1):
            raise ValueError('Die Auswahlmaske passt nicht zum Bild.')
        return values.reshape(labels.shape)==1
    foreground=labels>0
    if additions is not None:
        foreground=foreground|(decode(additions)&(np.array(image)[:,:,3]>128))
    if pixel_mask is not None:
        # A freehand mask clips foreground pixels, never whole connected objects.
        # Green is an allowed image region, not an artificial filled neon stroke.
        keep=decode(pixel_mask)&foreground
        if keep.sum()<12:
            raise ValueError('Im grünen Bereich wurde kein Motiv erkannt. Bitte mehr vom Motiv markieren.')
    else:
        available=set(np.unique(labels))-{0}
        if not isinstance(selected,list) or not selected or any(type(i) is not int or i not in available for i in selected):
            raise ValueError('Bitte mindestens ein erkanntes Motivelement auswählen.')
        keep=np.isin(labels,selected)
    return keep


def selected_image(image,labels,selected=None,pixel_mask=None):
    keep=selection_mask(image,labels,selected,pixel_mask)
    rgba=np.array(image)
    rgba[:,:,3]=np.where(keep,rgba[:,:,3],0)
    out=io.BytesIO();Image.fromarray(rgba).save(out,'PNG')
    return out.getvalue()


def analyze_image(raw,foreground=None,trace_profile=None):
    image=_load_image(raw)
    if foreground is None:
        mask,rect=_mask(image)
    else:
        mask=np.asarray(foreground,dtype=bool)
        if mask.shape!=(image.height,image.width) or mask.sum()<12:
            raise ValueError('Keine verwertbare Auswahl im Bild.')
        yy,xx=np.where(mask);rect=(int(xx.min()),int(yy.min()),int(xx.max()+1),int(yy.max()+1))
    neon=trace_profile=='neon' or image.info.get('traceProfile')=='neon'
    a,b,c,d=rect
    is_master=False
    if (ASSETS/'B_KITE.png').is_file() and (ASSETS/'masters.json').is_file():
        reference,ref_rect,masters=_reference()
        signature=_signature(mask,rect)
        intersection=np.logical_and(reference,signature).sum()
        union=np.logical_or(reference,signature).sum()
        ra,rb,rc,rd=ref_rect
        is_master=intersection/max(1,union)>.985 and abs(((c-a)/(d-b))/((rc-ra)/(rd-rb))-1)<.005
    if is_master:
        scale=(c-a)/(rc-ra); dx=a-ra*scale; dy=b-rb*scale
        modes={mode:[{'name':item['name'],'commands':transform(item['commands'],scale,dx,dy)}
                     for item in masters[mode]] for mode in ('single','double')}
    else:
        modes=_trace(mask,neon=neon)
    for paths in modes.values():
        for item in paths: item['length']=path_length(item['commands'])
    parts=_assign_parts(mask,modes,image,neon=neon)
    out=io.BytesIO(); image.crop(tuple(rect)).save(out,'PNG')
    model=dict(modes=modes,parts=parts,recoveryImage=image.copy(),image='data:image/png;base64,'+base64.b64encode(out.getvalue()).decode(),
                imageBounds=[a,b,c-a,d-b],sourceKind='master' if is_master else 'trace',
                sourceLabel='B-KITE · vorhandene Vektorvorlage' if is_master else 'Automatisch nachgezeichnet · Entwurf',
                pixelWidth=image.width,pixelHeight=image.height,
                traceNote='' if is_master else ('Bei breiten Vollflächen verwendet Single Line die Silhouette statt einer uneindeutigen Mittellinie. ' if any(p.get('method')=='silhouette' for p in modes['single']) else '')+'Automatisch ermittelte Kurven bitte vor der Fertigung visuell prüfen.')
    if neon:
        model.update(suggestedMode='single',sourceLabel='Neon-Visualisierung · Leuchtkern als Mittellinie',
                     traceNote='Single Line aus den hellen Leuchtkernen; ohne Lichtschein. Verbindungen und verdeckte Stellen im Bild vor der Fertigung prüfen.')
    return model
