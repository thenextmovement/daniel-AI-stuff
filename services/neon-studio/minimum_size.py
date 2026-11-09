"""Geometric size of a motif with fixed-width neon on the drawn centerlines."""
import json
import math

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Polygon
from shapely.ops import polylabel, unary_union

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


def measure(drawing):
    span = drawing['width'] - PADDING
    if span <= 0 or not drawing['paths']:
        raise ValueError('Keine messbare Neonzeichnung.')
    paths = [transform(part, 1000/span, 0, 0) for p in drawing['paths'] for part in subpaths(p)]
    lines = [LineString(sample_path(p, 128)) for p in paths if list(segments(p))]
    if not lines:
        raise ValueError('Keine messbaren Neonpfade.')
    gap = min(parallel_gap(p) for p in paths)
    tree = STRtree(lines)
    for i, line in enumerate(lines):
        # Wider gaps already fit at the smallest supported plate (80 mm).
        for j in tree.query(line, predicate='dwithin', distance=min(gap, 8*1000/44)):
            if j >= i:
                continue
            other = lines[j]
            distance = line.distance(other)
            if distance <= 5 and joins(line, other, 1, 5):
                continue
            gap = min(gap, distance)

    # Close tracing seams within half a unit per metre of artwork. Restore
    # the offset to measure the diameter between the original centerlines.
    seam = .25
    ink = unary_union(lines).buffer(seam, quad_segs=32)
    openings = [opening_diameter(Polygon(ring)) + 2*seam
                for part in getattr(ink, 'geoms', [ink]) for ring in part.interiors]
    # Explicit closed contours remain relevant even below the seam tolerance.
    for line in lines:
        if line.is_ring:
            openings.append(opening_diameter(Polygon(line)))
    opening = min(openings, default=math.inf)
    required_span = max(CENTER_SPACING*1000/gap, REFERENCE_DIAMETER*1000/opening)
    minimum = max(80, math.ceil(PADDING + required_span - 1e-8))
    return dict(recommendedWidth=minimum, currentWidth=drawing['width'],
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
