// The payment API may mask a database exception as billing_payment_failed.
// Only a successful, empty lookup is evidence that the billing case is absent.
const previous = $('Validate Billing v2 Payment').first().json || {};
const response = $json || {};
const maskedFailure = [0, 500].includes(Number(previous.billingFailureStatus || 0)) &&
  ['', 'BILLING_PAYMENT_FAILED'].includes(String(previous.billingFailureCode || '').toUpperCase());
const confirmedAbsent = Number(response.statusCode) === 200 && Array.isArray(response.body) && response.body.length === 0;
const verifiedOrder = previous.customerIdentityMatched === true && /^[0-9]+$/.test(String(previous.shopifyOrderId || '')) &&
  String(previous.order?.id || '') === String(previous.shopifyOrderId);
return [{json: maskedFailure && confirmedAbsent && verifiedOrder
  ? {...previous, billingFailureCode:'BILLING_CASE_NOT_FOUND', legacyCaseAbsenceVerified:true}
  : previous} ];
