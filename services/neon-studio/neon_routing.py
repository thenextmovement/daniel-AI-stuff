"""Place physical cut gaps at corners and contacts, preserving original Béziers."""
import math
import numpy as np
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
        if np.dot(before,after)<math.cos(math.radians(15))*np.linalg.norm(before)*np.linalg.norm(after):
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


def route(paths):
    runs=[(i,run,LineString(sample_path(run,96))) for i,path in enumerate(paths)
          for part in subpaths(path) for run in corner_runs(part) if path_length(run)>1e-7]
    if not runs:raise RoutingTooSmall('Keine messbaren Neonstücke.')
    contact_tolerance=min(3.,max(.5,(max(x.bounds[2] for _,_,x in runs)-min(x.bounds[0] for _,_,x in runs))*.001))
    output=[[] for _ in paths];accepted=[]
    for i,run,line in sorted(runs,key=lambda item:-item[2].length):
        # A near miss at an endpoint is common in traced T junctions. Leave
        # genuinely parallel neighbouring outlines intact for the spacing test.
        contacts=[other for other in accepted if line.distance(other)<contact_tolerance]
        pieces=clipped(run,unary_union([other.buffer(10.15,quad_segs=32) for other in contacts])) if contacts else [run]
        if not pieces:
            raise RoutingTooSmall('Die Trennstelle würde zu viel vom ursprünglichen Strich entfernen.')
        for piece in pieces:
            remaining=LineString(sample_path(piece,96))
            if not remaining.is_simple:raise ValueError('Selbstkreuzender Neonpfad: Linienführung an der Kreuzung teilen.')
            output[i].extend(piece);accepted.append(remaining)
    if any(not commands for commands in output):raise RoutingTooSmall('Ein Motivdetail hätte kein Neonstück.')
    return output


def size_lower_bound(drawing, reference_width, padding, floor):
    """Lower bound in board mm before cutting. A cut cannot lengthen a run."""
    from shapely import STRtree
    if 'dot' in drawing.get('pathRoles',[]):return floor  # fixed-size point normalization
    span=reference_width-padding
    runs=[run for path in drawing['paths'] for part in subpaths(path)
          for run in corner_runs(part) if path_length(run)>1e-7]
    if not runs or span<=0:return floor
    lines=[LineString(sample_path(run,96)) for run in runs]
    factor=max((floor-padding)/span,10/min(map(path_length,runs)))
    motif_span=max(line.bounds[2] for line in lines)-min(line.bounds[0] for line in lines)
    # In reference units this bounds the contact tolerance at every candidate scale.
    tolerance=max(.5/factor,.001*motif_span)+.05
    tree=STRtree(lines);fixed=[]
    for i,line in enumerate(lines):
        nearby=tree.query(line,predicate='dwithin',distance=tolerance)
        if all(j==i or lines[j].length<line.length-1e-6 for j in nearby):
            fixed.append(line)
    if len(fixed)>1:
        tree=STRtree(fixed)
        for i,line in enumerate(fixed):
            for j in tree.query(line,predicate='dwithin',distance=10/factor):
                if j>i:
                    distance=line.distance(fixed[j])
                    if distance>0:factor=max(factor,10/distance)
    return max(floor,math.ceil(padding+span*factor-1e-7))
