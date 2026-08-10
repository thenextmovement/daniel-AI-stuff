export const CONFIG = Object.freeze({
  quentinBoardId: '62bae9b97705e7419ed64593',
  vectorListId: '6421a75cc602d9d540d59f2d',
  abdulListId: '6421a72719c7af9056e6d16b',
  quoteReadyListId: '659ffc4e5f8bffd67fe38265',
  backboardFieldIds: [
    '67ab34664610ec7a48dd3e25',
    '67ab34753b38d5d627c00406',
    '67f4f919135f6ee95dcfafc1',
    '67f4f96efd792feaa9b0c1df',
  ],
  priceFieldIds: [
    '67ab4036913a9ecdc0cb3a30',
    '67ab404384a17910e9673e48',
    '67f4f8f054ff1b3f888c0228',
    '67f4f933dd18fd2f77bf8708',
  ],
});

export function classifyTitle(title) {
  const value = String(title || '').toLowerCase().replace(/[‐‑‒–—−_]/g, '-');
  const led = /\b(?:led\s*-?\s*neon(?:\s*-?\s*flex)?|neon\s*-?\s*flex)\b/i.test(value);
  if (led) return { kind: 'led-neon-flex', destinationListId: CONFIG.abdulListId, known: true };
  const rules = [
    ['3d-backlit', /\b(?:3d\s*-?\s*)?back\s*-?\s*lit\b/i],
    ['3d-frontlit', /\b(?:3d\s*-?\s*)?front\s*-?\s*lit\b/i],
    ['3d-nonlit', /\b(?:3d\s*-?\s*)?non\s*-?\s*lit\b/i],
    ['3d-other', /\b3d\b/i],
    ['lightbox', /\blight\s*-?\s*box\b/i],
    ['ultra-thin-acrylic', /\bultra\s*-?\s*thin\s+acrylic\b/i],
    ['neon-halo', /\bneon\s*-?\s*halo\b/i],
    ['full-glow', /\bfull\s*-?\s*glow\b/i],
    ['marquee', /\bmarquee?\b/i],
  ];
  const match = rules.find(([, regex]) => regex.test(value));
  if (match) {
    return { kind: match[0], destinationListId: CONFIG.quoteReadyListId, known: true };
  }
  return { kind: 'led-neon-flex', destinationListId: CONFIG.abdulListId, known: true, defaulted: true };
}

export function normalizeBackboard(raw, productKind) {
  const value = String(raw || '').toLowerCase().trim().replace(/[‐‑‒–—−_]/g, ' ');
  if (productKind === 'led-neon-flex') {
    if (/cut\s*to\s*shape|shape\s*cut/.test(value)) return 'Formzuschnitt';
    if (/cut\s*to\s*(?:letter|letters)|fine\s*cut/.test(value)) return 'Feinzuschnitt';
    if (/cut\s*to\s*(?:board|rectangle)|rectangular\s*cut/.test(value)) return 'Rechteckiger Zuschnitt';
    return '';
  }
  if (/loose\s*letters?/.test(value)) return 'Einzelne Buchstaben';
  return '';
}

export function normalizeMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[^0-9,.-]/g, '').replace(',', '.');
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

export function priceMismatch(current, extracted) {
  const left = normalizeMoney(current);
  const right = normalizeMoney(extracted);
  return right !== null && (left === null || Math.abs(left - right) > 0.009);
}

export function withDeviationSuffix(title, mismatch) {
  const clean = String(title || '').trim();
  if (!mismatch || clean.includes('Custom Fields Abweichung❗')) return clean;
  return `${clean} Custom Fields Abweichung❗`;
}

export function planBackboards(productKind, variants = []) {
  const slots = Array(4).fill('');
  const issues = [];
  for (let i = 0; i < Math.min(variants.length, 4); i += 1) {
    const translated = normalizeBackboard(variants[i]?.backboard_raw, productKind);
    slots[i] = translated;
    if (!translated) issues.push(`Backboard_${i + 1} konnte nicht sicher ausgelesen werden`);
  }
  if (variants.length > 4) issues.push(`${variants.length - 4} weitere Variante(n) passen nicht in die vier Trello-Felder`);
  if (!variants.length) issues.push('image.png lieferte keine sicher zuordenbare Variante');
  return { slots, issues };
}
