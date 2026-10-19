const terminal = $('Build Terminal Evidence Payload').first().json || {};
const gate = $('Build Complete Live Gate + Message').first().json || {};
if (terminal.verified !== true) throw new Error('DUNNING_PROJECTION_REQUIRES_VERIFIED_SEND');
const stage = Number(gate.stage);
if (!Number.isInteger(stage) || stage < 1 || stage > 6) throw new Error('DUNNING_PROJECTION_STAGE_INVALID');
const sentAt = DateTime.fromISO(String(terminal.audit_record?.metadata?.sent_at || ''), { setZone: true }).toUTC();
if (!sentAt.isValid) throw new Error('DUNNING_PROJECTION_SENT_AT_INVALID');
const localSent = sentAt.setZone('Europe/Berlin');
const nextBusinessDayOrSame = (value) => {
  let result = value.startOf('day');
  while (result.weekday > 5) result = result.plus({ days: 1 });
  return result;
};
const addBusinessDays = (value, count) => {
  let result = value.startOf('day');
  let remaining = count;
  while (remaining > 0) {
    result = result.plus({ days: 1 });
    if (result.weekday <= 5) remaining -= 1;
  }
  return result;
};
let nextDue = null;
if (stage === 1 || stage === 2) {
  nextDue = addBusinessDays(localSent, 4);
} else if (stage === 3) {
  const orderCreated = DateTime.fromISO(String(gate.shopify_order_created_at || ''), { setZone: true }).setZone('Europe/Berlin');
  const invoiceDue = DateTime.fromISO(String(gate.easybill_due_date || ''), { zone: 'Europe/Berlin' });
  if (!orderCreated.isValid || !invoiceDue.isValid) throw new Error('DUNNING_PROJECTION_S4_BASELINE_INVALID');
  const candidates = [
    nextBusinessDayOrSame(orderCreated.plus({ days: 14 })),
    nextBusinessDayOrSame(localSent.plus({ days: 7 })),
    nextBusinessDayOrSame(invoiceDue.plus({ days: 1 }))
  ];
  nextDue = candidates.reduce((latest, value) => value > latest ? value : latest);
} else if ((stage === 4 || stage === 5) && gate.stage_model !== 'legacy_4') {
  nextDue = nextBusinessDayOrSame(localSent.plus({ days: 7 }));
}
const orderNumber = String(gate.shopify_order_name || '').normalize('NFKC').trim().toUpperCase();
if (!/^#NEONT\d+$/.test(orderNumber)) throw new Error('DUNNING_PROJECTION_ORDER_INVALID');
const updatedBy = 'n8n:TICKET-099 verified sender projection TICKET-298';
return [{ json: {
  order_number: orderNumber,
  stage,
  sent_at: sentAt.toISO(),
  next_due_at: nextDue ? nextDue.toISODate() : null,
  updated_at: $now.toUTC().toISO(),
  updated_by: updatedBy,
  insert_record: {
    shopify_order_number: orderNumber,
    mahnstufe: stage,
    last_sent_at: sentAt.toISO(),
    next_due_at: nextDue ? nextDue.toISODate() : null,
    updated_at: $now.toUTC().toISO(),
    updated_by: updatedBy
  },
  patch_record: {
    mahnstufe: stage,
    last_sent_at: sentAt.toISO(),
    next_due_at: nextDue ? nextDue.toISODate() : null,
    updated_at: $now.toUTC().toISO(),
    updated_by: updatedBy
  }
} }];