import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEmailBillingChanges, signBillingConfirmation, verifyBillingConfirmation } from '../../src/lib/ops/billing/email-confirmation';
const secret = 'test-only-confirmation-secret-not-a-production-key-123456';
const proposal = { caseId: 'd03fa491-67cc-491f-8c19-6b6ec9767cb4', customerEmail: 'customer@example.com', conversationId: 'conversation-1', requestMessageId: '<request@example.com>', revision: 2, updatedAt: '2026-11-25T10:00:00.000Z', action: 'change' as const, changes: { billingAddress: { name: 'Example', street: 'Testweg 1', zip: '40219', city: 'Düsseldorf', country: 'DE' } }, expiresAt: 2000000000 };
test('only address and VAT metadata can be proposed', () => {
  assert.deepEqual(validateEmailBillingChanges(proposal.changes, false), proposal.changes);
  for (const field of ['lineItems','price','discount','paymentMethod','invoiceEmail','projectNumber','vatRate','vatValidation']) assert.throws(() => validateEmailBillingChanges({[field]: 'x'}, false));
  assert.throws(() => validateEmailBillingChanges({billingAddress: {name: 'x', price: '10'}}, false));
});
test('final invoice cannot have delivery address changed', () => {
  assert.throws(() => validateEmailBillingChanges({deliveryAddress: proposal.changes.billingAddress}, true));
  assert.deepEqual(validateEmailBillingChanges({vatId: 'DE123456789'}, true), {vatId: 'DE123456789'});
});
test('confirmation is bound to exact data, customer and conversation', () => {
  const token = signBillingConfirmation(proposal, secret);
  assert.deepEqual(verifyBillingConfirmation(token, secret, {customerEmail: proposal.customerEmail, conversationId: proposal.conversationId, now: 1900000000}), proposal);
  assert.throws(() => verifyBillingConfirmation(token, secret, {customerEmail: 'someone@example.com', conversationId: proposal.conversationId, now: 1900000000}));
  assert.throws(() => verifyBillingConfirmation(token, secret, {customerEmail: proposal.customerEmail, conversationId: 'other', now: 1900000000}));
  assert.throws(() => verifyBillingConfirmation(token, secret, {customerEmail: proposal.customerEmail, conversationId: proposal.conversationId, now: 2000000001}));
  const [payload, signature] = token.split('.');
  const altered = JSON.parse(Buffer.from(payload, 'base64url').toString()); altered.changes.billingAddress.street = 'Other 2';
  assert.throws(() => verifyBillingConfirmation(Buffer.from(JSON.stringify(altered)).toString('base64url') + '.' + signature, secret, {customerEmail: proposal.customerEmail, conversationId: proposal.conversationId, now: 1900000000}));
});
test('missing bindings and weak keys fail closed', () => {
  assert.throws(() => signBillingConfirmation({...proposal, conversationId: ''}, secret));
  assert.throws(() => signBillingConfirmation(proposal, 'short'));
  assert.throws(() => signBillingConfirmation({...proposal, changes: {price: 1}}, secret));
});
