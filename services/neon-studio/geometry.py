"""Millimetre geometry. Cubic paths stay cubic through preview and PDF export."""
import math
from copy import deepcopy
from functools import lru_cache

import numpy as np
from scipy.integrate import quad
from shapely.geometry import LineString, Polygon, MultiPoint, Point, box
from shapely.ops import unary_union, nearest_points
from shapely import multipoints, convex_hull, STRtree, linestrings, points as shapely_points
from colors import NEON_COLORS, line_color, valid_color


DEFAULTS = dict(mode='double', shape='bottom', width=600, gap=15, tube=6,
                depth=20, radius=3)
KAPPA = 4 * (math.sqrt(2) - 1) / 3


def segments(path):
    start = prev = None
    for op, *points in path:
        if op == 'm':
            start = prev = np.array(points[0], float)
        elif op in ('l', 'c'):
            pts = np.array([prev, *points], float)
            yield op, pts
            prev = pts[-1]
        elif op == 'h' and prev is not None and np.linalg.norm(prev-start) > 1e-9:
            yield 'l', np.array([prev, start])
            prev = start


def sample_path(path, steps=40):
    points = []
    for op, pts in segments(path):
        if not points:
            points.append(pts[0].tolist())
        if op == 'l':
            points.append(pts[-1].tolist())
        else:
            t = np.linspace(0, 1, steps+1)[1:, None]
            points.extend(((1-t)**3*pts[0] + 3*(1-t)**2*t*pts[1]
                           + 3*(1-t)*t*t*pts[2] + t**3*pts[3]).tolist())
    return points


def path_length(path):
    total = 0.
    for op, pts in segments(path):
        if op == 'l':
            total += np.linalg.norm(pts[1]-pts[0])
        else:
            a, b, c = np.diff(pts, axis=0)
            total += quad(lambda t: np.linalg.norm(3*(1-t)**2*a + 6*(1-t)*t*b + 3*t*t*c),
                          0, 1, epsabs=1e-7)[0]
    return float(total)


def path_bounds(path):
    points = []
    for op, pts in segments(path):
        points.extend([pts[0], pts[-1]])
        if op == 'c':
            for axis in (0, 1):
                a, b, c, d = pts[:, axis]
                coeff = [-a+3*b-3*c+d, 2*(a-2*b+c), b-a]
                roots = np.roots(np.trim_zeros(coeff, 'f')) if any(abs(v)>1e-12 for v in coeff) else []
                for t in roots:
                    if np.isreal(t) and 0 < float(np.real(t)) < 1:
                        t = float(np.real(t))
                        points.append((1-t)**3*pts[0]+3*(1-t)**2*t*pts[1]+3*(1-t)*t*t*pts[2]+t**3*pts[3])
    arr = np.array(points)
    return [*arr.min(axis=0), *arr.max(axis=0)]


def path_d(path):
    return ' '.join('Z' if c[0]=='h' else c[0].upper()+' '+' '.join(f'{v:.5f}' for p in c[1:] for v in p) for c in path)


def transform(path, scale, dx, dy):
    return [[c[0], *[[x*scale+dx, y*scale+dy] for x,y in c[1:]]] for c in path]


def _outline_pieces(path, rect):
    """Split at rectangle crossings without flattening the retained Beziers."""
    try:
        rect=np.asarray(rect,float)
        if rect.shape!=(4,) or not np.isfinite(rect).all() or np.any(rect[2:]<=rect[:2]):
            raise ValueError()
    except (ValueError,TypeError):
        raise ValueError('Bitte ein gültiges Rechteck über einen Konturabschnitt ziehen.')

    def split(points,t):
        levels=[points]
        while len(levels[-1])>1:
            levels.append((1-t)*levels[-1][:-1]+t*levels[-1][1:])
        return np.array([v[0] for v in levels]),np.array([v[-1] for v in levels[::-1]])

    pieces=[]
    for op,points in segments(path):
        cuts=[0.,1.]
        for axis in (0,1):
            for edge in (rect[axis],rect[axis+2]):
                v=points[:,axis]
                coefficients=([v[1]-v[0],v[0]-edge] if op=='l' else
                              [-v[0]+3*v[1]-3*v[2]+v[3],3*v[0]-6*v[1]+3*v[2],-3*v[0]+3*v[1],v[0]-edge])
                roots=([-coefficients[1]/coefficients[0]] if coefficients[0] else []) if op=='l' else np.roots(np.trim_zeros(coefficients,'f'))
                for root in roots:
                    if abs(root.imag)<1e-8 and 1e-8<root.real<1-1e-8:
                        t=float(root.real);crossing=split(points,t)[0][-1]
                        if rect[1-axis]-1e-8<=crossing[1-axis]<=rect[3-axis]+1e-8:
                            cuts.append(t)
        cuts=sorted(set(round(t,10) for t in cuts))
        for a,b in zip(cuts,cuts[1:]):
            part=points if a==0 else split(points,a)[1]
            if b<1:part=split(part,(b-a)/(1-a))[0]
            middle=split(part,.5)[0][-1]
            inside=bool(np.all(middle>=rect[:2]-1e-8) and np.all(middle<=rect[2:]+1e-8))
            pieces.append((op,part,inside))
    return pieces


def straighten_outline(path, rect, radius):
    """Replace one rectangle-clipped outline run; retain all other Beziers exactly."""
    pieces=_outline_pieces(path,rect)
    starts=[i for i,p in enumerate(pieces) if p[2] and not pieces[i-1][2]]
    if len(starts)!=1:
        raise ValueError('Bitte genau einen zusammenhängenden Abschnitt der Acrylkante markieren. Das Rechteck bei Bedarf kleiner ziehen.')
    pieces=pieces[starts[0]:]+pieces[:starts[0]]
    count=next(i for i,p in enumerate(pieces) if not p[2])
    selected,remaining=pieces[:count],pieces[count:]
    a,b=selected[0][1][0],selected[-1][1][-1]
    distance=np.linalg.norm(b-a)
    if distance<.01:raise ValueError('Die Endpunkte liegen zu nah zusammen. Bitte einen größeren Abschnitt markieren.')
    direction=(b-a)/distance
    replacement=[['m',a.tolist()]]
    # Small tangent transitions avoid introducing sharp corners at the two cuts.
    blend=min(radius,distance/4)
    tangents=[]
    for points,end in ((selected[0][1],False),(selected[-1][1],True)):
        vectors=(points[-1]-points[-2::-1]) if end else (points[1:]-points[0])
        tangent=next((v/np.linalg.norm(v) for v in vectors if np.linalg.norm(v)>1e-9),direction)
        tangents.append(tangent)
    if np.linalg.norm(tangents[0]-direction)>.01:
        replacement.append(['c',(a+tangents[0]*blend/2).tolist(),(a+direction*blend/2).tolist(),(a+direction*blend).tolist()])
    end=b-direction*blend if np.linalg.norm(tangents[1]-direction)>.01 else b
    replacement.append(['l',end.tolist()])
    if np.linalg.norm(tangents[1]-direction)>.01:
        replacement.append(['c',(b-direction*blend/2).tolist(),(b-tangents[1]*blend/2).tolist(),b.tolist()])
    result=replacement+[[op,*points[1:].tolist()] for op,points,_ in remaining]+[['h']]
    original_poly=Polygon(sample_path(path,100));candidate=Polygon(sample_path(result,100))
    if not candidate.is_valid or not candidate.buffer(.03).covers(original_poly):
        raise ValueError('Diese Gerade würde Acryl abschneiden. Bitte die Einkerbung einschließlich beider geraden Anschlussstücke markieren.')
    if candidate.symmetric_difference(original_poly).area<.001:
        raise ValueError('Dieser Konturabschnitt ist bereits gerade.')
    before=[['m',a.tolist()]]+[[op,*points[1:].tolist()] for op,points,_ in selected]
    return result,dict(before=path_d(before),after=path_d(replacement))


def compact_outline(path):
    """A small editing cage of lines/automatic Beziers, independent of CNC sampling."""
    if len(path)<40:return path
    points=np.asarray(LineString(sample_path(path,20)).simplify(.015).coords)
    count=len(points)-1;result=[]
    for i in range(4):
        part=fit_curve(points[i*count//4:(i+1)*count//4+1],.3,refine=True)
        result.extend(part if not result else part[1:])
    result.append(['h'])
    poly=Polygon(sample_path(result,150))
    return result if poly.is_valid else path


def visible_outline_controls(path, protected=None):
    # The conversion depends only on the visible curve, not the drag target.
    # Return a fresh list: callers translate/edit paths after this step.
    return [[cmd[0], *[list(p) for p in cmd[1:]]]
            for cmd in _visible_outline_controls(_outline_key(path))]


def _outline_key(path):
    return tuple((cmd[0], *[tuple(p) for p in cmd[1:]]) for cmd in path)


def _indexed_hausdorff(a, b):
    """Same discrete Hausdorff distance, with indexed nearest-segment queries.

    Keep every sampled vertex in both directions. The spatial index avoids
    comparing every vertex with every segment of a densely sampled outline.
    """
    ac = np.asarray(a.coords); bc = np.asarray(b.coords)
    if len(ac)*len(bc) < 200000:
        return a.hausdorff_distance(b)
    def directed(source, target):
        tree = STRtree(linestrings(np.stack([target[:-1], target[1:]], axis=1)))
        _, distances = tree.query_nearest(shapely_points(source), all_matches=False, return_distance=True)
        return float(distances.max())
    return max(directed(ac, bc), directed(bc, ac))


@lru_cache(maxsize=32)
def _visible_outline_controls(path):
    """Materialize old clearance repairs as editable curves, once, not per drag.

    Sharp joins get explicit anchors. Bound the approximation to 0.04 mm;
    otherwise retain the original curves. The envelope never changes anchors.
    """
    if len(path)<40:return path
    points=np.asarray(LineString(sample_path(path,40)).simplify(.001).coords)
    vectors=np.diff(points,axis=0)
    unit=vectors/np.maximum(np.linalg.norm(vectors,axis=1)[:,None],1e-9)
    cuts=sorted(set([0,len(points)-1]+[i+1 for i in range(len(unit)-1) if unit[i]@unit[i+1]<.985]
                    +[i*(len(points)-1)//4 for i in range(1,4)]))
    result=[]
    for a,b in zip(cuts,cuts[1:]):
        part=fit_curve(points[a:b+1],.03,refine=True)
        result.extend(part if not result else part[1:])
    result.append(['h'])
    # Merge redundant smooth subdivisions; keep actual corners as anchors.
    # This conversion is deterministic from the visible path, independent of
    # whether a preview has already built its clearance envelope.
    parts=list(segments(result))
    while True:
        merged=[];i=0;changed=False
        while i<len(parts):
            if i+1<len(parts):
                op,a=parts[i];op2,b=parts[i+1]
                v=a[-1]-a[-2];w=b[1]-b[0]
                if v@w>.985*np.linalg.norm(v)*np.linalg.norm(w):
                    q=sample_path([M(*a[0]),[op,*a[1:].tolist()],[op2,*b[1:].tolist()]],100)
                    fit=fit_curve(q,.02,refine=True)
                    if len(fit)==2:
                        merged.extend(segments(fit));i+=2;changed=True;continue
            merged.append(parts[i]);i+=1
        parts=merged
        if not changed:break
    result=[M(*parts[0][1][0])]+[[op,*p[1:].tolist()] for op,p in parts]+[['h']]
    poly=Polygon(sample_path(result,250));original=Polygon(sample_path(path,250))
    if (not poly.is_valid or not original.is_valid or
            _indexed_hausdorff(poly.exterior,original.exterior)>.04):
        return path
    return result


@lru_cache(maxsize=128)
def _checked_anchor_step(outer, controls, action, point, target, protected,
                         replay, radius, selected, fixed_neighbors, visible, auto_handles=False):
    """Reuse completed edits; all curve/clearance inputs are part of the key.

    Shapely geometries are immutable and hash by their coordinates. A changed
    gap, motif, UV area or scale therefore cannot reuse an old clearance check.
    Preview and committed replay remain separate because validation differs.
    """
    controls, highlight = edit_outline_anchor(
        controls, action, point, target, protected, replay=replay, radius=radius,
        delete_points=selected, fixed_neighbors=fixed_neighbors, visible=visible, auto_handles=auto_handles)
    if visible:
        if action == 'delete':
            controls = visible_outline_controls(rounded_editable_outline(controls, protected, radius))
        outer = controls
    elif action != 'insert':
        outer = rounded_editable_outline(controls, protected, radius)
    return outer, controls, highlight


def edit_outline_anchor(path, action, point, target, protected, replay=False, radius=3, delete_points=None, fixed_neighbors=True, visible=False, auto_handles=False):
    """Edit visible Beziers and clamp the whole curve along the drag axis.

    Legacy edits retain their original sparse-cage behaviour during replay.
    """
    from scipy.optimize import minimize_scalar
    point=np.asarray(point,float)
    if point.shape!=(2,) or not np.isfinite(point).all():raise ValueError('Ungültiger Konturpunkt.')
    pieces=[(op,pts.copy()) for op,pts in segments(path)]
    def assemble(parts):
        return [M(*parts[0][1][0])]+[[op,*pts[1:].tolist()] for op,pts in parts]+[['h']]
    def polygon(parts):return Polygon(np.asarray(sample_path(assemble(parts),100)))
    if action=='insert':
        def at(pts,t):
            q=pts.copy()
            while len(q)>1:q=(1-t)*q[:-1]+t*q[1:]
            return q[0]
        candidates=[]
        for i,(op,pts) in enumerate(pieces):
            nearest=minimize_scalar(lambda t:np.sum((at(pts,t)-point)**2),bounds=(0,1),method='bounded')
            candidates.append((nearest.fun,i,nearest.x))
        distance,index,t=min(candidates)
        if not replay and distance>1:raise ValueError('Bitte direkt auf die Acrylkontur klicken.')
        op,pts=pieces[index]
        if min(np.linalg.norm(at(pts,t)-pts[0]),np.linalg.norm(at(pts,t)-pts[-1]))<.05:
            raise ValueError('Hier liegt bereits ein Konturpunkt.')
        levels=[pts]
        while len(levels[-1])>1:levels.append((1-t)*levels[-1][:-1]+t*levels[-1][1:])
        left=np.array([q[0] for q in levels]);right=np.array([q[-1] for q in levels[::-1]])
        pieces[index:index+1]=[(op,left),(op,right)]
        return assemble(pieces),dict(kind='anchor',action=action,point=left[-1].tolist())
    index=min(range(len(pieces)),key=lambda i:np.linalg.norm(pieces[i][1][0]-point))
    anchor=pieces[index][1][0].copy()
    if not replay and np.linalg.norm(anchor-point)>.25:
        raise ValueError('Bitte den Konturpunkt erneut auswählen.')
    if action=='delete':
        selected=np.asarray([point] if delete_points is None else delete_points,float)
        if selected.ndim!=2 or selected.shape[1]!=2 or not 0<len(selected)<=len(pieces) or not np.isfinite(selected).all():
            raise ValueError('Ungültige Konturpunktauswahl.')
        indices=set()
        for p in selected:
            nearest=min(range(len(pieces)),key=lambda i:np.linalg.norm(pieces[i][1][0]-p))
            if not replay and np.linalg.norm(pieces[nearest][1][0]-p)>.25:
                raise ValueError('Bitte die Konturpunkte erneut auswählen.')
            indices.add(nearest)
        if len(pieces)-len(indices)<4:raise ValueError('Mindestens vier Konturpunkte bleiben erhalten.')
        # Moving an anchor may already rely on automatic clearance repair.
        # Reject only newly lost coverage, not that existing cage/envelope overlap.
        covered=protected.intersection(polygon(pieces).buffer(.35))
        if len(indices)>1:
            # Resolve all anchors against the same cage, including runs crossing
            # the closing seam. Join the surviving neighbours of each removed run
            # and validate only the finished contour. Rounding happens afterwards.
            keep=[i for i in range(len(pieces)) if i not in indices]
            result=[]
            bridges=[]
            for i,j in zip(keep,keep[1:]+keep[:1]):
                if (i+1)%len(pieces)==j:result.append(pieces[i])
                else:
                    bridges.append((len(result),i,j))
                    result.append(('l',np.array([pieces[i][1][0],pieces[j][1][0]])))
            poly=polygon(result)
            if poly.is_valid and not poly.buffer(.351).covers(covered):
                # A straight replacement can clip the clearance envelope even
                # though a simple curved bridge fits. Bow only the deleted run
                # outwards, keeping both surviving anchors and all other edges.
                original=polygon(pieces)
                required=protected.intersection(original)
                for slot,i,j in bridges:
                    a,b=result[slot][1][0],result[slot][1][-1];delta=b-a
                    span=np.linalg.norm(delta)
                    if span<.01:continue
                    normal=np.array([delta[1],-delta[0]])/span
                    if not original.exterior.is_ccw:normal=-normal
                    # Validate each run against the untouched original contour;
                    # other selected runs must not block this local correction.
                    rest=[];k=j
                    while k!=i:rest.append(pieces[k]);k=(k+1)%len(pieces)
                    rest_points=np.asarray(sample_path(assemble(rest)[:-1],100))
                    t=np.linspace(0,1,101)[:,None]
                    def bridge(height):
                        return ('c',np.array([a,a+delta/3+normal*height,a+2*delta/3+normal*height,b]))
                    def safe(height):
                        curve=a+t*delta+3*t*(1-t)*normal*height
                        trial=Polygon(np.vstack([curve,rest_points[1:]]))
                        return trial.is_valid and trial.buffer(.005).covers(required)
                    if safe(0):continue
                    # Bound the repair: do not invent a large bulge to make an
                    # arbitrary deletion possible. Unsafe selections still fail.
                    high=next((span*f/32 for f in range(1,9) if safe(span*f/32)),None)
                    if high is None:continue
                    low=max(0,high-span/32)
                    for _ in range(10):
                        mid=(low+high)/2
                        if safe(mid):high=mid
                        else:low=mid
                    result[slot]=bridge(high)
                poly=polygon(result)
            if not poly.is_valid or not poly.buffer(.351).covers(covered):
                raise ValueError('Die verbleibende Kontur würde sich überschneiden oder den Randabstand unterschreiten. Bitte die Auswahl anpassen.')
            return assemble(result),dict(kind='anchor',action=action)
        # Rotate so both incident segments are contiguous, also at the closing seam.
        start=(index-1)%len(pieces);pieces=pieces[start:]+pieces[:start]
        a,b=pieces[:2];q=np.array(sample_path([M(*a[1][0]),[a[0],*a[1][1:].tolist()],[b[0],*b[1][1:].tolist()]],80))
        chord=q[-1]-q[0];span=np.linalg.norm(chord)
        if span<.01:raise ValueError('Dieser Punkt ist für die geschlossene Kontur erforderlich.')
        deviation=np.max(np.abs(chord[0]*(q[:,1]-q[0,1])-chord[1]*(q[:,0]-q[0,0])))/span
        if deviation<.01:replacement=('l',np.array([q[0],q[-1]]))
        else:
            ta=a[1][1]-a[1][0];tb=b[1][-2]-b[1][-1]
            ta/=max(np.linalg.norm(ta),1e-9);tb/=max(np.linalg.norm(tb),1e-9)
            ds=np.r_[0,np.cumsum(np.linalg.norm(np.diff(q,axis=0),axis=1))];u=ds/ds[-1]
            b0=(1-u)**3;b1=3*(1-u)**2*u;b2=3*(1-u)*u*u;b3=u**3
            matrix=np.stack([b1[:,None]*ta,b2[:,None]*tb],axis=-1).reshape(-1,2)
            rhs=(q-(b0+b1)[:,None]*q[0]-(b2+b3)[:,None]*q[-1]).reshape(-1)
            alpha=np.clip(np.linalg.lstsq(matrix,rhs,rcond=None)[0],.01,ds[-1])
            replacement=('c',np.array([q[0],q[0]+alpha[0]*ta,q[-1]+alpha[1]*tb,q[-1]]))
        pieces[:2]=[replacement];poly=polygon(pieces)
        if not poly.is_valid or not poly.buffer(.351).covers(covered):
            raise ValueError('Dieser Punkt wird für den Randabstand benötigt und kann hier nicht entfernt werden.')
        return assemble(pieces),dict(kind='anchor',action=action)
    if action!='move':raise ValueError('Unbekannte Konturkorrektur.')
    target=np.asarray(target,float)
    if target.shape!=(2,) or not np.isfinite(target).all():raise ValueError('Ungültiger Konturpunkt.')
    delta=target-point
    incoming=pieces[(index-1)%len(pieces)];outgoing=pieces[index]
    left=anchor-incoming[1][0];right=outgoing[1][-1]-anchor
    left_length=np.linalg.norm(left);right_length=np.linalg.norm(right)
    tangent=left/max(left_length,1e-9)
    straight=(incoming[0]==outgoing[0]=='l' and left_length>.01 and right_length>.01
              and np.dot(tangent,right/right_length)>.999999)
    normal_delta=delta-tangent*np.dot(delta,tangent)
    local_bend=straight and np.linalg.norm(normal_delta)>1e-6
    ta=anchor-incoming[1][-2];tb=outgoing[1][1]-anchor
    smooth=(incoming[0]==outgoing[0]=='c' and
            np.dot(ta,tb)>0 and abs(ta[0]*tb[1]-ta[1]*tb[0])<1e-6*max(np.linalg.norm(ta)*np.linalg.norm(tb),1))
    # A new point on a straight edge bends only its neighbourhood. Long
    # diagonals to the old endpoints would cross neon and create hidden steps
    # when the clearance envelope is unioned into the final contour.
    covered=protected.intersection(polygon(pieces)) if visible or local_bend or smooth else None
    # Only the selected anchor and its incident handles move. Replay old saved
    # edits with their original fillet grouping so existing designs do not change.
    moving={index}
    if not fixed_neighbors:
        for direction in (-1,1):
            i=index;distance=0.
            for _ in range(len(pieces)-1):
                j=(i-1)%len(pieces) if direction<0 else i
                length=np.linalg.norm(np.diff(pieces[j][1],axis=0),axis=1).sum()
                if distance+length>4*radius+.05:break
                distance+=length;i=(i+direction)%len(pieces);moving.add(i)
    def moved(fraction):
        if local_bend:
            displacement=delta*fraction;destination=anchor+displacement
            reach=max(4*radius,2*np.linalg.norm(normal_delta)*fraction,.1)
            a=anchor-tangent*min(reach,left_length);b=anchor+tangent*min(reach,right_length)
            la=np.dot(destination-a,tangent);lb=np.dot(b-destination,tangent)
            start=(index-1)%len(pieces);result=pieces[start:]+pieces[:start]
            replacement=[]
            if np.linalg.norm(a-incoming[1][0])>1e-8:replacement.append(('l',np.array([incoming[1][0],a])))
            replacement.extend([
                ('c',np.array([a,a+tangent*la/3,destination-tangent*la/3,destination])),
                ('c',np.array([destination,destination+tangent*lb/3,b-tangent*lb/3,b]))])
            if np.linalg.norm(b-outgoing[1][-1])>1e-8:replacement.append(('l',np.array([b,outgoing[1][-1]])))
            return replacement+result[2:]
        result=[(op,pts.copy()) for op,pts in pieces]
        if visible:
            for j in ((index-1)%len(result),index):
                op,p=result[j]
                if op=='l':
                    v=(p[-1]-p[0])/3
                    result[j]=('c',np.array([p[0],p[0]+v,p[-1]-v,p[-1]]))
        for i,(op,pts) in enumerate(result):
            if i in moving:
                pts[0]+=delta*fraction
                if op=='c':pts[1]+=delta*fraction
            if (i+1)%len(result) in moving:
                pts[-1]+=delta*fraction
                if op=='c':pts[-2]+=delta*fraction
        return result
    # Do not let a drag jump through a narrow neck to another valid polygon.
    # Visible-curve edits keep the existing protected coverage; they never
    # repair an invalid drag later by silently adding new boundary segments.
    allowed=protected.buffer(-.18)
    initial_inside=allowed.contains(Point(anchor))
    t=np.linspace(0,1,81 if auto_handles else 41)[:,None];u=1-t
    def curvature(p):
        d=3*(u*u*(p[1]-p[0])+2*u*t*(p[2]-p[1])+t*t*(p[3]-p[2]))
        dd=6*(u*(p[2]-2*p[1]+p[0])+t*(p[3]-2*p[2]+p[1]))
        return np.abs(d[:,0]*dd[:,1]-d[:,1]*dd[:,0])/np.maximum(np.linalg.norm(d,axis=1)**3,1e-12)
    limit=1/max(radius,.001)
    if visible:
        # Existing fitted fillets may be tighter; do not make them worse.
        for op,p in (incoming,outgoing):
            if op=='c':limit=max(limit,float(np.max(curvature(p))))
    def too_tight(parts,destination):
        return (local_bend or visible) and any(op=='c' and
            (np.linalg.norm(p[0]-destination)<1e-8 or np.linalg.norm(p[-1]-destination)<1e-8)
            and np.max(curvature(p))>limit+1e-6 for op,p in parts)
    candidates={}
    def candidate(fraction):
        if fraction in candidates:return candidates[fraction]
        result=moved(fraction);destination=anchor+delta*fraction
        if auto_handles and visible and fixed_neighbors and not local_bend and too_tight(result,destination):
            # Refit only the two incident curves. Neighbour anchors and their
            # tangent directions stay fixed; no extra boundary points appear.
            from scipy.optimize import minimize
            before=(index-1)%len(result);a=result[before][1];b=result[index][1]
            la=np.linalg.norm(destination-a[0]);lb=np.linalg.norm(b[-1]-destination)
            left=a[1]-a[0];right=b[-1]-b[-2]
            nl=np.linalg.norm(left);nr=np.linalg.norm(right)
            if min(la,lb,nl,nr)>.01:
                left=left/nl;right=right/nr
                tangent=(destination-a[0])/la+(b[-1]-destination)/lb
                angle=np.arctan2(tangent[1],tangent[0])
                initial=np.array([la/3,la/3,lb/3,lb/3,angle])
                def curves(v):
                    tangent=np.array([np.cos(v[4]),np.sin(v[4])])
                    return (np.array([a[0],a[0]+left*v[0],destination-tangent*v[1],destination]),
                            np.array([destination,destination+tangent*v[2],b[-1]-right*v[3],b[-1]]))
                def cost(v):
                    return np.sum(((v[:4]-initial[:4])/[la,la,lb,lb])**2)+.01*(v[4]-angle)**2
                def radius_constraint(v):
                    x,y=curves(v)
                    return np.r_[limit*.998-curvature(x),limit*.998-curvature(y)]
                fit=minimize(cost,initial,method='SLSQP',
                    bounds=[(.01,la*1.5),(.01,la*1.5),(.01,lb*1.5),(.01,lb*1.5),(angle-np.pi/2,angle+np.pi/2)],
                    constraints=[{'type':'ineq','fun':radius_constraint}],options={'maxiter':60,'ftol':1e-8})
                if fit.success and np.min(radius_constraint(fit.x))>=-1e-6:
                    x,y=curves(fit.x);result[before]=('c',x);result[index]=('c',y)
        candidates[fraction]=result
        return result
    constraint=None
    def valid(fraction):
        nonlocal constraint
        parts=candidate(fraction);poly=polygon(parts);destination=anchor+delta*fraction
        if not poly.is_valid:
            constraint='intersection';return False
        if (not initial_inside and allowed.contains(Point(destination))) or (covered is not None and not poly.buffer(.001).covers(covered)):
            constraint='clearance';return False
        if too_tight(parts,destination):
            constraint='radius';return False
        return True
    fraction=0.;constrained=False
    for step in np.linspace(1/16,1,16):
        if not valid(step):
            low,high=fraction,step
            for _ in range(16):
                mid=(low+high)/2
                if valid(mid):low=mid
                else:high=mid
            fraction=low;constrained=True;break
        fraction=step
    return assemble(candidate(fraction)),dict(kind='anchor',action=action,point=(anchor+delta*fraction).tolist(),constrained=constrained,constraint=constraint if constrained else None)


def rounded_editable_outline(controls, protected, radius):
    """Resolve automatic corners against the immutable neon/UV clearance."""
    poly=Polygon(sample_path(controls,180))
    if not poly.is_valid:raise ValueError('Diese Bewegung würde die Acrylkontur überschneiden.')
    limits=poly.union(protected).bounds
    poly=poly.buffer(radius,quad_segs=24).buffer(-2*radius,quad_segs=24).buffer(radius,quad_segs=24)
    # A small numerical cushion covers buffer chord and curve-fit errors, not tube width.
    poly=poly.union(protected.buffer(.035,quad_segs=32)).intersection(box(*limits))
    if poly.geom_type!='Polygon':raise ValueError('Diese Bewegung würde die Acrylkontur trennen.')
    points=np.array(poly.exterior.coords);count=len(points)-1;result=[]
    for i in range(4):
        part=fit_curve(points[i*count//4:(i+1)*count//4+1],.012)
        result.extend(part if not result else part[1:])
    result.append(['h']);fitted=Polygon(sample_path(result,250))
    if not fitted.is_valid or not fitted.covers(protected):
        return [M(*points[0])]+[L(*q) for q in points[1:]]+[['h']]
    return result


def move_outline_point(path, point, target, radius, protected, replay=False):
    """Move an outline anchor and its adjacent handles, then round locally.

    The neon/UV envelope is immutable. Crossing drags are rejected;
    the protected envelope limits inward movements at the neon clearance.
    """
    try:
        point=np.asarray(point,float);target=np.asarray(target,float)
        if point.shape!=(2,) or target.shape!=(2,) or not np.isfinite([point,target]).all():raise ValueError()
    except (ValueError,TypeError):
        raise ValueError('Ungültiger Konturpunkt.')
    pieces=[(op,pts.copy()) for op,pts in segments(path)]
    if not pieces:raise ValueError('Keine bearbeitbare Acrylkontur vorhanden.')
    index=min(range(len(pieces)),key=lambda i:np.linalg.norm(pieces[i][1][0]-point))
    anchor=pieces[index][1][0].copy()
    if not replay and np.linalg.norm(anchor-point)>.2:
        raise ValueError('Der Konturpunkt hat sich geändert. Bitte den Punkt erneut auswählen.')
    # Stored movements follow the motif scale. Changing the gap/radius shifts
    # its anchors, so replay the displacement at the nearest current anchor.
    delta=target-point
    if np.linalg.norm(delta)<.001:return path,dict(kind='point')
    # A small fillet has two anchors. Carry both together so dragging either
    # cannot fold the existing radius over its neighbouring straight edge.
    moving={index}
    for direction in (-1,1):
        i=index;distance=0
        for _ in range(len(pieces)-1):
            j=(i-1)%len(pieces) if direction<0 else i
            op,pts=pieces[j]
            length=np.linalg.norm(np.diff(pts,axis=0),axis=1).sum()
            if distance+length>4*radius+.05:break
            distance+=length;i=(i+direction)%len(pieces);moving.add(i)
    affected=[]
    for i,(op,pts) in enumerate(pieces):
        start=i in moving;end=(i+1)%len(pieces) in moving
        if not start and not end:continue
        affected.append(pts.copy())
        if start:
            pts[0]+=delta
            if op=='c':pts[1]+=delta
        if end:
            pts[-1]+=delta
            if op=='c':pts[-2]+=delta
        affected.append(pts.copy())
    alternative=[M(*pieces[0][1][0])]+[[op,*pts[1:].tolist()] for op,pts in pieces]+[['h']]
    candidate=Polygon(sample_path(alternative,100))
    if not candidate.is_valid:
        raise ValueError('Diese Bewegung würde die Acrylkontur überschneiden. Bitte den Punkt weniger weit ziehen.')
    constrained=not candidate.buffer(.04).covers(protected)
    affected=np.vstack(affected)
    # Leave room for the selected corner radius without changing distant runs.
    margin=max(4*radius,.5)
    rect=[*(affected.min(axis=0)-margin),*(affected.max(axis=0)+margin)]
    result=local_outline_depth(path,alternative,rect,radius,protected)
    poly=Polygon(sample_path(result,200))
    if not poly.is_valid or not poly.buffer(.04).covers(protected):
        raise ValueError('Der Punkt lässt sich mit diesem Randabstand und Eckenradius nicht verschieben.')
    return result,dict(kind='point',constrained=constrained)


def local_outline_depth(path, alternative, rect, radius, protected):
    """Use another depth only inside a selection, with transitions inside its edge.

    Outside runs retain their exact line/Bezier commands. The protected motif
    offset prevents local rounding from reducing the requested neon clearance.
    """
    pieces=_outline_pieces(path,rect)
    if not any(p[2] for p in pieces):
        raise ValueError('Bitte den Bereich einschließlich der Acrylkante markieren.')
    window=box(*rect)
    blend=min(radius,(rect[2]-rect[0])/8,(rect[3]-rect[1])/8)
    inner=window.buffer(-2*blend,join_style=2)
    # Sample each split segment separately: rectangle intersections stay exact.
    original=Polygon([p for op,pts,_ in pieces for p in sample_path([M(*pts[0]),[op,*pts[1:].tolist()]],100)[:-1]])
    target=Polygon(sample_path(alternative,100))
    change=original.symmetric_difference(target).intersection(inner)
    if change.area<1e-6:
        return path
    candidate=original.difference(inner).union(target.intersection(inner))
    # Round both inward and outward shoulders, then restore clearance. All
    # changed geometry is clipped to the requested rectangle below.
    candidate=candidate.buffer(blend,quad_segs=20).buffer(-2*blend,quad_segs=20).buffer(blend,quad_segs=20)
    candidate=candidate.union(protected)
    candidate=original.difference(window).union(candidate.intersection(window))
    if candidate.geom_type!='Polygon' or not candidate.is_valid:
        raise ValueError('Bitte den Bereich etwas größer markieren, damit die Acrylplatte zusammenhängend bleibt.')
    candidate=Polygon(candidate.exterior)
    # Reassemble the original outside segments and fitted inside runs by their
    # common endpoints. This leaves every curve outside the rectangle untouched.
    sampled=[M(*candidate.exterior.coords[0]),*[L(*p) for p in list(candidate.exterior.coords)[1:]],['h']]
    changed=_outline_pieces(sampled,rect)
    starts=[i for i,p in enumerate(changed) if p[2] and not changed[i-1][2]]
    inside_runs=[]
    if starts:
        for start in starts:
            pts=[changed[start][1][0]];i=start
            while changed[i][2]:
                pts.append(changed[i][1][-1]);i=(i+1)%len(changed)
            inside_runs.append(pts)
    elif all(p[2] for p in changed):
        pts=np.array(candidate.exterior.coords);ids=np.linspace(0,len(pts)-1,5,dtype=int)
        inside_runs=[pts[a:b+1] for a,b in zip(ids,ids[1:])]
    outside=[[M(*pts[0]),[op,*pts[1:].tolist()]] for op,pts,inside in pieces if not inside]
    anchors=[np.array(point) for run in outside for point in (run[0][1],run[-1][-1])]
    def soften_end(points):
        # A small corner radius cannot hide a large jump between two depths.
        # Replace that jump with a tangent bridge, entirely inside the selection.
        a=points[0]
        offset=target.exterior.distance(MultiPoint([a]))
        if offset<.05:return points
        tangent=None
        for _,part,inside in pieces:
            if not inside:continue
            for end in (0,-1):
                if np.linalg.norm(part[end]-a)<.03:
                    vectors=part[1:]-a if end==0 else part[-2::-1]-a
                    tangent=next((v/np.linalg.norm(v) for v in vectors if np.linalg.norm(v)>1e-8),None)
                    break
            if tangent is not None:break
        if tangent is None:return points
        distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points,axis=0),axis=1))]
        # Try a broad, smooth bridge first. A shorter bridge may be needed next
        # to a letter; none may cross the protected neon offset.
        extent=min(max(4*radius,3*offset),distances[-1]*.4)
        for span in (extent,extent*.8,extent*.6,extent*.4,extent*.25):
            # Measure along the incoming direction so a vertical step does not
            # consume the transition's width before we reach the other level.
            projections=(points-a)@tangent
            crossings=np.flatnonzero((projections>=span)&(distances<=distances[-1]*.48))
            if not len(crossings):continue
            index=int(crossings[0])
            if index<1:continue
            t=(span-projections[index-1])/(projections[index]-projections[index-1])
            b=points[index-1]+t*(points[index]-points[index-1])
            direction=points[index]-points[index-1]
            direction/=np.linalg.norm(direction)
            handle=np.linalg.norm(b-a)/3
            curve=[M(*a),C(*(a+tangent*handle),*(b-direction*handle),*b)]
            samples=np.array(sample_path(curve,80))
            bridge=LineString(samples)
            if not window.buffer(.001).covers(bridge) or protected.buffer(-.02).intersects(bridge):continue
            return np.vstack((samples,points[index:]))
        return points
    cleaned=[]
    for pts in inside_runs:
        pts=np.array(pts,float)
        # Boolean clipping and analytic rectangle intersections differ by tiny
        # rounding errors. Share the exact outside endpoint, avoiding micro-loops.
        for end in (0,-1):
            if anchors:
                nearest=min(anchors,key=lambda point:np.linalg.norm(point-pts[end]))
                if np.linalg.norm(nearest-pts[end])<.03:pts[end]=nearest
        keep=[pts[0]]
        for point in pts[1:]:
            if np.linalg.norm(point-keep[-1])>1e-6:keep.append(point)
        keep[-1]=pts[-1]
        if len(keep)>1:
            keep=soften_end(np.array(keep))
            keep=soften_end(keep[::-1])[::-1]
            cleaned.append(keep)
    for fitted in (True,False):
        # Starting with an original segment also retains its winding direction.
        runs=outside+[fit_curve(LineString(pts).simplify(.002).coords,.01) if fitted else
              [M(*pts[0]),*[L(*p) for p in pts[1:]]] for pts in cleaned]
        if not runs:return path
        result=runs.pop(0).copy()
        while runs:
            end=np.array(result[-1][-1])
            distance,index,reverse=min((np.linalg.norm(end-np.array(run[-1][-1] if rev else run[0][1])),i,rev)
                                       for i,run in enumerate(runs) for rev in (False,True))
            if distance>.03:
                raise ValueError('Die Übergänge liegen zu nah an der Auswahlkante. Bitte den Bereich etwas größer markieren.')
            run=runs.pop(index)
            if reverse:
                run=[M(*run[-1][-1])]+[[op,*pts[-2::-1].tolist()] for op,pts in list(segments(run))[::-1]]
            result.extend(run[1:])
        result.append(['h'])
        poly=Polygon(sample_path(result,100))
        if poly.is_valid and poly.buffer(.04).covers(protected):return result
    raise ValueError('Bitte den Bereich etwas größer markieren, damit die Kontur gültig bleibt.')


def M(x,y): return ['m', [float(x),float(y)]]
def L(x,y): return ['l', [float(x),float(y)]]
def C(*a): return ['c', list(map(float,a[:2])), list(map(float,a[2:4])), list(map(float,a[4:]))]


def rounded_outline(w, h, radius, bottom_radius, notches=(), depth=0):
    r = radius; R = bottom_radius; k = KAPPA
    p = [M(r,0), C(r-k*r,0,0,r-k*r,0,r), L(0,h-R),
         C(0,h-R+k*R,R-k*R,h,R,h)]
    for a,b in notches:
        middle=(a+b)/2; q=(b-a)/4
        p.extend([L(a,h), C(a+q,h,middle-q,h-depth,middle,h-depth),
                  C(middle+q,h-depth,b-q,h,b,h)])
    p.extend([L(w-R,h), C(w-R+k*R,h,w,h-R+k*R,w,h-R), L(w,r),
              C(w,r-k*r,w-r+k*r,0,w-r,0), L(r,0), ['h']])
    return p


def fit_curve(points, tolerance=.2, refine=False):
    """Sparse tangent-constrained cubic fit; split at measured maximum deviation."""
    points = np.array(points, dtype=float)
    if len(points)<2:
        return []
    out=[M(*points[0])]

    def recurse(q, tangent0, tangent1, level=0):
        if len(q)<=2:
            out.append(L(*q[-1])); return
        chord = q[-1]-q[0]; span = np.linalg.norm(chord)
        if span>1e-9:
            delta=q-q[0]
            deviation=np.abs(chord[0]*delta[:,1]-chord[1]*delta[:,0])/span
            along=(q-q[0])@chord/(span*span)
            if deviation.max()<=tolerance and along.min()>=0 and along.max()<=1:
                out.append(L(*q[-1])); return
        ds=np.r_[0,np.cumsum(np.linalg.norm(np.diff(q,axis=0),axis=1))]
        if ds[-1]<1e-9:
            return
        u=ds/ds[-1]; b0=(1-u)**3; b1=3*(1-u)**2*u; b2=3*(1-u)*u*u; b3=u**3
        mat=np.stack([b1[:,None]*tangent0, b2[:,None]*tangent1],axis=-1).reshape(-1,2)
        rhs=(q-(b0+b1)[:,None]*q[0]-(b2+b3)[:,None]*q[-1]).reshape(-1)
        alpha=np.linalg.lstsq(mat,rhs,rcond=None)[0]
        alpha=np.clip(alpha, .01, ds[-1]*1.5)
        a=q[0]+alpha[0]*tangent0; b=q[-1]+alpha[1]*tangent1
        estimate=b0[:,None]*q[0]+b1[:,None]*a+b2[:,None]*b+b3[:,None]*q[-1]
        if refine:
            # Editing controls need geometric fit, not equal arc-length timing.
            # Refine point parameters before adding another anchor to a smooth arc.
            for _ in range(12):
                t=u[:,None];v=1-t
                first=3*v*v*(a-q[0])+6*v*t*(b-a)+3*t*t*(q[-1]-b)
                second=6*v*(b-2*a+q[0])+6*t*(q[-1]-2*b+a)
                error=estimate-q;den=np.sum(first*first+error*second,axis=1)
                step=np.divide(np.sum(error*first,axis=1),den,out=np.zeros_like(u),where=np.abs(den)>1e-10)
                revised=np.clip(u-step,0,1)
                if np.any(np.diff(revised)<0):break
                u=revised;b0=(1-u)**3;b1=3*(1-u)**2*u;b2=3*(1-u)*u*u;b3=u**3
                mat=np.stack([b1[:,None]*tangent0,b2[:,None]*tangent1],axis=-1).reshape(-1,2)
                rhs=(q-(b0+b1)[:,None]*q[0]-(b2+b3)[:,None]*q[-1]).reshape(-1)
                alpha=np.clip(np.linalg.lstsq(mat,rhs,rcond=None)[0],.01,ds[-1]*1.5)
                a=q[0]+alpha[0]*tangent0;b=q[-1]+alpha[1]*tangent1
                estimate=b0[:,None]*q[0]+b1[:,None]*a+b2[:,None]*b+b3[:,None]*q[-1]
                if np.max(np.linalg.norm(estimate-q,axis=1))<=tolerance:break
        errors=np.linalg.norm(q-estimate,axis=1); index=int(np.argmax(errors))
        t=np.linspace(0,1,65)[:,None]
        sampled=(1-t)**3*q[0]+3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3*q[-1]
        deviation=LineString(q).hausdorff_distance(LineString(sampled))
        if errors[index]<=tolerance and deviation<=tolerance:
            out.append(C(*a,*b,*q[-1])); return
        if level>=16:
            out.extend(L(*point) for point in q[1:]);return
        if deviation>tolerance and errors[index]<=tolerance:index=len(q)//2
        index=max(1,min(len(q)-2,index))
        tangent=q[index+1]-q[index-1]; tangent=tangent/max(np.linalg.norm(tangent),1e-9)
        recurse(q[:index+1],tangent0,-tangent,level+1)
        recurse(q[index:],tangent,tangent1,level+1)

    # Anchor genuine sharp vertices instead of rounding letter corners accidentally.
    diffs=np.diff(points,axis=0); norms=np.linalg.norm(diffs,axis=1)
    unit=diffs/np.maximum(norms[:,None],1e-9)
    cuts=[0]+[i+1 for i in range(len(unit)-1) if unit[i]@unit[i+1]<.65]+[len(points)-1]
    for first,last in zip(cuts,cuts[1:]):
        q=points[first:last+1]
        a=q[1]-q[0]; a/=max(np.linalg.norm(a),1e-9)
        b=q[-2]-q[-1]; b/=max(np.linalg.norm(b),1e-9)
        recurse(q,a,b)
    return out


def _side_inset(hull, depths):
    """Inset a convex envelope by side, using inward half-plane clipping.

    Sloping faces blend the two adjacent side settings. Coordinates follow the
    drawing (positive y points down). Equal settings retain the original inset.
    """
    from shapely.geometry.polygon import orient
    points=list(orient(hull, sign=1).exterior.coords)[:-1]
    clipped=points[:]
    for a,b in zip(points,points[1:]+points[:1]):
        dx,dy=b[0]-a[0],b[1]-a[1]
        length=math.hypot(dx,dy)
        if length<1e-10:continue
        nx,ny=dy/length,-dx/length  # outward normal
        horizontal=depths['right' if nx>=0 else 'left']
        vertical=depths['bottom' if ny>=0 else 'top']
        depth=(abs(nx)*horizontal+abs(ny)*vertical)/(abs(nx)+abs(ny))
        limit=nx*a[0]+ny*a[1]-depth
        result=[]
        for p,q in zip(clipped,clipped[1:]+clipped[:1]):
            dp=nx*p[0]+ny*p[1]-limit;dq=nx*q[0]+ny*q[1]-limit
            if dp<=0:result.append(p)
            if (dp<=0)!=(dq<=0):
                t=dp/(dp-dq)
                result.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
        clipped=result
        if len(clipped)<3:return Polygon()
    return Polygon(clipped)


def _directional_buffer(core, paddings):
    """Minkowski envelope with a convex, four-radius rounded offset kernel.

    Cardinal radii are the requested left/right/top/bottom clearances. Keeping
    the origin inside the kernel preserves the motif, even for unequal sides.
    """
    if len(set(paddings.values()))==1:
        return core.buffer(next(iter(paddings.values())),quad_segs=20)
    angles=np.linspace(0,2*math.pi,129)[:-1]
    kernel=np.array([(math.cos(t)*paddings['right' if math.cos(t)>=0 else 'left'],
                      math.sin(t)*paddings['bottom' if math.sin(t)>=0 else 'top']) for t in angles])
    # Remove redundant samples below 0.005 mm, then construct all segment
    # envelopes in GEOS as one batch instead of thousands of Python calls.
    boundary=core.exterior if core.geom_type=='Polygon' else core
    coords=np.asarray(boundary.simplify(.005,preserve_topology=True).coords)
    clouds=np.concatenate((coords[:-1,None,:]+kernel,coords[1:,None,:]+kernel),axis=1)
    pieces=convex_hull(multipoints(clouds))
    return unary_union([core,*pieces] if core.geom_type=='Polygon' else pieces)


def _full_shape(lines, padding, radius, depth, depths=None, paddings=None):
    # Close the outline of each component, preserving useful exterior concavities.
    pieces=[]
    for line in lines:
        poly=Polygon(line.coords) if len(line.coords)>=3 else Polygon()
        core=poly if poly.is_valid and poly.area>1 else line
        pieces.append(_directional_buffer(core,paddings) if paddings else core.buffer(padding, quad_segs=20))
    merged=unary_union(pieces)
    # Connect disjoint components by the shortest visible bridge, never emit islands.
    while merged.geom_type=='MultiPolygon':
        parts=list(merged.geoms)
        _,a,b=min((parts[i].distance(parts[j]),i,j) for i in range(len(parts)) for j in range(i))
        p,q=nearest_points(parts[a],parts[b])
        bridge=LineString([p,q]).buffer(max(2,padding),quad_segs=12)
        merged=unary_union([merged,bridge])
    merged=Polygon(merged.exterior)
    # Fill recesses deeper than the requested distance from the outer envelope.
    # Rounded inset + union preserves the original clearance around every route.
    hull=merged.convex_hull
    # The rounded cap contains the entire inset: rounding must never deepen a
    # corner past the maximum. Clipping keeps the original outside dimensions.
    if depths and len(set(depths.values()))>1:
        inset=_side_inset(hull,depths)
    else:
        inset=hull.buffer(-next(iter(depths.values()),depth),quad_segs=20) if depths else hull.buffer(-depth,quad_segs=20)
    cap=inset.buffer(radius,quad_segs=20).intersection(hull)
    if not cap.is_empty:
        merged=unary_union([merged,cap])
        merged=Polygon(merged.exterior)
    smoothing=max(1,radius)
    merged=merged.buffer(smoothing,quad_segs=20).buffer(-smoothing,quad_segs=20)
    # Keep fitting error small without adding an invisible padding allowance.
    contour=LineString(merged.exterior.coords).simplify(.01,preserve_topology=True)
    points=np.array(contour.coords)
    # Split a closed loop into quarters for stable fits with nonzero endpoints.
    ids=np.linspace(0,len(points)-1,5,dtype=int)
    path=[]
    for a,b in zip(ids,ids[1:]):
        part=fit_curve(points[a:b+1],.01)
        path.extend(part if not path else part[1:])
    path.append(['h'])
    fitted=Polygon(sample_path(path,40))
    if not fitted.is_valid or any(not fitted.covers(line) or fitted.exterior.distance(line)<padding-.09 for line in lines):
        # A valid rounded GEOS outline is preferable to a cubic fit that cuts inward.
        path=[M(*points[0]),*[L(*p) for p in points[1:]],['h']]
    return path


def build_geometry(model, options=None, *, editable=True, sizing_probe=False, uncut_probe=False):
    settings={**DEFAULTS, 'reserve':.1, **(options or {})}
    if settings.get('geometricSizing'):
        settings.update(tube=6,gap=15,gapSides={},autoRoute=False)
    elif settings.get('autoRoute'):settings['tube']=8
    if settings['mode'] not in ('single','double') or settings['shape'] not in ('rectangle','bottom','shape'):
        raise ValueError('Unbekannter Linienmodus oder Plattenform.')
    limits={'width':(80,20000),'gap':(2,100),'tube':(1,30),'depth':(0,20000),'radius':(.5,40),'reserve':(.001,20)}
    # A fixed-scale drawing can shrink below the initial width limit after hiding
    # paths. Its actual width is derived below; keep restoration possible.
    if settings.get('scale') is not None:
        limits['width']=(1,20000)
    for key,(low,high) in limits.items():
        try: value=float(settings[key])
        except (ValueError,TypeError): raise ValueError(f'Ungültiger Wert: {key}.')
        if not math.isfinite(value) or not low<=value<=high:
            raise ValueError(f'{key}: Wert zwischen {low:g} und {high:g} erforderlich.')
        settings[key]=value
    overrides=settings.get('depthSides',{})
    sides=('left','right','top','bottom')
    if not isinstance(overrides,dict) or any(key not in sides for key in overrides):
        raise ValueError('Ungültige Seite für die Einkerbung.')
    try:overrides={key:float(value) for key,value in overrides.items()}
    except (ValueError,TypeError):raise ValueError('Ungültige Einkerbung je Seite.')
    if any(not math.isfinite(value) or not 0<=value<=20000 for value in overrides.values()):
        raise ValueError('Einkerbung je Seite: Wert zwischen 0 und 20.000 mm erforderlich.')
    settings['depthSides']=overrides
    side_depths={side:overrides.get(side,settings['depth']) for side in sides}
    regions=settings.get('depthRegions',[])
    if not isinstance(regions,list) or len(regions)>50:
        raise ValueError('Höchstens 50 Bereiche für die Einkerbung sind möglich.')
    clean_regions=[]
    for region in regions:
        try:
            rect=np.asarray(region['rect'],float);value=float(region['depth'])
            if rect.shape!=(4,) or not np.isfinite(rect).all() or np.any(rect[2:]<=rect[:2]):raise ValueError()
            if not math.isfinite(value) or not 0<=value<=20000:raise ValueError()
        except (KeyError,ValueError,TypeError):
            raise ValueError('Ungültiger Bereich: Rechteck und Einkerbung von 0 bis 20.000 mm erforderlich.')
        clean_regions.append(dict(rect=rect.tolist(),depth=value))
    settings['depthRegions']=clean_regions
    gaps=settings.get('gapSides',{})
    if not isinstance(gaps,dict) or any(key not in sides for key in gaps):
        raise ValueError('Ungültige Seite für den Randabstand.')
    try:gaps={key:float(value) for key,value in gaps.items()}
    except (ValueError,TypeError):raise ValueError('Ungültiger Randabstand je Seite.')
    if any(not math.isfinite(value) or not 2<=value<=100 for value in gaps.values()):
        raise ValueError('Randabstand je Seite: Wert zwischen 2 und 100 mm erforderlich.')
    settings['gapSides']=gaps
    edge_allowance=settings['tube']/2 if settings.get('autoRoute') or settings.get('geometricSizing') else 0
    side_gaps={side:gaps.get(side,settings['gap'])+edge_allowance for side in sides}
    part_modes=settings.get('partModes',{})
    part_ids={p['id'] for p in model['parts']}
    if not isinstance(part_modes,dict) or any(key not in part_ids or mode not in ('single','double') for key,mode in part_modes.items()):
        raise ValueError('Ungültige Linienart für einen Motivbereich.')
    settings['partModes']=part_modes
    outline_indices=set();outline_parts={}
    if model.get('sourceKind')=='vector' and (settings['mode']=='single' or 'single' in part_modes.values()):
        from vector_import import ensure_vector_single
        outline_indices,outline_parts=ensure_vector_single(model,[key for key,mode in part_modes.items() if mode=='single'])
    from path_splitting import path_catalog, ancestors
    catalog,expanded=path_catalog(model,settings)
    settings['straightened']={key:sorted(set(indices)) for key,indices in settings.get('straightened',{}).items() if indices}
    colors=settings.get('pathColors',{})
    if not isinstance(colors,dict) or any(key not in catalog or not valid_color(value) for key,value in colors.items()):
        raise ValueError('Ungültige Farbe für einen Neonpfad.')
    settings['pathColors']=colors
    color_sources={key:item.get('sourceColor','#1748bd') for key,item in catalog.items()}
    resolved_colors={key:line_color(color_sources[key],next((colors[a] for a in ancestors(key) if a in colors),None)) for key in catalog}
    hidden=settings.get('hiddenPaths',[])
    if not isinstance(hidden,list) or any(not isinstance(key,str) or key not in catalog for key in hidden):
        raise ValueError('Ungültiger ausgeblendeter Neonpfad.')
    settings['hiddenPaths']=list(dict.fromkeys(hidden))
    hidden_paths=[{'key':key,'name':catalog[key]['name'],'mode':key.split(':')[0],'color':resolved_colors[key]} for key in settings['hiddenPaths']]
    bases=[f'{mode}:{i}' for mode in ('double','single') for i,item in enumerate(model['modes'][mode])
           if part_modes.get(item['partId'],settings['mode'])==mode
           and (i in outline_indices if item.get('outlineParts') else not (mode=='single' and item['partId'] in outline_parts))]
    source=[dict(catalog[leaf]) for key in bases for leaf in expanded[key]]
    if not source:
        raise ValueError('Keine verwertbaren Neonlinien erkannt.')
    scale_bounds=np.array([path_bounds(item['commands']) for item in source])
    scale_width=scale_bounds[:,2].max()-scale_bounds[:,0].min()
    source=[item for item in source if not any(a in hidden for a in ancestors(item['key']))]
    # A division is only a selection change. Keep the original sampling for
    # acrylic support unless a section is actually hidden or reshaped.
    visible_keys={item['key'] for item in source}
    support_source=[]
    for key in bases:
        leaves=expanded[key]
        unchanged=all(leaf in visible_keys for leaf in leaves) and not any(
            a in settings['straightened'] for leaf in leaves for a in ancestors(leaf) if a!=key) and all(
            catalog[leaf]['offset']==catalog[key]['offset'] for leaf in leaves)
        support_source.extend([catalog[key]] if unchanged else [catalog[leaf] for leaf in leaves if leaf in visible_keys])
    # Fixed physical dot dimensions are applied before the acrylic and length
    # calculations. Other artwork retains its original proportional scale.
    if any(item.get('role')=='dot' for item in source):
        dot_scale=float(settings['scale']) if settings.get('scale') is not None else (settings['width']-side_gaps['left']-side_gaps['right'])/max(scale_width,.00001)
        if not math.isfinite(dot_scale) or not .0001<=dot_scale<=1000:raise ValueError('Ungültiger Motivmaßstab.')
        from manufacturing import normalize_dot
        source=[normalize_dot(item,dot_scale) for item in source]
        support_source=[normalize_dot(item,dot_scale) for item in support_source]
    reference=np.asarray(model['sourceOrigin']) if 'sourceOrigin' in model else np.array([path_bounds(p['commands']) for p in model['modes']['double']])[:,:2].min(axis=0)
    from uv_print import uv_geometry, subtract_mask, polygon_commands, subpaths
    uv_mask,uv_shape,uv_clip=uv_geometry(model,settings.get('uvStrokes',[]),reference,settings.get('uvMode','original'),hidden)
    if not uv_mask.is_empty:
        clipped=[]
        for item in source:
            commands=subtract_mask(item['commands'],uv_mask)
            if len(commands)>1:clipped.append({**item,'commands':commands,'length':path_length(commands)})
        source=clipped
    source=[{**item,'commands':transform(item['commands'],1,*item['offset'])} for item in source]
    uv_support=subpaths(polygon_commands(uv_shape))
    if not source and not uv_support:
        # Keep the original viewport and recovery list when the last path is hidden.
        empty=build_geometry(model,{**settings,'hiddenPaths':[],'uvStrokes':[]})
        empty.update(paths=[],names=[],pathPartIds=[],pathModes=[],pathKeys=[],pathData=[],pathColors=[],
                     outer=[],outerData='',neonMeters=0,neonMaterialMeters=0,openPaths=0,minGap=None,checks=[],
                     hiddenPaths=hidden_paths,exportable=False,
                     notices=['Alle Linien sind ausgeblendet. Stelle mindestens eine Linie wieder her.'])
        empty['settings']['hiddenPaths']=settings['hiddenPaths']
        return empty
    support_paths=[path for item in support_source for path in subpaths(transform(
        subtract_mask(item['commands'],uv_mask) if not uv_mask.is_empty else item['commands'],1,*item['offset']))]+uv_support
    bounds=np.array([path_bounds(path) for path in support_paths])
    x0,y0=bounds[:,:2].min(axis=0); x1,y1=bounds[:,2:].max(axis=0)
    # User-facing gap is contour to vector path, with no tube-width or reserve
    # allowance. Tube width only affects the physical neon preview.
    paddings=side_gaps.copy()
    padding=min(paddings.values())
    left,right,top,bottom=(paddings[side] for side in sides)
    asymmetric=len(set(paddings.values()))>1
    w=settings['width']
    if settings.get('scale') is None and (w<=left+right+20 or scale_width<1):
        raise ValueError('Breite ist für den Randabstand zu klein.')
    scale=float(settings['scale']) if settings.get('scale') is not None else (w-left-right)/scale_width
    if not math.isfinite(scale) or not .0001<=scale<=1000:
        raise ValueError('Ungültiger Motivmaßstab.')
    settings['scale']=scale
    w=(x1-x0)*scale+left+right; h=(y1-y0)*scale+top+bottom
    if h>20000:
        raise ValueError('Das Motiv wird höher als 20.000 mm. Bitte Breite reduzieren.')
    if w>20000:
        raise ValueError('Das Motiv wird breiter als 20.000 mm. Bitte Abstand oder Größe reduzieren.')
    dx=left-x0*scale; dy=top-y0*scale
    paths=[transform(item['commands'],scale,dx,dy) for item in source]
    if settings.get('autoRoute') and not uncut_probe:
        from neon_routing import route
        paths=route(paths)
    if sizing_probe:
        return dict(paths=paths,names=[p['name'] for p in source],pathRoles=[p.get('role','stroke') for p in source],
                    pathModes=[p['mode'] for p in source],settings=settings,width=w,neonMeters=sum(map(path_length,paths))/1000,
                    neonMaterialMeters=sum(map(path_length,paths))*.0011)
    # At large physical scales a fixed coarse sampling can shift the acrylic
    # outline away from the true curve extrema during dimension anchoring.
    steps=max(40,math.ceil(math.sqrt(max(w,h)))) if settings.get('autoRoute') or settings.get('geometricSizing') else 40
    if settings.get('geometricSizing'):steps=max(steps,192)
    lines=[LineString(sample_path(transform(path,scale,dx,dy),steps)) for path in support_paths]
    clearance=unary_union([_directional_buffer(line,paddings) for line in lines]) if asymmetric else None
    def has_clearance(poly,tolerance):
        if asymmetric:return poly.buffer(tolerance).covers(clearance)
        return all(poly.covers(l) and poly.exterior.distance(l)>=padding-tolerance for l in lines)
    radius=min(settings['radius'],padding,w/4,h/4)
    notices=[]
    if radius<settings['radius']-.01:
        notices.append(f'Eckenradius auf {radius:.1f} mm begrenzt, damit der Rand erhalten bleibt.')
    depth=side_depths['bottom'] if settings['shape']=='bottom' else settings['depth']; notches=[]
    requested_depth=depth
    if settings['shape']=='bottom':
        bottom_bounds=[line.bounds for line in lines if line.bounds[3]>h-bottom-(h-top-bottom)*.15]
        intervals=[]
        for a,_,b,_ in sorted(bottom_bounds):
            if intervals and a<=intervals[-1][1]+left+right+3:
                intervals[-1][1]=max(b,intervals[-1][1])
            else: intervals.append([a,b])
        notches=[(a[1]+right,b[0]-left) for a,b in zip(intervals,intervals[1:])]
        def create(d): return rounded_outline(w,h,radius,min(padding,w/4,h/4),notches,d)
        outer=create(depth)
        for _ in range(18):
            poly=Polygon(sample_path(outer,45))
            if poly.is_valid and has_clearance(poly,.06): break
            depth*=.82; outer=create(depth)
        if depth<requested_depth-.1:
            notices.append(f'Einkerbung auf {depth:.1f} mm begrenzt, um den Neonabstand einzuhalten.')
    elif settings['shape']=='rectangle':
        outer=rounded_outline(w,h,radius,radius)
    else:
        outer=_full_shape(lines,padding,radius,depth,side_depths,paddings if asymmetric else None)
        # Sampling/curve fitting can move extrema by a fraction of a millimetre.
        # Anchor the backing to the requested dimensions without moving neon.
        a,b,c,d=path_bounds(outer)
        outer=[[cmd[0],*[[((x-a)*w/(c-a)),((y-b)*h/(d-b))] for x,y in cmd[1:]]]
               for cmd in outer]
    if settings.get('geometricSizing'):
        # Restore clearance lost by polygon fitting. The exact motif bounds
        # already reserve 18 mm to the rectangular envelope on every side.
        contour=Polygon(sample_path(outer,128))
        gap=min(contour.exterior.distance(line) for line in lines)
        if gap<padding and contour.is_valid:
            corrected=contour.buffer(padding-gap+.025,quad_segs=32).intersection(box(0,0,w,h))
            outer=[M(*corrected.exterior.coords[0]),*[L(*point) for point in corrected.exterior.coords[1:-1]],['h']]
    # Edits are stored in motif coordinates, so they follow proportional resizing.
    reference=np.asarray(model['sourceOrigin']) if 'sourceOrigin' in model else np.array([path_bounds(p['commands']) for p in model['modes']['double']])[:,:2].min(axis=0)
    shift_x=(x0-reference[0])*scale-left;shift_y=(y0-reference[1])*scale-top
    active_depth_regions=[]
    if settings['shape']=='shape' and clean_regions:
        protected=clearance if asymmetric else unary_union([line.buffer(padding,quad_segs=40) for line in lines])
        alternatives={}
        for index,region in enumerate(clean_regions):
            value=region['depth']
            if value not in alternatives:
                target=_full_shape(lines,padding,radius,value,paddings=paddings if asymmetric else None)
                a,b,c,d=path_bounds(target)
                alternatives[value]=[[cmd[0],*[[((x-a)*w/(c-a)),((y-b)*h/(d-b))] for x,y in cmd[1:]]] for cmd in target]
            rect=[v*scale-(shift_x if j%2==0 else shift_y) for j,v in enumerate(region['rect'])]
            # Regions follow the motif when resizing. If hiding paths removes
            # the selected edge, keep the setting dormant until it is restored.
            if not any(piece[2] for piece in _outline_pieces(outer,rect)):continue
            outer=local_outline_depth(outer,alternatives[value],rect,radius,protected)
            active_depth_regions.append(index)
    edits=settings.get('outlineEdits',[])
    if not isinstance(edits,list) or len(edits)>50:
        raise ValueError('Höchstens 50 Konturkorrekturen sind möglich.')
    preview=settings.get('outlinePreview')
    outline_preview=None
    point_protected=None
    outline_controls=None
    anchors_changed=False
    visible_controls=False
    for i,rect in enumerate(edits+([preview] if preview is not None else [])):
        try:
            if isinstance(rect,dict) and rect.get('kind')=='anchor':
                if point_protected is None:
                    dense_lines=[LineString(sample_path(transform(path,scale,dx,dy),250)) for path in support_paths]
                    point_protected=unary_union([_directional_buffer(line,paddings) if asymmetric else line.buffer(padding,quad_segs=96) for line in dense_lines])
                if rect.get('visibleContour') and not visible_controls:
                    outline_controls=visible_outline_controls(outer,point_protected)
                    visible_controls=True
                elif outline_controls is None:outline_controls=compact_outline(outer)
                point=np.asarray(rect.get('point'),float)*scale-[shift_x,shift_y]
                target=np.asarray(rect.get('target',rect.get('point')),float)*scale-[shift_x,shift_y]
                selected=None
                if 'points' in rect:
                    selected=np.asarray(rect['points'],float)
                    if selected.ndim!=2 or selected.shape[1]!=2:raise ValueError('Ungültige Konturpunktauswahl.')
                    selected=selected*scale-[shift_x,shift_y]
                outer,outline_controls,highlight=deepcopy(_checked_anchor_step(
                    _outline_key(outer),_outline_key(outline_controls),rect.get('action'),
                    tuple(point),tuple(target),point_protected,i<len(edits),radius,
                    None if selected is None else tuple(map(tuple,selected)),
                    rect.get('fixedNeighbors',False),visible_controls,rect.get('autoHandles') is True))
                anchors_changed=anchors_changed or rect.get('action')!='insert'
                if i==len(edits):
                    if 'point' in highlight:highlight['point']=(np.array(highlight['point'])+[shift_x,shift_y]).tolist()
                    outline_preview=highlight
                continue
            outline_controls=None;visible_controls=False
            if isinstance(rect,dict) and rect.get('kind')=='point':
                if point_protected is None:
                    point_protected=clearance if asymmetric else unary_union([line.buffer(padding,quad_segs=40) for line in lines])
                def local_point(key):
                    p=np.asarray(rect.get(key),float)
                    if p.shape!=(2,) or not np.isfinite(p).all():raise ValueError('Ungültiger Konturpunkt.')
                    return p*scale-[shift_x,shift_y]
                outer,highlight=move_outline_point(outer,local_point('point'),local_point('target'),radius,point_protected,replay=i<len(edits))
                if i==len(edits):outline_preview=highlight
                continue
            if not isinstance(rect,list) or len(rect)!=4:raise ValueError('Ungültige Konturauswahl.')
            local_rect=[float(value)*scale-(shift_x if j%2==0 else shift_y) for j,value in enumerate(rect)]
            outer,highlight=straighten_outline(outer,local_rect,radius)
            if i==len(edits):
                # Overlay uses the same coordinate origin as the displayed drawing.
                outline_preview=dict(rect=[float(v)*scale for v in rect],**highlight,offset=[shift_x,shift_y])
        except (ValueError,TypeError) as error:
            if i<len(edits):
                raise ValueError(f'Konturkorrektur {i+1} passt nicht mehr zu diesen Einstellungen. Bitte die Konturkorrekturen zurücksetzen oder die letzte Änderung rückgängig machen. {error}')
            raise
    # Sliders need the actual, validated contour immediately. Preparing sparse
    # editing handles can wait until release; it never changes the CNC contour.
    if outline_controls is None:outline_controls=compact_outline(outer) if editable else []
    visible_path=outer if visible_controls else visible_outline_controls(outer,point_protected) if editable else []
    poly=Polygon(sample_path(outer,250 if anchors_changed else 60))
    if not poly.is_valid or not all(poly.covers(line) for line in lines):
        raise ValueError('Diese Kontur ist nicht gültig. Bitte Randabstand erhöhen oder Rechteck wählen.')
    center_gap=min(poly.exterior.distance(line) for line in lines)
    if center_gap < min(side_gaps.values())-.1 or (asymmetric and not has_clearance(poly,.1)):
        raise ValueError('Die Kontur unterschreitet den eingestellten Neonabstand.')
    neon_lines=[LineString(sample_path(piece,40)) for p in paths for piece in subpaths(p)]
    overlaps=sum(a.intersection(b).length for i,a in enumerate(neon_lines) for b in neon_lines[:i])
    # Keep neon coordinates fixed as padding changes; only the backing expands.
    # A shared source origin also prevents untouched parts jumping in mixed mode.
    paths=[transform(p,1,shift_x,shift_y) for p in paths]
    outer=transform(outer,1,shift_x,shift_y)
    outline_controls=transform(outline_controls,1,shift_x,shift_y)
    bbox=path_bounds(outer)
    settings['width']=float(bbox[2]-bbox[0])
    raw_box=model['imageBounds']
    neon_length=sum(item['length'] for item in source)*scale/1000
    if settings.get('autoRoute'):neon_length=sum(map(path_length,paths))/1000
    missing=[p for p in model['parts'] if not p[part_modes.get(p['id'],settings['mode'])]]
    if missing:
        notices.append('Für '+', '.join(p['name'] for p in missing)+' fehlen Linien. Bitte die andere Linienart zuweisen.')
    if hidden_paths:
        notices.append(f'{len(hidden_paths)} Pfad(e) ausgeblendet: nicht in Neonmetern, Außenkontur oder PDF enthalten.')
    used_modes={p['mode'] for p in source}
    mode_label='Gemischt' if len(used_modes)>1 else ('Single Line' if 'single' in used_modes else 'Double Line')
    parts=[{**p,'mode':part_modes.get(p['id'],settings['mode']),'linkedParts':outline_parts.get(p['id'],[p['id']]),
            'bounds':[(p['bounds'][0]-reference[0])*scale,(p['bounds'][1]-reference[1])*scale,
                      (p['bounds'][2]-reference[0])*scale,(p['bounds'][3]-reference[1])*scale]}
           for p in model['parts']]
    if settings.get('pathOffsets'):
        for part in parts:
            boxes=[path_bounds(path) for item,path in zip(source,paths) if item['partId']==part['id']]
            if boxes:
                boxes=np.asarray(boxes);part['bounds']=[*boxes[:,:2].min(axis=0),*boxes[:,2:].max(axis=0)]
    checks=[
        {'ok':True,'label':'Eine geschlossene Acrylkontur'},
        {'ok':True,'label':'Neon und UV-Druck innerhalb der Platte' if uv_support else 'Neon innerhalb der Platte'},
        {'ok':center_gap>=min(side_gaps.values())-.1,
         'label':f'Min. Abstand zum {"Motiv (Neon/UV)" if uv_support else "Neonpfad"}: {center_gap:.2f} mm'},
        {'ok':overlaps<.05,'label':'Keine überlappenden Strecken' if overlaps<.05 else f'{overlaps:.1f} mm überlappende Strecken'},
        {'ok':not missing,'label':('Sichtbare Motivelemente enthalten' if hidden_paths else 'Alle Motivelemente enthalten') if not missing else 'Motivelemente ohne Neonpfade'},
    ]
    uv=None
    if not uv_mask.is_empty and uv_support:
        clip=transform(polygon_commands(uv_clip),scale,-reference[0]*scale,-reference[1]*scale)
        uv=dict(clip=clip,clipData=path_d(clip),image=model['image'],
                artwork=[{**item,'commands':transform(item['commands'],scale,-reference[0]*scale,-reference[1]*scale),
                          'originalStrokeWidth':item.get('originalStrokeWidth',0)*scale}
                         for item in model.get('artwork',model['modes']['double'])] if model['sourceKind']=='vector' else None)
        notices.append('UV-Druck: Originaldarstellung, ohne Neonmeter. Die Druckflächen werden bei der Acrylkontur berücksichtigt.')
    return dict(outlineVisibleControls=transform(visible_path,1,shift_x,shift_y),outlineControls=outline_controls,uv=uv,paths=paths, names=[p['name'] for p in source], outer=outer,
                pathColors=[resolved_colors[p['key']] for p in source],colorSources=color_sources,neonPalette=NEON_COLORS,
                pathPartIds=[p['partId'] for p in source],pathModes=[p['mode'] for p in source],pathRoles=[p.get('role','stroke') for p in source],pathKeys=[p['key'] for p in source],
                parts=parts,modeLabel=mode_label,exportable=not missing,hiddenPaths=hidden_paths,
                pathData=[path_d(p) for p in paths], outerData=path_d(outer),outlinePreview=outline_preview,activeDepthRegions=active_depth_regions,
                width=float(bbox[2]-bbox[0]), height=float(bbox[3]-bbox[1]), bounds=bbox,
                neonMeters=neon_length, neonMaterialMeters=neon_length*1.10,
                minGap=center_gap,
                settings=settings, effectiveRadius=radius,effectiveDepth=depth,
                imageBox=[(raw_box[0]-reference[0])*scale,(raw_box[1]-reference[1])*scale,raw_box[2]*scale,raw_box[3]*scale],
                checks=checks, notices=notices, sourceKind=model['sourceKind'],
                sourceLabel=model['sourceLabel'], openPaths=sum(p[-1][0]!='h' for p in paths))
