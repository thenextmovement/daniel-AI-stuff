import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));

const SUPABASE_CREDENTIAL = {
  httpHeaderAuth: {
    id: "NTtNxoBGGzJCQi9u",
    name: "Header Auth account 2 | SUPABASE",
  },
};

const OUTLOOK_CREDENTIAL = {
  microsoftOutlookOAuth2Api: {
    id: "CTEmJD5CjYu9hawu",
    name: "Microsoft Outlook support@neontrip.de",
  },
};

export const normalizeSentDeltaCode = String.raw`
function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, number) => String.fromCharCode(Number(number) || 32));
}

function textFromHtml(value) {
  const html = String(value || "");
  const markers = [
    /<div[^>]+id=["']divRplyFwdMsg["'][^>]*>/i,
    /<div[^>]+id=["']mail-editor-reference-message-container["'][^>]*>/i,
    /<div[^>]+class=["'][^"']*gmail_quote[^"']*["'][^>]*>/i,
    /<blockquote[^>]*(?:type=["']cite["'])?[^>]*>/i,
    /<!--\s*Original Message\s*-->/i,
  ];
  let cut = html.length;
  for (const marker of markers) {
    const match = marker.exec(html);
    if (match && match.index < cut) cut = match.index;
  }
  const text = decodeEntities(html.slice(0, cut)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
  const lines = text.replace(/\r/g, "").split("\n");
  const quoteMarkers = [
    /^\s*-{2,}\s*(?:ursprüngliche nachricht|original message)\s*-{2,}\s*$/i,
    /^\s*(?:von|from)\s*:\s*.+$/i,
    /^\s*(?:gesendet|sent)\s*:\s*.+$/i,
    /^\s*(?:an|to)\s*:\s*.+@.+$/i,
    /^\s*am\s+.+\s+schrieb\s+.+:\s*$/i,
    /^\s*on\s+.+\s+wrote\s*:\s*$/i,
    /^\s*_{5,}\s*$/,
  ];
  const markerIndex = lines.findIndex((line) => quoteMarkers.some((pattern) => pattern.test(line)));
  return lines.slice(0, markerIndex >= 0 ? markerIndex : lines.length)
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withoutSignature(value) {
  const text = String(value || "");
  const markers = [
    /\n\s*Fabienne Trapp\s*(?:\n|$)/i,
    /\n\s*Beratung\s*&\s*Realisierung\s*(?:\n|$)/i,
    /\n\s*NEONTRIP®?\s*(?:\n|$)/i,
    /\n\s*Tel(?:efon)?\s*:\s*\+?49/i,
    /\n\s*E-Mail\s*:\s*support@neontrip\.de/i,
    /\n\s*Adresse\s*:\s*Bilker Allee/i,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trim().slice(0, 6000);
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function recipientEmails(message) {
  return [
    ...(Array.isArray(message && message.toRecipients) ? message.toRecipients : []),
    ...(Array.isArray(message && message.ccRecipients) ? message.ccRecipients : []),
    ...(Array.isArray(message && message.bccRecipients) ? message.bccRecipients : []),
  ]
    .map((entry) => String(entry && entry.emailAddress && entry.emailAddress.address || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 100);
}

function headerValue(headers, name) {
  const record = headers && typeof headers === "object" ? headers : {};
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? record[key] : null;
  return Array.isArray(value) ? value[0] : value;
}

const request = $("Build Delta Request").first().json;
const response = $input.first().json || {};
const httpStatus = Number(response.statusCode || response.status || 0);
const headers = response.headers || {};
const body = response.body && typeof response.body === "object" ? response.body : {};
const retryAfterRaw = headerValue(headers, "retry-after");
const retryAfterSeconds = Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null;
const errorCode = String(body && body.error && body.error.code || "").slice(0, 200);
const errorMessage = String(body && body.error && body.error.message || response.statusMessage || "").slice(0, 2000);

let cursorUrl = null;
let cursorKind = null;
let messages = [];

if (httpStatus >= 200 && httpStatus < 300) {
  cursorUrl = body["@odata.nextLink"] || body["@odata.deltaLink"] || null;
  cursorKind = body["@odata.nextLink"] ? "next" : (body["@odata.deltaLink"] ? "delta" : null);

  if (!cursorUrl || !cursorKind) {
    throw new Error("Microsoft Graph delta response did not contain a nextLink or deltaLink.");
  }

  const cursor = new URL(cursorUrl);
  if (
    cursor.protocol !== "https:"
    || cursor.hostname !== "graph.microsoft.com"
    || !cursor.pathname.toLowerCase().includes("/messages/delta")
  ) {
    throw new Error("Rejected an invalid Microsoft Graph cursor URL.");
  }

  messages = (Array.isArray(body.value) ? body.value : [])
    .filter((message) => message && !message["@removed"] && message.id && message.conversationId && message.sentDateTime)
    .slice(0, 100)
    .map((message) => {
      const responseText = withoutSignature(textFromHtml(
        message.uniqueBody && message.uniqueBody.content
          || message.body && message.body.content
          || message.bodyPreview
          || ""
      ));
      return {
        graph_message_id: String(message.id).slice(0, 2000),
        internet_message_id: String(message.internetMessageId || "").slice(0, 2000),
        conversation_id: String(message.conversationId).slice(0, 2000),
        sent_at: message.sentDateTime,
        received_at: message.receivedDateTime || null,
        subject: String(message.subject || "").slice(0, 1000),
        recipient_emails: recipientEmails(message),
        response_body_text: responseText,
        response_body_hash: stableHash(responseText),
      };
    });
}

const normalizedCode = errorCode.toLowerCase();
return [{
  json: {
    p_mailbox_key: request.mailbox_key,
    p_execution_id: request.execution_id,
    p_correlation_id: request.correlation_id,
    p_http_status: httpStatus,
    p_retry_after_seconds: retryAfterSeconds,
    p_cursor_url: cursorUrl,
    p_cursor_kind: cursorKind,
    p_messages: messages,
    p_error_code: errorCode || null,
    p_error_message: errorMessage || null,
    p_reset_cursor: httpStatus === 410 || normalizedCode.includes("syncstate") || normalizedCode.includes("resyncrequired"),
  },
}];
`;

export const buildFeedbackCode = String.raw`
function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 6000);
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
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

function firstLine(value) {
  return String(value || "").split(/\n+/).map((line) => line.trim()).find(Boolean) || "";
}

function lastLine(value) {
  const lines = String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] || "";
}

function greetingStyle(value) {
  const line = firstLine(value).toLowerCase();
  if (/^(hallo|hi|hey)\b/.test(line)) return "informal";
  if (/^(guten tag|sehr geehrte|dear|hello)\b/.test(line)) return "formal";
  return "other";
}

function closingStyle(value) {
  const line = lastLine(value).toLowerCase();
  if (/^(viele grüße|beste grüße|best regards)[,!.]?$/.test(line)) return "approved";
  if (/^(liebe grüße|lg|herzliche grüße|kind regards)[,!.]?$/.test(line)) return "other";
  return "missing_or_other";
}

function extractAmounts(value) {
  const matches = String(value || "").match(/\b\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?\s*(?:€|eur)(?!\w)|\b\d+(?:\.\d{2})\s*(?:€|eur)(?!\w)/gi) || [];
  return [...new Set(matches.map((token) => {
    const raw = token.toLowerCase().replace(/\s*(?:€|eur)\s*/g, "").replace(/\s/g, "");
    const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  }).filter((value) => value !== null))].sort((a, b) => a - b);
}

function extractDates(value) {
  const matches = String(value || "").match(/\b(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})\b/g) || [];
  return [...new Set(matches)].sort();
}

function attachmentRefs(value) {
  const text = String(value || "").toLowerCase();
  return [
    ["order_confirmation", /\b(bestellbestätigung|auftragsbestätigung|purchase order|order confirmation)\b/i],
    ["delivery_note", /\b(lieferschein|delivery note)\b/i],
    ["invoice", /\b(rechnung|invoice)\b/i],
    ["artwork", /\b(druckdatei|grafikdatei|druckdaten|logo(?:datei)?|artwork|print file)\b/i],
    ["attachment", /\b(anhang|angehängt|beigefügt|attached|attachment)\b/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name).sort();
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const output = [];
for (const item of $input.all()) {
  const candidate = item.json || {};
  const draftText = String(candidate.draft_body_text || "").trim().slice(0, 6000);
  const sentText = String(candidate.sent_body_text || "").trim().slice(0, 6000);
  if (!candidate.sent_index_id || !candidate.source_message_id || !candidate.sent_graph_message_id || !draftText || !sentText) continue;

  const ratio = editRatio(draftText, sentText);
  const draftNormalized = normalize(draftText);
  const sentNormalized = normalize(sentText);
  const draftWords = draftNormalized.split(/\s+/).filter(Boolean).length;
  const sentWords = sentNormalized.split(/\s+/).filter(Boolean).length;
  const draftAmounts = extractAmounts(draftText);
  const sentAmounts = extractAmounts(sentText);
  const draftDates = extractDates(draftText);
  const sentDates = extractDates(sentText);
  const draftAttachmentRefs = attachmentRefs(draftText);
  const sentAttachmentRefs = attachmentRefs(sentText);
  const draftQuestions = (draftText.match(/\?/g) || []).length;
  const sentQuestions = (sentText.match(/\?/g) || []).length;
  const draftGreeting = greetingStyle(draftText);
  const sentGreeting = greetingStyle(sentText);
  const draftClosing = closingStyle(draftText);
  const sentClosing = closingStyle(sentText);
  const commitmentPattern = /\b(garantiert|definitiv|auf jeden fall|wir liefern am|kommt sicher am|wir erstatten|gutschrift erstellt|kostenlos|gratis|produktion (?:startet|beginnt)|starten wir (?:die )?produktion)\b/i;
  const internalPattern = /\b(angesehen|geöffnet|gelesen|aufgerufen|viewed|opened|read|accessed)\b/i;
  const draftCommitment = commitmentPattern.test(draftText);
  const sentCommitment = commitmentPattern.test(sentText);
  const labels = [];

  if (ratio <= 0.02) labels.push("unchanged");
  if (sentWords < draftWords * 0.75) labels.push("shortened");
  if (sentWords > draftWords * 1.35) labels.push("expanded");
  if (draftGreeting !== sentGreeting || firstLine(draftText) !== firstLine(sentText)) labels.push("greeting_changed");
  if (draftClosing !== sentClosing || lastLine(draftText) !== lastLine(sentText)) labels.push("closing_changed");
  if (sentQuestions > draftQuestions) labels.push("question_added");
  if (sentQuestions < draftQuestions) labels.push("question_removed");
  if (!sameArray(draftAmounts, sentAmounts)) labels.push("amount_changed");
  if (!sameArray(draftDates, sentDates)) labels.push("date_changed");
  if (!sameArray(draftAttachmentRefs, sentAttachmentRefs)) labels.push("attachment_reference_changed");
  if (draftCommitment !== sentCommitment) labels.push("commitment_changed");
  if (internalPattern.test(draftText) && !internalPattern.test(sentText)) labels.push("internal_detail_removed");
  if (draftGreeting !== sentGreeting) labels.push("tone_changed");

  const factualCorrection = labels.some((label) => [
    "amount_changed", "date_changed", "attachment_reference_changed", "commitment_changed", "internal_detail_removed"
  ].includes(label));
  if (factualCorrection) labels.push("factual_correction");
  if (ratio > 0.65) labels.push("manual_rewrite");
  if (candidate.message_source === "whatsapp_relay" && sentWords <= 90) labels.push("whatsapp_style");
  if (ratio > 0.45 || factualCorrection || String(candidate.risk_level || "") === "high") labels.push("needs_human_review");
  if (!labels.length || (ratio > 0.02 && ratio <= 0.08 && !factualCorrection)) labels.push("minor_formatting");

  const uniqueLabels = [...new Set(labels)];
  const criticalChange = uniqueLabels.some((label) => [
    "amount_changed", "date_changed", "commitment_changed", "internal_detail_removed", "factual_correction"
  ].includes(label));
  const reviewPriority = String(candidate.risk_level || "") === "high" || criticalChange || ratio > 0.65
    ? "high"
    : (ratio > 0.20 || uniqueLabels.includes("attachment_reference_changed") ? "normal" : "low");
  const targetRecipient = String(candidate.from_email || "").trim().toLowerCase();
  const recipients = (Array.isArray(candidate.sent_recipient_emails) ? candidate.sent_recipient_emails : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);

  output.push({ json: {
    p_sent_index_id: candidate.sent_index_id,
    p_source_message_id: candidate.source_message_id,
    p_conversation_id: candidate.conversation_id || candidate.sent_conversation_id || "",
    p_draft_id: candidate.draft_id || "",
    p_sent_message_id: candidate.sent_graph_message_id,
    p_sent_internet_message_id: candidate.sent_internet_message_id || "",
    p_draft_body_hash: candidate.draft_body_hash || stableHash(draftText),
    p_sent_body_hash: stableHash(sentText),
    p_sent_body_text: sentText,
    p_edit_ratio: Number(ratio.toFixed(6)),
    p_edit_summary: {
      draft_characters: draftText.length,
      sent_characters: sentText.length,
      character_delta: sentText.length - draftText.length,
      draft_words: draftWords,
      sent_words: sentWords,
      word_delta: sentWords - draftWords,
      collector_version: "email-feedback-delta-v1",
    },
    p_edit_labels: uniqueLabels,
    p_change_profile: {
      version: "email-change-profile-delta-v1",
      match: {
        method: "sent_index_conversation_and_time_window",
        draft_created_at: candidate.draft_created_at,
        sent_at: candidate.sent_at || null,
        target_recipient_present: !targetRecipient || recipients.includes(targetRecipient),
        sent_index_id: candidate.sent_index_id,
      },
      semantic_deltas: {
        amounts_changed: !sameArray(draftAmounts, sentAmounts),
        draft_amounts_cents: draftAmounts,
        sent_amounts_cents: sentAmounts,
        dates_changed: !sameArray(draftDates, sentDates),
        draft_dates: draftDates,
        sent_dates: sentDates,
        attachment_references_changed: !sameArray(draftAttachmentRefs, sentAttachmentRefs),
        draft_attachment_references: draftAttachmentRefs,
        sent_attachment_references: sentAttachmentRefs,
        question_delta: sentQuestions - draftQuestions,
        commitment_changed: draftCommitment !== sentCommitment,
        internal_detail_removed: internalPattern.test(draftText) && !internalPattern.test(sentText),
      },
      style_deltas: {
        greeting_changed: uniqueLabels.includes("greeting_changed"),
        closing_changed: uniqueLabels.includes("closing_changed"),
        draft_greeting_style: draftGreeting,
        sent_greeting_style: sentGreeting,
        draft_closing_style: draftClosing,
        sent_closing_style: sentClosing,
        shortened: uniqueLabels.includes("shortened"),
        expanded: uniqueLabels.includes("expanded"),
      },
      source: {
        channel: candidate.message_source || "external_email",
        risk_level: candidate.risk_level || null,
        reply_length_class: candidate.reply_length_class || null,
      },
      automation: {
        auto_prompt_update_allowed: false,
        human_review_required_for_learning: true,
      },
    },
    p_review_priority: reviewPriority,
  } });
}

return output;
`;

export const sentDeltaWorkflow = {
  name: "AI Email Agent — Sent Delta Indexer v1",
  nodes: [
    {
      id: "sent-delta-schedule",
      name: "Every Five Minutes",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        rule: { interval: [{ field: "minutes", minutesInterval: 5 }] },
      },
    },
    {
      id: "begin-sent-sync",
      name: "Begin Sent Sync",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [260, 0],
      parameters: {
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        method: "POST",
        url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/begin_email_agent_sent_sync_v1",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ p_mailbox_key: 'support@neontrip.de', p_execution_id: String($execution.id) }) }}",
        options: { timeout: 30000 },
      },
      credentials: SUPABASE_CREDENTIAL,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: "stopWorkflow",
    },
    {
      id: "build-delta-request",
      name: "Build Delta Request",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [520, 0],
      parameters: {
        jsCode: String.raw`
const response = $input.first().json || {};
const state = response.body && typeof response.body === "object" ? response.body : response;
if (!state.should_request) return [{ json: state }];

let requestUrl = String(state.cursor_url || "");
if (!requestUrl) {
  const since = new Date(state.initial_since || Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const select = "id,internetMessageId,conversationId,sentDateTime,receivedDateTime,subject,toRecipients,ccRecipients,bccRecipients,body,uniqueBody,bodyPreview";
  requestUrl = "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta"
    + "?changeType=created"
    + "&$select=" + encodeURIComponent(select)
    + "&$filter=" + encodeURIComponent("receivedDateTime ge " + since);
}

const parsed = new URL(requestUrl);
if (
  parsed.protocol !== "https:"
  || parsed.hostname !== "graph.microsoft.com"
  || !parsed.pathname.toLowerCase().includes("/messages/delta")
  || parsed.username
  || parsed.password
) {
  throw new Error("Rejected an invalid Microsoft Graph delta request URL.");
}

return [{ json: { ...state, request_url: parsed.toString() } }];
`,
      },
    },
    {
      id: "should-fetch-graph",
      name: "Should Fetch Graph",
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [780, 0],
      parameters: {
        options: {},
        conditions: {
          options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
          combinator: "and",
          conditions: [{
            id: "should-request-true",
            operator: { type: "boolean", operation: "true", singleValue: true },
            leftValue: "={{ $json.should_request }}",
            rightValue: "",
          }],
        },
      },
    },
    {
      id: "fetch-sent-delta-page",
      name: "Fetch Sent Delta Page",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1040, -100],
      parameters: {
        authentication: "predefinedCredentialType",
        nodeCredentialType: "microsoftOutlookOAuth2Api",
        method: "GET",
        url: "={{ $json.request_url }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [{
            name: "Prefer",
            value: "odata.maxpagesize=50, outlook.body-content-type=\"html\"",
          }],
        },
        options: {
          timeout: 30000,
          response: {
            response: {
              fullResponse: true,
              neverError: true,
              responseFormat: "json",
            },
          },
        },
      },
      credentials: OUTLOOK_CREDENTIAL,
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 5000,
      onError: "stopWorkflow",
    },
    {
      id: "normalize-sent-delta",
      name: "Normalize Sent Delta",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1300, -100],
      parameters: { jsCode: normalizeSentDeltaCode },
    },
    {
      id: "persist-sent-delta",
      name: "Persist Sent Delta",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1560, -100],
      parameters: {
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        method: "POST",
        url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/record_email_agent_sent_sync_result_v1",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json) }}",
        options: {
          timeout: 30000,
          response: { response: { fullResponse: true, responseFormat: "json" } },
        },
      },
      credentials: SUPABASE_CREDENTIAL,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: "stopWorkflow",
    },
  ],
  connections: {
    "Every Five Minutes": { main: [[{ node: "Begin Sent Sync", type: "main", index: 0 }]] },
    "Begin Sent Sync": { main: [[{ node: "Build Delta Request", type: "main", index: 0 }]] },
    "Build Delta Request": { main: [[{ node: "Should Fetch Graph", type: "main", index: 0 }]] },
    "Should Fetch Graph": {
      main: [
        [{ node: "Fetch Sent Delta Page", type: "main", index: 0 }],
        [],
      ],
    },
    "Fetch Sent Delta Page": { main: [[{ node: "Normalize Sent Delta", type: "main", index: 0 }]] },
    "Normalize Sent Delta": { main: [[{ node: "Persist Sent Delta", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    saveManualExecutions: true,
    saveExecutionProgress: true,
    executionTimeout: 180,
  },
};

export const reviewMatcherWorkflow = {
  name: "AI Email Agent — Review Feedback Matcher v3",
  nodes: [
    {
      id: "review-match-schedule",
      name: "Every Five Minutes",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        rule: { interval: [{ field: "minutes", minutesInterval: 5 }] },
      },
    },
    {
      id: "fetch-feedback-candidates",
      name: "Fetch Feedback Candidates",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [260, 0],
      parameters: {
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        method: "POST",
        url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/get_email_agent_feedback_candidates_v1",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ p_limit: 40 }) }}",
        options: {
          timeout: 30000,
          response: { response: { fullResponse: true, responseFormat: "json" } },
        },
      },
      credentials: SUPABASE_CREDENTIAL,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: "stopWorkflow",
    },
    {
      id: "expand-feedback-candidates",
      name: "Expand Feedback Candidates",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [520, 0],
      parameters: {
        jsCode: String.raw`
const response = $input.first().json || {};
const payload = response.body !== undefined ? response.body : response;
const rows = Array.isArray(payload) ? payload : [];
return rows.slice(0, 40).map((row) => ({ json: row }));
`,
      },
    },
    {
      id: "build-review-feedback",
      name: "Build Review Feedback",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [780, 0],
      parameters: { jsCode: buildFeedbackCode },
    },
    {
      id: "record-indexed-feedback",
      name: "Record Indexed Feedback",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1040, 0],
      parameters: {
        authentication: "genericCredentialType",
        genericAuthType: "httpHeaderAuth",
        method: "POST",
        url: "https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/record_email_agent_feedback_from_index_v1",
        sendHeaders: true,
        headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json) }}",
        options: {
          timeout: 30000,
          response: { response: { fullResponse: true, responseFormat: "json" } },
        },
      },
      credentials: SUPABASE_CREDENTIAL,
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 3000,
      onError: "stopWorkflow",
    },
  ],
  connections: {
    "Every Five Minutes": { main: [[{ node: "Fetch Feedback Candidates", type: "main", index: 0 }]] },
    "Fetch Feedback Candidates": { main: [[{ node: "Expand Feedback Candidates", type: "main", index: 0 }]] },
    "Expand Feedback Candidates": { main: [[{ node: "Build Review Feedback", type: "main", index: 0 }]] },
    "Build Review Feedback": { main: [[{ node: "Record Indexed Feedback", type: "main", index: 0 }]] },
  },
  settings: {
    executionOrder: "v1",
    timezone: "Europe/Berlin",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    saveManualExecutions: true,
    saveExecutionProgress: true,
    executionTimeout: 180,
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await mkdir(join(directory, "generated"), { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "generated", "sent-delta-indexer.json"),
      `${JSON.stringify(sentDeltaWorkflow, null, 2)}\n`,
    ),
    writeFile(
      join(directory, "generated", "review-feedback-matcher.json"),
      `${JSON.stringify(reviewMatcherWorkflow, null, 2)}\n`,
    ),
  ]);
  console.log("Generated email feedback delta workflows.");
}
