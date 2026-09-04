import assert from 'node:assert/strict';

import { assertArtifact, workflowUpdates } from './n8n-partial-updates.mjs';

const findOperation = (workflow, predicate) => {
  const operation = workflow.operations.find(predicate);
  assert.ok(operation, 'expected operation was not found');
  return operation;
};

const codeForUpdatedNode = (workflow, nodeId) => findOperation(
  workflow,
  (operation) => operation.type === 'updateNode' && operation.nodeId === nodeId,
).updates['parameters.jsCode'];

const codeForAddedNode = (workflow, nodeId) => findOperation(
  workflow,
  (operation) => operation.type === 'addNode' && operation.node.id === nodeId,
).node.parameters.jsCode;

const expressionForUpdatedNode = (workflow, nodeId, field) => findOperation(
  workflow,
  (operation) => operation.type === 'updateNode' && operation.nodeId === nodeId,
).updates[field];

async function executeCode(code, { input, lookup = () => null, workflowId = 'workflow', executionId = 'execution' }) {
  const runner = new Function(
    '$input',
    '$',
    '$workflow',
    '$execution',
    `'use strict'; return (async () => { ${code}\n })();`,
  );
  return runner(
    { all: () => input, first: () => input[0] },
    lookup,
    { id: workflowId },
    { id: executionId },
  );
}

function executeExpression(expression, { json, lookup }) {
  assert.ok(expression.startsWith('={{') && expression.endsWith('}}'));
  const body = expression.slice(3, -2).trim();
  const runner = new Function('$json', '$', `'use strict'; return (${body});`);
  return runner(json, lookup);
}

assertArtifact();

const uploaderConnectionKeys = workflowUpdates.uploader.operations
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
assert.equal(new Set(uploaderConnectionKeys).size, uploaderConnectionKeys.length);
assert.equal(
  uploaderConnectionKeys.filter((key) => key.includes('Check Deal Adjustment Result') && key.includes('SB: Record Deal Adjustments')).length,
  1,
);

const requestUuid = '10000000-0000-4000-8000-000000000001';
const customerUuid = '20000000-0000-4000-8000-000000000002';
const order = {
  id: 12345,
  name: '#1234',
  created_at: '2026-09-01T10:00:00.000Z',
  note: 'B2B order',
  note_attributes: [{ name: 'Nerdy-Forms_ID', value: requestUuid }],
  total_price: '1190.00',
  subtotal_price: '1000.00',
  total_tax: '190.00',
  total_discounts: '0.00',
  currency: 'EUR',
  financial_status: 'paid',
  fulfillment_status: null,
  fulfillments: [],
  discount_codes: [],
  tags: 'b2b',
  line_items: [],
  shipping_address: null,
  billing_address: null,
  cancelled_at: null,
};
const shopifyLookup = (name) => ({
  item: {
    json: name === 'Split Orders' ? order : { id: customerUuid },
  },
});

const resolverBody = executeExpression(
  findOperation(
    workflowUpdates.shopifySync,
    (operation) => operation.type === 'updateNode' && operation.nodeId === 'find-request',
  ).updates.parameters.jsonBody,
  { json: {}, lookup: shopifyLookup },
);
assert.equal(JSON.parse(resolverBody).p_note.includes(requestUuid), true);
assert.equal(JSON.parse(resolverBody).p_customer_id, customerUuid);

const upsertExpression = expressionForUpdatedNode(
  workflowUpdates.shopifySync,
  'supabase-upsert-order',
  'parameters.jsonBody',
);
const resolvedUpsert = JSON.parse(executeExpression(upsertExpression, {
  json: { body: [{ resolved_request_id: requestUuid }] },
  lookup: shopifyLookup,
}));
assert.equal(resolvedUpsert.request_id, requestUuid);
const unresolvedUpsert = JSON.parse(executeExpression(upsertExpression, {
  json: { body: [{ resolved_request_id: null, resolution_status: 'unresolved' }] },
  lookup: shopifyLookup,
}));
assert.equal(Object.hasOwn(unresolvedUpsert, 'request_id'), false);
assert.equal(unresolvedUpsert.shopify_order_id, '12345');
assert.equal(unresolvedUpsert.order_value, 1190);

const ledgerCode = codeForUpdatedNode(workflowUpdates.dealProducer, 'filter-prepare');
const ledgerRows = await executeCode(ledgerCode, {
  input: [{
    json: {
      shopify_order_number: '#1234',
      email: 'buyer@example.test',
      request_id: requestUuid,
      conversion_value: '1000.00',
      conversion_time: '2026-09-01T10:10:00.000Z',
      value_source: 'billing_cases.subtotal_net_cents',
      time_source: 'billing_cases.paid_at',
      request_resolution_source: 'shopify_note_request_id',
      gclid: 'a'.repeat(30),
    },
  }],
});
assert.equal(ledgerRows.length, 1);
assert.equal(ledgerRows[0].json.conversion_value, 1000);
assert.equal(ledgerRows[0].json.conversion_name, 'Offline: Deal gewonnen');
assert.equal(Object.hasOwn(ledgerRows[0].json, 'hashed_email'), false);

const config = {
  conversionActions: {
    'Angebot versendet': 'customers/123/conversionActions/offer',
    'Deal gewonnen': 'customers/123/conversionActions/deal',
  },
};
const conversionBuildCode = codeForUpdatedNode(workflowUpdates.uploader, 'build-upload');
const conversionBatch = await executeCode(conversionBuildCode, {
  workflowId: workflowUpdates.uploader.id,
  executionId: 'natural-deal-1',
  lookup: (name) => ({ first: () => ({ json: name === 'Config' ? config : {} }) }),
  input: [
    {
      json: {
        conversion_id: '30000000-0000-4000-8000-000000000003',
        claim_token: '40000000-0000-4000-8000-000000000004',
        conversion_name: 'Offline: Deal gewonnen',
        conversion_value: 1000,
        conversion_time: '2026-09-01T10:10:00.000Z',
        hashed_email: 'b'.repeat(64),
        consent_ad_user_data: 'granted',
        consent_ad_personalization: 'denied',
      },
    },
    {
      json: {
        conversion_id: '50000000-0000-4000-8000-000000000005',
        claim_token: '60000000-0000-4000-8000-000000000006',
        conversion_name: 'Offline: Angebot versendet',
        conversion_value: 280,
        conversion_time: '2026-09-01T09:00:00.000Z',
        gclid: 'g'.repeat(30),
      },
    },
  ],
});
assert.equal(conversionBatch[0].json.payload.conversions.length, 2);
assert.deepEqual(conversionBatch[0].json.payload.conversions[0].userIdentifiers, [{
  hashedEmail: 'b'.repeat(64),
  userIdentifierSource: 'FIRST_PARTY',
}]);
assert.deepEqual(conversionBatch[0].json.payload.conversions[0].consent, {
  adUserData: 'GRANTED',
  adPersonalization: 'DENIED',
});
assert.equal(
  conversionBatch[0].json.rows[0].conversionValue,
  conversionBatch[0].json.payload.conversions[0].conversionValue,
);
assert.equal(conversionBatch[0].json.payload.conversions[1].gclid, 'g'.repeat(30));
assert.equal(conversionBatch[0].json.rows[0].claimToken, '40000000-0000-4000-8000-000000000004');

const localOnlyConversionBatch = await executeCode(conversionBuildCode, {
  workflowId: workflowUpdates.uploader.id,
  executionId: 'invalid-match-1',
  lookup: (name) => ({ first: () => ({ json: name === 'Config' ? config : {} }) }),
  input: [{
    json: {
      conversion_id: '80000000-0000-4000-8000-000000000008',
      claim_token: '90000000-0000-4000-8000-000000000009',
      conversion_name: 'Offline: Deal gewonnen',
      conversion_value: 725.5,
      conversion_time: '2026-09-01T10:10:00.000Z',
    },
  }],
});
assert.equal(localOnlyConversionBatch[0].json.localOnly, true);
assert.equal(localOnlyConversionBatch[0].json.localAttempts[0].conversionValue, 725.5);

const adjustmentBuildCode = codeForAddedNode(
  workflowUpdates.uploader,
  'build-deal-adjustment-upload',
);
const adjustmentBatch = await executeCode(adjustmentBuildCode, {
  workflowId: workflowUpdates.uploader.id,
  executionId: 'natural-adjustment-1',
  lookup: (name) => ({ first: () => ({ json: name === 'Config' ? config : {} }) }),
  input: [
    {
      json: {
        conversion_id: '30000000-0000-4000-8000-000000000003',
        claim_token: '70000000-0000-4000-8000-000000000007',
        adjustment_state_key: 'c'.repeat(64),
        adjustment_type: 'RESTATEMENT',
        adjusted_value: 850,
        currency_code: 'EUR',
        adjustment_date_time: '2026-09-03T10:00:00.000Z',
        conversion_name: 'Offline: Deal gewonnen',
        conversion_time: '2026-09-01T10:10:00.000Z',
        order_id: '30000000-0000-4000-8000-000000000003',
      },
    },
  ],
});
assert.equal(adjustmentBatch[0].json.payload.partialFailure, true);
assert.deepEqual(adjustmentBatch[0].json.payload.conversionAdjustments[0].restatementValue, {
  adjustedValue: 850,
  currencyCode: 'EUR',
});
assert.equal(
  adjustmentBatch[0].json.rows[0].adjustmentDateTime,
  '2026-09-03T10:00:00.000Z',
);

const adjustmentCheckCode = codeForAddedNode(
  workflowUpdates.uploader,
  'check-deal-adjustment-result',
);
const adjustmentRows = adjustmentBatch[0].json.rows;
const successfulAdjustment = await executeCode(adjustmentCheckCode, {
  input: [{ json: { jobId: '101', results: [{ orderId: adjustmentRows[0].orderId }] } }],
  lookup: (name) => ({
    first: () => ({ json: name === 'Build Deal Adjustment Payload' ? adjustmentBatch[0].json : {} }),
  }),
});
assert.equal(successfulAdjustment[0].json.attempts[0].status, 'success');
assert.equal(successfulAdjustment[0].json.attempts[0].jobId, '101');

const duplicateAdjustment = await executeCode(adjustmentCheckCode, {
  input: [{
    json: {
      jobId: '102',
      partialFailureError: {
        details: [{
          errors: [{
            errorCode: { conversionAdjustmentUploadError: 'RESTATEMENT_ALREADY_EXISTS' },
            message: 'The same restatement time already exists.',
            location: {
              fieldPathElements: [{ fieldName: 'conversion_adjustments', index: 0 }],
            },
          }],
        }],
      },
    },
  }],
  lookup: (name) => ({
    first: () => ({ json: name === 'Build Deal Adjustment Payload' ? adjustmentBatch[0].json : {} }),
  }),
});
assert.equal(duplicateAdjustment[0].json.attempts[0].status, 'duplicate');
assert.equal(duplicateAdjustment[0].json.attempts[0].adjustmentStateKey, 'c'.repeat(64));

process.stdout.write('n8n partial-update artifact tests passed\n');
