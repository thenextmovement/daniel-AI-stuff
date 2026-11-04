"""Spatial UV brush masks: preserve artwork, subtract only covered neon lengths."""
import math
import numpy as np
from shapely.geometry import Point, LineString, Polygon, GeometryCollection, box, MultiPoint
from shapely.ops import unary_union


def subpaths(commands):
    result=[]
    for command in commands:
        if command[0]=='m':result.append([])
        if result:result[-1].append(command)
    return result


def filled_shape(commands,evenodd=False):
    from geometry import sample_path
    from shapely.ops import polygonize
    rings=[]
    for path in subpaths(commands):
        points=sample_path(path,50)
        if len(points)<3:continue
        points=np.vstack([points,points[0]])
        area=np.sum(points[:-1,0]*points[1:,1]-points[1:,0]*points[:-1,1])
        poly=Polygon(points).buffer(0)
        if not poly.is_empty:rings.append((poly,1 if area>0 else -1))
    # Resolve complete paint operations, retaining both even-odd and non-zero
    # counters; overlapping same-winding contours stay filled.
    faces=polygonize(unary_union([p.boundary for p,_ in rings]))
    kept=[]
    for face in faces:
        point=face.representative_point()
        winding=sum(sign for poly,sign in rings if poly.covers(point))
        if (winding%2!=0) if evenodd else (winding!=0):kept.append(face)
    return unary_union(kept) if kept else GeometryCollection()


def mask_from_strokes(strokes, bounds, reference):
    if not isinstance(strokes,list) or len(strokes)>500:
        raise ValueError('Höchstens 500 UV-Pinselstriche sind möglich. Bitte bei Bedarf zurücksetzen.')
    mask=GeometryCollection();count=0
    for stroke in strokes:
        if not isinstance(stroke,dict) or stroke.get('op') not in ('add','erase'):
            raise ValueError('Ungültiger UV-Pinselstrich.')
        try:
            points=np.asarray(stroke['points'],float);radius=float(stroke['radius'])
            count+=len(points)
            if points.ndim!=2 or points.shape[1]!=2 or not 1<=len(points)<=10000 or count>100000 or not np.isfinite(points).all() or not math.isfinite(radius) or not 0<radius<=max(bounds[2:])*2:
                raise ValueError()
        except (ValueError,TypeError,KeyError):raise ValueError('Ungültige UV-Pinselkoordinaten.') from None
        points=points+reference
        shape=(Point(points[0]) if len(points)==1 else LineString(points)).buffer(radius,quad_segs=12)
        mask=mask.union(shape) if stroke['op']=='add' else mask.difference(shape)
    x,y,w,h=bounds
    return mask.intersection(box(x,y,x+w,y+h))


def polygon_commands(shape):
    result=[]
    if shape.is_empty:return result
    polygons=[shape] if shape.geom_type=='Polygon' else list(shape.geoms)
    for poly in polygons:
        if poly.geom_type!='Polygon':continue
        for ring in [poly.exterior,*poly.interiors]:
            pts=list(ring.coords)
            result.extend([['m',list(pts[0])],*[['l',list(p)] for p in pts[1:-1]],['h']])
    return result


def subtract_mask(commands,mask):
    """Split crossing Beziers with de Casteljau; untouched commands stay exact."""
    from geometry import segments, sample_path
    if mask.is_empty:return commands
    if not mask.intersects(LineString(sample_path(commands,80))):return commands
    def split(p,t):
        levels=[p]
        while len(levels[-1])>1:levels.append((1-t)*levels[-1][:-1]+t*levels[-1][1:])
        return np.array([v[0] for v in levels]),np.array([v[-1] for v in levels[::-1]])
    result=[]
    for path in subpaths(commands):
        previous=None
        for op,points in segments(path):
            kept=[]
            def visit(p,a,b,depth):
                hull=MultiPoint(p).convex_hull
                if not mask.intersects(hull):kept.append((a,b));return
                if mask.covers(hull):return
                if depth>=22 or np.ptp(p,axis=0).max()<1e-5:
                    if not mask.covers(Point(split(p,.5)[0][-1])):kept.append((a,b))
                    return
                left,right=split(p,.5);mid=(a+b)/2
                visit(left,a,mid,depth+1);visit(right,mid,b,depth+1)
            visit(points,0.,1.,0)
            merged=[]
            for a,b in kept:
                if merged and abs(a-merged[-1][1])<1e-10:merged[-1][1]=b
                else:merged.append([a,b])
            for a,b in merged:
                part=points if a==0 else split(points,a)[1]
                if b<1:part=split(part,(b-a)/(1-a))[0]
                if previous is None or np.linalg.norm(previous-part[0])>1e-7:result.append(['m',part[0].tolist()])
                result.append([op,*part[1:].tolist()]);previous=part[-1]
            if not merged or merged[-1][1]<1:previous=None
    return result


def recognized_shapes(model, hidden):
    """Filled import/trace regions, preserving counters and excluding page backgrounds."""
    from geometry import sample_path
    groups={}
    for i,item in enumerate(model['modes']['double']):
        if f'double:{i}' in hidden:continue
        groups.setdefault(item['partId'],[]).append(item)
    x,y,w,h=model['imageBounds'];frame=box(x,y,x+w,y+h)
    shapes=[]
    for items in groups.values():
        commands=[c for item in items for c in item['commands']]
        if model['sourceKind']=='vector' and not items[0].get('filled'):
            shape=unary_union([LineString(sample_path(path,50)).buffer(max(.01,items[0].get('originalStrokeWidth',.1))/2)
                               for path in subpaths(commands) if len(path)>1])
        else:
            shape=filled_shape(commands,items[0].get('evenodd',model['sourceKind']!='vector'))
        if shape.is_empty:continue
        # A solid page-sized rectangle is a background, not lettering. This does
        # not remove intentional filled symbols or disconnected photo regions.
        if len(groups)>1 and shape.area>=frame.area*.9 and shape.area>=shape.envelope.area*.995 and shape.intersection(frame).area>=frame.area*.9:
            continue
        shapes.append(shape)
    return unary_union(shapes) if shapes else GeometryCollection()


def uv_geometry(model,strokes,reference,mode='original',hidden=()):
    """Return brush coverage, backing footprint and the actual print clip."""
    from geometry import sample_path, path_bounds
    if mode not in ('original','forms'):raise ValueError('Unbekannte UV-Druck-Auswahl.')
    if not strokes:return GeometryCollection(),GeometryCollection(),GeometryCollection()
    x,y,w,h=model['imageBounds']
    bounds=[path_bounds(p['commands']) for p in model['modes']['double']]
    x0=min(x,*[b[0] for b in bounds]);y0=min(y,*[b[1] for b in bounds])
    x1=max(x+w,*[b[2] for b in bounds]);y1=max(y+h,*[b[3] for b in bounds])
    mask=mask_from_strokes(strokes,[x0,y0,x1-x0,y1-y0],reference)
    if mask.is_empty:return mask,GeometryCollection(),mask
    if mode=='forms':
        print_mask=recognized_shapes(model,hidden).intersection(mask)
        return mask,print_mask,print_mask
    shapes=[]
    for item in model['modes']['double']:
        for path in subpaths(item['commands']):
            points=sample_path(path,50)
            if len(points)<2:continue
            if item.get('filled') or path[-1][0]=='h':shape=Polygon(points).buffer(0)
            else:shape=LineString(points).buffer(item.get('originalStrokeWidth',.1)/2)
            if mask.intersects(shape):shapes.append(shape.intersection(mask))
    return mask,unary_union(shapes) if shapes else GeometryCollection(),mask
