const observedAt = new Date().toISOString();
const items = (function validateShopifyPages(items, expectedCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) throw Error('SHOPIFY_MIRROR_COUNT_INVALID');
  const ids=new Set(); const out=[];
  for (const [index,item] of items.entries()) {
    const p=item.json;
    if (p.statusCode!==200 || !Array.isArray(p.body?.orders)) throw Error('SHOPIFY_MIRROR_PAGE_INVALID');
    const link=String(p.headers?.link||p.headers?.Link||'');
    const hasNext=/rel="next"/.test(link);
    if (hasNext !== (index < items.length-1)) throw Error('SHOPIFY_MIRROR_TERMINAL_PAGE_MISSING');
    for (const o of p.body.orders) {
      if (!/^\d+$/.test(String(o.id||'')) || ids.has(String(o.id)) || !o.name || [o.total_outstanding,o.total_price,o.current_total_price].some(v=>v==null||String(v).trim()===''||!Number.isFinite(Number(v))) || (Number(o.total_price)<0 || Number(o.current_total_price)<0) || !/^[A-Z]{3}$/.test(o.currency||'') || typeof o.test!=='boolean' || !Number.isFinite(Date.parse(o.updated_at))) throw Error('SHOPIFY_MIRROR_ORDER_INVALID');
      ids.add(String(o.id));
    }
    out.push({json:p.body});
  }
  if (ids.size!==expectedCount) throw Error('SHOPIFY_MIRROR_COUNT_MISMATCH');
  return out;
})($input.all(),$('Shopify: Count Orders').first().json.count);
const all = [];
for (const it of items) { const j = it.json || {}; if (Array.isArray(j.orders)) all.push(...j.orders); }
const num = (v) => (v == null || v === '') ? null : Number(v);
const addr = (a) => {
  if (!a) return null;
  const x = { name: a.name || [a.first_name, a.last_name].filter(Boolean).join(' ') || null, company: a.company || null, address1: a.address1 || null, address2: a.address2 || null, zip: a.zip || null, city: a.city || null, country: a.country || null, phone: a.phone || null };
  return Object.values(x).some((v) => v) ? x : null;
};
function row(o) {
  const ba = o.billing_address || {};
  const sa = o.shipping_address || {};
  const c = o.customer || {};
  const kunde = ba.company || sa.company || [c.first_name || ba.first_name, c.last_name || ba.last_name].filter(Boolean).join(' ').trim() || ba.name || sa.name || '';
  const email = o.email || o.contact_email || c.email || '';
  const match = [ba.company, sa.company, c.first_name, c.last_name, ba.first_name, ba.last_name, ba.name, sa.first_name, sa.last_name, sa.name, o.note, (String(email).split('@')[0] || '')].filter(Boolean).join(' ').toLowerCase();
  const phone = o.phone || sa.phone || ba.phone || (c.default_address && c.default_address.phone) || c.phone || null;
  return { is_test: o.test, current_total_price: num(o.current_total_price), shopify_updated_at: o.updated_at, ingested_at: observedAt, shopify_order_id: String(o.id), name: o.name || null, financial_status: o.financial_status || null, fulfillment_status: o.fulfillment_status || null, total_price: num(o.total_price), total_outstanding: num(o.total_outstanding), subtotal_price: num(o.subtotal_price), currency: o.currency || null, email: email || null, kunde: kunde || null, kunde_email: email || null, match_text: match || null, tags: o.tags || null, payment_gateway_names: Array.isArray(o.payment_gateway_names) ? o.payment_gateway_names : [], created_at: o.created_at || null, processed_at: o.processed_at || null, cancelled_at: o.cancelled_at || null, ship_address: addr(o.shipping_address), bill_address: addr(o.billing_address), phone };
}
const rows = all.map(row);
const batches = [];
for (let i = 0; i < rows.length; i += 200) batches.push(rows.slice(i, i + 200));
return batches.map((b) => ({ json: { batch: b, anzahl: b.length } }));
