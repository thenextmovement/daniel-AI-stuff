import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_NAMES = {
  main: 'NEONTRIP Shopify ↔ Easybill Daily Reconciliation v1.0',
  error: 'NEONTRIP Shopify ↔ Easybill Reconciliation Error Alert v1.0',
  qa: 'QA ONLY — NEONTRIP Shopify ↔ Easybill Reconciliation — TICKET-088',
};

export const CREDENTIALS = {
  shopify: {
    id: 'WZah58udMOwKiRR3',
    name: 'Shopify Access Token account',
  },
  easybill: {
    id: 'YF5qkE2gWbB3A6U2',
    name: 'Header Auth account | Easybill',
  },
  outlook: {
    id: 'CTEmJD5CjYu9hawu',
    name: 'Microsoft Outlook support@neontrip.de',
  },
};

export const ALERT_RECIPIENT = 'info@NeonTrip.de';
export const ALERT_SUBJECT = 'Easy Bill & Shopify Abweichung';

export function normalizeDocumentNumber(value) {
  return String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function amountToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function normalizePartyValue(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function compareParties(shopifyParty, easybillParty) {
  const shopifyEmails = (shopifyParty?.emails ?? [])
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  const easybillEmails = (easybillParty?.emails ?? [])
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  const sharedEmail = shopifyEmails.find((email) => easybillEmails.includes(email));
  if (sharedEmail) return { matches: true, method: 'email', value: sharedEmail };

  const shopifyNames = (shopifyParty?.names ?? []).map(normalizePartyValue).filter(Boolean);
  const easybillNames = (easybillParty?.names ?? []).map(normalizePartyValue).filter(Boolean);
  const sharedName = shopifyNames.find((name) => easybillNames.includes(name));
  if (sharedName) return { matches: true, method: 'name', value: sharedName };

  return {
    matches: false,
    method: shopifyEmails.length && easybillEmails.length ? 'email' : 'name',
    value: null,
  };
}

const selectLatestOrderCode = `const payload = $input.first().json || {};
const orders = Array.isArray(payload.orders) ? payload.orders : [];
const now = $now.setZone('Europe/Berlin');
const cutoff = now.startOf('day').set({ hour: 11, minute: 15, second: 0, millisecond: 0 });
const eligible = orders
  .filter((order) => !order.cancelled_at)
  .filter((order) => {
    const created = DateTime.fromISO(String(order.created_at || ''), { setZone: true });
    return created.isValid && created <= cutoff;
  })
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
if (!eligible.length) {
  throw new Error('Keine nicht stornierte Shopify-Bestellung vor dem 11:15-Cutoff gefunden.');
}
const order = eligible[0];
const normalizeNumber = (value) => String(value ?? '').trim().replace(/^#+/, '').replace(/\\s+/g, '').toUpperCase();
const billing = order.billing_address || {};
const customer = order.customer || {};
const names = [
  billing.company,
  [billing.first_name, billing.last_name].filter(Boolean).join(' '),
  [customer.first_name, customer.last_name].filter(Boolean).join(' '),
].filter(Boolean);
const emails = [order.email, customer.email].filter(Boolean);
const amount = Number(order.total_price);
if (!Number.isFinite(amount)) throw new Error('Shopify-Bruttobetrag ist ungueltig.');
return [{ json: {
  correlationId: 'easybill-shopify:' + cutoff.toISODate() + ':' + String(order.id),
  reconciliationDate: cutoff.toISODate(),
  cutoff: cutoff.toISO(),
  shopifyOrderId: String(order.id),
  shopifyOrderNumber: String(order.name || ''),
  expectedInvoiceNumber: normalizeNumber(order.name),
  shopifyAmountCents: Math.round(amount * 100),
  shopifyAmount: amount.toFixed(2),
  currency: String(order.currency || 'EUR').toUpperCase(),
  shopifyCreatedAt: order.created_at,
  shopifyCustomer: { names, emails },
} }];`;

const prepareInvoiceCode = `const base = $('Select Latest Eligible Order').first().json;
const payload = $input.first().json || {};
const documents = Array.isArray(payload.items) ? payload.items : [];
const normalizeNumber = (value) => String(value ?? '').trim().replace(/^#+/, '').replace(/\\s+/g, '').toUpperCase();
const exact = documents.find((document) => document.type === 'INVOICE' && normalizeNumber(document.number) === base.expectedInvoiceNumber) || null;
return [{ json: { ...base, invoiceFound: Boolean(exact), easybillDocument: exact } }];`;

const missingInvoiceCode = `const item = $input.first().json;
return [{ json: {
  ...item,
  status: 'mismatch',
  mismatch: true,
  reasons: ['Easybill-Rechnung fehlt'],
  checks: {
    invoiceNumber: false,
    amount: false,
    customer: false,
  },
  easybillInvoiceNumber: null,
  easybillAmountCents: null,
  easybillCustomer: null,
} }];`;

const compareCode = `const lookup = $('Prepare Invoice Lookup').first().json;
const document = lookup.easybillDocument || {};
const customer = $input.first().json || {};
const normalizeNumber = (value) => String(value ?? '').trim().replace(/^#+/, '').replace(/\\s+/g, '').toUpperCase();
const normalizeParty = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\\p{L}\\p{N}]+/gu, ' ')
  .trim()
  .replace(/\\s+/g, ' ');
const shopifyEmails = (lookup.shopifyCustomer?.emails || []).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
const easybillEmails = (Array.isArray(customer.emails) ? customer.emails : (customer.emails ? [customer.emails] : []))
  .map((entry) => typeof entry === 'string' ? entry : (entry?.email || entry?.value || ''))
  .map((v) => String(v || '').trim().toLowerCase())
  .filter(Boolean);
const sharedEmail = shopifyEmails.find((email) => easybillEmails.includes(email));
const shopifyNames = (lookup.shopifyCustomer?.names || []).map(normalizeParty).filter(Boolean);
const easybillNames = [
  customer.company_name,
  customer.name,
  [customer.first_name, customer.last_name].filter(Boolean).join(' '),
].map(normalizeParty).filter(Boolean);
const sharedName = shopifyNames.find((name) => easybillNames.includes(name));
const customerMatches = Boolean(sharedEmail || sharedName);
const easybillAmountCents = Number(document.amount);
const numberMatches = normalizeNumber(document.number) === lookup.expectedInvoiceNumber;
const amountMatches = Number.isFinite(easybillAmountCents) && easybillAmountCents === lookup.shopifyAmountCents;
const reasons = [];
if (!numberMatches) reasons.push('Rechnungsnummer stimmt nicht');
if (!amountMatches) reasons.push('Bruttobetrag stimmt nicht');
if (!customerMatches) reasons.push('Kunde stimmt nicht oder ist nicht eindeutig pruefbar');
return [{ json: {
  ...lookup,
  status: reasons.length ? 'mismatch' : 'ok',
  mismatch: reasons.length > 0,
  reasons,
  checks: { invoiceNumber: numberMatches, amount: amountMatches, customer: customerMatches },
  customerMatchMethod: sharedEmail ? 'email' : (sharedName ? 'name' : null),
  easybillInvoiceNumber: document.number || null,
  easybillDocumentId: document.id ? String(document.id) : null,
  easybillAmountCents: Number.isFinite(easybillAmountCents) ? easybillAmountCents : null,
  easybillAmount: Number.isFinite(easybillAmountCents) ? (easybillAmountCents / 100).toFixed(2) : null,
  easybillCustomerId: customer.id ? String(customer.id) : null,
  easybillCustomer: customer.company_name || customer.name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null,
} }];`;

const prepareAlertCode = `const item = $input.first().json;
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const euros = (cents) => cents == null ? 'nicht vorhanden' : (Number(cents) / 100).toFixed(2).replace('.', ',') + ' EUR';
const reasonList = (item.reasons || []).map((reason) => '<li>' + escapeHtml(reason) + '</li>').join('');
const alertFingerprint = [item.reconciliationDate, item.shopifyOrderId, ...(item.reasons || []).slice().sort()].join(':');
return [{ json: {
  ...item,
  subject: '${ALERT_SUBJECT}',
  alertFingerprint,
  body_html: '<h2>Easybill &amp; Shopify Abweichung</h2>' +
    '<p>Der taegliche Abgleich hat eine Abweichung festgestellt.</p>' +
    '<ul>' + reasonList + '</ul>' +
    '<table border="1" cellpadding="6" cellspacing="0">' +
    '<tr><th>Pruefung</th><th>Shopify</th><th>Easybill</th></tr>' +
    '<tr><td>Nummer</td><td>' + escapeHtml(item.shopifyOrderNumber) + '</td><td>' + escapeHtml(item.easybillInvoiceNumber || 'nicht vorhanden') + '</td></tr>' +
    '<tr><td>Bruttobetrag</td><td>' + escapeHtml(euros(item.shopifyAmountCents)) + '</td><td>' + escapeHtml(euros(item.easybillAmountCents)) + '</td></tr>' +
    '<tr><td>Kunde</td><td>' + escapeHtml((item.shopifyCustomer?.names || []).join(' / ') || 'nicht vorhanden') + '</td><td>' + escapeHtml(item.easybillCustomer || 'nicht vorhanden') + '</td></tr>' +
    '</table>' +
    '<p>Correlation-ID: <code>' + escapeHtml(item.correlationId) + '</code></p>' +
    '<p>Es wurden keine Shopify- oder Easybill-Daten veraendert.</p>',
} }];`;

const idempotencyCode = `const item = $input.first().json;
const state = $getWorkflowStaticData('global');
state.sentAlerts = state.sentAlerts || {};
const sentAt = state.sentAlerts[item.alertFingerprint] || null;
return [{ json: { ...item, shouldSend: !sentAt, alreadySentAt: sentAt } }];`;

const markSentCode = `const alert = $('Notification Idempotency').first().json;
const state = $getWorkflowStaticData('global');
state.sentAlerts = state.sentAlerts || {};
state.sentAlerts[alert.alertFingerprint] = $now.toISO();
const keys = Object.keys(state.sentAlerts);
if (keys.length > 90) {
  keys.sort((a, b) => String(state.sentAlerts[a]).localeCompare(String(state.sentAlerts[b])));
  for (const key of keys.slice(0, keys.length - 90)) delete state.sentAlerts[key];
}
return [{ json: { status: 'alert_sent', correlationId: alert.correlationId, alertFingerprint: alert.alertFingerprint } }];`;

const recordOkCode = `const item = $input.first().json;
return [{ json: {
  status: 'ok',
  correlationId: item.correlationId,
  reconciliationDate: item.reconciliationDate,
  shopifyOrderId: item.shopifyOrderId,
  shopifyOrderNumber: item.shopifyOrderNumber,
  easybillDocumentId: item.easybillDocumentId,
  easybillInvoiceNumber: item.easybillInvoiceNumber,
  checks: item.checks,
} }];`;

const technicalAlertCode = `const input = $input.first().json || {};
const execution = input.execution || {};
const workflow = input.workflow || {};
const error = execution.error || input.error || {};
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const day = $now.setZone('Europe/Berlin').toISODate();
const fingerprint = [day, workflow.id || workflow.name, execution.lastNodeExecuted, error.message].join(':');
return [{ json: {
  subject: '${ALERT_SUBJECT}',
  alertFingerprint: fingerprint,
  workflowId: workflow.id || null,
  workflowName: workflow.name || null,
  executionId: execution.id || null,
  failedNode: execution.lastNodeExecuted || null,
  errorMessage: error.message || 'Unbekannter technischer Fehler',
  body_html: '<h2>Easybill &amp; Shopify Abweichung</h2>' +
    '<p>Der taegliche Abgleich konnte technisch nicht abgeschlossen werden.</p>' +
    '<ul><li>Workflow: ' + escapeHtml(workflow.name || workflow.id || 'unbekannt') + '</li>' +
    '<li>Execution: ' + escapeHtml(execution.id || 'unbekannt') + '</li>' +
    '<li>Knoten: ' + escapeHtml(execution.lastNodeExecuted || 'unbekannt') + '</li>' +
    '<li>Fehler: ' + escapeHtml(error.message || 'unbekannt') + '</li></ul>' +
    '<p>Es wurden keine Shopify- oder Easybill-Daten veraendert.</p>',
} }];`;

const technicalIdempotencyCode = `const item = $input.first().json;
const state = $getWorkflowStaticData('global');
state.sentAlerts = state.sentAlerts || {};
const sentAt = state.sentAlerts[item.alertFingerprint] || null;
return [{ json: { ...item, shouldSend: !sentAt, alreadySentAt: sentAt } }];`;

const technicalMarkSentCode = `const alert = $('Technical Alert Idempotency').first().json;
const state = $getWorkflowStaticData('global');
state.sentAlerts = state.sentAlerts || {};
state.sentAlerts[alert.alertFingerprint] = $now.toISO();
return [{ json: { status: 'technical_alert_sent', alertFingerprint: alert.alertFingerprint } }];`;

function httpNode(id, name, position, parameters, credentials) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.3,
    position,
    parameters,
    credentials,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
  };
}

function codeNode(id, name, position, jsCode) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { mode: 'runOnceForAllItems', jsCode },
  };
}

function booleanIfNode(id, name, position, expression) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position,
    parameters: {
      conditions: {
        options: { version: 2, caseSensitive: true, typeValidation: 'strict', leftValue: '' },
        combinator: 'and',
        conditions: [{
          id: id + '-condition',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
          leftValue: expression,
          rightValue: '',
        }],
      },
      options: {},
    },
  };
}

function outlookNode(id, name, position) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.microsoftOutlook',
    typeVersion: 2,
    position,
    parameters: {
      resource: 'message',
      operation: 'send',
      toRecipients: ALERT_RECIPIENT,
      subject: "={{ $json.subject }}",
      bodyContent: "={{ $json.body_html }}",
      additionalFields: { bodyContentType: 'html' },
    },
    credentials: { microsoftOutlookOAuth2Api: CREDENTIALS.outlook },
  };
}

function coreNodes(triggerNode) {
  return [
    triggerNode,
    httpNode('read-shopify', 'Read Shopify Orders', [260, 300], {
      url: '=https://galaxybuzzdk.myshopify.com/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min={{ encodeURIComponent($now.setZone(\'Europe/Berlin\').minus({ days: 14 }).startOf(\'day\').toISO()) }}',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'shopifyAccessTokenApi',
      options: {},
    }, { shopifyAccessTokenApi: CREDENTIALS.shopify }),
    codeNode('select-order', 'Select Latest Eligible Order', [500, 300], selectLatestOrderCode),
    httpNode('read-easybill-document', 'Read Easybill Invoice', [740, 300], {
      url: '=https://api.easybill.de/rest/v1/documents?limit=100&page=1&number={{ encodeURIComponent($json.expectedInvoiceNumber) }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      options: {},
    }, { httpHeaderAuth: CREDENTIALS.easybill }),
    codeNode('prepare-invoice', 'Prepare Invoice Lookup', [980, 300], prepareInvoiceCode),
    booleanIfNode('invoice-found', 'Invoice Found?', [1220, 300], '={{ $json.invoiceFound }}'),
    httpNode('read-easybill-customer', 'Read Easybill Customer', [1460, 220], {
      url: '=https://api.easybill.de/rest/v1/customers/{{ $json.easybillDocument.customer_id }}',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      options: {},
    }, { httpHeaderAuth: CREDENTIALS.easybill }),
    codeNode('build-comparison', 'Build Comparison', [1700, 220], compareCode),
    codeNode('build-missing', 'Build Missing Invoice Result', [1460, 420], missingInvoiceCode),
  ];
}

function coreConnections(triggerName) {
  return {
    [triggerName]: { main: [[{ node: 'Read Shopify Orders', type: 'main', index: 0 }]] },
    'Read Shopify Orders': { main: [[{ node: 'Select Latest Eligible Order', type: 'main', index: 0 }]] },
    'Select Latest Eligible Order': { main: [[{ node: 'Read Easybill Invoice', type: 'main', index: 0 }]] },
    'Read Easybill Invoice': { main: [[{ node: 'Prepare Invoice Lookup', type: 'main', index: 0 }]] },
    'Prepare Invoice Lookup': { main: [[{ node: 'Invoice Found?', type: 'main', index: 0 }]] },
    'Invoice Found?': {
      main: [
        [{ node: 'Read Easybill Customer', type: 'main', index: 0 }],
        [{ node: 'Build Missing Invoice Result', type: 'main', index: 0 }],
      ],
    },
    'Read Easybill Customer': { main: [[{ node: 'Build Comparison', type: 'main', index: 0 }]] },
  };
}

export function buildMainWorkflow(errorWorkflowId = '__ERROR_WORKFLOW_ID__') {
  const trigger = {
    id: 'daily-trigger',
    name: 'Daily 18:00 Europe/Berlin',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.3,
    position: [20, 300],
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 18 * * *' }] } },
  };
  const nodes = [
    ...coreNodes(trigger),
    booleanIfNode('mismatch', 'Mismatch?', [1940, 300], '={{ $json.mismatch }}'),
    codeNode('prepare-alert', 'Prepare Alert', [2180, 220], prepareAlertCode),
    codeNode('notification-idempotency', 'Notification Idempotency', [2420, 220], idempotencyCode),
    booleanIfNode('should-send', 'Should Send Alert?', [2660, 220], '={{ $json.shouldSend }}'),
    outlookNode('send-alert', 'Send Internal Alert', [2900, 140]),
    codeNode('mark-alert-sent', 'Mark Alert Sent', [3140, 140], markSentCode),
    codeNode('duplicate-suppressed', 'Duplicate Alert Suppressed', [2900, 300], "return [{ json: { status: 'duplicate_alert_suppressed', correlationId: $json.correlationId, alertFingerprint: $json.alertFingerprint, alreadySentAt: $json.alreadySentAt } }];"),
    codeNode('record-ok', 'Record OK', [2180, 420], recordOkCode),
  ];
  const connections = {
    ...coreConnections(trigger.name),
    'Build Comparison': { main: [[{ node: 'Mismatch?', type: 'main', index: 0 }]] },
    'Build Missing Invoice Result': { main: [[{ node: 'Mismatch?', type: 'main', index: 0 }]] },
    'Mismatch?': {
      main: [
        [{ node: 'Prepare Alert', type: 'main', index: 0 }],
        [{ node: 'Record OK', type: 'main', index: 0 }],
      ],
    },
    'Prepare Alert': { main: [[{ node: 'Notification Idempotency', type: 'main', index: 0 }]] },
    'Notification Idempotency': { main: [[{ node: 'Should Send Alert?', type: 'main', index: 0 }]] },
    'Should Send Alert?': {
      main: [
        [{ node: 'Send Internal Alert', type: 'main', index: 0 }],
        [{ node: 'Duplicate Alert Suppressed', type: 'main', index: 0 }],
      ],
    },
    'Send Internal Alert': { main: [[{ node: 'Mark Alert Sent', type: 'main', index: 0 }]] },
  };
  return {
    name: WORKFLOW_NAMES.main,
    nodes,
    connections,
    settings: {
      executionOrder: 'v1',
      timezone: 'Europe/Berlin',
      errorWorkflow: errorWorkflowId,
      executionTimeout: 300,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveExecutionProgress: true,
      saveManualExecutions: true,
    },
  };
}

export function buildQaWorkflow() {
  const trigger = {
    id: 'qa-webhook',
    name: 'QA Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1,
    position: [20, 300],
    parameters: {
      httpMethod: 'POST',
      path: 'ticket-088-shopify-easybill-reconciliation-qa',
      responseMode: 'lastNode',
      responseData: 'firstEntryJson',
      options: {},
    },
  };
  return {
    name: WORKFLOW_NAMES.qa,
    nodes: [...coreNodes(trigger)],
    connections: coreConnections(trigger.name),
    settings: {
      executionOrder: 'v1',
      timezone: 'Europe/Berlin',
      executionTimeout: 300,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveManualExecutions: true,
    },
  };
}

export function buildErrorWorkflow() {
  const nodes = [
    {
      id: 'error-trigger',
      name: 'Reconciliation Error Trigger',
      type: 'n8n-nodes-base.errorTrigger',
      typeVersion: 1,
      position: [20, 260],
      parameters: {},
    },
    codeNode('prepare-technical-alert', 'Prepare Technical Alert', [260, 260], technicalAlertCode),
    codeNode('technical-idempotency', 'Technical Alert Idempotency', [500, 260], technicalIdempotencyCode),
    booleanIfNode('technical-should-send', 'Should Send Technical Alert?', [740, 260], '={{ $json.shouldSend }}'),
    outlookNode('send-technical-alert', 'Send Technical Alert', [980, 180]),
    codeNode('mark-technical-sent', 'Mark Technical Alert Sent', [1220, 180], technicalMarkSentCode),
    codeNode('technical-suppressed', 'Duplicate Technical Alert Suppressed', [980, 340], "return [{ json: { status: 'duplicate_technical_alert_suppressed', alertFingerprint: $json.alertFingerprint, alreadySentAt: $json.alreadySentAt } }];"),
  ];
  return {
    name: WORKFLOW_NAMES.error,
    nodes,
    connections: {
      'Reconciliation Error Trigger': { main: [[{ node: 'Prepare Technical Alert', type: 'main', index: 0 }]] },
      'Prepare Technical Alert': { main: [[{ node: 'Technical Alert Idempotency', type: 'main', index: 0 }]] },
      'Technical Alert Idempotency': { main: [[{ node: 'Should Send Technical Alert?', type: 'main', index: 0 }]] },
      'Should Send Technical Alert?': {
        main: [
          [{ node: 'Send Technical Alert', type: 'main', index: 0 }],
          [{ node: 'Duplicate Technical Alert Suppressed', type: 'main', index: 0 }],
        ],
      },
      'Send Technical Alert': { main: [[{ node: 'Mark Technical Alert Sent', type: 'main', index: 0 }]] },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'Europe/Berlin',
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveExecutionProgress: true,
    },
  };
}

export function writeGeneratedWorkflows(outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const files = {
    'reconciliation-main.json': buildMainWorkflow(),
    'reconciliation-error-handler.json': buildErrorWorkflow(),
    'reconciliation-qa.json': buildQaWorkflow(),
  };
  for (const [file, workflow] of Object.entries(files)) {
    fs.writeFileSync(path.join(outputDirectory, file), JSON.stringify(workflow, null, 2) + '\n');
  }
  return Object.keys(files);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const outputDirectory = path.join(path.dirname(currentFile), 'generated');
  const files = writeGeneratedWorkflows(outputDirectory);
  console.log(`Generated ${files.length} workflows in ${outputDirectory}`);
}
