const input = $input.first().json || {};
const payload = input.body && typeof input.body === 'object' ? input.body : input;
const errors = [];
const headers = input.headers && typeof input.headers === 'object' ? input.headers : {};
const expectedSecret = String($env.SHOPIFY_SALE_WEBHOOK_SECRET || $env.N8N_SHOPIFY_SALE_WEBHOOK_SECRET || '').trim();
const receivedSignature = String(
  headers['x-neontrip-signature'] ||
  headers['X-Neontrip-Signature'] ||
  headers['X-NEONTRIP-SIGNATURE'] ||
  ''
).trim();

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shopifyPhone(value, country) {
  const raw = text(value);
  if (!raw) return undefined;
  // Normalize national numbers only with an explicit German country context.
  // Do not infer the country from a number alone or concatenate extension text.
  if (/[^\d+().\s/\-]/.test(raw)) return undefined;
  const german = /^(de|deutschland|germany)$/i.test(String(country || '').trim());
  const formatted = raw.replace(/^(\+49|0049)\s*\(0\)/, '$1');
  const compact = formatted.replace(/[().\s/\-]/g, '');
  let international = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  if (german && /^0[1-9]\d{5,12}$/.test(international)) international = '+49' + international.slice(1);
  else if (german && /^49[1-9]\d{5,12}$/.test(international)) international = '+' + international;
  if (!/^\+[1-9]\d{7,14}$/.test(international)) return undefined;
  const digits = international.slice(1);
  // Shopify rejects malformed Romanian numbers such as +40 followed by a German 01... mobile number.
  const romanianNational = international.match(/^\+40(\d+)$/)?.[1];
  if (romanianNational && !/^[237]\d{8}$/.test(romanianNational)) return undefined;
  return `+${digits}`;
}

function shopifyEmail(value) {
  const raw = text(value);
  if (!raw || raw.length > 254 || /[\s<>]/.test(raw)) return undefined;
  if (!/^[^@]+@[^@]+\.[^@]{2,}$/.test(raw)) return undefined;
  const [local, domain] = raw.split('@');
  if (!local || local.length > 64 || !domain || domain.length > 253) return undefined;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return undefined;
  return raw;
}

function cents(value) {
  return Math.round(number(value) * 100);
}

function isPrivateEmail(email) {
  const domain = String(email || '').toLowerCase().split('@').pop() || '';
  const privateDomains = new Set([
    'gmail.com', 'googlemail.com', 'web.de', 'gmx.de', 'gmx.net',
    'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de',
    'yahoo.com', 'yahoo.de', 'icloud.com', 'me.com', 'mac.com', 't-online.de',
    'freenet.de', 'aol.com', 'proton.me', 'protonmail.com', 'mailbox.org'
  ]);
  return privateDomains.has(domain);
}

function cleanCountry(country) {
  const value = text(country);
  if (!value) return 'Germany';
  const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const countries = {
    de: 'Germany', deutschland: 'Germany', germany: 'Germany',
    at: 'Austria', osterreich: 'Austria', austria: 'Austria',
    ch: 'Switzerland', schweiz: 'Switzerland', suisse: 'Switzerland', svizzera: 'Switzerland', switzerland: 'Switzerland',
    nl: 'Netherlands', niederlande: 'Netherlands', netherlands: 'Netherlands',
    be: 'Belgium', belgien: 'Belgium', belgium: 'Belgium',
    fr: 'France', frankreich: 'France', france: 'France',
    it: 'Italy', italien: 'Italy', italy: 'Italy',
    es: 'Spain', spanien: 'Spain', spain: 'Spain',
    pt: 'Portugal', portugal: 'Portugal',
    pl: 'Poland', polen: 'Poland', poland: 'Poland',
    cz: 'Czechia', tschechien: 'Czechia', czechia: 'Czechia',
    dk: 'Denmark', danemark: 'Denmark', denmark: 'Denmark',
    se: 'Sweden', schweden: 'Sweden', sweden: 'Sweden',
    no: 'Norway', norwegen: 'Norway', norway: 'Norway',
    fi: 'Finland', finnland: 'Finland', finland: 'Finland',
    ie: 'Ireland', irland: 'Ireland', ireland: 'Ireland',
    lu: 'Luxembourg', luxemburg: 'Luxembourg', luxembourg: 'Luxembourg',
    gr: 'Greece', griechenland: 'Greece', greece: 'Greece',
    hu: 'Hungary', ungarn: 'Hungary', hungary: 'Hungary',
    sk: 'Slovakia', slowakei: 'Slovakia', slovakia: 'Slovakia',
    si: 'Slovenia', slowenien: 'Slovenia', slovenia: 'Slovenia',
    hr: 'Croatia', kroatien: 'Croatia', croatia: 'Croatia',
    ro: 'Romania', rumanien: 'Romania', romania: 'Romania',
    bg: 'Bulgaria', bulgarien: 'Bulgaria', bulgaria: 'Bulgaria',
  };
  return countries[key] || value;
}

function shopifyAddress(source, customer, fallbackSource = {}) {
  const sourceName = text(source?.name) || text(customer?.signerName) || [customer?.firstName, customer?.lastName].filter(Boolean).join(' ');
  const fallbackName = text(fallbackSource?.name) || [fallbackSource?.firstName, fallbackSource?.lastName].filter(Boolean).join(' ');
  const parts = sourceName ? sourceName.split(/\s+/) : [];
  const fallbackParts = fallbackName ? fallbackName.split(/\s+/) : [];
  return {
    first_name: text(source?.firstName) || text(parts[0]) || text(fallbackSource?.firstName) || text(fallbackParts[0]) || text(customer?.firstName) || 'Kunde',
    last_name: text(source?.lastName) || text(parts.slice(1).join(' ')) || text(fallbackSource?.lastName) || text(fallbackParts.slice(1).join(' ')) || text(customer?.lastName) || text(source?.company) || text(fallbackSource?.company) || 'Kunde',
    company: text(source?.company) || text(customer?.company),
    address1: text(source?.street),
    zip: text(source?.zip),
    city: text(source?.city),
    country: cleanCountry(source?.country),
    phone: shopifyPhone(source?.phone, source?.country) || shopifyPhone(customer?.phone, customer?.country || fallbackSource?.country || source?.country)
  };
}

function originalAddressValue(source) {
  const cityLine = [text(source?.zip), text(source?.city)].filter(Boolean).join(' ');
  return [
    text(source?.name) || [text(source?.firstName), text(source?.lastName)].filter(Boolean).join(' '),
    text(source?.company),
    text(source?.street),
    cityLine,
    text(source?.country),
    text(source?.phone)
  ].filter(Boolean).join(', ') || '(leer)';
}

function verifySignature() {
  if (!expectedSecret) {
    errors.push('SHOPIFY_SALE_WEBHOOK_SECRET missing in n8n environment');
    return;
  }
  if (!receivedSignature || !receivedSignature.startsWith('sha256=')) {
    errors.push('missing webhook signature');
    return;
  }
  let createHmac;
  let timingSafeEqual;
  try {
    ({ createHmac, timingSafeEqual } = require('crypto'));
  } catch (error) {
    errors.push('crypto module unavailable for signature verification');
    return;
  }
  const rawBody = input.rawBody || JSON.stringify(payload);
  const expectedSignature = 'sha256=' + createHmac('sha256', expectedSecret).update(rawBody).digest('hex');
  const left = Buffer.from(receivedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    errors.push('invalid webhook signature');
  }
}

verifySignature();
if (payload.source !== 'neontrip-offers') errors.push('source must be neontrip-offers');
if (payload.event !== 'offer.completed') errors.push('event must be offer.completed');
if (!text(payload.idempotencyKey)) errors.push('idempotencyKey missing');
if (!payload.offer || typeof payload.offer !== 'object') errors.push('offer missing');
if (!payload.offer?.id) errors.push('offer.id missing');
if (!Array.isArray(payload.lineItems) || payload.lineItems.length === 0) errors.push('lineItems missing');

if (errors.length) {
  return [{ json: { shouldCreate: false, statusCode: 400, ok: false, error: 'invalid_payload', issues: errors } }];
}


const customer = payload.customer || {};
const billing = payload.billingAddress || {};
const delivery = payload.deliveryAddress || {};
const offer = payload.offer || {};
const totals = payload.totals || {};
const vatRate = number(offer.vatRate ?? totals.vatRate ?? 19);
const taxExempt = Boolean(offer.taxExempt);
const taxTreatment = text(offer.taxTreatment) || (taxExempt ? 'EU_INTRA_COMMUNITY' : 'TAXABLE');
const taxIdType = text(offer.taxIdType) || text(billing.taxIdType);
const managedTaxTag = 'NEONTRIP_TAX_MANAGED';
const taxTreatmentLabel = taxTreatment === 'CH_EXPORT'
  ? 'Steuerfreie Ausfuhrlieferung'
  : taxTreatment === 'EU_INTRA_COMMUNITY'
    ? 'Steuerfreie innergemeinschaftliche Lieferung'
    : 'Umsatzsteuerpflichtig';
const customerEmailOriginal = text(customer.email) || text(customer.signerEmail) || text(billing.email);
const invoiceEmailOriginal = text(billing.email) || customerEmailOriginal;
const customerEmail = shopifyEmail(customerEmailOriginal);
const invoiceEmail = shopifyEmail(invoiceEmailOriginal) || customerEmail;
const projectNumber = text(billing.projectNumber);
const offerNumber = text(offer.offerNumber) || text(offer.documentReference) || text(offer.id);
const nerdyFormsId = text(offer.nerdyFormsId);
const customerPhoneOriginal = text(customer.phone) || text(billing.phone) || text(delivery.phone);
const customerPhoneCountry = text(customer.phone) ? (text(customer.country) || text(billing.country)) : text(billing.phone) ? text(billing.country) : text(delivery.country);
const customerPhone = shopifyPhone(customerPhoneOriginal, customerPhoneCountry);
const shouldSendReceipt = false;
const privateEmailReceipt = Boolean(customerEmail && isPrivateEmail(customerEmail));

const totalsCents = {
  subtotalNet: cents(totals.subtotalNet),
  vatAmount: cents(totals.vatAmount),
  totalGross: cents(totals.totalGross)
};
if (totalsCents.subtotalNet + totalsCents.vatAmount !== totalsCents.totalGross) {
  throw new Error('offer_tax_totals_invalid_before_shopify_create');
}
if (taxExempt && totalsCents.vatAmount !== 0) {
  throw new Error('tax_exempt_offer_contains_vat_before_shopify_create');
}

const sourceRows = payload.lineItems.map((item, index) => {
  const title = text(item.title) || `Position ${index + 1}`;
  const description = text(item.description);
  const section = text(item.section);
  const quantity = Math.max(1, Math.trunc(number(item.quantity) || 1));
  const unitNet = number(item.unitPriceNet || (number(item.lineNet) / quantity) || 0);
  const unitGross = number(item.unitPriceGross) || unitNet * (1 + vatRate / 100);
  const lineNet = item.lineNet !== undefined && item.lineNet !== null ? number(item.lineNet) : unitNet * quantity;
  const lineGross = item.lineGross !== undefined && item.lineGross !== null ? number(item.lineGross) : unitGross * quantity;
  const targetLineCents = cents(taxExempt ? lineNet : lineGross);
  if (targetLineCents < 0) throw new Error('negative_offer_line_not_supported_before_shopify_create');
  return {item,index,title,description,section,quantity,unitNet,unitGross,lineNet,lineGross,targetLineCents,allocationAdjustmentCents:0};
});

const projectedSourceCents = sourceRows.reduce((sum, row) => sum + row.targetLineCents, 0);
const targetOrderCents = taxExempt ? totalsCents.subtotalNet : totalsCents.totalGross;
const allocationDifference = targetOrderCents - projectedSourceCents;
if (allocationDifference) {
  const maximumRoundingResidual = Math.max(1, sourceRows.length);
  if (Math.abs(allocationDifference) > maximumRoundingResidual) {
    throw new Error('offer_line_totals_do_not_match_accepted_total_before_shopify_create');
  }
  let adjustmentIndex = -1;
  for (let index = sourceRows.length - 1; index >= 0; index -= 1) {
    if (/^(produkt|product)$/i.test(String(sourceRows[index].section || ''))) {
      adjustmentIndex = index;
      break;
    }
  }
  if (adjustmentIndex < 0) adjustmentIndex = sourceRows.length - 1;
  const adjusted = sourceRows[adjustmentIndex];
  if (!adjusted || adjusted.targetLineCents + allocationDifference < 0) {
    throw new Error('offer_product_price_allocation_invalid_before_shopify_create');
  }
  adjusted.targetLineCents += allocationDifference;
  adjusted.allocationAdjustmentCents = allocationDifference;
}

const lineItems = [];
for (const row of sourceRows) {
  const lowerUnitCents = Math.floor(row.targetLineCents / row.quantity);
  const upperUnitCount = row.targetLineCents - lowerUnitCents * row.quantity;
  const lowerUnitCount = row.quantity - upperUnitCount;
  const baseProperties = [
    row.description ? { name: 'Beschreibung', value: row.description } : null,
    row.section ? { name: 'Bereich', value: row.section } : null,
    row.item.id ? { name: 'Offer Item ID', value: String(row.item.id) } : null,
    { name: '_NEONTRIP Source Quantity', value: String(row.quantity) },
    { name: '_NEONTRIP Source Unit Net', value: String(row.unitNet) },
    { name: '_NEONTRIP Source Unit Gross', value: String(row.unitGross) },
    { name: '_NEONTRIP Source Line Net', value: String(row.lineNet) },
    { name: '_NEONTRIP Source Line Gross', value: String(row.lineGross) },
    row.allocationAdjustmentCents ? { name: '_NEONTRIP Product Price Adjustment Cents', value: String(row.allocationAdjustmentCents) } : null
  ].filter(Boolean);
  const addBucket = (quantity, unitCents, bucket) => {
    if (quantity) {
      lineItems.push({
        title: row.title,
        quantity,
        price: (unitCents / 100).toFixed(2),
        requires_shipping: true,
        taxable: !taxExempt,
        properties: [
          ...baseProperties,
          upperUnitCount ? { name: '_NEONTRIP Cent Allocation', value: bucket } : null
        ].filter(Boolean)
      });
    }
  };
  addBucket(lowerUnitCount, lowerUnitCents, 'lower');
  addBucket(upperUnitCount, lowerUnitCents + 1, 'upper');
}
const projectedShopifyCents = lineItems.reduce((sum, row) => sum + Math.round(Number(row.price) * 100) * Number(row.quantity), 0);
if (projectedShopifyCents !== targetOrderCents) {
  throw new Error('shopify_cent_allocation_failed_before_order_create');
}

const billingAddress = shopifyAddress(billing, customer);
const shippingAddress = shopifyAddress(delivery, customer, billingAddress);
const requiredAddressFields = ['last_name', 'address1', 'city', 'country'];
const completeShopifyAddress = (address) => requiredAddressFields.every((field) => Boolean(text(address?.[field])));
const billingAddressComplete = completeShopifyAddress(billingAddress);
const shippingAddressComplete = completeShopifyAddress(shippingAddress);
const contactOmissions = [];
const contactFallbackDetails = [];
if (customerEmailOriginal && !customerEmail) {
  contactOmissions.push('email_invalid');
  contactFallbackDetails.push({ key: 'email', label: 'E-Mail', value: customerEmailOriginal });
}
if (customerPhoneOriginal && !customerPhone) {
  contactOmissions.push('phone_invalid');
  contactFallbackDetails.push({ key: 'phone', label: 'Telefonnummer', value: customerPhoneOriginal });
}
if (!billingAddressComplete) {
  contactOmissions.push('billing_address_incomplete');
  contactFallbackDetails.push({ key: 'billing_address', label: 'Rechnungsadresse', value: originalAddressValue(billing) });
}
if (!shippingAddressComplete) {
  contactOmissions.push('shipping_address_incomplete');
  contactFallbackDetails.push({ key: 'shipping_address', label: 'Lieferadresse', value: originalAddressValue(delivery) });
}
const contactFallbackUsed = contactOmissions.length > 0;
const adminUrl = `https://angebote.neontrip.de/admin/offers/${encodeURIComponent(String(offer.id || ''))}`;
const noteAttributes = [
  { name: 'NEONTRIP Offer ID', value: String(offer.id || '') },
  { name: 'NEONTRIP Offer Number', value: String(offerNumber || '') },
  { name: 'NEONTRIP Offer URL', value: String(offer.publicUrl || '') },
  { name: 'NEONTRIP PDF Snapshot', value: String(offer.finalPdfUrl || '') },
  { name: 'Trello Card ID', value: String(offer.trelloCardId || '') },
  projectNumber ? { name: 'Projektnummer', value: projectNumber } : null,
  { name: 'Nerdy-Forms_ID', value: String(nerdyFormsId || '') },
  { name: 'Idempotency Key', value: String(payload.idempotencyKey) },
  { name: 'Invoice Mail Intended', value: shouldSendReceipt ? 'yes_private_email' : 'no_business_email' },
  { name: 'Rechnungs-E-Mail', value: String(invoiceEmailOriginal || '') },
  { name: 'NEONTRIP Admin URL', value: adminUrl },
  contactFallbackUsed ? { name: 'NEONTRIP Contact Fallback', value: 'yes' } : null,
  contactFallbackUsed ? { name: 'NEONTRIP Contact Omitted', value: contactOmissions.join(',') } : null,
  taxExempt ? { name: 'Steuerbehandlung', value: taxTreatmentLabel } : null,
  taxExempt && billing.vatId ? { name: taxIdType === 'CH_UID' ? 'Schweizer UID' : 'USt-IdNr.', value: String(billing.vatId) } : null
].filter((entry) => entry && entry.value);

const customerBody = {
  customer: {
    first_name: text(customer.firstName) || billingAddress.first_name,
    last_name: text(customer.lastName) || billingAddress.last_name,
    email: customerEmail || undefined,
    // A delivery or invoice contact is not necessarily the Shopify account owner.
    phone: shopifyPhone(customer.phone, customer.country || billing.country) || undefined,
    currency: text(offer.currency) || 'EUR',
    tax_exempt: taxExempt,
    tags: taxExempt ? managedTaxTag : undefined,
    addresses: [
      billingAddressComplete ? billingAddress : null,
      shippingAddressComplete ? shippingAddress : null
    ].filter(Boolean)
  }
};

const baseOrder = {
  // Keep the Shopify customer/contact email stable. The separate invoice email is carried in note attributes and billing payload.
  email: customerEmail || undefined,
  note: [
    `NEONTRIP Angebot: ${offerNumber}`,
    projectNumber ? `Projektnummer: ${projectNumber}` : null,
    nerdyFormsId ? `Nerdy-Forms_ID: ${nerdyFormsId}` : null,
    offer.publicUrl ? `Angebotslink: ${offer.publicUrl}` : null,
    offer.finalPdfUrl ? `PDF Snapshot: ${offer.finalPdfUrl}` : null,
    contactFallbackUsed ? `Kontaktdaten-Fallback: ${contactOmissions.join(', ')}; Originaldaten im angenommenen Angebot: ${adminUrl}` : null,
    `Netto: ${totals.subtotalNet ?? ''} / MwSt: ${totals.vatAmount ?? ''} / Brutto: ${totals.totalGross ?? ''}`,
    taxExempt ? `${taxTreatmentLabel}${billing.vatId ? ` / ${taxIdType === 'CH_UID' ? 'Schweizer UID' : 'USt-IdNr.'}: ${billing.vatId}` : ''}` : null
  ].filter(Boolean).join('\n'),
  send_receipt: false,
  send_fulfillment_receipt: false,
  financial_status: 'pending',
  currency: text(offer.currency) || 'EUR',
  po_number: projectNumber || undefined,
  taxes_included: !taxExempt,
  total_tax: (totalsCents.vatAmount / 100).toFixed(2),
  tax_lines: taxExempt ? undefined : [{
    title: `MwSt. ${vatRate}%`,
    price: number(totals.vatAmount).toFixed(2),
    rate: vatRate / 100
  }],
  line_items: lineItems,
  billing_address: billingAddressComplete ? billingAddress : undefined,
  shipping_address: shippingAddressComplete ? shippingAddress : undefined,
  note_attributes: noteAttributes,
};

return [{ json: {
  shouldCreate: true,
  statusCode: 200,
  idempotencyKey: payload.idempotencyKey,
  offerId: offer.id,
  offerNumber,
  trelloCardId: text(offer.trelloCardId),
  customerEmail,
  invoiceEmail,
  customerEmailOriginal,
  invoiceEmailOriginal,
  contactFallbackUsed,
  contactOmissions,
  contactFallbackDetails,
  customerPhoneOriginal,
  billingAddressOriginal: originalAddressValue(billing),
  shippingAddressOriginal: originalAddressValue(delivery),
  projectNumber,
  customerSearchQuery: customerEmail ? `email:${customerEmail}` : 'id:0',
  shouldSendReceipt,
  isPrivateEmail: privateEmailReceipt,
  paymentReceiptReason: shouldSendReceipt ? 'private_email_send_receipt_enabled' : 'business_email_no_shopify_receipt',
  taxExempt,
  taxTreatment,
  taxIdType,
  managedTaxTag,
  acceptedAt: text(offer.acceptedAt) || text(offer.signedAt),
  customerBody,
  baseOrder,
  totalsCents
} }];
