const outlookCredential = {
  microsoftOutlookOAuth2Api: {
    id: 'CTEmJD5CjYu9hawu',
    name: 'Microsoft Outlook support@neontrip.de',
  },
};

const supabaseCredential = {
  httpHeaderAuth: {
    id: 'NTtNxoBGGzJCQi9u',
    name: 'Header Auth account 2 | SUPABASE',
  },
};

const node = (id, name, type, typeVersion, position, parameters, extra = {}) => ({
  id,
  name,
  type,
  typeVersion,
  position,
  parameters,
  ...extra,
});

const requestOptions = {
  timeout: 30000,
  response: { response: { fullResponse: true, responseFormat: 'json' } },
};

const expandPendingCode = String.raw`const response = $input.first().json;
const payload = response.body ?? response;
const rows = Array.isArray(payload) ? payload : [];
return rows.slice(0, 40).map((row) => ({ json: row }));`;

const buildFeedbackCode = String.raw`function textFromHtml(value) {
  const html = String(value || '');
  const markers = [
    /<div[^>]+id=["']divRplyFwdMsg["'][^>]*>/i,
    /<div[^>]+class=["'][^"']*gmail_quote[^"']*["'][^>]*>/i,
    /<blockquote[^>]*(?:type=["']cite["'])?[^>]*>/i,
  ];
  let cut = html.length;
  for (const marker of markers) {
    const match = marker.exec(html);
    if (match && match.index < cut) cut = match.index;
  }
  return html.slice(0, cut)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withoutSignature(value) {
  const text = String(value || '');
  const markers = [
    /\n\s*Fabienne Trapp\s*(?:\n|$)/i,
    /\n\s*Beratung\s*&\s*Realisierung\s*(?:\n|$)/i,
    /\n\s*NEONTRIP®?\s*(?:\n|$)/i,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trim();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

function editRatio(leftValue, rightValue) {
  const left = normalize(leftValue).split(/\s+/).filter(Boolean).slice(0, 1200);
  const right = normalize(rightValue).split(/\s+/).filter(Boolean).slice(0, 1200);
  if (!left.length && !right.length) return 0;
  if (!left.length || !right.length) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
    }
    previous = current;
  }
  return Math.min(1, previous[right.length] / Math.max(left.length, right.length));
}

const pendingRows = $('Expand Pending Reviews').all().map((item) => item.json);
const responseItems = $input.all();
const output = [];

for (let index = 0; index < responseItems.length; index += 1) {
  const pending = pendingRows[index] || {};
  const response = responseItems[index]?.json || {};
  const payload = response.body ?? response;
  const messages = Array.isArray(payload?.value) ? payload.value : [];
  const createdAt = Date.parse(pending.created_at || 0);
  const sent = messages
    .filter((message) => {
      const sentAt = Date.parse(message.sentDateTime || 0);
      return !Number.isFinite(createdAt) || !Number.isFinite(sentAt) || sentAt >= createdAt - 10 * 60 * 1000;
    })
    .sort((left, right) => Date.parse(left.sentDateTime || 0) - Date.parse(right.sentDateTime || 0))[0];
  if (!sent?.id) continue;

  const draftText = String(pending.draft_body_text || '');
  const sentText = withoutSignature(textFromHtml(sent.body?.content || sent.bodyPreview || ''));
  const ratio = editRatio(draftText, sentText);
  output.push({ json: {
    p_source_message_id: pending.message_id,
    p_conversation_id: pending.conversation_id || sent.conversationId || '',
    p_draft_id: pending.draft_id || '',
    p_sent_message_id: sent.id,
    p_draft_body_hash: pending.draft_body_hash || stableHash(draftText),
    p_sent_body_hash: stableHash(sentText),
    p_edit_ratio: Number(ratio.toFixed(6)),
    p_edit_summary: {
      draft_characters: draftText.length,
      sent_characters: sentText.length,
      draft_words: normalize(draftText).split(/\s+/).filter(Boolean).length,
      sent_words: normalize(sentText).split(/\s+/).filter(Boolean).length,
      collector_version: 'email-feedback-v1',
    },
  } });
}

return output;`;

const nodes = [
  node('schedule', 'Every Five Minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], {
    rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] },
  }),
  node('fetch-pending', 'Fetch Pending Draft Reviews', 'n8n-nodes-base.httpRequest', 4.4, [260, 0], {
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    method: 'GET',
    url: 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/email_agent_log',
    sendQuery: true,
    queryParameters: { parameters: [
      { name: 'review_status', value: 'eq.pending_review' },
      { name: 'draft_created', value: 'eq.true' },
      { name: 'created_at', value: "={{ 'gte.' + new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }}" },
      { name: 'select', value: 'message_id,conversation_id,draft_id,draft_body_hash,draft_body_text,created_at' },
      { name: 'order', value: 'created_at.asc' },
      { name: 'limit', value: '40' },
    ] },
    options: requestOptions,
  }, {
    credentials: supabaseCredential,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'stopWorkflow',
  }),
  node('expand-pending', 'Expand Pending Reviews', 'n8n-nodes-base.code', 2, [520, 0], {
    jsCode: expandPendingCode,
  }),
  node('fetch-sent', 'Fetch Sent Conversation', 'n8n-nodes-base.httpRequest', 4.4, [780, 0], {
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'microsoftOutlookOAuth2Api',
    method: 'GET',
    url: 'https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages',
    sendQuery: true,
    queryParameters: { parameters: [
      { name: '$filter', value: "={{ \"conversationId eq '\" + String($json.conversation_id || '').replace(/'/g, \"''\") + \"'\" }}" },
      { name: '$select', value: 'id,internetMessageId,conversationId,sentDateTime,subject,toRecipients,ccRecipients,body,bodyPreview' },
      { name: '$top', value: '20' },
    ] },
    options: requestOptions,
  }, {
    credentials: outlookCredential,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'continueRegularOutput',
  }),
  node('build-feedback', 'Build Review Feedback', 'n8n-nodes-base.code', 2, [1040, 0], {
    jsCode: buildFeedbackCode,
  }),
  node('record-feedback', 'Record Review Feedback', 'n8n-nodes-base.httpRequest', 4.4, [1300, 0], {
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    method: 'POST',
    url: 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/record_email_agent_feedback',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json) }}',
    options: requestOptions,
  }, {
    credentials: supabaseCredential,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 3000,
    onError: 'stopWorkflow',
  }),
];

const connection = (name) => ({ node: name, type: 'main', index: 0 });
const connections = {
  'Every Five Minutes': { main: [[connection('Fetch Pending Draft Reviews')]] },
  'Fetch Pending Draft Reviews': { main: [[connection('Expand Pending Reviews')]] },
  'Expand Pending Reviews': { main: [[connection('Fetch Sent Conversation')]] },
  'Fetch Sent Conversation': { main: [[connection('Build Review Feedback')]] },
  'Build Review Feedback': { main: [[connection('Record Review Feedback')]] },
};

process.stdout.write(JSON.stringify({
  name: 'AI Email Agent v2 — Review Feedback Collector',
  nodes,
  connections,
  settings: {
    executionOrder: 'v1',
    timezone: 'Europe/Berlin',
    executionTimeout: 180,
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
    saveExecutionProgress: true,
    saveManualExecutions: true,
  },
}));
