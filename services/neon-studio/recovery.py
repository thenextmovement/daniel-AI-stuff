"""Local, explicitly selected raster retracing; existing source paths stay immutable."""
import base64
import binascii
import io
import math
from copy import deepcopy

import numpy as np
from scipy import ndimage
from skimage.measure import find_contours
from skimage.segmentation import watershed
from shapely.geometry import LineString, Point, Polygon, GeometryCollection, box
from shapely.ops import unary_union, nearest_points

from geometry import path_bounds, path_length, sample_path
from tracing import _trace, _assign_parts
from uv_print import subpaths, subtract_mask


def source_origin(model):
    return model.get('sourceOrigin') or np.array([path_bounds(p['commands']) for p in model['modes']['double']])[:, :2].min(axis=0).tolist()


def recovery_source(model):
    image = model.get('recoveryImage')
    if image is None:
        raise ValueError('Nacherkennung ist für importierte Bilder und nachgezeichnete PDF-Seiten verfügbar. Bitte das Originalbild laden.')
    raw = io.BytesIO(); image.save(raw, 'PNG')
    return dict(image='data:image/png;base64,'+base64.b64encode(raw.getvalue()).decode(),
                width=image.width, height=image.height, origin=source_origin(model))


def selected_pixels(image, selection):
    if not isinstance(selection, dict): raise ValueError('Bitte zuerst einen Bereich markieren.')
    w, h = image.size
    if selection.get('mask') is not None:
        try:
            raw = base64.b64decode(selection['mask'], validate=True)
            if len(raw) != w*h: raise ValueError()
            selected = np.frombuffer(raw, dtype=np.uint8).reshape(h, w) > 0
        except (ValueError, TypeError, binascii.Error): raise ValueError('Ungültige Pinselmarkierung.') from None
        region = GeometryCollection()
        for contour in find_contours(np.pad(selected, 1), .5, fully_connected='high'):
            region = region.symmetric_difference(Polygon(np.fliplr(contour)-1).buffer(0))
    else:
        try:
            rect = np.asarray(selection['rect'], float)
            if rect.shape != (4,) or not np.isfinite(rect).all() or np.any(rect[2:] <= rect[:2]): raise ValueError()
            x0, y0, x1, y1 = np.rint(rect).astype(int)
            if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h): raise ValueError()
        except (KeyError, ValueError, TypeError): raise ValueError('Bitte ein gültiges Rechteck im Original markieren.') from None
        selected = np.zeros((h, w), bool); selected[y0:y1, x0:x1] = True
        region = box(x0, y0, x1, y1)
    try:
        seed = np.asarray(selection['seed'], float); tolerance = float(selection.get('tolerance', 35))
        if seed.shape != (2,) or not np.isfinite(seed).all() or not math.isfinite(tolerance) or not 0 <= tolerance <= 160: raise ValueError()
        x, y = np.floor(seed).astype(int)
        if not (0 <= x < w and 0 <= y < h and selected[y, x]): raise ValueError()
    except (KeyError, ValueError, TypeError): raise ValueError('Bitte eine Linienfarbe innerhalb der Markierung anklicken.') from None
    rgba = np.asarray(image.convert('RGBA'))
    if rgba[y, x, 3] < 128: raise ValueError('Bitte eine sichtbare Linienfarbe anklicken.')
    rgb = rgba[:, :, :3].astype(np.int16)
    visible = rgba[:, :, 3] >= 128
    # Segment by actual image edges, not a hard RGB cutoff through a gradient.
    # The pipette chooses a connected source region. Watershed puts its border
    # on the image edge after flat interiors have supplied stable markers.
    smooth = ndimage.gaussian_filter(rgb.astype(float), (.7, .7, 0))
    gradient = np.maximum(np.max(np.abs(np.gradient(smooth, axis=0)), axis=2),
                          np.max(np.abs(np.gradient(smooth, axis=1)), axis=2))
    markers, _ = ndimage.label((gradient <= .5+tolerance/10) & visible)
    sizes = np.bincount(markers.ravel()); sizes[0] = 0
    markers[sizes[markers] < 12] = 0
    regions = watershed(gradient, markers, mask=visible)
    if regions[y, x]:
        mask = regions == regions[y, x]
    else:
        mask = visible & (np.max(np.abs(rgb-rgb[y, x]), axis=2) <= tolerance)
    labels, _ = ndimage.label(mask, structure=np.ones((3, 3)))
    sizes = np.bincount(labels.ravel()); sizes[0] = 0
    touched = np.zeros(len(sizes), bool); touched[np.unique(labels[selected])] = True; touched[0] = False
    mask &= (sizes[labels] >= 12) & touched[labels]
    if mask.sum() < 12: raise ValueError('Keine Linien in dieser Auswahl gefunden. Farbe oder Empfindlichkeit anpassen.')
    # Trace complete source components, then clip the resulting curves. Tracing
    # an already cropped bitmap would turn the brush/rectangle edge into neon.
    return mask, box(-2, -2, w+2, h+2).difference(region)


def recover(model, selection):
    image = model.get('recoveryImage')
    if image is None: recovery_source(model)  # Same actionable error as source request.
    mask, outside = selected_pixels(image, selection)
    neon = image.info.get('traceProfile') == 'neon'
    modes = _trace(mask, neon=neon)
    parts = _assign_parts(mask, modes, image, neon=neon)
    merged = {**model, 'sourceOrigin':source_origin(model),
              'modes':{mode:list(paths) for mode, paths in model['modes'].items()}, 'parts':list(model['parts'])}
    prefix = f'recovered-{len(model["parts"])}-'
    added_ids = set(); keys = []
    for mode, items in modes.items():
        existing = unary_union([LineString(sample_path(path, 80))
                                for item in model['modes'][mode] for path in subpaths(item['commands']) if len(path) > 1])
        # Raster edge antialiasing and curve fitting may differ by about a pixel.
        covered = existing.buffer(1.25)
        for item in items:
            commands = subtract_mask(subtract_mask(item['commands'], outside), covered)
            for path in subpaths(commands):
                if len(path) < 2 or path_length(path) < 3: continue
                path = deepcopy(path)
                # Clipping shared edges must not leave small disconnected stubs.
                if path[-1][0] != 'h':
                    for point in (path[0][1], path[-1][-1]):
                        target = nearest_points(Point(point), existing)[1]
                        if Point(point).distance(target) < 1.4: point[:] = list(target.coords[0])
                new = {**item, 'commands':path, 'length':path_length(path), 'partId':prefix+item['partId'],
                       'name':'Nacherkannt · '+item['name']}
                keys.append(f'{mode}:{len(merged["modes"][mode])}')
                merged['modes'][mode].append(new); added_ids.add(item['partId'])
    # Some edges of a region already belong to another part. Keep the original
    # mode availability: those shared edges remain present in the drawing.
    merged['parts'].extend({**p, 'id':prefix+p['id'], 'name':'Nacherkannt · '+p['name']} for p in parts if p['id'] in added_ids)
    return merged, keys
