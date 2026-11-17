/** The provider gives participants and a start time but no recording-to-call foreign key. */
export function matchRecording(claim, response, binding, endpoint) {
  if (response.statusCode !== 200 || !Array.isArray(response.body)) return {outcome:'failed'};
  const phone = value => {
    const s = String(value ?? '').replace(/[\s().-]/g,'');
    if (/^\+[1-9]\d{6,14}$/.test(s)) return s;
    if (/^00[1-9]\d{6,14}$/.test(s)) return '+' + s.slice(2);
    if (/^0[1-9]\d{5,12}$/.test(s)) return '+49' + s.slice(1);
    return null;
  };
  const from = phone(claim.source_phone), to = phone(claim.phone), dial = Date.parse(claim.dialed_at);
  if (!from || !to || !Number.isFinite(dial) || response.body.length >= 100) return {outcome:'ambiguous'};
  const staff = binding?.statusCode === 200 && binding.body?.length === 1 && binding.body[0].voice_staff;
  const user = endpoint?.statusCode === 200 && endpoint.body;
  const verifiedSip = staff && user && /^[1-9]\d*$/.test(String(staff.placetel_target_id)) &&
    String(staff.placetel_target_id) === String(user.id) && staff.placetel_employee_id != null &&
    String(staff.placetel_employee_id) === String(user.webuser_id) && staff.extension != null &&
    String(staff.extension) === String(user.did) && phone(user.callerid) === from &&
    /^[^@\s]+@[^@\s]+$/.test(user.sipuid) && user.sipuid.endsWith('@' + user.domain) && user.sipuid;
  const candidates = response.body.filter(r => {
    const delta = Date.parse(r.time) - dial;
    return r.direction === 'out' && phone(r.to) === to && delta >= -5000 && delta <= 120000;
  });
  if (!verifiedSip && candidates.some(r => String(r.from).includes('@'))) return {outcome:'failed'};
  const matching = candidates.filter(r => phone(r.from) === from || (verifiedSip && r.from === verifiedSip));
  if (matching.length !== 1) return {outcome:matching.length ? 'ambiguous':'missing'};
  const r = matching[0];
  // No authorization header is forwarded to the media server.
  const url = String(r.file || '');
  const signed = url.match(/^https:\/\/storage\.googleapis\.com\/placetel-documents\/uploads\/recording\/file\/([1-9]\d*)\/[A-Za-z0-9@%._~-]+\?([^#\s]+)$/);
  const allowedMedia = /^https:\/\/(?:[a-z0-9-]+\.)*(?:placetel\.de|fpbx\.de)(?:\/|$)/i.test(url) ||
    (signed && signed[1] === String(r.id) && ['GoogleAccessId','Expires','Signature'].every(key =>
      signed[2].split('&').some(part => part.startsWith(key + '=') && part.length > key.length + 1)));
  if (!/^[1-9]\d*$/.test(String(r.id)) || !(Number(r.duration)>0) ||
      !allowedMedia) return {outcome:'failed'};
  return {outcome:'found',url:r.file,recording:{id:String(r.id),from,to,direction:'out',time:r.time,duration:Number(r.duration)}};
}

export function segmentsOf(response) {
  if (response.statusCode !== 200 || !Array.isArray(response.body?.segments)) return {outcome:'failed'};
  const labels = new Map(), segments = [];
  for (const turn of response.body.segments) {
    const text = String(turn.text ?? '').trim();
    if (!text) continue;
    if (typeof turn.speaker !== 'string' || !turn.speaker || !Number.isFinite(turn.start) ||
        !Number.isFinite(turn.end) || turn.start < 0 || turn.end < turn.start) return {outcome:'failed'};
    if (!labels.has(turn.speaker)) labels.set(turn.speaker,'speaker_' + (labels.size + 1));
    if (labels.size > 2) return {outcome:'ambiguous'};
    segments.push({speaker:labels.get(turn.speaker),text,startMs:Math.round(turn.start*1000),endMs:Math.round(turn.end*1000)});
  }
  if (!segments.length) return {outcome:'failed'};
  return {outcome:labels.size===2?'complete':'single_speaker',segments};
}
