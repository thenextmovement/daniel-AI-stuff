"""Geometric size of a motif with fixed-width neon on the drawn centerlines."""
import hashlib
import json
import math

import numpy as np
from shapely import STRtree, points, linestrings, distance as distances
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points, polylabel, unary_union

from geometry import sample_path, segments, transform
from neon_routing import joins
from uv_print import subpaths

PROFILE = dict(geometricSizing=True, autoRoute=False, tube=6, gap=15, gapSides={}, scale=None)
PADDING = 36
CENTER_SPACING = 8
# Diameter inside the three centerlines of the A in the 70 cm MATPLUS sample.
REFERENCE_DIAMETER = 15.608


def parallel_sites(path):
    """Each pair of parallel arms is a separate clearance check."""
    arms = []
    for op, points in segments(path):
        if op != 'l':
            continue
        a, b = points
        length = np.linalg.norm(b-a)
        if length < 1e-8:
            continue
        direction = (b-a)/length
        for c, d, axis in arms:
            if abs(direction @ axis) < .99999:
                continue
            lo, hi = sorted(((c-a) @ direction, (d-a) @ direction))
            overlap = min(length, hi) - max(0, lo)
            offset = c-a
            distance = abs(offset[0]*direction[1]-offset[1]*direction[0])
            if distance > 1e-8 and overlap > 1e-8:
                yield nearest_points(LineString([a,b]), LineString([c,d]))
        arms.append((a, b, direction))


def other_pair_sites(first, second, excluded):
    """Local minima on the two curves, including more than one gap on the same pair."""
    def edges(line):
        coords = np.asarray(line.coords)
        return linestrings(np.stack([coords[:-1],coords[1:]],axis=1)), points(coords)

    a, av = edges(first)
    b, bv = edges(second)
    tree = STRtree(b)
    ai, bi = tree.query(a, predicate='dwithin', distance=8*1000/44)
    if not len(ai):
        return
    # Segment pairs that share a minimum form one plateau. A neighbor with
    # a smaller distance matters only if that shared boundary also reaches
    # the minimum (two nearby corners can be independent bottlenecks).
    ids = ai*len(b)+bi
    order = np.argsort(ids)
    ids,ai,bi = ids[order],ai[order],bi[order]
    value = distances(a[ai],b[bi])
    rejected = np.zeros(len(ai),dtype=bool)
    links = []
    for di,dj in [(0,1),(1,-1),(1,0),(1,1)]:
        x,y = ai+di,bi+dj
        if first.is_ring:
            x %= len(a)
        if second.is_ring:
            y %= len(b)
        neighbor = x*len(b)+y
        pos = np.minimum(np.searchsorted(ids,neighbor),len(ids)-1)
        src = np.flatnonzero((x>=0)&(x<len(a))&(y>=0)&(y<len(b))&(ids[pos]==neighbor))
        dst = pos[src]
        boundary_a = av[ai[src]+1] if di else a[ai[src]]
        boundary_b = bv[bi[src]+int(dj>0)] if dj else b[bi[src]]
        shared = distances(boundary_a,boundary_b)
        at_src = shared <= value[src]+1e-7
        at_dst = shared <= value[dst]+1e-7
        rejected[src[at_src & ~at_dst]] = True
        rejected[dst[at_dst & ~at_src]] = True
        common = at_src & at_dst
        links.append((src[common],dst[common]))
    rows,cols = (np.concatenate(side) for side in zip(*links))
    graph = coo_matrix((np.ones(len(rows),dtype=bool),(rows,cols)),shape=(len(ai),len(ai)))
    _,component = connected_components(graph,directed=False)
    # All equally close points on the ignored plateau refer to the same gap.
    rejected |= np.isin(ai,STRtree(a).query(excluded[0],predicate='dwithin',distance=1e-7)) & np.isin(
        bi,tree.query(excluded[1],predicate='dwithin',distance=1e-7))
    groups,representatives = np.unique(component,return_index=True)
    for k in representatives[~np.isin(groups,component[rejected])]:
        yield nearest_points(a[ai[k]],b[bi[k]])


def measure(drawing, issues=None):
    span = drawing['width'] - PADDING
    if span <= 0 or not drawing['paths']:
        raise ValueError('Keine messbare Neonzeichnung.')
    settings = drawing.get('settings', {})
    scale = settings.get('scale') or span/1000
    keys = drawing.get('pathKeys', [])
    ignored = {row['id'] for row in settings.get('ignoredLimits', []) if isinstance(row,dict) and isinstance(row.get('id'),str)}
    ignored_groups = {(row.get('kind'),tuple(row.get('keys',[]))) for row in settings.get('ignoredLimits',[])
                      if isinstance(row,dict) and row.get('id') in ignored}
    active_ignored = set()
    paths, owners, lines = [], [], []
    for owner, path in enumerate(drawing['paths']):
        for part in subpaths(path):
            scaled = transform(part, 1000/span, 0, 0)
            if list(segments(scaled)):
                paths.append(scaled)
                owners.append(owner)
                lines.append(LineString(sample_path(scaled, 128)))
    if not lines:
        raise ValueError('Keine messbaren Neonpfade.')
    best = {'spacing': math.inf, 'opening': math.inf}
    winner = None
    required_span = 0.
    def consider(kind, indices, endpoints, value=None):
        nonlocal winner, required_span
        first, second = [np.asarray(point.coords[0]) for point in endpoints]
        if value is None:
            value = float(np.linalg.norm(second-first))
        required = CENTER_SPACING if kind=='spacing' else REFERENCE_DIAMETER
        indices = sorted(set(indices))
        names = [keys[i] if i<len(keys) else str(i) for i in indices]
        size = required*1000/max(value,1e-12)
        if size>required_span or (kind,tuple(names)) in ignored_groups:
            origin = np.asarray(drawing['paths'][indices[0]][0][1])
            offsets = [(v*span/1000-origin)/scale for v in (first,second)]
            # Source units make the exception independent of preview width and pan.
            # Include all participating geometry so an edit requires a fresh decision.
            signature = [kind,names]
            for i in indices:
                signature.append([[cmd[0], *[(np.round((np.asarray(x)-origin)/scale,4)+0.).tolist() for x in cmd[1:]]] for cmd in drawing['paths'][i]])
            signature.append(sorted(tuple(np.round(v,3)+0.) for v in offsets))
            identity = hashlib.sha256(json.dumps(signature,sort_keys=True).encode()).hexdigest()[:32]
            if identity in ignored:
                active_ignored.add(identity)
                return False
        best[kind] = min(best[kind],value)
        actual = value*span/1000
        if issues is not None and actual < required-1e-7:
            k = kind,tuple(sorted(names))
            allowance = 6 if kind=='opening' else 0
            if k not in issues or actual-allowance<issues[k]['actual']:
                issues[k]=dict(kind=kind,keys=k[1],actual=actual-allowance,required=required-allowance)
        if size>required_span:
            required_span=size
            winner=dict(id=identity,keys=names,kind=kind,offsets=[v.tolist() for v in offsets])
        return True

    tree=STRtree(lines)
    for i,line in enumerate(lines):
        for endpoints in parallel_sites(paths[i]):
            consider('spacing',[owners[i]],endpoints)
        for j in tree.query(line,predicate='dwithin',distance=8*1000/44):
            if j>=i:
                continue
            other=lines[j]
            distance=line.distance(other)
            if distance<=5 and joins(line,other,1,5):
                continue
            pair=[owners[i],owners[j]]
            endpoints=nearest_points(line,other)
            if not consider('spacing',pair,endpoints):
                for local in other_pair_sites(line,other,endpoints):
                    consider('spacing',pair,local)

    seam=.25
    ink=unary_union(lines).buffer(seam,quad_segs=32)
    def opening(polygon,indices,correction):
        center=polylabel(polygon,tolerance=.001)
        edge=nearest_points(center,polygon.boundary)[1]
        radius=center.distance(edge)
        if radius<=0:
            return
        delta=(np.asarray(edge.coords[0])-center.coords[0])*(1+correction/radius)
        consider('opening',indices,[Point(center.coords[0]-delta),Point(center.coords[0]+delta)])
    for part in getattr(ink,'geoms',[ink]):
        for ring in part.interiors:
            coords=np.asarray(ring.coords)
            hits=set(tree.nearest(points((coords[:-1]+coords[1:])/2)))
            if len(hits)==1 and lines[next(iter(hits))].is_ring:
                continue  # The explicit ring below measures this same aperture.
            opening(Polygon(ring),[owners[i] for i in hits],seam)
    for i,line in enumerate(lines):
        if line.is_ring:
            opening(Polygon(line),[owners[i]],0)
    if issues is not None:
        return
    minimum=max(80,math.ceil(PADDING+required_span-1e-8))
    if minimum==80:
        winner=None
    gap,aperture=best['spacing'],best['opening']
    return dict(recommendedWidth=minimum,limitingSite=winner,ignoredSiteIds=sorted(active_ignored),
                limitingKeys=winner['keys'] if winner else [],limitingReasons=[winner['kind']] if winner else [],
                currentWidth=drawing['width'],minimumSpacing=None if math.isinf(gap) else gap*span/1000,
                opening=None if math.isinf(aperture) else aperture*span/1000-6)


class SpacingLimitExceeded(ValueError):
    """The spacing constraint would require a sign wider than the supported range."""


def minimum_size(store, model, settings):
    options = {**settings, **PROFILE}
    def at_width(width):
        return measure(store.size_probe(model, {**options, 'width':width}, uncut=True))
    reference = store.size_probe(model, {**options, 'width':80}, uncut=True)
    report = measure(reference)
    # Fixed physical dots can change relative to the rest of the motif.
    if 'dot' in reference.get('pathRoles', []):
        for width in range(80, 20001):
            report = at_width(width)
            if report['recommendedWidth'] <= width:
                report['recommendedWidth'] = width
                return report
        raise ValueError('Keine passende Breite bis 20 m für diese Punktgeometrie.')
    if report['recommendedWidth'] > 20000:
        error = SpacingLimitExceeded if 'spacing' in report['limitingReasons'] else ValueError
        raise error('Die geometrische Mindestbreite überschreitet 20 m.')
    return report

def widths_for_heights(store, model, settings, heights):
    """Invert the measured acrylic outline, including fixed gaps and shape edits."""
    if (not isinstance(heights,list) or not 1<=len(heights)<=4 or
        any(type(h) not in (int,float) or not 80<=h<=20000 for h in heights)):
        raise ValueError('Eine bis vier Höhen zwischen 8 und 2000 cm eingeben.')
    result=[]
    for target in heights:
        lo,hi=80.,20000.
        width=lo
        previous=None
        for _ in range(28):
            options={**settings,**PROFILE,'width':width}
            try:
                height=store.drawing(model,json.dumps(options,sort_keys=True),editable=False)['height']
            except ValueError as error:
                if 'höher als 20.000' not in str(error):raise
                height=None
            if height is not None and abs(height-target)<.02:
                result.append(width)
                break
            if height is None or height>target:hi=width
            else:lo=width
            if hi-lo<.00001:raise ValueError('Die Höhe ist für dieses Motiv im verfügbaren Breitenbereich nicht erreichbar.')
            estimate=(hi+lo)/2
            if height is not None:
                if previous and abs(height-previous[1])>.00001:
                    estimate=width+(target-height)*(width-previous[0])/(height-previous[1])
                elif height>PADDING:
                    estimate=PADDING+(target-PADDING)*(width-PADDING)/(height-PADDING)
                previous=(width,height)
            width=min(hi,max(lo,estimate))
            if width==(previous or (None,))[0]:width=(hi+lo)/2
        else:raise ValueError('Die gewünschte Acrylhöhe konnte nicht bestätigt werden.')
    return result


def target_width(store, model, settings, width):
    if type(width) not in (float, int) or not 80 <= width <= 20000:
        raise ValueError('Wunschbreite zwischen 8 und 2000 cm eingeben.')
    options = {**settings, **PROFILE, 'width':width}

    def inspect(params):
        drawing = store.size_probe(model, params, uncut=True)
        issues = {}
        measure(drawing, issues)
        return drawing, issues

    drawing, issues = inspect(options)
    ordered = sorted(issues.values(), key=lambda issue: issue['actual']-issue['required'])
    report = dict(issues=ordered, proposal=None)
    pairs = [issue for issue in ordered if issue['kind']=='spacing' and len(issue['keys'])==2]
    if not pairs:
        return report

    # Keep touching strokes and enclosed counters attached to the moved outline.
    shapes = {}
    for key, path in zip(drawing['pathKeys'], drawing['paths']):
        parts = [LineString(sample_path(part, 128)) for part in subpaths(path) if list(segments(part))]
        if parts:
            shapes[key] = unary_union(parts)
    envelopes = {key: shape.convex_hull for key, shape in shapes.items()}
    def connected(key):
        group = {key}
        pending = [key]
        while pending:
            current = pending.pop()
            for other in shapes.keys()-group:
                if (shapes[current].intersects(shapes[other]) or
                    envelopes[current].covers(shapes[other]) or envelopes[other].covers(shapes[current])):
                    group.add(other)
                    pending.append(other)
        return group

    def translation_groups(group, fixed, delta):
        yield group
        # When the neighbouring glyph blocks the move, also try moving its
        # neighbours in the same row, stopping at the next generous gap.
        moved = set(group)
        axis = int(abs(delta[1]) > abs(delta[0]))
        sign = np.sign(delta[axis])
        frontier = list(group)
        while frontier:
            box = shapes[frontier.pop()].bounds
            for key in shapes.keys()-moved-{fixed}:
                bounds = shapes[key].bounds
                transverse = 1-axis
                overlap = min(box[transverse+2],bounds[transverse+2])-max(box[transverse],bounds[transverse])
                gap = bounds[axis]-box[axis+2] if sign>0 else box[axis]-bounds[axis+2]
                if overlap<=0 or gap < -.1 or gap > 3*CENTER_SPACING:
                    continue
                neighbours = connected(key)-moved
                if fixed not in neighbours:
                    moved.update(neighbours)
                    frontier.extend(neighbours)
        if moved != group:
            yield moved

    for issue in pairs[:3]:
        first, second = issue['keys']
        p, q = nearest_points(shapes[first], shapes[second])
        vector = np.array([q.x-p.x, q.y-p.y])
        distance = np.linalg.norm(vector)
        if distance < 1e-7:
            continue
        shift = vector/distance*(issue['required']-issue['actual']+.2)
        for key, other, delta in [(second, first, shift), (first, second, -shift)]:
            group = connected(key)
            if other in group:
                continue
            for moved in translation_groups(group, other, delta):
                offsets = dict(settings.get('pathOffsets') or {})
                for member in moved:
                    offsets[member] = (np.array(offsets.get(member,[0,0]))+
                                       delta/drawing['settings']['scale']).tolist()
                candidate = {**options, 'pathOffsets':offsets}
                try:
                    _, after = inspect(candidate)
                    if (('spacing', issue['keys']) in after or
                        any(k not in issues or v['actual'] < issues[k]['actual']-.001 for k,v in after.items())):
                        continue
                    final = store.drawing(model, json.dumps(candidate, sort_keys=True), editable=False)
                    if not final['exportable'] or abs(final['width']-width)>.1:
                        continue
                except ValueError:
                    continue
                report['proposal'] = dict(keys=sorted(moved), dx=delta[0], dy=delta[1],
                                          offsets=offsets, remaining=len(after))
                return report
    return report
