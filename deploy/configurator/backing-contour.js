import {createRasterMask,flattenSvgPath} from './deterministic-raster.js';
/** Preview contour only; not a routed or strength-checked manufacturing drawing. */
const cache = new WeakMap();

/** Line-sized acrylic rails with two bridges between adjacent rows (preview only). */
export function buildFreestandingSupports(result, { logo = false } = {}) {
  const { widthMm: width, heightMm: height } = result.size.exact.design;
  const scale = result.size.scale, groups = new Map();
  for (const glyph of result.layout.glyphs) {
    const key = logo ? 0 : glyph.lineIndex;
    const b = glyph.bounds, row = groups.get(key) || { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    row.left = Math.min(row.left, b.minX * scale); row.right = Math.max(row.right, b.maxX * scale);
    row.top = Math.min(row.top, b.minY * scale); row.bottom = Math.max(row.bottom, b.maxY * scale);
    groups.set(key, row);
  }
  const rows = [...groups.values()].sort((a,b) => a.top - b.top);
  const rails = rows.flatMap(row => {
    const rowHeight = row.bottom - row.top, inset = Math.min(5, (row.right - row.left) * .015);
    const thickness = Math.min(14, Math.max(7, rowHeight * .09), rowHeight);
    const centers = rows.length === 1 && rowHeight > 150 ? [.28, .72] : [.5];
    return centers.map(f => ({left: Math.max(0,row.left + inset), right: Math.min(width,row.right - inset),
      top: Math.max(0,row.top + rowHeight*f - thickness/2), bottom: Math.min(height,row.top + rowHeight*f + thickness/2)}));
  });
  const polygon = points => 'M' + points.map(([x,y]) => `${+x.toFixed(3)} ${+y.toFixed(3)}`).join('L') + 'Z';
  const paths = rails.map(r => polygon([[r.left,r.top],[r.right,r.top],[r.right,r.bottom],[r.left,r.bottom]]));
  for (let i = 1; i < rails.length; i++) {
    const a = rails[i-1], b = rails[i], left = Math.max(a.left,b.left), right = Math.min(a.right,b.right);
    const half = Math.min(7,(a.right-a.left)/8,(b.right-b.left)/8);
    for (const f of [.25,.75]) {
      // Shared horizontal overlap gives vertical bridges; disjoint rows get slanted bridges.
      const shared = right-left >= 4*half;
      const ax = shared ? left+(right-left)*f : a.left+(a.right-a.left)*f;
      const bx = shared ? ax : b.left+(b.right-b.left)*f;
      paths.push(polygon([[ax-half,(a.top+a.bottom)/2],[ax+half,(a.top+a.bottom)/2],
        [bx+half,(b.top+b.bottom)/2],[bx-half,(b.top+b.bottom)/2]]));
    }
  }
  return { path: paths.join(''), rails };
}

/** Rasterize the padded outlines, join adjacent letters and word gaps broadly, then follow the actual
 * exterior. Coordinates are millimetres from the backing's top-left bounding box. */
export function buildBackingContour(result, marginMm = 12.5, version = 2) {
  if(version!==1&&version!==2)throw new Error('Unsupported backing contour version.');
  if (cache.get(result)?.margin === marginMm && cache.get(result)?.version === version) return cache.get(result).path;
  const { layout, size } = result;
  const widthMm = size.exact.design.widthMm + 2 * marginMm;
  const heightMm = size.exact.design.heightMm + 2 * marginMm;
  const resolution = Math.min(1200 / widthMm, 600 / heightMm);
  const scale = size.scale * resolution, pad = marginMm * resolution + 2;
  const deterministic=result.rasterVersion===2;
  const canvas = deterministic?{}:document.createElement('canvas');
  canvas.width = Math.ceil(widthMm * resolution) + 4;
  canvas.height = Math.ceil(heightMm * resolution) + 4;
  const raster=deterministic?createRasterMask(canvas.width,canvas.height):null;
  const ctx = deterministic?null:canvas.getContext('2d', { willReadFrequently: true });
  if(ctx){ctx.fillStyle = ctx.strokeStyle = '#000';ctx.lineJoin = ctx.lineCap = 'round';}
  const fillPolygon=points=>{if(raster){raster.polygon(points);return;}ctx.beginPath();ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);ctx.closePath();ctx.fill();};
  const drawGlyph = glyph => {
    if(raster){
      if(glyph.centerlineD)raster.stroke(flattenSvgPath(glyph.centerlineD,([x,y])=>[pad+x*scale,pad+y*scale]),(layout.tubeMm/2+marginMm)*resolution);
      else{const paths=flattenSvgPath(glyph.d,([x,y])=>[pad+(x+glyph.x)*scale,pad+(-y+glyph.y)*scale]);raster.fill(paths);raster.stroke(paths,marginMm*resolution);}
      return;
    }
    if(glyph.centerlineD){
      ctx.setTransform(scale,0,0,scale,pad,pad);
      ctx.lineWidth=(layout.tubeMm+2*marginMm)/size.scale;
      ctx.stroke(new Path2D(glyph.centerlineD));
      return;
    }
    ctx.setTransform(scale, 0, 0, -scale, pad + glyph.x * scale, pad + glyph.y * scale);
    ctx.lineWidth = 2 * marginMm / size.scale;
    const path = new Path2D(glyph.d);
    ctx.fill(path); ctx.stroke(path);
  };
  for (const glyph of layout.glyphs) drawGlyph(glyph);

  // Bridge every adjacent pair on a line, including letters in the same word.
  // Facing halves keep the exposed outer sides while filling the narrow necks
  // between letters with the same broad acrylic used across word gaps.
  const initial = raster?raster.mask.slice():ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const facingPoints = (glyph, right) => {
    const b = glyph.bounds;
    const left = pad + (right ? (b.minX + b.maxX) / 2 : b.minX) * scale;
    const rightEdge = pad + (right ? b.maxX : (b.minX + b.maxX) / 2) * scale;
    const points = [];
    const x0 = Math.max(1, Math.floor(left - marginMm * resolution));
    const x1 = Math.min(canvas.width - 2, Math.ceil(rightEdge + marginMm * resolution));
    const y0 = Math.max(1, Math.floor(pad + b.minY * scale - marginMm * resolution));
    const y1 = Math.min(canvas.height - 2, Math.ceil(pad + b.maxY * scale + marginMm * resolution));
    for (let x = x0; x <= x1; x++) {
      let top = -1, bottom = -1;
      for (let y = y0; y <= y1; y++) if (raster?initial[y*canvas.width+x]:initial[(y * canvas.width + x) * 4 + 3] > 127) {
        if (top < 0) top = y;
        bottom = y + 1;
      }
      if (top >= 0) points.push([x, top], [x, bottom]);
    }
    return points;
  };
  ctx?.setTransform(1, 0, 0, 1, 0, 0);
  // Cut-around follows each whole letter silhouette. Open letter counters and
  // swashes must not leave a narrow tube-shaped carrier, e.g. the left of H.
  // Keep the original padded strokes underneath: added support cannot remove
  // their physical margin.
  if(version===2)for(const glyph of layout.glyphs){
    const hull=convexHull([...facingPoints(glyph,false),...facingPoints(glyph,true)]);
    if(hull.length<3)continue;
    const rounded=softenWordBridge(hull,Infinity,marginMm*2*resolution,deterministic);
    fillPolygon(rounded);
  }
  for (let i = 1; i < layout.glyphs.length; i++) {
    const a = layout.glyphs[i - 1], b = layout.glyphs[i];
    if (a.lineIndex !== b.lineIndex) continue;
    const hull = convexHull([...facingPoints(a, true), ...facingPoints(b, false)]);
    if (hull.length < 3) continue;
    const seamX = pad + (a.bounds.maxX + b.bounds.minX) * scale / 2;
    const rounded = softenWordBridge(hull, seamX, marginMm * 3 * resolution,deterministic);
    fillPolygon(rounded);
  }
  const readMask = () => {
    if(raster)return raster.mask;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return Uint8Array.from({ length: canvas.width * canvas.height }, (_, i) => pixels[i * 4 + 3] > 127 ? 1 : 0);
  };
  let mask = readMask();
  const lines = new Map();
  for (const glyph of layout.glyphs) {
    const box = glyph.bounds, line = lines.get(glyph.lineIndex) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    line.minX = Math.min(line.minX, pad + box.minX * scale - marginMm * resolution);
    line.maxX = Math.max(line.maxX, pad + box.maxX * scale + marginMm * resolution);
    line.minY = Math.min(line.minY, pad + box.minY * scale - marginMm * resolution);
    line.maxY = Math.max(line.maxY, pad + box.maxY * scale + marginMm * resolution);
    lines.set(glyph.lineIndex, line);
  }
  const bridges = lineBridgePolygons(mask, canvas.width, canvas.height, [...lines.values()]);
  for (const bridge of bridges) {
    const hull=version===2?softenWordBridge(bridge,Infinity,marginMm*3*resolution,deterministic):bridge;
    fillPolygon(hull);
  }
  if (bridges.length) mask = readMask();
  const rawPoints = contourFromMask(mask, canvas.width, canvas.height, Math.max(2, marginMm * 2 * resolution));
  const points = version===2 ? smoothCutAround(rawPoints,marginMm*3*resolution,deterministic) : rawPoints;
  // Raster cells can extend beyond the nominal outer size by one pixel.
  // Keep the physical contour inside the size shown to the customer and sent to AR.
  const path = points.length ? 'M' + points.map(([x, y]) =>
    `${Math.max(0, Math.min(widthMm, (x - 2) / resolution)).toFixed(2)} ${Math.max(0, Math.min(heightMm, (y - 2) / resolution)).toFixed(2)}`).join('L') + 'Z' : '';
  cache.set(result, { margin: marginMm, version, path });
  return path;
}


/**
 * Bounded simplification and concave fillets. Work in the existing raster
 * coordinate system; preserve all four extrema and never rescale the sign.
 */
export function smoothCutAround(points,radius,deterministic=false){
 const norm=deterministic?(x,y)=>Math.sqrt(x*x+y*y):Math.hypot;
 if(points.length<4)return points;
 const distance=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  return norm(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
 };
 const anchors=new Set([0]);
 for(const axis of [0,1])for(const sign of [-1,1]){
  let best=0;for(let i=1;i<points.length;i++)if(sign*points[i][axis]>sign*points[best][axis])best=i;anchors.add(best);
 }
 const indices=[...anchors].sort((a,b)=>a-b);indices.push(points.length);
 const keep=new Set(indices.slice(0,-1)),stack=[];
 for(let i=1;i<indices.length;i++)stack.push([indices[i-1],indices[i]]);
 while(stack.length){
  const [a,b]=stack.pop();let maximum=.45,at=-1;
  for(let i=a+1;i<b;i++){const d=distance(points[i],points[a],points[b%points.length]);if(d>maximum){maximum=d;at=i;}}
  if(at>=0){keep.add(at);stack.push([a,at],[at,b]);}
 }
 const simplified=[...keep].sort((a,b)=>a-b).map(i=>points[i]),out=[];
 for(let i=0;i<simplified.length;i++){
  const a=simplified[(i+simplified.length-1)%simplified.length],p=simplified[i],b=simplified[(i+1)%simplified.length];
  const cross=(p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]);
  if(cross>=0){out.push(p);continue;}
  const l1=norm(a[0]-p[0],a[1]-p[1]),l2=norm(b[0]-p[0],b[1]-p[1]),trim=Math.min(radius,l1*.4,l2*.4);
  if(trim<.5){out.push(p);continue;}
  const entry=p.map((v,j)=>v+(a[j]-v)*trim/l1),exit=p.map((v,j)=>v+(b[j]-v)*trim/l2);
  const steps=Math.min(10,Math.max(2,Math.ceil(trim/2)));
  for(let j=0;j<=steps;j++){const t=j/steps;out.push(entry.map((v,k)=>(1-t)**2*v+2*(1-t)*t*p[k]+t*t*exit[k]));}
 }
 return out;
}

/** Add a standing base to a normal M/L/Z preview contour. Width and origin
 * stay unchanged; total height becomes heightMm + supportMm. Slot dimensions
 * are configurable visualization assumptions, not approved manufacturing data. */
export function tabletopContour(path, widthMm, heightMm, {
  supportMm = 20, slotInsetMm = 35, slotWidthMm = 3, slotDepthMm = 12,
} = {}) {
  if (![widthMm, heightMm, supportMm, slotInsetMm, slotWidthMm, slotDepthMm].every(value => Number.isFinite(value) && value > 0)
      || supportMm <= slotDepthMm) throw new Error('Invalid tabletop preview dimensions.');
  const polygon = [...path.matchAll(/[ML]\s*([\d.eE+-]+)[ ,]+([\d.eE+-]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  if (polygon.length < 3) return '';
  const bottom = heightMm + supportMm;
  const resolution = Math.min(1200 / widthMm, 700 / bottom);
  const width = Math.ceil(widthMm * resolution) + 4, height = Math.ceil(bottom * resolution) + 4;
  const baseRow = height - 2, mask = new Uint8Array(width * height);
  // Preserve every existing filled interval, then extend the lower-facing
  // material to the base. Upper overhangs never create full-height pillars,
  // which would close the side cut-ins of letters such as S.
  for (let x = 2; x < width - 2; x++) {
    const at = Math.min(widthMm - 1e-7, (x - 1.5) / resolution), crossings = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((a[0] <= at && b[0] > at) || (b[0] <= at && a[0] > at))
        crossings.push(a[1] + (b[1] - a[1]) * (at - a[0]) / (b[0] - a[0]));
    }
    crossings.sort((a, b) => a - b);
    const fill = (from, to) => {
      const start = Math.max(2, Math.floor(from * resolution) + 2);
      const end = Math.min(baseRow, Math.ceil(to * resolution) + 2);
      for (let y = start; y < end; y++) mask[y * width + x] = 1;
    };
    for (let i = 0; i + 1 < crossings.length; i += 2) fill(crossings[i], crossings[i + 1]);
    fill(Math.max(crossings.at(-1) ?? heightMm, heightMm * .6), bottom);
  }
  const points = traceExterior(mask, width, height).map(([x, y]) => [
    Math.max(0, Math.min(widthMm, (x - 2) / resolution)),
    Math.max(0, Math.min(bottom, (y - 2) / resolution)),
  ]);
  // Keep slots exact in mm even when their width is below raster resolution.
  // For very small previews, move the feet inward proportionately without overlap.
  const inset = Math.min(slotInsetMm, widthMm * .4);
  const halfSlot = Math.min(slotWidthMm, widthMm / 6) / 2;
  const centers = [inset, widthMm - inset], output = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    output.push(a);
    if (a[1] !== bottom || b[1] !== bottom || a[0] === b[0]) continue;
    const direction = Math.sign(b[0] - a[0]);
    for (const center of [...centers].sort((x, y) => direction * (x - y))) {
      if (center - halfSlot < Math.min(a[0], b[0]) || center + halfSlot > Math.max(a[0], b[0])) continue;
      const entry = center - direction * halfSlot, exit = center + direction * halfSlot;
      output.push([entry, bottom], [entry, bottom - slotDepthMm], [exit, bottom - slotDepthMm], [exit, bottom]);
    }
  }
  return output.length ? 'M' + output.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z' : '';
}

/** Round word-bridge shoulders and bow the two long facing edges gently
 * inward. This changes only added acrylic; the padded glyphs stay underneath. */
export function softenWordBridge(input, seamX, radius, deterministic=false) {
  const norm=deterministic?(x,y)=>Math.sqrt(x*x+y*y):Math.hypot;
  const sine=deterministic?t=>Math.round(Math.sin(t)*1e12)/1e12:Math.sin;
  const hull = input.map(point => [...point]);
  // Raster hulls contain many nearly-collinear vertices. Removing these first
  // permits a real shoulder radius instead of tiny per-pixel corner rounding.
  let changed = true;
  while (changed && hull.length > 4) {
    changed = false;
    for (let i = 0; i < hull.length && hull.length > 4; i++) {
      const a = hull[(i + hull.length - 1) % hull.length], b = hull[i], c = hull[(i + 1) % hull.length];
      const distance = Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / (norm(c[0] - a[0], c[1] - a[1]) || 1);
      if (distance < radius * .09) { hull.splice(i--, 1); changed = true; }
    }
  }
  const crossingYs = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    if ((a[0] <= seamX && b[0] > seamX) || (b[0] <= seamX && a[0] > seamX))
      crossingYs.push(a[1] + (b[1] - a[1]) * (seamX - a[0]) / (b[0] - a[0]));
  }
  const depth = crossingYs.length > 1 ? Math.max(...crossingYs) - Math.min(...crossingYs) : 0;
  const corners = hull.map((point, i) => {
    const a = hull[(i + hull.length - 1) % hull.length], b = hull[(i + 1) % hull.length];
    const before = norm(a[0] - point[0], a[1] - point[1]);
    const after = norm(b[0] - point[0], b[1] - point[1]);
    const trim = Math.min(radius, before * .45, after * .45, depth * .25 || radius);
    const toward = (other, length) => point.map((v, axis) => v + (other[axis] - v) * trim / (length || 1));
    return { point, entry: toward(a, before), exit: toward(b, after) };
  });
  const points = [];
  for (let i = 0; i < corners.length; i++) {
    const { point, entry, exit } = corners[i], next = corners[(i + 1) % corners.length].entry;
    for (let j = 0; j <= 8; j++) {
      const t = j / 8;
      points.push(entry.map((v, axis) => (1 - t) ** 2 * v + 2 * (1 - t) * t * point[axis] + t ** 2 * exit[axis]));
    }
    const crosses = Math.min(exit[0], next[0]) <= seamX && Math.max(exit[0], next[0]) >= seamX;
    const bow = crosses ? depth * .1 * Math.sign(next[0] - exit[0]) : 0;
    const steps = Math.max(2, Math.ceil(norm(next[0] - exit[0], next[1] - exit[1]) / 3));
    for (let j = 1; j < steps; j++) {
      const t = j / steps;
      points.push([exit[0] + (next[0] - exit[0]) * t, exit[1] + (next[1] - exit[1]) * t + bow * sine(Math.PI * t) ** 2]);
    }
  }
  return points;
}

/** Broad support between consecutive lines, restricted to their central
 * facing areas. Outer letter sides are not included in the connecting hull. */
export function lineBridgePolygons(mask, width, height, lineBounds) {
  const lines = [...lineBounds].sort((a, b) => a.minY - b.minY);
  const bridges = [];
  const facing = (box, lower, x0, x1) => {
    const points = [], midY = (box.minY + box.maxY) / 2;
    const y0 = Math.max(1, Math.floor(lower ? midY : box.minY));
    const y1 = Math.min(height - 2, Math.ceil(lower ? box.maxY : midY));
    for (let x = Math.max(1, Math.ceil(x0)); x <= Math.min(width - 2, Math.floor(x1)); x++) {
      let top = -1, bottom = -1;
      for (let y = y0; y <= y1; y++) if (mask[y * width + x]) {
        if (top < 0) top = y;
        bottom = y + 1;
      }
      if (top >= 0) points.push([x, top], [x, bottom]);
    }
    return points;
  };
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    const left = Math.max(a.minX, b.minX), right = Math.min(a.maxX, b.maxX);
    const overlap = right - left;
    const shared = overlap > .25 * Math.min(a.maxX - a.minX, b.maxX - b.minX);
    const band = box => shared ? [left + overlap * .1, right - overlap * .1]
      : [box.minX + (box.maxX - box.minX) * .1, box.maxX - (box.maxX - box.minX) * .1];
    const hull = convexHull([...facing(a, true, ...band(a)), ...facing(b, false, ...band(b))]);
    if (hull.length >= 3) bridges.push(hull);
  }
  return bridges;
}

function convexHull(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = input => {
    const out = [];
    for (const point of input) {
      while (out.length > 1 && cross(out.at(-2), out.at(-1), point) <= 0) out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  return [...half(points), ...half([...points].reverse())];
}

/** Pure raster operation, exported for focused contour regression checks.
 * Input is copied. Closed counters are filled, exterior concavities survive,
 * and detached glyph parts are connected by at least bridgeWidth pixels. */
export function contourFromMask(input, width, height, bridgeWidth = 2) {
  const mask = input.slice();
  connectComponents(mask, width, height, bridgeWidth);
  fillCounters(mask, width, height);
  return traceExterior(mask, width, height);
}

function neighbours(index, width, height, visit) {
  const x = index % width, y = Math.floor(index / width);
  if (x) visit(index - 1);
  if (x + 1 < width) visit(index + 1);
  if (y) visit(index - width);
  if (y + 1 < height) visit(index + width);
}

function connectComponents(mask, width, height, bridgeWidth) {
  const labels = new Int32Array(mask.length), queue = new Int32Array(mask.length);
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    let head = 0, tail = 1; queue[0] = i; labels[i] = ++count;
    while (head < tail) neighbours(queue[head++], width, height, next => {
      if (mask[next] && !labels[next]) { labels[next] = count; queue[tail++] = next; }
    });
  }
  if (count < 2) return;
  // Multi-source growth finds neighbouring components in linear raster time.
  const origin = new Int32Array(mask.length), distance = new Int32Array(mask.length);
  let head = 0, tail = 0;
  for (let i = 0; i < mask.length; i++) if (labels[i]) { queue[tail++] = i; origin[i] = i; }
  const edges = new Map();
  while (head < tail) {
    const current = queue[head++];
    neighbours(current, width, height, next => {
      if (!labels[next]) {
        labels[next] = labels[current]; origin[next] = origin[current];
        distance[next] = distance[current] + 1; queue[tail++] = next;
      } else if (labels[next] !== labels[current]) {
        const a = Math.min(labels[next], labels[current]), b = Math.max(labels[next], labels[current]);
        const key = a * (count + 1) + b, cost = distance[next] + distance[current];
        if (!edges.has(key) || edges.get(key).cost > cost)
          edges.set(key, { a, b, cost, p: origin[current], q: origin[next] });
      }
    });
  }
  const roots = Array.from({ length: count + 1 }, (_, i) => i);
  const root = n => { while (roots[n] !== n) { roots[n] = roots[roots[n]]; n = roots[n]; } return n; };
  for (const edge of [...edges.values()].sort((a, b) => a.cost - b.cost)) {
    const a = root(edge.a), b = root(edge.b);
    if (a === b) continue;
    roots[a] = b;
    const p = [edge.p % width + .5, Math.floor(edge.p / width) + .5];
    const q = [edge.q % width + .5, Math.floor(edge.q / width) + .5];
    fillCapsule(mask, width, height, p, q, bridgeWidth / 2);
  }
}

function fillCapsule(mask, width, height, p, q, radius) {
  const dx = q[0] - p[0], dy = q[1] - p[1], length2 = dx * dx + dy * dy;
  const x0 = Math.max(1, Math.floor(Math.min(p[0], q[0]) - radius));
  const x1 = Math.min(width - 2, Math.ceil(Math.max(p[0], q[0]) + radius));
  const y0 = Math.max(1, Math.floor(Math.min(p[1], q[1]) - radius));
  const y1 = Math.min(height - 2, Math.ceil(Math.max(p[1], q[1]) + radius));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = Math.max(0, Math.min(1, ((x + .5 - p[0]) * dx + (y + .5 - p[1]) * dy) / (length2 || 1)));
    if ((x + .5 - p[0] - t * dx) ** 2 + (y + .5 - p[1] - t * dy) ** 2 <= radius ** 2) mask[y * width + x] = 1;
  }
}

function fillCounters(mask, width, height) {
  const outside = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let head = 0, tail = 0;
  const add = i => { if (!mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) neighbours(queue[head++], width, height, add);
  for (let i = 0; i < mask.length; i++) if (!outside[i]) mask[i] = 1;
}

function traceExterior(mask, width, height) {
  const stride = width + 1, edges = new Map();
  const add = (x, y, direction) => {
    const key = y * stride + x;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push(direction);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    if (!y || !mask[(y - 1) * width + x]) add(x, y, 0);
    if (x + 1 === width || !mask[y * width + x + 1]) add(x + 1, y, 1);
    if (y + 1 === height || !mask[(y + 1) * width + x]) add(x + 1, y + 1, 2);
    if (!x || !mask[y * width + x - 1]) add(x, y + 1, 3);
  }
  const delta = [1, stride, -1, -stride], loops = [];
  while (edges.size) {
    const start = edges.keys().next().value;
    let key = start, previous = 0;
    const points = [];
    do {
      points.push([key % stride, Math.floor(key / stride)]);
      const options = edges.get(key);
      if (!options?.length) break;
      const direction = [(previous + 1) % 4, previous, (previous + 3) % 4, (previous + 2) % 4].find(d => options.includes(d));
      options.splice(options.indexOf(direction), 1);
      if (!options.length) edges.delete(key);
      key += delta[direction]; previous = direction;
    } while (key !== start);
    loops.push(points);
  }
  const area = points => Math.abs(points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0));
  const points = loops.sort((a, b) => area(b) - area(a))[0] || [];
  // Drop only collinear samples: no smoothing that erases a real concavity.
  return points.filter((b, i) => {
    const a = points[(i + points.length - 1) % points.length], c = points[(i + 1) % points.length];
    return (b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0]);
  });
}
