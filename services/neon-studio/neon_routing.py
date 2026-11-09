"""Place physical cut gaps at corners and contacts, preserving original Béziers."""
import math
import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Point
from shapely.ops import unary_union
from geometry import path_length, sample_path
from path_splitting import at, curve_segments, divide, split_commands
from uv_print import subpaths


class RoutingTooSmall(ValueError):
    pass


def corner_runs(part):
    segments=list(curve_segments(part))
    joins=list(zip(segments,segments[1:]))
    if len(segments)>1 and np.linalg.norm(segments[-1][1][-1]-segments[0][1][0])<1e-7:
        joins.append((segments[-1],segments[0]))
    cuts=[]
    for (index,a),(_,b) in joins:
        before=next(v for v in reversed(np.diff(a,axis=0)) if np.linalg.norm(v)>1e-10)
        after=next(v for v in np.diff(b,axis=0) if np.linalg.norm(v)>1e-10)
        if np.dot(before,after)<math.cos(math.radians(.1))*np.linalg.norm(before)*np.linalg.norm(after):
            cuts.append([index,1.])
    return split_commands(part,cuts) if cuts else [part]


def clipped(run,mask):
    result=[];active=[]
    for _,points in curve_segments(run):
        ts=np.linspace(0,1,97 if len(points)==4 else 2)
        sampled=np.array([at(points,t) for t in ts])
        distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(sampled,axis=0),axis=1))]
        line=LineString(sampled)
        rest=line.difference(mask)
        pieces=[rest] if rest.geom_type=='LineString' else list(getattr(rest,'geoms',[]))
        for piece in pieces:
            if piece.length<1e-7:continue
            a,b=[float(np.interp(line.project(Point(x)),distances,ts)) for x in (piece.coords[0],piece.coords[-1])]
            if b<=a:continue
            curve=divide(points,a)[1] if a else points
            if b<1:curve=divide(curve,(b-a)/(1-a))[0]
            if not active or np.linalg.norm(np.array(active[-1][-1])-curve[0])>1e-6:
                active=[['m',curve[0].tolist()]];result.append(active)
            active.append(['c' if len(points)==4 else 'l',*curve[1:].tolist()])
    if len(result)>1 and np.linalg.norm(np.array(result[-1][-1][-1])-result[0][0][-1])<1e-6:
        result=[result[-1]+result[0][1:],*result[1:-1]]
    return result


def endpoint_directions(line):
    if line.is_closed:return []
    coords=np.asarray(line.coords)
    tangents=[]
    for sequence in (coords,coords[::-1]):
        for point in sequence[1:]:
            vector=point-sequence[0]
            if np.linalg.norm(vector)>1e-10:
                tangents.append((Point(sequence[0]),vector/np.linalg.norm(vector)))
                break
    return tangents


def joins(a,b,tolerance):
    intersection=a.intersection(b)
    if not intersection.is_empty:
        if intersection.length>1e-6:
            raise ValueError('Deckungsgleiche Neonstrecken: gemeinsame Linie im Motiv eindeutig zuordnen.')
        return True
    # A close parallel stroke remains a separate strip. Snap only a transverse
    # endpoint to another run, using a scale-independent artwork tolerance.
    for first,other in ((a,b),(b,a)):
        for endpoint,tangent in endpoint_directions(first):
            if endpoint.distance(other)>tolerance:continue
            # A tangent connector can terminate at a loop. Over its interior
            # it must leave the loop; parallel offsets remain independent.
            if other.is_closed:
                start=first.project(endpoint)
                inside=start+first.length*.5*(1 if start<first.length/2 else -1)
                if first.interpolate(inside).distance(other)>3*tolerance:return True
            at_length=other.project(endpoint)
            step=min(other.length*.001,tolerance)
            left=other.interpolate(max(0,at_length-step))
            right=other.interpolate(min(other.length,at_length+step))
            direction=np.array(right.coords[0])-left.coords[0]
            norm=np.linalg.norm(direction)
            if norm and abs(np.dot(tangent,direction))/norm<.94:return True
    return False


def layout(paths):
    runs=[(i,run,LineString(sample_path(run,96))) for i,path in enumerate(paths)
          for part in subpaths(path) for run in corner_runs(part) if path_length(run)>1e-7]
    if not runs:raise RoutingTooSmall('Keine messbaren Neonstücke.')
    runs.sort(key=lambda item:-item[2].length)
    lines=[item[2] for item in runs];tree=STRtree(lines)
    tolerance=max(1e-8,(max(x.bounds[2] for x in lines)-min(x.bounds[0] for x in lines))*.001)
    contacts=[set() for _ in runs];ends=[[] for _ in runs]
    for i,line in enumerate(lines):
        for j in tree.query(line,predicate='dwithin',distance=tolerance):
            if j>=i or not joins(line,lines[j],tolerance):continue
            contacts[i].add(j)
            # At corners of the same source path, share the gap equally.
            if runs[i][0]!=runs[j][0]:continue
            for a,u in endpoint_directions(line):
                for b,v in endpoint_directions(lines[j]):
                    if a.distance(b)>1e-7:continue
                    chord=np.linalg.norm(u-v)
                    if chord>.01:
                        ends[i].append((a,10.15/chord));ends[j].append((b,10.15/chord))
    return runs,contacts,ends


def route(paths):
    runs,contacts,ends=layout(paths)
    output=[[] for _ in paths];accepted=[]
    for n,(i,run,line) in enumerate(runs):
        masks=[point.buffer(radius,quad_segs=32) for point,radius in ends[n]]
        masks.extend(piece.buffer(10.15,quad_segs=32) for j in contacts[n] for piece in accepted[j])
        pieces=clipped(run,unary_union(masks)) if masks else [run]
        if not pieces:raise RoutingTooSmall('Die Trennstelle würde einen Strich vollständig entfernen.')
        accepted.append([])
        for piece in pieces:
            remaining=LineString(sample_path(piece,96))
            if not remaining.is_simple:raise ValueError('Selbstkreuzender Neonpfad: Linienführung an der Kreuzung teilen.')
            output[i].extend(piece);accepted[n].append(remaining)
    if any(not commands for commands in output):raise RoutingTooSmall('Ein Motivdetail hätte kein Neonstück.')
    return output


def size_lower_bound(drawing, reference_width, padding, floor):
    """Necessary proportional constraints on runs that routing cannot shorten."""
    from manufacturing import inspect
    if 'dot' in drawing.get('pathRoles',[]):return floor  # point normalization can be absolute
    runs,contacts,ends=layout(drawing['paths'])
    span=reference_width-padding
    factor=max((floor-padding)/span,10/min(path_length(run) for _,run,_ in runs))
    fixed=[(run,line) for i,(_,run,line) in enumerate(runs) if not contacts[i] and not ends[i]]
    if fixed:
        paths=[run for run,_ in fixed]
        probe={**drawing,'paths':paths,'names':['']*len(paths),'pathModes':['single']*len(paths),'pathRoles':['stroke']*len(paths)}
        radius=inspect(probe)['minimumRadius']
        if radius is not None and radius>0:factor=max(factor,25/radius)
    if len(fixed)>1:
        lines=[line for _,line in fixed];tree=STRtree(lines)
        for i,line in enumerate(lines):
            for j in tree.query(line,predicate='dwithin',distance=10/factor):
                if j>i:
                    distance=line.distance(lines[j])
                    if distance>0:factor=max(factor,10/distance)
    return max(floor,math.ceil(padding+span*factor-1e-7))
