import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Review artifact only. Import this module and pass one workflow's `operations`
// to n8n_update_partial_workflow with validateOnly=true first. This file never
// calls n8n, Supabase, Shopify, or Google Ads itself and contains no secret.

const supabaseCredential = {
  httpHeaderAuth: {
    id: 'NTtNxoBGGzJCQi9u',
    name: 'Header Auth account 2 | SUPABASE',
  },
};

const supabaseApiCredential = {
  supabaseApi: {
    id: 'Zaq29c8PLMB1Xlml',
    name: 'Supabase neontrip-followup',
  },
};

const shopifyResolverBody = `={{ (() => {
  const order = $('Split Orders').item.json;
  const customerId = $('Supabase: Upsert Customer').item.json.id || null;
  const noteParts = [order.note];
  if (Array.isArray(order.note_attributes)) {
    for (const attribute of order.note_attributes) {
      if (!attribute || attribute.value == null) continue;
      noteParts.push(String(attribute.name || 'note_attribute') + ': ' + String(attribute.value));
    }
  }
  return JSON.stringify({
    p_shopify_order_id: order.id == null ? null : String(order.id),
    p_shopify_order_number: order.name || null,
    p_customer_id: customerId,
    p_order_time: order.created_at || null,
    p_note: noteParts.filter(Boolean).join('\\n') || null
  });
})() }}`;

const shopifyOrderUpsertBody = `={{ (() => {
  const order = $('Split Orders').item.json;
  const resolverRows = Array.isArray($json.body) ? $json.body : (Array.isArray($json) ? $json : []);
  const resolvedRequestId = resolverRows[0] && resolverRows[0].resolved_request_id
    ? resolverRows[0].resolved_request_id
    : null;
  const payload = {
    shopify_order_id: String(order.id),
    shopify_order_number: order.name,
    customer_id: $('Supabase: Upsert Customer').item.json.id || null,
    order_value: Number(order.total_price) || 0,
    subtotal_price: Number(order.subtotal_price) || 0,
    total_tax: Number(order.total_tax) || 0,
    total_discounts: Number(order.total_discounts) || 0,
    currency: order.currency || 'EUR',
    status: order.financial_status || 'pending',
    fulfillment_status: order.fulfillment_status || 'unfulfilled',
    tracking_number: order.fulfillments && order.fulfillments[0] && order.fulfillments[0].tracking_number
      ? order.fulfillments[0].tracking_number
      : '',
    carrier: order.fulfillments && order.fulfillments[0] && order.fulfillments[0].tracking_company
      ? order.fulfillments[0].tracking_company
      : '',
    shipped_at: order.fulfillments && order.fulfillments[0]
      ? order.fulfillments[0].created_at
      : null,
    delivered_at: order.fulfillment_status === 'fulfilled' && order.fulfillments && order.fulfillments[0]
      ? order.fulfillments[0].updated_at
      : null,
    discount_codes: order.discount_codes && order.discount_codes.length > 0
      ? order.discount_codes.map((discount) => discount.code)
      : null,
    tags: order.tags || '',
    line_items: order.line_items || [],
    shipping_address: order.shipping_address || null,
    billing_address: order.billing_address || null,
    note: order.note || null,
    cancelled_at: order.cancelled_at || null,
    shopify_created_at: order.created_at
  };
  if (resolvedRequestId) payload.request_id = resolvedRequestId;
  return JSON.stringify(payload);
})() }}`;

const prepareDealLedgerRowsCode = `const inputItems = $input.all();
const candidates = Array.isArray(inputItems[0]?.json)
  ? inputItems[0].json
  : inputItems.map((item) => item.json);
const checkedAt = new Date().toISOString();

return candidates.map((row) => {
  const orderNumber = String(row.shopify_order_number || '').trim();
  const email = String(row.email || '').toLowerCase().trim();
  const requestId = String(row.request_id || '').trim();
  const conversionValue = Number(row.conversion_value);
  const conversionTime = new Date(row.conversion_time);

  if (!orderNumber || !email || !requestId) {
    throw new Error('Paid Deal candidate is missing its order, email, or resolved request contract');
  }
  if (!Number.isFinite(conversionValue) || conversionValue <= 0) {
    throw new Error('Paid Deal candidate has no positive canonical net value');
  }
  if (Number.isNaN(conversionTime.getTime())) {
    throw new Error('Paid Deal candidate has no valid canonical conversion time');
  }

  return {
    json: {
      shopify_order_number: orderNumber,
      email,
      gclid: row.gclid || null,
      conversion_name: 'Offline: Deal gewonnen',
      conversion_value: Math.round((conversionValue + Number.EPSILON) * 100) / 100,
      conversion_time: conversionTime.toISOString(),
      request_id: requestId,
      uploaded_to_gads: false,
      deal_value_source: row.value_source,
      deal_time_source: row.time_source,
      deal_request_resolution_source: row.request_resolution_source,
      deal_financial_checked_at: checkedAt
    }
  };
});`;

const buildConversionUploadCode = `const config = $('Config').first().json;
const inputItems = $input.all();
const conversions = Array.isArray(inputItems[0]?.json)
  ? inputItems[0].json
  : inputItems.map((item) => item.json);

if (!Array.isArray(conversions) || conversions.length === 0) {
  return [{ json: { skip: true, reason: 'No conversions', attempts: [], localAttempts: [], localOnly: false } }];
}

const invalidClickIds = new Set(['', 'test', 'undefined', 'null']);
const invalidPrefixes = ['test', 'diagnostic-', 'codex_'];
const validClickId = (value) => {
  const text = String(value || '').trim();
  const normalized = text.toLowerCase();
  return text.length >= 25 && !invalidClickIds.has(normalized) && !invalidPrefixes.some((prefix) => normalized.startsWith(prefix));
};
const attemptedAt = new Date().toISOString();
const rows = [];
const localAttempts = [];
const clickConversions = [];

for (let candidateIndex = 0; candidateIndex < conversions.length; candidateIndex += 1) {
  const conversion = conversions[candidateIndex];
  const sourceId = String(conversion.conversion_id || '').trim();
  const claimToken = String(conversion.claim_token || '').trim();
  const conversionTime = new Date(conversion.conversion_time);
  const actionName = conversion.conversion_name === 'Offline: Angebot versendet'
    ? 'Angebot versendet'
    : conversion.conversion_name === 'Offline: Deal gewonnen'
      ? 'Deal gewonnen'
      : null;
  const conversionAction = actionName ? config.conversionActions[actionName] : null;

  if (!sourceId || !claimToken || !conversionAction || Number.isNaN(conversionTime.getTime())) {
    throw new Error('Claimed conversion violates the upload contract; no provider call was made');
  }

  const conversionTimeIso = conversionTime.toISOString();
  const orderId = sourceId;
  const gclid = validClickId(conversion.gclid) ? String(conversion.gclid).trim() : null;
  const gbraid = validClickId(conversion.gbraid) ? String(conversion.gbraid).trim() : null;
  const wbraid = validClickId(conversion.wbraid) ? String(conversion.wbraid).trim() : null;
  const hashedEmail = /^[a-f0-9]{64}$/.test(String(conversion.hashed_email || ''))
    && conversion.consent_ad_user_data === 'granted'
    ? String(conversion.hashed_email)
    : null;
  const rawValue = Number(conversion.conversion_value ?? 0);
  const conversionValue = Number.isFinite(rawValue) ? rawValue : 0;

  if (!gclid && !gbraid && !wbraid && !hashedEmail) {
    localAttempts.push({
      attemptKey: [$workflow.id, $execution.id, 'conversion', sourceId, 'LOCAL_NO_CLICK_ID'].join(':'),
      sourceType: 'conversion',
      sourceId,
      claimToken,
      conversionAction,
      conversionName: conversion.conversion_name,
      conversionValue,
      conversionTime: conversionTimeIso,
      orderId,
      payloadIndex: candidateIndex,
      jobId: null,
      attemptedAt,
      status: 'permanent_failure',
      errorCode: 'LOCAL_NO_CLICK_ID',
      errorMessage: 'No valid GCLID, GBRAID, WBRAID, or consented hashed email was available; Google Ads was not called.',
      retryAfter: null
    });
    continue;
  }

  const payloadIndex = clickConversions.length;
  const clickConversion = {
    conversionAction,
    conversionDateTime: conversionTimeIso.replace('T', ' ').replace('Z', '+00:00'),
    conversionValue,
    currencyCode: 'EUR',
    orderId
  };
  if (gclid) clickConversion.gclid = gclid;
  if (gbraid) clickConversion.gbraid = gbraid;
  if (wbraid) clickConversion.wbraid = wbraid;
  if (hashedEmail) {
    clickConversion.userIdentifiers = [{
      hashedEmail,
      userIdentifierSource: 'FIRST_PARTY'
    }];
    clickConversion.consent = { adUserData: 'GRANTED' };
    if (conversion.consent_ad_personalization === 'granted') {
      clickConversion.consent.adPersonalization = 'GRANTED';
    } else if (conversion.consent_ad_personalization === 'denied') {
      clickConversion.consent.adPersonalization = 'DENIED';
    }
  }
  clickConversions.push(clickConversion);

  rows.push({
    attemptKey: [$workflow.id, $execution.id, 'conversion', sourceId].join(':'),
    sourceType: 'conversion',
    sourceId,
    claimToken,
    conversionAction,
    conversionName: conversion.conversion_name,
    conversionValue,
    conversionTime: conversionTimeIso,
    orderId,
    payloadIndex,
    attemptedAt
  });
}

if (clickConversions.length === 0) {
  return [{
    json: {
      skip: true,
      reason: localAttempts.length > 0 ? 'No provider-uploadable conversions; local terminal receipts only' : 'No valid conversions',
      attempts: localAttempts,
      localAttempts,
      localOnly: localAttempts.length > 0
    }
  }];
}

return [{
  json: {
    skip: false,
    conversionCount: clickConversions.length,
    withGclid: clickConversions.filter((row) => Boolean(row.gclid)).length,
    withBraid: clickConversions.filter((row) => Boolean(row.gbraid || row.wbraid)).length,
    withEmail: clickConversions.filter((row) => Array.isArray(row.userIdentifiers)).length,
    conversionIds: rows.map((row) => row.sourceId),
    rows,
    attempts: localAttempts,
    localAttempts,
    localOnly: false,
    payload: { conversions: clickConversions, partialFailure: true }
  }
}];`;

const buildAdjustmentUploadCode = `const config = $('Config').first().json;
const inputItems = $input.all();
const adjustments = Array.isArray(inputItems[0]?.json)
  ? inputItems[0].json
  : inputItems.map((item) => item.json);

if (!Array.isArray(adjustments) || adjustments.length === 0) {
  return [{ json: { skip: true, reason: 'No Deal adjustments', rows: [], payload: null } }];
}

const conversionAction = config.conversionActions['Deal gewonnen'];
if (!conversionAction) throw new Error('Deal conversion action is missing; no provider call was made');

const rows = [];
const conversionAdjustments = [];

for (const adjustment of adjustments) {
  const sourceId = String(adjustment.conversion_id || '').trim();
  const claimToken = String(adjustment.claim_token || '').trim();
  const stateKey = String(adjustment.adjustment_state_key || '').trim();
  const adjustmentType = String(adjustment.adjustment_type || '').toUpperCase();
  const adjustedValue = Number(adjustment.adjusted_value);
  const adjustmentDateTime = new Date(adjustment.adjustment_date_time);
  const conversionTime = new Date(adjustment.conversion_time);
  const orderId = String(adjustment.order_id || '').trim();

  const contractValid = sourceId
    && claimToken
    && /^[a-f0-9]{64}$/.test(stateKey)
    && ['RESTATEMENT', 'RETRACTION'].includes(adjustmentType)
    && Number.isFinite(adjustedValue)
    && adjustedValue >= 0
    && !Number.isNaN(adjustmentDateTime.getTime())
    && !Number.isNaN(conversionTime.getTime())
    && adjustmentDateTime.getTime() > conversionTime.getTime()
    && orderId === sourceId
    && adjustment.conversion_name === 'Offline: Deal gewonnen'
    && (adjustmentType !== 'RESTATEMENT' || adjustedValue > 0)
    && (adjustmentType !== 'RETRACTION' || adjustedValue === 0);
  if (!contractValid) {
    throw new Error('Claimed Deal adjustment violates the upload contract; no provider call was made');
  }

  const payloadIndex = conversionAdjustments.length;
  const adjustmentTimeIso = adjustmentDateTime.toISOString();
  const providerRow = {
    conversionAction,
    adjustmentType,
    adjustmentDateTime: adjustmentTimeIso.replace('T', ' ').replace('Z', '+00:00'),
    orderId
  };
  if (adjustmentType === 'RESTATEMENT') {
    providerRow.restatementValue = {
      adjustedValue,
      currencyCode: String(adjustment.currency_code || 'EUR')
    };
  }
  conversionAdjustments.push(providerRow);

  rows.push({
    attemptKey: [$workflow.id, $execution.id, 'adjustment', sourceId, stateKey].join(':'),
    sourceType: 'conversion',
    sourceId,
    claimToken,
    conversionAction,
    conversionName: adjustment.conversion_name,
    conversionTime: conversionTime.toISOString(),
    orderId,
    payloadIndex,
    attemptedAt: new Date().toISOString(),
    adjustmentStateKey: stateKey,
    adjustmentType,
    adjustedValue,
    adjustmentDateTime: adjustmentTimeIso
  });
}

return [{
  json: {
    skip: false,
    adjustmentCount: conversionAdjustments.length,
    rows,
    payload: { conversionAdjustments, partialFailure: true }
  }
}];`;

const checkAdjustmentUploadCode = `const inputItem = $input.first();
const result = inputItem?.json || {};
const batch = $('Build Deal Adjustment Payload').first().json;
const rows = Array.isArray(batch.rows) ? batch.rows : [];

if (rows.length === 0) {
  throw new Error('Adjustment result cannot be mapped: batch rows are missing');
}

const transientCodes = new Set([
  'TOO_RECENT_CONVERSION_ACTION',
  'TOO_RECENT_CONVERSION',
  'CONVERSION_NOT_FOUND',
  'INTERNAL_ERROR',
  'RESOURCE_TEMPORARILY_UNAVAILABLE',
  'TEMPORARY_ERROR',
  'TRANSIENT_ERROR',
  'CONCURRENT_MODIFICATION',
  'EXTERNAL_SERVICE_ERROR',
  'DEADLINE_EXCEEDED',
  'QUOTA_EXCEEDED',
  'RESOURCE_EXHAUSTED'
]);
const cleanMessage = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted-id]').slice(0, 800);
};
const collectErrors = (value, found = []) => {
  if (Array.isArray(value)) {
    for (const child of value) collectErrors(child, found);
  } else if (value && typeof value === 'object') {
    if (value.errorCode && value.location) found.push(value);
    for (const child of Object.values(value)) collectErrors(child, found);
  }
  return found;
};
const getErrorCode = (error) => {
  const entries = Object.entries(error?.errorCode || {});
  return String(entries[0]?.[1] || error?.status || error?.code || 'UNKNOWN');
};
const getErrorIndex = (error) => {
  const elements = error?.location?.fieldPathElements;
  if (!Array.isArray(elements)) return null;
  const adjustmentPart = elements.find((element) =>
    ['conversionAdjustments', 'conversion_adjustments', 'adjustments'].includes(element?.fieldName)
    && element.index !== undefined
    && Number.isInteger(Number(element.index))
  );
  return adjustmentPart ? Number(adjustmentPart.index) : null;
};
const retryAt = (codes, row) => {
  if (codes.includes('TOO_RECENT_CONVERSION')) {
    const conversionTime = new Date(row.conversionTime).getTime();
    const afterTwentyFiveHours = conversionTime + 25 * 60 * 60 * 1000;
    return new Date(Math.max(Date.now() + 60 * 60 * 1000, afterTwentyFiveHours)).toISOString();
  }
  const hours = codes.includes('TOO_RECENT_CONVERSION_ACTION') || codes.includes('CONVERSION_NOT_FOUND') ? 6 : 1;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
};
const duplicateForRow = (codes, row) => codes.every((code) =>
  (row.adjustmentType === 'RESTATEMENT' && code === 'RESTATEMENT_ALREADY_EXISTS')
  || (row.adjustmentType === 'RETRACTION' && code === 'CONVERSION_ALREADY_RETRACTED')
);

const jobId = result.jobId == null || result.jobId === '' ? null : String(result.jobId);
const responseResults = Array.isArray(result.results) ? result.results : [];
const requestError = result.error || inputItem?.error;
const partialFailure = result.partialFailureError;
const googleErrors = collectErrors(partialFailure);
const indexedErrors = new Map();
let ambiguous = Boolean(partialFailure) && googleErrors.length === 0;

for (const error of googleErrors) {
  const index = getErrorIndex(error);
  if (index === null || index < 0 || index >= rows.length) {
    ambiguous = true;
    continue;
  }
  if (!indexedErrors.has(index)) indexedErrors.set(index, []);
  indexedErrors.get(index).push(error);
}

const requestMessage = cleanMessage(
  typeof requestError === 'string'
    ? requestError
    : requestError?.message || partialFailure?.message || 'Google Ads adjustment request could not be mapped safely'
);
const requestCode = String(
  typeof requestError === 'object' && requestError
    ? requestError.status || requestError.code || 'REQUEST_FAILURE'
    : 'REQUEST_FAILURE'
);

const attempts = rows.map((row, index) => {
  if (requestError || ambiguous) {
    return {
      ...row,
      jobId,
      status: 'request_failure',
      errorCode: requestCode,
      errorMessage: requestMessage,
      retryAfter: retryAt([], row)
    };
  }

  const rowErrors = indexedErrors.get(index) || [];
  if (rowErrors.length > 0) {
    const codes = rowErrors.map(getErrorCode);
    const messages = [...new Set(rowErrors.map((error) => cleanMessage(error.message || codes.join(','))))];
    const status = duplicateForRow(codes, row)
      ? 'duplicate'
      : codes.every((code) => transientCodes.has(code))
        ? 'retryable'
        : 'permanent_failure';
    return {
      ...row,
      jobId,
      status,
      errorCode: [...new Set(codes)].join(',').slice(0, 160),
      errorMessage: messages.join(' | ').slice(0, 800),
      retryAfter: status === 'retryable' ? retryAt(codes, row) : null
    };
  }

  const responseRow = responseResults[index];
  const explicitSuccess = responseRow && typeof responseRow === 'object' && Object.keys(responseRow).length > 0;
  if (!explicitSuccess) {
    return {
      ...row,
      jobId,
      status: 'request_failure',
      errorCode: 'MISSING_RESULT',
      errorMessage: 'Google Ads returned no explicit result for this adjustment payload index',
      retryAfter: retryAt([], row)
    };
  }

  return {
    ...row,
    jobId,
    status: 'success',
    errorCode: null,
    errorMessage: null,
    retryAfter: null
  };
});

return [{
  json: {
    attempts,
    jobId,
    counts: {
      attempted: attempts.length,
      success: attempts.filter((attempt) => attempt.status === 'success').length,
      duplicate: attempts.filter((attempt) => attempt.status === 'duplicate').length,
      retryable: attempts.filter((attempt) => attempt.status === 'retryable').length,
      permanentFailure: attempts.filter((attempt) => attempt.status === 'permanent_failure').length,
      requestFailure: attempts.filter((attempt) => attempt.status === 'request_failure').length
    }
  }
}];`;

const logAdjustmentCode = `const batch = $('Build Deal Adjustment Payload').first().json;
const parsed = $('Check Deal Adjustment Result').first().json;
const receipt = $input.first().json;
const attempts = Array.isArray(parsed.attempts) ? parsed.attempts : [];

return [{
  json: {
    receiptRecorded: Number(receipt.received || 0) === attempts.length,
    timestamp: new Date().toISOString(),
    adjustmentCount: Number(batch.adjustmentCount || 0),
    success: Number(parsed.counts?.success || 0),
    duplicate: Number(parsed.counts?.duplicate || 0),
    retryable: Number(parsed.counts?.retryable || 0),
    permanentFailure: Number(parsed.counts?.permanentFailure || 0),
    requestFailure: Number(parsed.counts?.requestFailure || 0),
    googleAdsJobId: parsed.jobId || null,
    receipt
  }
}];`;

const hasItemsParameters = (id) => ({
  conditions: {
    options: {
      version: 2,
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'strict',
    },
    conditions: [{
      id,
      leftValue: '={{ $json.length || $input.all().length }}',
      rightValue: 0,
      operator: { type: 'number', operation: 'gt' },
    }],
    combinator: 'and',
  },
});

const shouldUploadParameters = (id) => ({
  conditions: {
    options: {
      version: 2,
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'strict',
    },
    conditions: [{
      id,
      leftValue: '={{ $json.skip }}',
      rightValue: false,
      operator: { type: 'boolean', operation: 'equals' },
    }],
    combinator: 'and',
  },
});

export const expectedBase = Object.freeze({
  shopifySync: {
    id: 'I9vCp27sS3jcH1am',
    name: 'Shopify → Supabase Sync (stündlich)',
    active: true,
    activeVersionId: '9b45d61f-a386-4647-931b-9397ec2e7ccf',
    nodeCount: 8,
  },
  dealProducer: {
    id: 'vCDQuqaWOALmMd56',
    name: 'Google Ads Offline Conversions v2.0',
    active: true,
    activeVersionId: '0ca6cbb7-e6a0-4fdb-aae7-df09741f8e96',
    nodeCount: 6,
  },
  uploader: {
    id: '1EjFCTTp84otDKgG',
    name: 'Google Ads Offline Upload v1.1 (15 min)',
    active: true,
    activeVersionId: 'ecbca73b-ec91-42b7-9dd7-c2b5c18344b1',
    nodeCount: 22,
  },
});

export const workflowUpdates = Object.freeze({
  shopifySync: {
    id: expectedBase.shopifySync.id,
    intent: 'Resolve Shopify orders to NEONTRIP requests deterministically and never overwrite an unresolved request_id',
    operations: [
      {
        type: 'updateNode',
        nodeId: 'find-request',
        updates: {
          parameters: {
            method: 'POST',
            url: 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/resolve_shopify_order_request_link_v1',
            authentication: 'genericCredentialType',
            genericAuthType: 'httpHeaderAuth',
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'Content-Type', value: 'application/json' }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: shopifyResolverBody,
            options: {
              response: {
                response: { responseFormat: 'json', fullResponse: true },
              },
            },
          },
        },
      },
      {
        type: 'updateNode',
        nodeId: 'supabase-upsert-order',
        updates: { 'parameters.jsonBody': shopifyOrderUpsertBody },
      },
    ],
  },

  dealProducer: {
    id: expectedBase.dealProducer.id,
    intent: 'Retire the unverified Google Sheet branch and write one conflict-safe canonical Deal ledger row',
    operations: [
      {
        type: 'updateNode',
        nodeId: 'get-orders',
        updates: {
          'parameters.url': 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/gads_paid_deal_export_candidates_v2',
        },
      },
      {
        type: 'updateNode',
        nodeId: 'filter-prepare',
        updates: { 'parameters.jsCode': prepareDealLedgerRowsCode },
      },
      {
        type: 'updateNode',
        nodeId: 'mark-exported',
        updates: {
          parameters: {
            method: 'POST',
            url: 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/google_ads_conversions?on_conflict=shopify_order_number',
            authentication: 'predefinedCredentialType',
            nodeCredentialType: 'supabaseApi',
            sendHeaders: true,
            headerParameters: {
              parameters: [{
                name: 'Prefer',
                value: 'resolution=ignore-duplicates,return=minimal',
              }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json) }}',
            options: {},
          },
          credentials: supabaseApiCredential,
          onError: null,
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 2000,
        },
      },
      { type: 'disableNode', nodeId: 'hash-email' },
      { type: 'disableNode', nodeId: 'append-sheet' },
    ],
  },

  uploader: {
    id: expectedBase.uploader.id,
    intent: 'Lease and upload canonical Deal revenue with all consented match keys and add fail-closed Deal adjustments without changing request-lead or offer semantics',
    operations: [
      {
        type: 'updateNode',
        nodeId: 'sb-get-pending',
        updates: {
          'parameters.url': 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/claim_pending_gads_conversions_v2',
          'parameters.jsonBody': '={"p_limit":200,"p_lease_seconds":900}',
        },
      },
      {
        type: 'updateNode',
        nodeId: 'build-upload',
        updates: { 'parameters.jsCode': buildConversionUploadCode },
      },
      {
        type: 'updateNode',
        nodeId: 'sb-mark-uploaded',
        updates: {
          'parameters.url': 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/record_google_ads_conversion_claim_attempts_v2',
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'sb-claim-deal-adjustments',
          name: 'SB: Claim Deal Adjustments',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [750, 820],
          parameters: {
            method: 'POST',
            url: 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/claim_pending_gads_deal_adjustments_v1',
            authentication: 'genericCredentialType',
            genericAuthType: 'httpHeaderAuth',
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'Content-Type', value: 'application/json' }],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={"p_limit":100,"p_lease_seconds":900,"p_lookback_days":90}',
            options: {},
          },
          credentials: supabaseCredential,
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 5000,
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'has-deal-adjustments',
          name: 'Hat Deal-Anpassungen?',
          type: 'n8n-nodes-base.if',
          typeVersion: 2,
          position: [1000, 820],
          parameters: hasItemsParameters('check-adjustment-length'),
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'build-deal-adjustment-upload',
          name: 'Build Deal Adjustment Payload',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1250, 820],
          parameters: { jsCode: buildAdjustmentUploadCode },
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'should-upload-deal-adjustments',
          name: 'Adjustment Upload nötig?',
          type: 'n8n-nodes-base.if',
          typeVersion: 2,
          position: [1500, 820],
          parameters: shouldUploadParameters('adjustment-not-skip'),
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'gads-upload-deal-adjustments',
          name: 'GAds: Upload Deal Adjustments',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [1750, 820],
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 5000,
          onError: 'continueRegularOutput',
          parameters: {
            method: 'POST',
            url: "=https://googleads.googleapis.com/v24/customers/{{ $('Config').first().json.customerId }}:uploadConversionAdjustments",
            sendHeaders: true,
            headerParameters: {
              parameters: [
                {
                  name: 'Authorization',
                  value: "=Bearer {{ $('Refresh Google OAuth').first().json.access_token }}",
                },
                {
                  name: 'developer-token',
                  value: "={{ $('Config').first().json.developerToken }}",
                },
                {
                  name: 'login-customer-id',
                  value: "={{ $('Config').first().json.mccId }}",
                },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify($json.payload) }}',
            options: {},
          },
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'check-deal-adjustment-result',
          name: 'Check Deal Adjustment Result',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [1875, 820],
          parameters: { jsCode: checkAdjustmentUploadCode },
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'sb-record-deal-adjustments',
          name: 'SB: Record Deal Adjustments',
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [2000, 820],
          retryOnFail: true,
          maxTries: 3,
          waitBetweenTries: 5000,
          parameters: {
            method: 'POST',
            url: 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/record_google_ads_deal_adjustment_attempts_v1',
            authentication: 'genericCredentialType',
            genericAuthType: 'httpHeaderAuth',
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: 'Content-Type', value: 'application/json' },
                { name: 'Prefer', value: 'return=representation' },
              ],
            },
            sendBody: true,
            specifyBody: 'json',
            jsonBody: '={{ JSON.stringify({ p_attempts: $json.attempts }) }}',
            options: {},
          },
          credentials: supabaseCredential,
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'log-deal-adjustments',
          name: 'Log Deal Adjustments',
          type: 'n8n-nodes-base.code',
          typeVersion: 2,
          position: [2250, 820],
          parameters: { jsCode: logAdjustmentCode },
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'no-deal-adjustments',
          name: 'Keine Deal-Anpassungen',
          type: 'n8n-nodes-base.noOp',
          typeVersion: 1,
          position: [1250, 1000],
          parameters: {},
        },
      },
      {
        type: 'addNode',
        node: {
          id: 'skip-deal-adjustments',
          name: 'Skip Deal Adjustments',
          type: 'n8n-nodes-base.noOp',
          typeVersion: 1,
          position: [1750, 1000],
          parameters: {},
        },
      },
      { type: 'addConnection', source: 'Refresh Google OAuth', target: 'SB: Claim Deal Adjustments' },
      { type: 'addConnection', source: 'SB: Claim Deal Adjustments', target: 'Hat Deal-Anpassungen?' },
      { type: 'addConnection', source: 'Hat Deal-Anpassungen?', target: 'Build Deal Adjustment Payload', branch: 'true' },
      { type: 'addConnection', source: 'Hat Deal-Anpassungen?', target: 'Keine Deal-Anpassungen', branch: 'false' },
      { type: 'addConnection', source: 'Build Deal Adjustment Payload', target: 'Adjustment Upload nötig?' },
      { type: 'addConnection', source: 'Adjustment Upload nötig?', target: 'GAds: Upload Deal Adjustments', branch: 'true' },
      { type: 'addConnection', source: 'Adjustment Upload nötig?', target: 'Skip Deal Adjustments', branch: 'false' },
      { type: 'addConnection', source: 'GAds: Upload Deal Adjustments', target: 'Check Deal Adjustment Result' },
      { type: 'addConnection', source: 'Check Deal Adjustment Result', target: 'SB: Record Deal Adjustments' },
      { type: 'addConnection', source: 'SB: Record Deal Adjustments', target: 'Log Deal Adjustments' },
    ],
  },
});

// Publishing is a separate, deliberate write after the draft diff and workflow
// validation pass. Publish in this order so the consumer understands the new
// ledger before the producer can emit new rows.
export const publishOrder = Object.freeze([
  { key: 'uploader', id: expectedBase.uploader.id, operations: [{ type: 'activateWorkflow' }] },
  { key: 'shopifySync', id: expectedBase.shopifySync.id, operations: [{ type: 'activateWorkflow' }] },
  { key: 'dealProducer', id: expectedBase.dealProducer.id, operations: [{ type: 'activateWorkflow' }] },
]);

export const expectedFullDiffInvariants = Object.freeze({
  all: [
    'Workflow name, tags, settings, project/folder placement, activation state and all existing credential references remain unchanged.',
    'No trigger node, trigger schedule, unrelated node, unrelated connection, or unrelated parameter changes.',
    'No credential literal or customer data is introduced into workflow code.',
  ],
  shopifySync: [
    'Only Find Matching Request and the request_id portion of Supabase: Upsert Order change.',
    'The resolver receives Shopify note plus note_attributes, prioritizes exact IDs server-side, and never substitutes an email/latest-request guess.',
    'When the resolver is unresolved or conflicting, request_id is absent from the merge body, so an existing value is not overwritten by null.',
    'Customer upsert and every non-request_id order field are byte-for-byte or semantically unchanged.',
  ],
  dealProducer: [
    'The schedule and paid-candidate branch remain; candidate RPC changes only from v1 to v2.',
    'SHA-256 Hash Email and Append to Google Sheet are disabled, remain connected as n8n pass-through nodes, and cannot hash or write to Sheets.',
    'Exactly one effective conflict-safe ledger write remains, keyed by shopify_order_number with ignore-duplicates; no parallel branch is added.',
    'The ledger row uses canonical conversion_time/value/source fields and does not perform client-side hashing.',
  ],
  uploader: [
    'Request-lead nodes and connections are untouched.',
    'Offline: Angebot versendet retains GCLID-only matching and its existing action mapping.',
    'Deal uploads use the existing ledger UUID as orderId across GCLID, GBRAID, WBRAID and consented hashed-email matches; hashed email requires ad_user_data granted and carries stored ad_personalization when granted or denied.',
    'Every conversion provider result is mapped by payload index and recorded through the claim-token v2 recorder with the exact payload conversionValue and conversionTime before a lease is released.',
    'Adjustments target only provider-receipted Deal rows, reuse the ledger UUID orderId and the RPC-provided stable adjustment_date_time, and include restatementValue only for RESTATEMENT.',
    'Ambiguous, missing-result and request-level outcomes are request_failure; only explicit row success or same-state provider duplicate can advance canonical state.',
  ],
});

export const validationChecklist = Object.freeze([
  'Re-fetch full draft, active published graph, activeVersionId and active flag for all three workflows; stop if any expectedBase value drifted.',
  'Capture rollback snapshots of all three complete workflows without printing credential values.',
  'Confirm all six migration RPCs exist with the exact signatures referenced in this artifact.',
  'Run n8n_update_partial_workflow for each draft with validateOnly=true and atomic mode; do not use continueOnError.',
  'Apply each draft update, re-fetch the complete graph, and reject any diff outside expectedFullDiffInvariants.',
  'Run runtime workflow validation with node, expression and connection checks before publishing.',
  'Publish in publishOrder only after the complete draft diff passes; verify active=true and activeVersionId equals the reviewed draft version afterward.',
  'Before any live Google effect, use a non-sending provider validation surface where available; never create a synthetic customer conversion.',
  'On the first natural Deal, reconcile exactly one ledger row, one matching Google job receipt, the same ledger UUID orderId, and no duplicate follow-up action.',
  'On the first natural refund/cancellation, reconcile one stable state key, one provider receipt, the expected RESTATEMENT/RETRACTION and canonical adjusted state.',
  'Verify the request-lead and offer branches continue to produce their prior receipts unchanged.',
]);

export function assertArtifact() {
  const serialized = JSON.stringify({ expectedBase, workflowUpdates, publishOrder });
  assert.equal(/GOCSPX-|1\/\/|client_secret|refresh_token/.test(serialized), false, 'secret-like literal found');
  assert.equal(serialized.includes('developerToken'), true, 'existing Config expression must remain indirect');
  assert.equal(serialized.includes('claim_pending_gads_conversions_v2'), true);
  assert.equal(serialized.includes('record_google_ads_conversion_claim_attempts_v2'), true);
  assert.equal(serialized.includes('claim_pending_gads_deal_adjustments_v1'), true);
  assert.equal(serialized.includes('record_google_ads_deal_adjustment_attempts_v1'), true);
  assert.equal(serialized.includes('resolve_shopify_order_request_link_v1'), true);
  assert.equal(serialized.includes('gads_paid_deal_export_candidates_v2'), true);
  assert.equal(serialized.includes('uploadConversionAdjustments'), true);

  const addedNodeIds = workflowUpdates.uploader.operations
    .filter((operation) => operation.type === 'addNode')
    .map((operation) => operation.node.id);
  assert.equal(new Set(addedNodeIds).size, addedNodeIds.length, 'duplicate added node ID');
  assert.equal(addedNodeIds.length, 10, 'unexpected adjustment branch node count');

  const connectionKeys = workflowUpdates.uploader.operations
    .filter((operation) => operation.type === 'addConnection')
    .map((operation) => JSON.stringify([
      operation.source,
      operation.target,
      operation.sourceOutput || 'main',
      operation.branch || null,
      operation.case ?? null,
      operation.sourceIndex ?? null,
      operation.targetIndex ?? null,
    ]));
  assert.equal(
    new Set(connectionKeys).size,
    connectionKeys.length,
    'duplicate uploader connection operation',
  );
  assert.equal(connectionKeys.length, 10, 'unexpected adjustment branch connection count');

  for (const [key, update] of Object.entries(workflowUpdates)) {
    assert.equal(update.id, expectedBase[key].id);
    assert.ok(update.operations.length > 0);
  }

  return {
    workflows: Object.keys(workflowUpdates).length,
    operationCounts: Object.fromEntries(
      Object.entries(workflowUpdates).map(([key, value]) => [key, value.operations.length]),
    ),
    publishOrder: publishOrder.map((entry) => entry.key),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(assertArtifact(), null, 2) + '\n');
}
