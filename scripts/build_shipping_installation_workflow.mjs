import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BASE_VERSION = '35d9a83b-6c4c-4f26-b8db-d750fcccd743';
export function nextShopifyPage(link = '') {
  const next = String(link).match(/<([^>]+)>;\s*rel="next"/)?.[1];
  if (next && !/^https:\/\/galaxybuzzdk\.myshopify\.com\/admin\/api\/[0-9-]+\/orders\.json\?/.test(next)) throw new Error('unexpected_shopify_next_url');
  return next || '';
}
export function buildInstallationWorkflow(source) {
  if (source.id !== 'QtG2XHw7DsvOEPtQ' || source.activeVersionId !== BASE_VERSION) throw new Error('shipping_active_version_changed');
  const wf = structuredClone(source);
  const node = name => { const n = wf.nodes.find(n => n.name === name); if (!n) throw new Error(`node_missing:${name}`); return n; };
  const poll = node('Shopify: Recent Fulfilled Orders');
  poll.parameters.url = poll.parameters.url.replace('&fulfillment_status=shipped', '');
  poll.parameters.options.response.response.fullResponse = true;
  poll.parameters.options.pagination = { pagination: {
    paginationMode: 'responseContainsNextURL',
    nextURL: '={{ (' + nextShopifyPage.toString() + ')($response.headers.link || $response.headers.Link || "") }}',
    paginationCompleteWhen: 'other', completeExpression: '={{ !/<([^>]+)>;\\s*rel="?next"?/.test($response.headers.link || $response.headers.Link || "") }}',
    limitPagesFetched: false, requestInterval: 500,
  } };
  const build = node('Build Shipment Records');
  if (!build.parameters.jsCode.startsWith('const body = $input.first()')) throw new Error('shipping_record_source_changed');
  build.parameters.jsCode = build.parameters.jsCode.replace("const body = $input.first()?.json || {};\nconst orders = Array.isArray(body.orders) ? body.orders : [];", "const orders = $input.all().flatMap(item => { const body = item.json.body || item.json; if (!Array.isArray(body.orders)) throw new Error('shopify_orders_missing'); return body.orders; });");
  const events = node('Build Shopify Event Records');
  if (!events.parameters.jsCode.startsWith('const graph = $input.first()')) throw new Error('shipping_event_source_changed');
  let eventCode = events.parameters.jsCode.replace("const graph = $input.first()?.json || {};\nconst source = $('Build Shipment Records').item.json || {};", "const graph = input.json || {};\nif (graph.errors?.length) throw new Error('shopify_fulfillment_events_failed');\nconst source = $('Build Shipment Records').itemMatching(inputIndex).json || {};");
  eventCode = eventCode.replace('return eventItems.map((event) => ({\n  json:', 'return eventItems.map((event) => ({\n  pairedItem: { item: inputIndex },\n  json:');
  events.parameters.jsCode = 'return $input.all().flatMap((input, inputIndex) => {\n' + eventCode + '\n});';
  const credential = structuredClone(node('Outlook: Send Pickup Notice').credentials);
  const prefix = 'Installation: ';
  const added = [];
  const add = (name, type, parameters, extra = {}) => {
    const n = { id: 'installation-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: prefix + name,
      type: 'n8n-nodes-base.' + type, typeVersion: type === 'httpRequest' ? 4.4 : type === 'wait' ? 1.1 : 2,
      position: [260 + (added.length % 5) * 280, 1400 + Math.floor(added.length / 5) * 240], parameters, ...extra };
    wf.nodes.push(n); added.push(n.name); return n;
  };
  const graph = (name, method, url, body, once = false) => add(name, 'httpRequest', {
    method, url, authentication: 'predefinedCredentialType', nodeCredentialType: 'microsoftOutlookOAuth2Api',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'Prefer', value: 'IdType="ImmutableId"' }] },
    ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: body } : {}),
    options: { timeout: 30000, response: { response: { responseFormat: method === 'POST' && !body ? 'autodetect' : 'json', ...(method === 'POST' && !body ? { fullResponse: true } : {}) } }, batching: { batch: { batchSize: 1, batchInterval: 250 } } },
  }, { credentials: structuredClone(credential), retryOnFail: method === 'GET', ...(method === 'GET' ? { maxTries: 3, waitBetweenTries: 5000 } : {}), ...(once ? { executeOnce: true } : {}) });
  const internal = (name, jsonBody) => {
    const parameters = structuredClone(node('17TRACK: Sync Outbound Tracking').parameters);
    parameters.url = 'https://coolify-proxy/api/internal/shipping/installation-documents';
    parameters.jsonBody = jsonBody;
    add(name, 'httpRequest', parameters, { retryOnFail: false });
  };
  graph('Mailbox', 'GET', 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', null, true);
  graph('Sent Folder', 'GET', 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems?$select=id', null, true);
  add('Fulfillments', 'code', { jsCode: `const profile = $('Installation: Mailbox').first().json;
const folder = $input.first().json;
if(profile.id !== '4d977ed3-c401-43e5-ad00-b171a294e787' || String(profile.mail || profile.userPrincipalName).toLowerCase() !== 'support@neontrip.de' || !folder.id) throw new Error('installation_mailbox_mismatch');
const out = []; const seen = new Set();
for (const page of $('Shopify: Recent Fulfilled Orders').all()) {
  const body = page.json.body || page.json;
  if (!Array.isArray(body.orders)) throw new Error('shopify_orders_missing');
  for (const o of body.orders) {
    if (o.cancelled_at) continue;
    for (const f of o.fulfillments || []) {
      const key = String(o.id) + ':' + String(f.id);
      if (f.status !== 'success' || seen.has(key)) continue;
      seen.add(key);
      out.push({ json: { action: 'reserve', order: { id: o.id, name: o.name, email: o.email, cancelled_at: o.cancelled_at, line_items: o.line_items, fulfillments: [f] }, fulfillmentId: String(f.id), mailboxProfile: profile, sentFolderId: folder.id }, pairedItem: { item: 0 } });
    }
  }
}
return out;` });
  internal('Reserve', '={{ JSON.stringify($json) }}');
  add('Ready Drafts', 'code', { jsCode: 'return $input.all().flatMap((item, index) => item.json.ready === true ? [{json:item.json,pairedItem:{item:index}}] : []);' });
  graph('Create Draft', 'POST', 'https://graph.microsoft.com/v1.0/me/messages', '={{ JSON.stringify($json.graphDraft) }}');
  const fields = 'id,isDraft,subject,body,toRecipients,ccRecipients,bccRecipients,replyTo,internetMessageHeaders,from,sender,sentDateTime,internetMessageId,parentFolderId';
  graph('Read Draft', 'GET', "={{ 'https://graph.microsoft.com/v1.0/me/messages/' + encodeURIComponent($json.id) + '?$select=" + fields + "&$expand=attachments' }}");
  internal('Authorize', "={{ JSON.stringify({action:'authorize',notificationId:$('Installation: Ready Drafts').item.json.notificationId,owner:$('Installation: Ready Drafts').item.json.owner,message:$json}) }}");
  add('Ready Sends', 'code', { jsCode: 'return $input.all().flatMap((item, index) => item.json.ready === true ? [{json:item.json,pairedItem:{item:index}}] : []);' });
  graph('Send Draft', 'POST', "={{ 'https://graph.microsoft.com/v1.0/me/messages/' + encodeURIComponent($json.draftId) + '/send' }}");
  add('Wait for Sent Copy', 'wait', { resume: 'timeInterval', amount: 30, unit: 'seconds' }, { webhookId: 'installation-documents-sent-copy' });
  graph('Read Sent Copy', 'GET', "={{ 'https://graph.microsoft.com/v1.0/me/messages/' + encodeURIComponent($('Installation: Ready Sends').item.json.draftId) + '?$select=" + fields + "&$expand=attachments' }}");
  internal('Complete', "={{ JSON.stringify({action:'complete',notificationId:$('Installation: Ready Sends').item.json.notificationId,owner:$('Installation: Ready Sends').item.json.owner,message:$json}) }}");
  // Branch errors must not stop the existing pickup/warning/17TRACK sibling branches.
  // continueRegularOutput lets downstream validators reject incomplete evidence.
  for (const n of wf.nodes.filter(n => added.includes(n.name))) n.onError = 'continueRegularOutput';
  wf.connections['Shopify: Recent Fulfilled Orders'].main[0].push({ node: added[0], type: 'main', index: 0 });
  for (let i = 0; i < added.length - 1; i++) wf.connections[added[i]] = { main: [[{ node: added[i + 1], type: 'main', index: 0 }]] };
  return wf;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/build_shipping_installation_workflow.mjs <active-source.json> <candidate.json>');
  fs.writeFileSync(process.argv[3], JSON.stringify(buildInstallationWorkflow(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2) + '\n');
}
