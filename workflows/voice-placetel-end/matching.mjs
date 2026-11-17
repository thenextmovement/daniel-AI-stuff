export function findEndedDial(claim, sip, pages, now = Date.now()) {
  if (String(sip.id) !== String(claim.target_id) || String(sip.webuser_id) !== String(claim.employee_id) ||
      String(sip.did) !== String(claim.extension) || typeof sip.sipuid !== 'string' ||
      !/^[\w.-]+@[\w.-]+$/.test(sip.sipuid) || !sip.sipuid.endsWith('@' + sip.domain)) {
    throw new Error('Persönliches Placetel-Ziel konnte nicht bestätigt werden.');
  }
  const canonical = input => {
    const value = String(input ?? '').replace(/[\s()./-]/g, '');
    if (/^00[1-9]\d{6,14}$/.test(value)) return '+' + value.slice(2);
    if (/^0[1-9]\d{5,13}$/.test(value)) return '+49' + value.slice(1);
    return /^\+[1-9]\d{6,14}$/.test(value) ? value : null;
  };
  const since = Date.parse(claim.dialed_at);
  if (!Number.isFinite(since) || !pages.length || pages.some(page => !Array.isArray(page))) {
    throw new Error('Ungültiger Placetel-Verbindungsnachweis.');
  }
  const matches = pages.flat().filter(row => {
    const start = Date.parse(row.received_at);
    return /\bSIP Dialout\s*$/i.test(row.description || '') &&
      (row.from === sip.sipuid.split('@')[0] || row.from === sip.sipuid) &&
      canonical(row.to) === claim.phone && start >= since - 5000 && start <= since + 120000;
  });
  if (matches.length !== 1) return null;
  const {received_at, length} = matches[0];
  if (!Number.isInteger(length) || length < 0 || length > 86400 || Date.parse(received_at)+length*1000 > now) return null;
  return {p_session:claim.session_id, p_phone:claim.phone, p_started:received_at, p_duration:length};
}
