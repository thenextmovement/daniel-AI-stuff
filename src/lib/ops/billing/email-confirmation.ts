import { createHmac, timingSafeEqual } from 'node:crypto';
import { sanitizePortalChangeBody } from './portal-change';

export type BillingEmailProposal = {
  caseId: string;
  customerEmail: string;
  conversationId: string;
  requestMessageId: string;
  revision: number;
  updatedAt: string;
  action: 'change' | 'convert' | 'change_and_convert';
  changes: Record<string, unknown>;
  expiresAt: number;
};

export function validateEmailBillingChanges(value: unknown, finalInvoice: boolean): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_billing_email_changes');
  const keys = Object.keys(value);
  const allowed = finalInvoice ? ['billingAddress', 'vatId'] : ['billingAddress', 'deliveryAddress', 'vatId'];
  if (keys.some(key => !allowed.includes(key))) throw new Error('billing_email_field_not_allowed');
  if (!keys.length) return {};
  const { changes } = sanitizePortalChangeBody(value);
  for (const addressKey of ['billingAddress', 'deliveryAddress']) {
    const address = changes[addressKey];
    if (address && !Object.keys(address).length) throw new Error('billing_email_address_empty');
  }
  return changes;
}

function validateProposal(value: unknown): BillingEmailProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_billing_confirmation');
  const p = value as BillingEmailProposal;
  const keys = ['caseId','customerEmail','conversationId','requestMessageId','revision','updatedAt','action','changes','expiresAt'];
  if (Object.keys(p).some(k => !keys.includes(k)) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.caseId) ||
      typeof p.customerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.customerEmail) || p.customerEmail.length > 254 ||
      typeof p.conversationId !== 'string' || !p.conversationId.trim() || p.conversationId.length > 1000 ||
      typeof p.requestMessageId !== 'string' || !p.requestMessageId.trim() || p.requestMessageId.length > 1000 ||
      !Number.isSafeInteger(p.revision) || p.revision < 0 ||
      typeof p.updatedAt !== 'string' || !Number.isFinite(Date.parse(p.updatedAt)) ||
      !['change','convert','change_and_convert'].includes(p.action) || !Number.isSafeInteger(p.expiresAt)) throw new Error('invalid_billing_confirmation');
  const changes = validateEmailBillingChanges(p.changes, false);
  if (p.action === 'change' && !Object.keys(changes).length) throw new Error('billing_email_changes_required');
  return {...p, customerEmail: p.customerEmail.trim().toLowerCase(), changes};
}

function signature(payload: string, secret: string) {
  if (secret.length < 32) throw new Error('billing_confirmation_not_configured');
  return createHmac('sha256', secret).update('billing-email-v1:' + payload).digest();
}

export function signBillingConfirmation(proposal: BillingEmailProposal, secret: string): string {
  const payload = Buffer.from(JSON.stringify(validateProposal(proposal))).toString('base64url');
  return payload + '.' + signature(payload, secret).toString('base64url');
}

export function verifyBillingConfirmation(token: string, secret: string, binding: {customerEmail: string; conversationId: string; now?: number}): BillingEmailProposal {
  if (typeof token !== 'string' || token.length > 16000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid_billing_confirmation');
  const [payload, encodedSignature] = token.split('.');
  const expected = signature(payload, secret);
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('invalid_billing_confirmation');
  const proposal = validateProposal(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  if (proposal.customerEmail !== binding.customerEmail.trim().toLowerCase() || proposal.conversationId !== binding.conversationId ||
      proposal.expiresAt <= (binding.now ?? Math.floor(Date.now()/1000))) throw new Error('billing_confirmation_binding_mismatch');
  return proposal;
}
