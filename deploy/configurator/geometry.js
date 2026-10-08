/** Pure outline geometry. No glow, tube routing or manufacturing tolerance is measured. */
export class GeometryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GeometryError';
    this.code = code;
  }
}

const fail = (code, message) => { throw new GeometryError(code, message); };
const positive = value => Number.isFinite(value) && value > 0;
const invisible = text => /^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f]*$/u.test(text);
const shapingOnly = char => /^[\p{M}\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufe00-\ufe0f]$/u.test(char);

/** Fontkit preserves source codepoints, but not source cluster offsets. Prove an
 * ordered mapping before offering individual targets; ambiguous shaping falls
 * back to coloring the entire line together instead of guessing a character. */
function characterTargets(line, run) {
  const characters = Array.from(line);
  const fallback = () => run.glyphs.map(() => ({
    charIndex: 0, charText: line, charLength: characters.length, charMapping: 'line-fallback',
  }));
  if (typeof Intl.Segmenter !== 'function') return fallback();
  const clusters = [];
  let clusterStart = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)) {
    const length = Array.from(segment).length;
    const cluster = { start: clusterStart, end: clusterStart + length };
    for (let index = cluster.start; index < cluster.end; index++) clusters[index] = cluster;
    clusterStart += length;
  }
  // Tabs still occupy four spaces visually but count as one original codepoint.
  const expanded = [], origins = [];
  characters.forEach((char, index) => {
    for (const value of char === '\t' ? '    ' : [char]) {
      expanded.push(value.codePointAt(0)); origins.push(index);
    }
  });
  const order = run.glyphs.map((_, index) => index);
  if (run.direction === 'rtl') order.reverse();
  const ranges = new Array(run.glyphs.length);
  let cursor = 0, previousRange;
  for (const glyphIndex of order) {
    const points = run.glyphs[glyphIndex].codePoints;
    if (!points?.length) {
      // Fontkit may emit a remaining combining mark with empty codePoints after
      // canonical composition. A zero-advance glyph following a marked grapheme
      // belongs to that same target; do not advance into the next base character.
      if (!previousRange || run.positions[glyphIndex].xAdvance !== 0
        || !characters.slice(previousRange.start, previousRange.end).some(char => /\p{M}/u.test(char))) return fallback();
      ranges[glyphIndex] = { ...previousRange };
      while (cursor < expanded.length && origins[cursor] < previousRange.end
        && shapingOnly(String.fromCodePoint(expanded[cursor]))) cursor++;
      continue;
    }
    const matches = start => points.every((point, offset) => expanded[start + offset] === point);
    // Composition can consume a combining mark without retaining it in codePoints.
    while (!matches(cursor) && cursor < expanded.length
      && shapingOnly(String.fromCodePoint(expanded[cursor]))) cursor++;
    if (!matches(cursor)) return fallback();
    const first = clusters[origins[cursor]];
    const last = clusters[origins[cursor + points.length - 1]];
    if (!first || !last) return fallback();
    ranges[glyphIndex] = { start: first.start, end: last.end };
    previousRange = ranges[glyphIndex];
    cursor += points.length;
  }
  if (expanded.slice(cursor).some(point => !shapingOnly(String.fromCodePoint(point)))) return fallback();
  // A required ligature can overlap the cluster of an additional mark. Merge
  // overlapping ranges so both glyphs always receive the same color target.
  const groups = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = groups.at(-1);
    if (last && range.start < last.end) last.end = Math.max(last.end, range.end);
    else groups.push({ ...range });
  }
  return ranges.map(range => {
    const group = groups.find(candidate => candidate.start <= range.start && candidate.end >= range.end);
    return {
      charIndex: group.start, charText: characters.slice(group.start, group.end).join(''),
      charLength: group.end - group.start, charMapping: 'cluster',
    };
  });
}

/**
 * Shape with Fontkit, then measure the real paths, including positioning offsets.
 * Coordinates are font units with SVG's downward Y. Render each returned glyph:
 * <path d={glyph.d} transform={`translate(${glyph.x} ${glyph.y}) scale(1 -1)`}/>
 * Align visible contours, then apply each line's leading-space advance as an indent.
 * Measure the combined silhouette, so whitespace itself adds no material.
 * Internal spaces and blank-line baseline spacing are retained. Outer empty lines
 * affect lineCount, but never enlarge the measured visible silhouette.
 */
export function layoutText(font, {
  text = '', alignment = 'center', lineHeight = 1.25, maxLines = 5,
} = {}) {
  if (!font || typeof font.layout !== 'function' || !positive(font.unitsPerEm)) {
    fail('INVALID_FONT', 'Diese Schriftdatei kann nicht verarbeitet werden.');
  }
  if (typeof text !== 'string') fail('INVALID_TEXT', 'Bitte einen Schriftzug eingeben.');
  if (!['left', 'center', 'right'].includes(alignment)) {
    fail('INVALID_ALIGNMENT', 'Die Textausrichtung ist ungültig.');
  }
  if (!positive(lineHeight) || !Number.isInteger(maxLines) || maxLines < 1) {
    fail('INVALID_LAYOUT', 'Die Zeileneinstellungen sind ungültig.');
  }
  // Treat pasted NBSP/thin/ideographic spaces as spacing, never as neon glyphs.
  // Keep one original codepoint per space; tabs retain their four-space advance.
  const lines = text.replace(/\r\n?/g, '\n').replace(/[^\S\n\t]/gu, ' ').split('\n');
  if (lines.length > maxLines) {
    fail('TOO_MANY_LINES', `Bitte höchstens ${maxLines} Zeilen verwenden.`);
  }
  if (invisible(lines.join(''))) fail('EMPTY_TEXT', 'Bitte einen Schriftzug eingeben.');

  const baselineStep = font.unitsPerEm * lineHeight;
  const shapedLines = lines.map((line, lineIndex) => {
    const glyphs = [];
    let minX = Infinity, maxX = -Infinity;
    let cursorX = 0, cursorY = 0, wordIndex = 0, afterSpace = false, indent = 0;
    // Keep kerning, required ligatures and mark positioning; separate ordinary
    // optional ligatures such as fi so Latin letters can be colored individually.
    const run = font.layout(line.replace(/\t/g, '    '), { liga: false, clig: false, dlig: false, hlig: false });
    if (!run || run.glyphs.length !== run.positions.length) {
      fail('INVALID_FONT', 'Die Schrift liefert keine gültigen Zeichenpositionen.');
    }
    const targets = characterTargets(line, run);
    for (let index = 0; index < run.glyphs.length; index++) {
      const glyph = run.glyphs[index];
      const position = run.positions[index];
      const characters = String.fromCodePoint(...(glyph.codePoints || []));
      if (glyph.id === 0 && (!characters || !invisible(characters))) {
        fail('UNSUPPORTED_GLYPH', characters
          ? `Die Schrift unterstützt „${characters}“ nicht. Bitte eine andere Schrift wählen.`
          : 'Die Schrift unterstützt mindestens ein eingegebenes Zeichen nicht.');
      }
      if (characters && invisible(characters)) afterSpace = glyphs.length > 0;
      else if (afterSpace) { wordIndex++; afterSpace = false; }
      const { xAdvance, yAdvance = 0, xOffset = 0, yOffset = 0 } = position;
      if (![xAdvance, yAdvance, xOffset, yOffset].every(Number.isFinite)) {
        fail('INVALID_FONT', 'Die Schrift enthält ungültige Zeichenpositionen.');
      }
      const path = glyph.path;
      const d = path.toSVG();
      const box = path.bbox;
      if (!glyphs.length && !d) indent += xAdvance;
      if (d && glyph.id !== 0) {
        if (!box || ![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) {
          fail('INVALID_FONT', 'Die Schrift enthält eine ungültige Zeichenkontur.');
        }
        const x = cursorX + xOffset;
        const y = lineIndex * baselineStep - cursorY - yOffset;
        const bounds = {
          minX: x + box.minX, maxX: x + box.maxX,
          minY: y - box.maxY, maxY: y - box.minY,
        };
        minX = Math.min(minX, bounds.minX);
        maxX = Math.max(maxX, bounds.maxX);
        glyphs.push({ d, x, y, lineIndex, wordIndex, glyphId: glyph.id, bounds, ...targets[index] });
      }
      cursorX += xAdvance;
      cursorY += yAdvance;
    }
    return { glyphs, minX, indent, width: glyphs.length ? maxX - minX : 0 };
  });

  const width = Math.max(...shapedLines.map(line => line.width));
  if (!positive(width)) fail('EMPTY_OUTLINE', 'Die Eingabe enthält keine darstellbare Schriftkontur.');
  const glyphs = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const line of shapedLines) {
    const alignmentOffset = alignment === 'right' ? width - line.width
      : alignment === 'center' ? (width - line.width) / 2 : 0;
    for (const glyph of line.glyphs) {
      const xShift = alignmentOffset - line.minX + line.indent;
      glyph.x += xShift;
      glyph.bounds.minX += xShift;
      glyph.bounds.maxX += xShift;
      minX = Math.min(minX, glyph.bounds.minX);
      maxX = Math.max(maxX, glyph.bounds.maxX);
      minY = Math.min(minY, glyph.bounds.minY);
      maxY = Math.max(maxY, glyph.bounds.maxY);
      glyphs.push(glyph);
    }
  }
  const height = maxY - minY;
  if (!positive(height)) fail('EMPTY_OUTLINE', 'Die Eingabe enthält keine darstellbare Schriftkontur.');
  for (const glyph of glyphs) {
    glyph.x -= minX;
    glyph.bounds.minX -= minX;
    glyph.bounds.maxX -= minX;
    glyph.y -= minY;
    glyph.bounds.minY -= minY;
    glyph.bounds.maxY -= minY;
  }
  return {
    glyphs, bounds: { x: 0, y: 0, width: maxX - minX, height },
    // A shared indent moves the whole preview; it is not extra sign material.
    indentEm: Math.min(...shapedLines.filter(line => line.glyphs.length).map(line => line.indent)) / font.unitsPerEm,
    lineCount: lines.length, unitsPerEm: font.unitsPerEm, baselineStep,
    alignment, measurement: 'visible-font-outline',
  };
}

/** Scale the silhouette uniformly. The margin is an assumed rectangular backing. */
export function sizeLayout(layout, { axis = 'width', valueMm = 1000, marginMm = 15 } = {}) {
  if (!layout?.bounds || !positive(layout.bounds.width) || !positive(layout.bounds.height)) {
    fail('INVALID_LAYOUT', 'Es fehlt eine gültige Schriftkontur.');
  }
  if (!['width', 'height'].includes(axis) || !positive(valueMm)
      || !Number.isFinite(marginMm) || marginMm < 0) {
    fail('INVALID_SIZE', 'Bitte ein gültiges Maß größer als null eingeben.');
  }
  const scale = valueMm / layout.bounds[axis];
  const widthMm = layout.bounds.width * scale;
  const heightMm = layout.bounds.height * scale;
  const exact = {
    design: { widthMm, heightMm },
    backing: { widthMm: widthMm + marginMm * 2, heightMm: heightMm + marginMm * 2 },
  };
  return {
    scale, marginMm, axis,
    design: { widthMm: Math.round(widthMm), heightMm: Math.round(heightMm) },
    backing: {
      widthMm: Math.round(exact.backing.widthMm),
      heightMm: Math.round(exact.backing.heightMm),
    },
    exact,
  };
}
