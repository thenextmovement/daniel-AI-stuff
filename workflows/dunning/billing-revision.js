// Billing revisions may disambiguate a replacement only when every live
// Pro-forma is accounted for by the same immutable billing case.
const resolveBillingRevision = (() => {
  let rows = [];
  try {
    const pages = $('Read Billing Revisions').all().map(i => i.json);
    const all = []; let total = null, valid = pages.length > 0;
    for (const p of pages) {
      const range = String(p.headers?.['content-range'] || p.headers?.['Content-Range'] || '');
      const match = range.match(/^(\d+)-(\d+)\/(\d+)$/);
      if (![200,206].includes(p.statusCode) || !Array.isArray(p.body)) { valid = false; break; }
      if (range === '*/0' && pages.length === 1 && p.body.length === 0) { total = 0; continue; }
      if (!match || Number(match[1]) !== all.length || Number(match[2]) !== all.length + p.body.length - 1 ||
          (total !== null && total !== Number(match[3]))) { valid = false; break; }
      total = Number(match[3]); all.push(...p.body);
    }
    if (valid && total === all.length) rows = all;
  } catch { /* Missing evidence cannot resolve an ambiguous document. */ }
  return (docs, orderId, orderName) => {
    if (docs.length < 2 || docs.some(d => d.type !== 'PROFORMA_INVOICE')) return docs;
    const cases = rows.filter(c => String(c.shopify_order_id).replace(/^gid:\/\/shopify\/Order\//,'') === String(orderId) &&
      c.shopify_order_name === orderName);
    if (cases.length !== 1) return docs;
    const c = cases[0];
    if (c.status !== 'PAYMENT_PENDING' || c.paid_at || c.cancelled_at || c.refunded_at ||
        c.tax_review_status === 'REVIEW_REQUIRED' || !Number.isInteger(c.current_revision) || c.current_revision < 1 ||
        !Array.isArray(c.billing_documents)) return docs;
    const mapped = docs.map(d => c.billing_documents.filter(b => b.document_type === 'PROFORMA' &&
      String(b.easybill_document_id) === String(d.id) && b.document_number === d.number &&
      Number(b.amount_cents) === Number(d.amount) && Number(d.amount) === Number(c.total_gross_cents) &&
      b.currency === d.currency && d.currency === c.currency &&
      Number.isInteger(b.revision) && b.revision <= c.current_revision &&
      ['FINALIZED','SENT'].includes(b.status)));
    if (mapped.some(a => a.length !== 1)) return docs;
    const current = docs.filter((d,i) => mapped[i][0].revision === c.current_revision &&
      mapped[i][0].status === 'SENT' && Number.isFinite(Date.parse(mapped[i][0].sent_at)));
    return current.length === 1 ? current : docs;
  };
})();
