"""Selectable line sections at junctions; exact Bezier subdivision, no retracing."""
import math

import numpy as np
from scipy.optimize import least_squares, minimize_scalar
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree


def curve_segments(commands):
    here = start = None
    for index, (op, *points) in enumerate(commands):
        if op == 'm':
            here = start = np.asarray(points[0], float)
        elif op in ('l', 'c', 'h'):
            points = [start] if op == 'h' else points
            curve = np.asarray([here, *points], float)
            if np.max(np.abs(curve-curve[0])) > 1e-10:
                yield index, curve
            here = curve[-1]


def divide(points, t):
    levels = [points]
    while len(levels[-1]) > 1:
        levels.append((1-t)*levels[-1][:-1]+t*levels[-1][1:])
    return np.array([p[0] for p in levels]), np.array([p[-1] for p in levels[::-1]])


def at(points, t):
    if len(points) == 2: return (1-t)*points[0]+t*points[1]
    return (1-t)**3*points[0]+3*(1-t)**2*t*points[1]+3*(1-t)*t*t*points[2]+t**3*points[3]


def split_commands(commands, cuts):
    """Keep closed-path wrapping and all original curve geometry."""
    from uv_print import subpaths
    by_index = {}
    indices = {i for i, _ in curve_segments(commands)}
    if not isinstance(cuts, list) or len(cuts) > 1000:
        raise ValueError('Ungültige Trennstellen.')
    for cut in cuts:
        if not isinstance(cut, list) or len(cut) != 2:
            raise ValueError('Ungültige Trennstelle.')
        i, t = cut
        if type(i) is not int or i not in indices or type(t) not in (float, int) or not math.isfinite(t) or not 0 <= t <= 1:
            raise ValueError('Ungültige Trennstelle.')
        by_index.setdefault(i, set()).add(round(float(t), 10))
    result = []; offset = 0
    for path in subpaths(commands):
        segments = list(curve_segments(path))
        if not any(i+offset in by_index for i,_ in segments):
            result.append(path); offset += len(path); continue
        pieces = []; current = []
        for i, points in segments:
            ts = by_index.get(i+offset, set())
            if 0 in ts and len(current) > 1:
                pieces.append(current); current = []
            breaks = sorted({0., 1., *ts})
            for a,b in zip(breaks,breaks[1:]):
                part = points if a == 0 else divide(points,a)[1]
                if b < 1: part = divide(part,(b-a)/(1-a))[0]
                if not current: current = [['m',part[0].tolist()]]
                current.append(['l' if len(part)==2 else 'c', *part[1:].tolist()])
                if b in ts:
                    pieces.append(current); current = []
        if len(current) > 1: pieces.append(current)
        seam_cut = (0 in by_index.get(segments[0][0]+offset,set()) or
                    1 in by_index.get(segments[-1][0]+offset,set()))
        if path[-1][0]=='h' and len(pieces)>1 and not seam_cut:
            pieces = [pieces[-1]+pieces[0][1:], *pieces[1:-1]]
        result.extend(pieces); offset += len(path)
    return result


def find_splits(paths, selected, tolerance=.02, visible=None):
    """Find crossings and T-junctions involving the selection. Endpoints alone
    need no cuts. Near-parallel strokes are never merged or moved."""
    from uv_print import subpaths
    records = []
    for key,commands in paths.items():
        for index,points in curve_segments(commands):
            ts = np.linspace(0,1,65 if len(points)==4 else 2)
            line = LineString([at(points,t) for t in ts])
            records.append((key,index,points,ts,line))
    if not records:return {}
    tree = STRtree([r[4] for r in records]); cuts = {}

    def add(record,t):
        key,index,points,_,_ = record
        point = at(points,t)
        if visible is not None and not visible(key,point):return
        cuts.setdefault(key,[]).append([index,round(float(np.clip(t,0,1)),10)])

    def guess(record,point):
        _,_,p,ts,line = record
        sampled = np.array([at(p,t) for t in ts])
        j = int(np.argmin(np.linalg.norm(sampled-point,axis=1)))
        lo,hi = ts[max(0,j-1)],ts[min(len(ts)-1,j+1)]
        if len(p)==2:
            return float(np.clip(np.dot(point-p[0],p[1]-p[0])/np.sum((p[1]-p[0])**2),0,1))
        result = minimize_scalar(lambda t:np.sum((at(p,t)-point)**2),bounds=(lo,hi),method='bounded',options={'xatol':1e-13})
        return min([0.,1.,float(result.x)],key=lambda t:np.sum((at(p,t)-point)**2))

    chosen = set(selected)
    for i,a in enumerate(records):
        for j in tree.query(a[4].buffer(tolerance)):
            if j<=i:continue
            b=records[j]
            if a[0] not in chosen and b[0] not in chosen:continue
            crossing=a[4].intersection(b[4])
            points=[crossing] if crossing.geom_type=='Point' else list(crossing.geoms) if crossing.geom_type=='MultiPoint' else []
            for point in points:
                xy=np.asarray(point.coords[0]); ta,tb=guess(a,xy),guess(b,xy)
                if a[0]==b[0] and min(ta,1-ta)<1e-6 and min(tb,1-tb)<1e-6:continue
                fit=least_squares(lambda t:at(a[2],t[0])-at(b[2],t[1]),[ta,tb],bounds=(0,1),gtol=1e-12,ftol=1e-12,xtol=1e-12)
                if np.linalg.norm(fit.fun)<1e-6:
                    add(a,fit.x[0]);add(b,fit.x[1])
            # Raster recovery endpoints can differ slightly from the analytic
            # curve they were snapped to. Only endpoints get this tolerance.
            for first,second in ((a,b),(b,a)):
                for end in (0.,1.):
                    xy=at(first[2],end)
                    if second[4].distance(Point(xy))>tolerance:continue
                    t=guess(second,xy)
                    if np.linalg.norm(xy-at(second[2],t))<=tolerance:
                        # Adjacent commands of one path are not junctions.
                        if first[0]==second[0] and (t<1e-6 or t>1-1e-6):continue
                        add(first,end);add(second,t)
    clean={}
    for key,values in cuts.items():
        segs=list(curve_segments(paths[key])); lookup={i:n for n,(i,_) in enumerate(segs)}
        normalized=set()
        for i,t in values:
            n=lookup[i]; length=np.linalg.norm(segs[n][1][-1]-segs[n][1][0])
            eps=min(1e-5,1e-6/max(length,1e-6))
            if t<eps:t=0.
            if t>1-eps:t=1.
            # Canonicalize the two representations of a command boundary.
            if t==0 and n and np.linalg.norm(segs[n-1][1][-1]-segs[n][1][0])<1e-8:
                i,t=segs[n-1][0],1.
            normalized.add((i,t))
        values=[list(v) for v in sorted(normalized)]
        pieces=split_commands(paths[key],values)
        if len(pieces)>len(subpaths(paths[key])):
            clean[key]=values
    return clean


def path_catalog(model, settings):
    """Expand reversible section settings into stable selectable path keys.
    Keep source paths available for UV fills and Single/Double conversion."""
    from geometry import path_length
    catalog={f'{mode}:{i}':{**item,'mode':mode,'key':f'{mode}:{i}'}
             for mode in ('double','single') for i,item in enumerate(model['modes'][mode])}
    expanded={key:[key] for key in catalog}; edits=settings.get('straightened',{})
    divisions=settings.get('pathSplits',{})
    if not isinstance(edits,dict) or not isinstance(divisions,dict) or len(divisions)>1000:
        raise ValueError('Ungültige Linienkorrektur.')

    def straighten(key):
        item=catalog[key]; indices=edits.get(key,[])
        if not isinstance(indices,list) or any(type(i) is not int or i<1 or i>=len(item['commands']) or item['commands'][i][0]!='c' for i in indices):
            raise ValueError('Ungültiger Kurvenabschnitt für die Begradigung.')
        if indices:
            commands=[['l',c[-1]] if i in indices else c for i,c in enumerate(item['commands'])]
            catalog[key]={**item,'commands':commands,'length':path_length(commands)}

    for key in list(catalog):straighten(key)
    for key in sorted(divisions,key=lambda k:k.count('~')):
        if key not in catalog or key.count('~')>20:raise ValueError('Ungültiger Pfad für die Trennung.')
        item=catalog[key]; pieces=split_commands(item['commands'],divisions[key])
        children=[]
        for n,commands in enumerate(pieces):
            child=f'{key}~{n+1}'; children.append(child)
            catalog[child]={**item,'key':child,'commands':commands,'length':path_length(commands),
                            'name':f'{item["name"]} · Teil {n+1}'}
            straighten(child)
        base=key.split('~')[0]
        expanded[base]=[child for old in expanded[base] for child in (children if old==key else [old])]
    if any(key not in catalog for key in edits):raise ValueError('Ungültige Linienkorrektur.')
    offsets=settings.get('pathOffsets',{})
    if not isinstance(offsets,dict) or any(key not in catalog for key in offsets):
        raise ValueError('Ungültige Pfadauswahl zum Verschieben.')
    for delta in offsets.values():
        if (not isinstance(delta,list) or len(delta)!=2 or
            any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>1e7 for v in delta)):
            raise ValueError('Ungültige Verschiebung.')
    # Source coordinates stay intact for UV masking and exact subdivision.
    # Children inherit a moved parent's offset only once, after all splits.
    for key,item in catalog.items():
        item['offset']=[sum(offsets.get(a,[0,0])[axis] for a in ancestors(key)) for axis in range(2)]
    return catalog,expanded


def ancestors(key):
    while True:
        yield key
        if '~' not in key:return
        key=key.rsplit('~',1)[0]
