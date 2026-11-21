export const WORKFLOW_ID = 'SEKwtYAVRR7zeKnl';
export const NODE_NAME = 'Validate + Build Shopify Order Context';
export function patchAlert(code) {
  return replaceOnce(code, "recipient: 'info@neontrip.de'", "recipient: 'support@neontrip.de'");
}
function replaceOnce(code, before, after) {
  if (code.split(before).length !== 2) throw new Error('shopify_phone_patch_baseline_mismatch');
  return code.replace(before, after);
}

const helper = String.raw`
function corroboratedCustomerPhone(customer, billing, delivery, offer) {
  const raw = text(customer.phone);
  const country = text(customer.country) || text(billing.country);
  const existing = shopifyPhone(raw, country);
  if (existing || !raw) return existing;
  // Repair only this customer's own national digits, never adopt an address contact.
  // The accepted snapshots must agree on the exact same explicit German number.
  if (!/^(de|deutschland|germany)$/i.test(String(country || '').trim())) return undefined;
  if (!text(offer.signedAt) || !Number.isFinite(Date.parse(offer.signedAt))) return undefined;
  if (/[^\d().\s/\-]/.test(raw)) return undefined;
  const national = raw.replace(/[().\s/\-]/g, '');
  if (!/^[1-9]\d{5,12}$/.test(national)) return undefined;
  const contacts = [billing, delivery].filter(address => text(address?.phone));
  if (!contacts.length) return undefined;
  const corroborating = contacts.map(address => {
    if (!/^(de|deutschland|germany)$/i.test(String(address.country || '').trim())) return undefined;
    return shopifyPhone(address.phone, address.country);
  });
  const expected = '+49' + national;
  return corroborating.every(phone => phone === expected) ? expected : undefined;
}
`;

export function patchContext(code) {
  let next = replaceOnce(code, '\nfunction shopifyEmail(value) {', helper + '\nfunction shopifyEmail(value) {');
  next = replaceOnce(next,
    'const customerPhone = shopifyPhone(customerPhoneOriginal, customerPhoneCountry);',
    'const customerPhone = text(customer.phone)\n  ? corroboratedCustomerPhone(customer, billing, delivery, offer)\n  : shopifyPhone(customerPhoneOriginal, customerPhoneCountry);');
  return replaceOnce(next,
    'phone: shopifyPhone(customer.phone, customer.country || billing.country) || undefined,',
    'phone: text(customer.phone) ? customerPhone : undefined,');
}

export function buildOperations(workflow) {
  if (workflow.id !== WORKFLOW_ID || workflow.versionId !== '8827e6c8-32b8-43de-9595-59096296da8d' || workflow.nodes?.length !== 45) {
    throw new Error('shopify_phone_workflow_baseline_mismatch');
  }
  const node = workflow.nodes.find(node => node.name === NODE_NAME);
  if (!node || node.type !== 'n8n-nodes-base.code') throw new Error('shopify_phone_node_missing');
  const alert = workflow.nodes.find(node => node.name === 'Build Contact-Fallback Success Alert');
  if (!alert || alert.type !== 'n8n-nodes-base.code') throw new Error('shopify_phone_alert_node_missing');
  const sender = workflow.nodes.find(node => node.name === 'Kontakt-Fallback-Mail senden');
  if (!sender || sender.type !== 'n8n-nodes-base.microsoftOutlook' || sender.parameters?.toRecipients !== 'info@neontrip.de') throw new Error('shopify_phone_alert_route_mismatch');
  return [
    { type: 'updateNode', nodeName: NODE_NAME, updates: { 'parameters.jsCode': patchContext(node.parameters.jsCode) } },
    { type: 'updateNode', nodeName: alert.name, updates: { 'parameters.jsCode': patchAlert(alert.parameters.jsCode) } },
    { type: 'updateNode', nodeName: sender.name, updates: { 'parameters.toRecipients': 'support@neontrip.de' } }
  ];
}
