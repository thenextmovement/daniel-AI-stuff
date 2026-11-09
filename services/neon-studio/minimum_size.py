"""Geometric size of a motif with fixed-width neon on the drawn centerlines."""
import json
import math

import numpy as np
from shapely import STRtree, points
from shapely.geometry import LineString, Polygon
from shapely.ops import nearest_points, polylabel, unary_union

from geometry import sample_path, segments, transform
from neon_routing import joins
from uv_print import subpaths

PROFILE = dict(geometricSizing=True, autoRoute=False, tube=6, gap=15, gapSides={}, scale=None)
PADDING = 36
CENTER_SPACING = 8
# Diameter inside the three centerlines of the A in the 70 cm MATPLUS sample.
REFERENCE_DIAMETER = 15.608


def parallel_gap(path):
    """Clearance between parallel arms in a continuous stroke, e.g. a U."""
    arms = []
    best = math.inf
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
                best = min(best, distance)
        arms.append((a, b, direction))
    return best


def opening_diameter(polygon):
    center = polylabel(polygon, tolerance=.001)
    return 2 * center.distance(polygon.boundary)


def measure(drawing, issues=None):
    span = drawing['width'] - PADDING
    if span <= 0 or not drawing['paths']:
        raise ValueError('Keine messbare Neonzeichnung.')
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
    gaps = [parallel_gap(p) for p in paths]
    def record(kind, indices, actual, required):
        if issues is None or actual >= required - 1e-7:
            return
        keys = tuple(sorted({drawing['pathKeys'][i] for i in indices}))
        identity = kind, keys
        if identity not in issues or actual < issues[identity]['actual']:
            issues[identity] = dict(kind=kind, keys=keys, actual=actual, required=required)

    if issues is not None:
        for i, value in enumerate(gaps):
            record('spacing', [owners[i]], value*span/1000, CENTER_SPACING)
    gap = min(gaps)
    gap_owners = {owners[i] for i,value in enumerate(gaps) if value == gap}
    tree = STRtree(lines)
    for i, line in enumerate(lines):
        # Wider gaps already fit at the smallest supported plate (80 mm).
        for j in tree.query(line, predicate='dwithin', distance=(CENTER_SPACING*1000/span if issues is not None else min(gap, 8*1000/44))):
            if j >= i:
                continue
            other = lines[j]
            distance = line.distance(other)
            if distance <= 5 and joins(line, other, 1, 5):
                continue
            record('spacing', [owners[i], owners[j]], distance*span/1000, CENTER_SPACING)
            if distance < gap:
                gap_owners = set()
                gap = distance
            if distance == gap:
                gap_owners.update((owners[i], owners[j]))

    # Close tracing seams within half a unit per metre of artwork. Restore
    # the offset to measure the diameter between the original centerlines.
    seam = .25
    ink = unary_union(lines).buffer(seam, quad_segs=32)
    openings = [(opening_diameter(Polygon(ring)) + 2*seam, ring, None)
                for part in getattr(ink, 'geoms', [ink]) for ring in part.interiors]
    # Explicit closed contours remain relevant even below the seam tolerance.
    for i,line in enumerate(lines):
        if line.is_ring:
            openings.append((opening_diameter(Polygon(line)), None, owners[i]))
    def opening_owners(ring, owner):
        if owner is not None:
            return {owner}
        coords = np.asarray(ring.coords)
        mids = points((coords[:-1]+coords[1:])/2)
        return {owners[i] for i in tree.nearest(mids)}

    if issues is not None:
        for value, ring, owner in openings:
            if value*span/1000 < REFERENCE_DIAMETER:
                record('opening', opening_owners(ring, owner), value*span/1000-6, REFERENCE_DIAMETER-6)
        return
    opening = min((v for v,_,_ in openings), default=math.inf)
    spacing_span = CENTER_SPACING*1000/gap
    opening_span = REFERENCE_DIAMETER*1000/opening
    required_span = max(spacing_span, opening_span)
    minimum = max(80, math.ceil(PADDING + required_span - 1e-8))
    limiting = set()
    reasons = []
    if minimum > 80 and spacing_span == required_span:
        limiting.update(gap_owners)
        reasons.append('spacing')
    if minimum > 80 and opening_span == required_span:
        reasons.append('opening')
        for value, ring, owner in openings:
            if value != opening:
                continue
            limiting.update(opening_owners(ring, owner))
    keys = drawing.get('pathKeys', [])
    return dict(recommendedWidth=minimum, limitingKeys=[keys[i] for i in sorted(limiting) if i<len(keys)],
                limitingReasons=reasons, currentWidth=drawing['width'],
                minimumSpacing=None if math.isinf(gap) else gap*span/1000,
                opening=None if math.isinf(opening) else opening*span/1000-6)


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
        raise ValueError('Die geometrische Mindestbreite überschreitet 20 m.')
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
