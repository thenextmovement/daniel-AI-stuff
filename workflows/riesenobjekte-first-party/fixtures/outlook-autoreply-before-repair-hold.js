const source = $('Normalize Oldest Outlook Inquiry').first().json || {};
const existingLead = $('Assess Existing Lead').first().json.existingLead || {};
const processing = $('Evaluate Processing Complete').first().json || {};

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char];
  });
}
function buildRiesenobjekteSignatureHtml() {
  return '<div style="margin:28px 0 14px 0">Viele Grüße</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#111">' +
    '<tr>' +
    '<td valign="top" style="vertical-align:top;padding:0 14px 0 0">' +
    '<img src="https://cdn.shopify.com/s/files/1/0534/7819/5350/files/fabienne123.jpg?v=1764000653" width="72" height="72" alt="Fabienne Trapp" style="display:block;width:72px;height:72px;border-radius:50%;object-fit:cover">' +
    '</td>' +
    '<td valign="top" style="vertical-align:top;padding:0">' +
    '<div style="font-weight:700;font-size:14px;margin:0 0 2px 0">Fabienne Trapp</div>' +
    '<div style="font-size:12px;color:#555;margin:0 0 10px 0">Kundenberatung</div>' +
    '<div role="img" aria-label="RIESENOBJEKTE" style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:20px;letter-spacing:.5px;margin:0 0 8px 0;color:#111">' +
    'RIESEN<span style="color:#ccff00">OBJEKTE</span>' +
    '</div>' +
    '<div style="font-size:12px;color:#444;margin:0 0 10px 0">Inflatables &amp; aufblasbare Sonderformen</div>' +
    '<div style="font-size:12px;color:#222">' +
    'Tel.: <a href="tel:+4921154257241" style="color:#222;text-decoration:none">+49 211 54257241</a><br>' +
    'E-Mail: <a href="mailto:info@riesenobjekte.de" style="color:#222;text-decoration:none">info@riesenobjekte.de</a><br>' +
    'Web: <a href="https://www.riesenobjekte.de" style="color:#222;text-decoration:none">www.riesenobjekte.de</a>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    '</table>';
}

const customerEmail = clean(source.senderEmail, 254).toLowerCase();
const senderName = clean(source.senderName, 180);
let firstName = senderName && !senderName.includes('@')
  ? senderName.split(/\s+/).filter(Boolean)[0] || ''
  : '';
const rawObjectType = clean(existingLead.context_snapshot?.project_brief?.object_type, 300);
const objectType = rawObjectType && !/^noch offen$/i.test(rawObjectType) ? rawObjectType : '';
const trelloCardId = clean(processing.trelloCardId, 1000);
const internalOk = processing.ready === true && Boolean(trelloCardId);

const autoReplyHtml = '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;max-width:640px">' +
  '<p>' + (firstName ? 'Hallo ' + esc(firstName) + ',' : 'Guten Tag,') + '</p>' +
  '<p>vielen Dank für Ihre Anfrage bei RIESENOBJEKTE. Wir haben Ihre Angaben' +
  (objectType ? ' zu ' + esc(objectType) : '') +
  ' erhalten und prüfen jetzt die passende Umsetzung.</p>' +
  '<p>Wir melden uns in der Regel innerhalb eines Werktags mit den nächsten Schritten bei Ihnen.</p>' +
  buildRiesenobjekteSignatureHtml() +
  '</div>';

return [{
  json: {
    requestId: clean(source.idempotencyKey, 500),
    customerEmail,
    autoReplySubject: 'Vielen Dank für Ihre Anfrage bei RIESENOBJEKTE',
    autoReplyHtml,
    autoReplyKind: 'normal',
    internalOk,
    trelloCardId
  }
}];