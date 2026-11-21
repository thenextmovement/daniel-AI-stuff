const current = $input.first().json || {};
const order = current.order || current;
const fallback = current.neontripContactFallback || {};
const details = Array.isArray(fallback.details)
  ? fallback.details.filter((entry) => entry && entry.label && entry.value !== undefined && entry.value !== null)
  : [];
const shouldSend = fallback.used === true && details.length > 0;
const offerId = fallback.offerId || null;
const offerNumber = fallback.offerNumber || offerId || 'unbekanntes Angebot';
const orderId = String(order.id || '').replace(/^gid:\/\/shopify\/Order\//, '') || null;
const orderName = order.name || (order.order_number ? '#' + order.order_number : null);
const adminUrl = offerId
  ? 'https://angebote.neontrip.de/admin/offers/' + encodeURIComponent(String(offerId))
  : 'https://angebote.neontrip.de/admin/offers';
const shopifyUrl = orderId
  ? 'https://admin.shopify.com/store/galaxybuzzdk/orders/' + encodeURIComponent(orderId)
  : null;
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const fieldBlocks = details.map((entry) =>
  '<div style="margin:16px 0;padding:16px;border:2px solid #d97706;border-radius:10px;background:#fff7ed">' +
    '<p style="margin:0 0 8px"><strong>Shopify-Sale wurde erstellt, aber die ' + escapeHtml(entry.label) + ' konnte nicht in Shopify eingespielt werden.</strong></p>' +
    '<div style="font-size:22px;font-weight:800;line-height:1.35;word-break:break-word">' + escapeHtml(entry.value) + '</div>' +
  '</div>'
).join('');
const subject = 'HINWEIS: Shopify-Sale erstellt – Kontaktdaten ausgelassen – ' + String(offerNumber);
const body = [
  '<h2>Shopify-Sale wurde erfolgreich erstellt</h2>',
  '<p><strong>Angebot:</strong> ' + escapeHtml(offerNumber) + '</p>',
  orderName ? '<p><strong>Shopify-Sale:</strong> ' + escapeHtml(orderName) + '</p>' : '',
  fieldBlocks,
  '<p><a href="' + escapeHtml(adminUrl) + '">Angebot direkt öffnen</a></p>',
  shopifyUrl ? '<p><a href="' + escapeHtml(shopifyUrl) + '">Shopify-Sale direkt öffnen</a></p>' : '',
  '<p>Die vollständigen Originaldaten bleiben im angenommenen Angebot gespeichert.</p>'
].join('');
return [{ json: {
  ...current,
  contactFallbackAlert: {
    shouldSend,
    recipient: 'info@neontrip.de',
    subject,
    body,
    adminUrl,
    shopifyUrl,
    details
  }
} }];
