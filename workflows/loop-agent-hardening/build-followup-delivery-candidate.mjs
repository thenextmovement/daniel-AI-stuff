import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(
  here,
  "generated",
  "followup-deterministic-delivery-loop-v4.json",
);

const supabaseCredential = {
  httpHeaderAuth: {
    id: "NTtNxoBGGzJCQi9u",
    name: "Header Auth account 2 | SUPABASE",
  },
};

function codeNode(id, name, position, lines) {
  return {
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    parameters: { jsCode: lines.join("\n") },
  };
}

function rpcNode(id, name, rpc, body, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    parameters: {
      method: "POST",
      url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/" + rpc,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Content-Type", value: "application/json" }],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: body,
      options: {
        response: { response: { responseFormat: "json" } },
        timeout: 15000,
      },
    },
    credentials: structuredClone(supabaseCredential),
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "stopWorkflow",
  };
}

function strictIf(id, name, leftValue, rightValue, type, operation, position) {
  return {
    id,
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: id + "-condition",
            leftValue,
            rightValue,
            operator: { type, operation },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  };
}

const nodes = [
  {
    id: "followup-schedule",
    name: "Every 30 Min 08-20",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: [0, 300],
    parameters: {
      rule: {
        interval: [
          {
            field: "cronExpression",
            expression: "0 */30 8-20 * * *",
          },
        ],
      },
    },
  },
  rpcNode(
    "claim-followup",
    "ClaimFollowupDelivery",
    "claim_followup_delivery_candidate",
    "={{ JSON.stringify({ p_workflow_execution_id: String($execution.id), p_lease_seconds: 900 }) }}",
    [220, 300],
  ),
  strictIf(
    "candidate-claimed",
    "CandidateClaimed",
    "={{ $json.route }}",
    "process",
    "string",
    "equals",
    [440, 300],
  ),
  codeNode("prepare-candidate", "PrepareCandidate", [660, 300], [
    "const claim = $json || {};",
    "const item = claim.candidate || {};",
    "const email = String(item.customer_email || '').trim().toLowerCase();",
    "const queueId = String(claim.followup_queue_id || item.id || '').trim();",
    "const requestId = String(item.request_id || '').trim();",
    "const documentId = String(item.document_id || '').trim();",
    "const rawLink = String(item.offer_public_url || '').trim();",
    "const validEmail = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) && !/@(neontrip\\.de|riesenobjekte\\.de|example\\.|neontrip\\.test$)/i.test(email);",
    "const modernLink = /^https:\\/\\/angebote\\.neontrip\\.de\\/offer\\/[^/?#]+$/i.test(rawLink);",
    "let route = 'blocked';",
    "let blockReason = 'candidate_identity_invalid';",
    "if (queueId && requestId && documentId && validEmail) {",
    "  route = 'modern'; blockReason = null;",
    "}",
    "return [{ json: {",
    "  ...item,",
    "  followup_queue_id: queueId,",
    "  claim_token: claim.claim_token,",
    "  customer_email: email,",
    "  request_id: requestId,",
    "  document_id: documentId,",
    "  candidate_offer_link: modernLink ? rawLink : null,",
    "  preflight_route: route,",
    "  block_reason: blockReason,",
    "  copy_mode: 'deterministic',",
    "  ai_copy_allowed: false,",
    "  automatic_retry_allowed: false,",
    "} }];",
  ]),
  strictIf(
    "preflight-route",
    "CandidateIdentityValid",
    "={{ $json.preflight_route }}",
    "modern",
    "string",
    "equals",
    [880, 300],
  ),
  {
    id: "search-modern",
    name: "SearchModernOffer",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [1100, 180],
    parameters: {
      url: "https://angebote.neontrip.de/api/internal/offers/search",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendQuery: true,
      queryParameters: {
        parameters: [
          {
            name: "q",
            value: "={{ $('PrepareCandidate').item.json.request_id }}",
          },
          { name: "limit", value: "5" },
        ],
      },
      options: { timeout: 30000 },
    },
    credentials: structuredClone(supabaseCredential),
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "continueRegularOutput",
  },
  codeNode("validate-modern", "ValidateModernOffer", [1320, 180], [
    "const item = $('PrepareCandidate').item.json;",
    "const response = $json || {};",
    "const results = Array.isArray(response.results) ? response.results : [];",
    "const closed = new Set(['ACCEPTED', 'COMPLETED', 'DOWNLOADED', 'EXPIRED', 'LOST']);",
    "const sendable = new Set(['SENT', 'VIEWED']);",
    "const exact = results.filter(offer => offer && offer.matchType === 'exact');",
    "const closedMatches = exact.filter(offer => closed.has(String(offer.status || '').toUpperCase()));",
    "const sendableMatches = exact.filter(offer => sendable.has(String(offer.status || '').toUpperCase()) && /^https:\\/\\/angebote\\.neontrip\\.de\\/offer\\/[^/?#]+$/i.test(String(offer.publicUrl || '')));",
    "let ok = false;",
    "let link = null;",
    "let reason = 'modern_offer_not_sendable';",
    "if (response.error || response.code === 'UNAUTHORIZED' || response.message === 'Unauthorized') reason = 'modern_offer_lookup_failed';",
    "else if (closedMatches.length > 0) reason = 'modern_offer_closed';",
    "else if (sendableMatches.length > 1) reason = 'modern_offer_ambiguous';",
    "else if (sendableMatches.length === 1) { ok = true; link = sendableMatches[0].publicUrl; reason = null; }",
    "return [{ json: { ...item, preflight_ok: ok, offer_link: link, block_reason: reason } }];",
  ]),
  strictIf(
    "modern-sendable",
    "ModernOfferSendable",
    "={{ $json.preflight_ok }}",
    true,
    "boolean",
    "equals",
    [1540, 180],
  ),
  {
    id: "lookup-replies",
    name: "LookupCustomerReplies",
    type: "n8n-nodes-base.microsoftOutlook",
    typeVersion: 2,
    position: [1760, 300],
    parameters: {
      operation: "getAll",
      limit: 10,
      filtersUI: {
        values: {
          filters: {
            receivedAfter: "={{ $now.minus({ days: 7 }).toISO() }}",
            sender: "={{ $json.customer_email }}",
          },
        },
      },
      options: {},
    },
    credentials: {
      microsoftOutlookOAuth2Api: {
        id: "CTEmJD5CjYu9hawu",
        name: "Microsoft Outlook support@neontrip.de",
      },
    },
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "continueRegularOutput",
  },
  codeNode("analyze-replies", "AnalyzeReplyEvidence", [1980, 300], [
    "const item = $('PrepareCandidate').item.json;",
    "const preflight = $input.first()?.json || {};",
    "let all = [];",
    "try { all = $('LookupCustomerReplies').all().map(entry => entry.json || {}); } catch {}",
    "const lookupFailed = all.some(entry => entry.error || entry.$error) || Boolean(preflight.error || preflight.$error);",
    "const customerEmail = String(item.customer_email || '').toLowerCase();",
    "let validatedOfferLink = '';",
    "try { validatedOfferLink = String($('ValidateModernOffer').item.json.offer_link || ''); } catch {}",
    "const replies = all.filter(entry => {",
    "  const from = String(entry.from?.emailAddress?.address || entry.sender?.emailAddress?.address || '').toLowerCase();",
    "  return from === customerEmail && Boolean(entry.subject || entry.bodyPreview || entry.body?.content);",
    "});",
    "const safe = !lookupFailed && replies.length === 0;",
    "return [{ json: {",
    "  ...item,",
    "  offer_link: validatedOfferLink,",
    "  reply_preflight_safe: safe,",
    "  reply_count: replies.length,",
    "  block_reason: lookupFailed ? 'outlook_reply_lookup_failed' : (replies.length > 0 ? 'customer_reply_detected' : null),",
    "} }];",
  ]),
  strictIf(
    "reply-safe",
    "ReplyPreflightSafe",
    "={{ $json.reply_preflight_safe }}",
    true,
    "boolean",
    "equals",
    [2200, 300],
  ),
  rpcNode(
    "block-delivery",
    "BlockFollowupDelivery",
    "block_followup_delivery",
    "={{ JSON.stringify({ p_followup_queue_id: $('PrepareCandidate').item.json.followup_queue_id, p_claim_token: $('PrepareCandidate').item.json.claim_token, p_workflow_execution_id: String($execution.id), p_reason: String($json.block_reason || 'preflight_blocked') }) }}",
    [2420, 520],
  ),
  codeNode("build-email", "BuildDeterministicFollowup", [2420, 220], [
    "const item = $json || {};",
    "function esc(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\"', '&quot;').replaceAll(\"'\", '&#39;'); }",
    "const link = String(item.offer_link || '').trim();",
    "if (!/^https:\\/\\/angebote\\.neontrip\\.de\\/offer\\/[^/?#]+$/i.test(link)) throw new Error('deterministic_followup_link_invalid');",
    "const rawName = String(item.customer_name || '').replace(/[^\\p{L}\\p{M} .'-]/gu, ' ').replace(/\\b(?:onerror|javascript|script|img)\\b/gi, ' ').replace(/\\s+/g, ' ').trim();",
    "const parts = rawName.split(/\\s+/).filter(Boolean);",
    "const isDu = /^(du|duzen)$/i.test(String(item.anrede || ''));",
    "const greeting = isDu ? ('Hallo ' + (parts[0] || '')) : ('Guten Tag ' + rawName);",
    "const number = Math.max(1, Math.min(5, Number(item.followup_number) || 1));",
    "const subjects = [",
    "  'Ihr NEONTRIP-Angebot',",
    "  'Ihr Leuchtschild-Angebot',",
    "  'Kurze Rückfrage zu Ihrem NEONTRIP-Angebot',",
    "  'Ihr NEONTRIP-Angebot: nächster Schritt',",
    "  'Ihr Leuchtschild-Projekt: kurzer Abschluss',",
    "];",
    "const sentences = isDu ? [",
    "  'ich wollte kurz nachfragen, ob das Angebot für dein individuelles Leuchtschild so passt oder ob wir noch etwas anpassen dürfen.',",
    "  'konntest du das Angebot in Ruhe ansehen? Wenn noch eine Frage offen ist, helfen wir dir gerne weiter.',",
    "  'passt die vorgeschlagene Ausführung für dich oder dürfen wir noch etwas abstimmen?',",
    "  'gibt es noch eine offene Frage zu deinem Leuchtschild-Projekt?',",
    "  'ich wollte ein letztes Mal kurz nachfragen, ob wir dich bei diesem Projekt noch unterstützen dürfen.',",
    "] : [",
    "  'ich wollte kurz nachfragen, ob das Angebot für Ihr individuelles Leuchtschild so passt oder ob wir noch etwas anpassen dürfen.',",
    "  'konnten Sie das Angebot in Ruhe ansehen? Wenn noch eine Frage offen ist, helfen wir Ihnen gerne weiter.',",
    "  'passt die vorgeschlagene Ausführung für Sie oder dürfen wir noch etwas abstimmen?',",
    "  'gibt es noch eine offene Frage zu Ihrem Leuchtschild-Projekt?',",
    "  'ich wollte ein letztes Mal kurz nachfragen, ob wir Sie bei diesem Projekt noch unterstützen dürfen.',",
    "];",
    "const subject = subjects[number - 1];",
    "const plain = greeting + ',\\n\\n' + sentences[number - 1] + '\\n\\nZum Angebot: ' + link + '\\n\\nViele Grüße';",
    "const body = '<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111\">' + esc(plain).replace(/\\r?\\n/g, '<br>') + '</div><br><strong>Fabienne Trapp</strong><br>Beratung &amp; Realisierung<br>NEONTRIP®';",
    "return [{ json: { ...item, email_subject: subject, email_body: body, copy_mode: 'deterministic', ai_copy_allowed: false, automatic_retry_allowed: false } }];",
  ]),
  {
    id: "send-followup",
    name: "SendFollowupOutlook",
    type: "n8n-nodes-base.microsoftOutlook",
    typeVersion: 2,
    position: [2640, 220],
    parameters: {
      resource: "message",
      operation: "send",
      toRecipients: "={{ $json.customer_email }}",
      subject: "={{ $json.email_subject }}",
      bodyContent: "={{ $json.email_body }}",
      additionalFields: { bodyContentType: "html" },
    },
    credentials: {
      microsoftOutlookOAuth2Api: {
        id: "CTEmJD5CjYu9hawu",
        name: "Microsoft Outlook support@neontrip.de",
      },
    },
    retryOnFail: false,
    onError: "continueErrorOutput",
  },
  rpcNode(
    "complete-delivery",
    "CompleteFollowupDelivery",
    "complete_followup_delivery",
    "={{ JSON.stringify({ p_followup_queue_id: $('PrepareCandidate').item.json.followup_queue_id, p_claim_token: $('PrepareCandidate').item.json.claim_token, p_provider_message_id: String($json.id || $json.messageId || $json.message_id || ''), p_workflow_execution_id: String($execution.id), p_email_subject: $('BuildDeterministicFollowup').item.json.email_subject, p_email_body: $('BuildDeterministicFollowup').item.json.email_body }) }}",
    [2860, 160],
  ),
  rpcNode(
    "unknown-delivery",
    "MarkFollowupDeliveryUnknown",
    "mark_followup_delivery_unknown",
    "={{ JSON.stringify({ p_followup_queue_id: $('PrepareCandidate').item.json.followup_queue_id, p_claim_token: $('PrepareCandidate').item.json.claim_token, p_workflow_execution_id: String($execution.id), p_error_code: 'outlook_send_unknown' }) }}",
    [2860, 320],
  ),
];

const connections = {
  "Every 30 Min 08-20": {
    main: [[{ node: "ClaimFollowupDelivery", type: "main", index: 0 }]],
  },
  ClaimFollowupDelivery: {
    main: [[{ node: "CandidateClaimed", type: "main", index: 0 }]],
  },
  CandidateClaimed: {
    main: [[{ node: "PrepareCandidate", type: "main", index: 0 }], []],
  },
  PrepareCandidate: {
    main: [[{ node: "CandidateIdentityValid", type: "main", index: 0 }]],
  },
  CandidateIdentityValid: {
    main: [
      [{ node: "SearchModernOffer", type: "main", index: 0 }],
      [{ node: "BlockFollowupDelivery", type: "main", index: 0 }],
    ],
  },
  SearchModernOffer: {
    main: [[{ node: "ValidateModernOffer", type: "main", index: 0 }]],
  },
  ValidateModernOffer: {
    main: [[{ node: "ModernOfferSendable", type: "main", index: 0 }]],
  },
  ModernOfferSendable: {
    main: [
      [{ node: "LookupCustomerReplies", type: "main", index: 0 }],
      [{ node: "BlockFollowupDelivery", type: "main", index: 0 }],
    ],
  },
  LookupCustomerReplies: {
    main: [[{ node: "AnalyzeReplyEvidence", type: "main", index: 0 }]],
  },
  AnalyzeReplyEvidence: {
    main: [[{ node: "ReplyPreflightSafe", type: "main", index: 0 }]],
  },
  ReplyPreflightSafe: {
    main: [
      [{ node: "BuildDeterministicFollowup", type: "main", index: 0 }],
      [{ node: "BlockFollowupDelivery", type: "main", index: 0 }],
    ],
  },
  BuildDeterministicFollowup: {
    main: [[{ node: "SendFollowupOutlook", type: "main", index: 0 }]],
  },
  SendFollowupOutlook: {
    main: [
      [{ node: "CompleteFollowupDelivery", type: "main", index: 0 }],
      [{ node: "MarkFollowupDeliveryUnknown", type: "main", index: 0 }],
    ],
  },
};

const workflow = {
  name: "NEONTRIP Follow-up Delivery v4 — Deterministic DB Loop",
  nodes,
  connections,
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    callerPolicy: "workflowsFromSameOwner",
    availableInMCP: false,
    errorWorkflow: "M4uG1HAtN9Zggxww",
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(workflow, null, 2) + "\n");
console.log(output);
