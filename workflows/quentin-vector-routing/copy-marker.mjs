export const MARKER_PREFIX = '<!-- NEONTRIP_QUENTIN_COPY:v1 source=';

export function buildCopyMarker(sourceId, targetId) {
  return `Kopie\n\n${MARKER_PREFIX}${sourceId} target=${targetId} -->`;
}

export function parseCopyMarker(text) {
  const value = String(text || '');
  const start = value.indexOf(MARKER_PREFIX);
  if (start < 0) return null;
  const body = value.slice(start + MARKER_PREFIX.length);
  const end = body.indexOf(' -->');
  if (end < 0) return null;
  const parts = body.slice(0, end).split(' target=');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { sourceId: parts[0].trim(), targetId: parts[1].trim() };
}

export function findSourceRegistryTarget(actions, sourceId) {
  for (const action of Array.isArray(actions) ? actions : []) {
    const parsed = parseCopyMarker(action?.data?.text);
    if (parsed && parsed.sourceId === String(sourceId) && parsed.targetId) return parsed.targetId;
  }
  return '';
}

export function hasExactSelfMarker(actions, sourceId, targetId) {
  const expected = buildCopyMarker(sourceId, targetId);
  return (Array.isArray(actions) ? actions : []).some(action => String(action?.data?.text || '').includes(expected));
}
