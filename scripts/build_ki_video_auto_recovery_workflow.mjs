import fs from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error(
    "Usage: node scripts/build_ki_video_auto_recovery_workflow.mjs <input.json> <output.json>",
  );
}

const workflow = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function node(name) {
  const match = workflow.nodes.find((entry) => entry.name === name);
  if (!match) throw new Error(`Required n8n node missing: ${name}`);
  return match;
}

function replaceOnce(value, search, replacement, label) {
  if (!value.includes(search)) throw new Error(`Expected ${label} source fragment missing`);
  if (value.indexOf(search) !== value.lastIndexOf(search)) {
    throw new Error(`Expected exactly one ${label} source fragment`);
  }
  return value.replace(search, replacement);
}

if (workflow.nodes.some((entry) => entry.name === "Provider Retry Available?")) {
  throw new Error("Workflow already contains the automatic recovery patch");
}

const queueDispatch = node("Prepare Queue Dispatch");
queueDispatch.parameters.jsCode = replaceOnce(
  queueDispatch.parameters.jsCode,
  `const eligibleCards = cards
  .filter((card) => card && card.id)
  .filter((card) => !/^fehler\\b/i.test(String(card.name || '').trim()))
  .filter((card) => !hasSentLabel(card));`,
  `const eligibleCards = cards
  .filter((card) => card && card.id)
  // A system-generated FEHLER prefix must not block a deliberate move back into
  // the send list. Sent labels remain the authoritative duplicate-send guard.
  .filter((card) => !hasSentLabel(card));`,
  "queue eligibility for recovered cards",
);

const parseQc = node("Parse Video Content QC");
parseQc.parameters.jsCode = replaceOnce(
  parseQc.parameters.jsCode,
  "const fallbackWithoutVideo = inconclusive && jobAttempts >= 2;",
  `const fallbackWithoutVideo = !normalApproval && jobAttempts >= 2;
const fallbackReason = evidenceBackedRejection
  ? 'content_rejected_after_two_video_attempts'
  : 'inconclusive_after_two_qc_attempts';`,
  "QC fallback decision",
);
parseQc.parameters.jsCode = replaceOnce(
  parseQc.parameters.jsCode,
  `const failureMessage = evidenceBackedRejection
  ? 'KI-Video hat die Inhaltspruefung nicht bestanden (' + issueText + '; ' + evidenceText + '). Versand wurde gestoppt.'
  : (fallbackWithoutVideo
    ? 'KI-Video konnte auch im zweiten Versuch nicht eindeutig freigegeben werden. Das Angebot wird ohne dieses Video versendet.'
    : 'KI-Video konnte nicht eindeutig geprueft werden. Ein zweiter, statischer Video-Versuch wird gestartet.');`,
  `const failureMessage = evidenceBackedRejection
  ? (fallbackWithoutVideo
    ? 'Auch der zweite KI-Video-Versuch hat eine konkrete Inhaltsabweichung (' + issueText + '; ' + evidenceText + '). Das fehlerhafte Video wird verworfen und das Angebot ohne Video versendet.'
    : 'KI-Video hat die Inhaltspruefung nicht bestanden (' + issueText + '; ' + evidenceText + '). Ein zweiter, statischer Video-Versuch wird gestartet.')
  : (fallbackWithoutVideo
    ? 'KI-Video konnte auch im zweiten Versuch nicht eindeutig freigegeben werden. Das Angebot wird ohne dieses Video versendet.'
    : 'KI-Video konnte nicht eindeutig geprueft werden. Ein zweiter, statischer Video-Versuch wird gestartet.');`,
  "QC failure message",
);
parseQc.parameters.jsCode = replaceOnce(
  parseQc.parameters.jsCode,
  "  videoContentQcFallbackWithoutVideo: fallbackWithoutVideo,",
  `  videoContentQcFallbackWithoutVideo: fallbackWithoutVideo,
  videoContentQcFallbackReason: fallbackWithoutVideo ? fallbackReason : '',`,
  "QC fallback reason output",
);

const watchdog = node("Video Watchdog Gate");
watchdog.parameters.jsCode = replaceOnce(
  watchdog.parameters.jsCode,
  "const titleBlocked = /^\\s*(?:❌\\s*)?(?:fehler|error)\\b/i.test(String(card.name || config.cardName || ''));",
  "const titleBlocked = /(?:^|\\s)(?:ANGEBOT\\s+NICHT\\s+SENDEN|DO\\s+NOT\\s+SEND)(?:\\s|$)/i.test(String(card.name || config.cardName || ''));",
  "watchdog title block",
);
watchdog.parameters.jsCode = replaceOnce(
  watchdog.parameters.jsCode,
  "  videoOmittedReason = deliveryWithoutVideo ? 'inconclusive_after_two_qc_attempts' : '';",
  "  videoOmittedReason = deliveryWithoutVideo ? String(parsedQc.videoContentQcFallbackReason || 'inconclusive_after_two_qc_attempts') : '';",
  "watchdog fallback reason",
);
watchdog.parameters.jsCode = replaceOnce(
  watchdog.parameters.jsCode,
  `} catch (error) {
  deliveryWithoutVideo = false;
}
const videoQcOk = blockingLabels.length === 0 && !titleBlocked;`,
  `} catch (error) {
  deliveryWithoutVideo = false;
}
try {
  const providerFallback = $('Prepare Provider Offer-only Fallback').first().json || {};
  if (providerFallback.deliveryWithoutVideo === true) {
    deliveryWithoutVideo = true;
    videoOmittedReason = String(providerFallback.videoOmittedReason || 'video_provider_unavailable_after_retries');
    videoQcDecision = String(providerFallback.videoContentQcDecision || 'provider_unavailable');
    videoQcConfidence = null;
  }
} catch (error) {
  // Provider fallback is only executed after the bounded provider retry limit.
}
const videoQcOk = blockingLabels.length === 0 && !titleBlocked;`,
  "provider fallback context",
);
watchdog.parameters.jsCode = replaceOnce(
  watchdog.parameters.jsCode,
  "    : 'Angebot wurde nicht rausgeschickt. Der Video-Watchdog hat einen ausdruecklichen Video- oder Versandstopp erkannt: ' + (blockingLabels.join(', ') || 'FEHLER im Titel')",
  "    : 'Angebot wurde nicht rausgeschickt. Der Video-Watchdog hat einen ausdruecklichen Video- oder Versandstopp erkannt: ' + (blockingLabels.join(', ') || 'ANGEBOT NICHT SENDEN im Titel')",
  "watchdog failure explanation",
);

const fallbackExists = node("Fallback Reusable Video Exists?");
fallbackExists.parameters.conditions.conditions[0].leftValue =
  "={{ ($('Upload Video to Trello').isExecuted && !!$('Upload Video to Trello').first().json.id) || ($('Check Reusable Trello Video').isExecuted && $('Check Reusable Trello Video').first().json.reusableVideo === true && !!$('Check Reusable Trello Video').first().json.existingVideoAttachmentId) }}";

const rejectedExists = node("Rejected Reusable Video?");
rejectedExists.parameters.conditions.conditions[0].leftValue =
  fallbackExists.parameters.conditions.conditions[0].leftValue;

const fallbackDelete = node("Delete Reusable Video for Offer-only");
fallbackDelete.parameters.url =
  "=https://api.trello.com/1/cards/{{ $('Config').first().json.cardId }}/attachments/{{ $('Upload Video to Trello').isExecuted && $('Upload Video to Trello').first().json.id ? $('Upload Video to Trello').first().json.id : $('Check Reusable Trello Video').first().json.existingVideoAttachmentId }}";

const rejectedDelete = node("Delete Rejected Reusable Video");
rejectedDelete.parameters.url = fallbackDelete.parameters.url;

const prepareFailure = node("Prepare Locked Offer Failure");
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  `const isLockedOffer =
  /\\b409\\b/.test(serialized) ||
  /viewed offers are locked|cannot be re-imported/i.test(serialized);`,
  `const isLockedOffer =
  /\\b409\\b/.test(serialized) ||
  /viewed offers are locked|cannot be re-imported/i.test(serialized);

const isTransientInfrastructureFailure =
  /\\b50[0234]\\b/.test(serialized) ||
  /econnrefused|econnreset|etimedout|upstream connect|connection refused|socket hang up|temporar(?:y|ily)|overloaded|service unavailable|try again later/i.test(serialized);`,
  "transient infrastructure classifier",
);
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  `const jobAttempts = Math.max(1, Number(config.jobAttempts || 1));
const automaticVideoAttemptLimit = 2;`,
  `const jobAttempts = Math.max(1, Number(config.jobAttempts || 1));
const jobMaxAttempts = Math.max(1, Number(config.jobMaxAttempts || 3));
const automaticVideoAttemptLimit = Math.min(2, jobMaxAttempts);`,
  "queue attempt limits",
);
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  `} else if (!upstreamFailureType && isRateLimit) {
  failureType = 'neontrip_offer_trello_rate_limited';
  failureMessage = 'Angebot wurde nicht rausgeschickt. Trello/Offer-API hat nach mehreren Versuchen weiterhin Rate Limit 429 geliefert.';
}

const videoQcFailure = failureType === 'video_content_qc_failed' || failureType === 'video_content_qc_unavailable' || failureType === 'video_content_qc_inconclusive';
const retryable = videoQcFailure && jobAttempts < automaticVideoAttemptLimit;`,
  `} else if (!upstreamFailureType && isRateLimit) {
  failureType = 'neontrip_offer_trello_rate_limited';
  failureMessage = 'Angebot wurde noch nicht rausgeschickt. Trello/Offer-API ist rate-limited und wird automatisch erneut versucht.';
} else if (!upstreamFailureType && isTransientInfrastructureFailure) {
  failureType = 'neontrip_offer_transient_failure';
  failureMessage = 'Angebot wurde noch nicht rausgeschickt. Eine voruebergehende API-/Netzwerkstoerung wird automatisch erneut versucht.';
}

const previewErrors = Array.isArray(input.errors)
  ? input.errors.map((entry) => String(entry || '').trim()).filter(Boolean)
  : [];
const previewPreSendBlocked = input.ok === false && input.blocked === true;
const permanentCustomerDataFailure = previewErrors.some((entry) =>
  /customer_email_missing_or_invalid|customer_not_in_live_canary/i.test(entry)
);
if (!upstreamFailureType && previewPreSendBlocked) {
  failureType = permanentCustomerDataFailure
    ? 'preview_delivery_customer_data_invalid'
    : 'preview_delivery_pre_send_blocked';
  failureMessage = permanentCustomerDataFailure
    ? 'Kundenversand wurde vor dem Senden blockiert: Empfaengeradresse fehlt oder ist ungueltig.'
    : 'Kundenversand wurde vor dem Senden blockiert (' + (previewErrors.join(', ') || 'Payload-Pruefung') + '). Der sichere Vorversand-Schritt wird erneut aufgebaut.';
}

const videoQcFailure = failureType === 'video_content_qc_failed' || failureType === 'video_content_qc_unavailable' || failureType === 'video_content_qc_inconclusive';
const retryableVideoQc = videoQcFailure && jobAttempts < automaticVideoAttemptLimit;
const retryableInfrastructure =
  (isRateLimit || isTransientInfrastructureFailure) &&
  jobAttempts < jobMaxAttempts;
const retryablePreSend =
  previewPreSendBlocked &&
  !permanentCustomerDataFailure &&
  jobAttempts < jobMaxAttempts;
const retryable = retryableVideoQc || retryableInfrastructure || retryablePreSend;
const automaticRecoveryKind = retryableVideoQc
  ? 'video_regeneration'
  : (retryableInfrastructure
    ? 'infrastructure_retry'
    : (retryablePreSend ? 'pre_send_rebuild' : 'manual_review'));`,
  "automatic recovery classifier",
);
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  `  nextAttempt: retryable ? jobAttempts + 1 : null,
  automaticVideoAttemptLimit,`,
  `  nextAttempt: retryable ? jobAttempts + 1 : null,
  automaticVideoAttemptLimit,
  automaticRecoveryAttemptLimit: retryableVideoQc ? automaticVideoAttemptLimit : jobMaxAttempts,
  automaticRecoveryKind,
  previewDeliveryErrors: previewErrors,`,
  "automatic recovery metadata",
);

const releaseLease = node("Release Video Lease");
releaseLease.parameters.jsCode = replaceOnce(
  releaseLease.parameters.jsCode,
  `let failure = {};
try {
  failure = $('Prepare Locked Offer Failure').first().json || {};
} catch (error) {
  failure = {};
}
const source = Object.keys(failure).length ? failure : input;`,
  `let failure = {};
let preparedFailurePresent = false;
try {
  failure = $('Prepare Locked Offer Failure').first().json || {};
  preparedFailurePresent = Object.keys(failure).length > 0;
} catch (error) {
  failure = {};
}
const source = preparedFailurePresent ? failure : input;`,
  "prepared failure source",
);
releaseLease.parameters.jsCode = replaceOnce(
  releaseLease.parameters.jsCode,
  `const previewDeliveryRejected = source.ok === false;
const shouldRetry = retryable || rateLimited || transientProviderFailure || previewDeliveryRejected;
const failed = !sent && !shouldRetry;`,
  `const previewDeliveryRejected = source.ok === false;
const currentAttempt = Math.max(1, Number(source.currentAttempt || config.jobAttempts || 1));
const jobMaxAttempts = Math.max(1, Number(config.jobMaxAttempts || 3));
const directRetryable =
  (rateLimited || transientProviderFailure || previewDeliveryRejected) &&
  currentAttempt < jobMaxAttempts;
const shouldRetry = preparedFailurePresent ? retryable : directRetryable;
const failed = !sent && !shouldRetry;`,
  "authoritative retry decision",
);
releaseLease.parameters.jsCode = replaceOnce(
  releaseLease.parameters.jsCode,
  `    automaticRetryPlanned: shouldRetry,
    currentAttempt: source.currentAttempt || config.jobAttempts || null,
    nextAttempt: source.nextAttempt || null,`,
  `    automaticRetryPlanned: shouldRetry,
    currentAttempt,
    nextAttempt: shouldRetry ? (source.nextAttempt || currentAttempt + 1) : null,
    automaticRecoveryKind: source.automaticRecoveryKind || (shouldRetry ? 'infrastructure_retry' : 'manual_review'),
    automaticRecoveryAttemptLimit: source.automaticRecoveryAttemptLimit || jobMaxAttempts,`,
  "release recovery metadata",
);

const finishJob = node("Supabase: Finish Preview Delivery Job");
finishJob.parameters.jsonBody = replaceOnce(
  finishJob.parameters.jsonBody,
  "automatic_retry_planned: $json.automaticRetryPlanned === true, current_attempt: $json.currentAttempt || null, next_attempt: $json.nextAttempt || null, automatic_video_attempt_limit: $json.automaticVideoAttemptLimit || 2,",
  "automatic_retry_planned: $json.automaticRetryPlanned === true, current_attempt: $json.currentAttempt || null, next_attempt: $json.nextAttempt || null, automatic_recovery_kind: $json.automaticRecoveryKind || null, automatic_recovery_attempt_limit: $json.automaticRecoveryAttemptLimit || null, automatic_video_attempt_limit: $json.automaticVideoAttemptLimit || 2,",
  "finish job recovery metadata",
);

const retryComment = node("Comment Automatic Video Retry");
retryComment.parameters.queryParameters.parameters[0].value =
  "=AUTOMATISCHER RECOVERY-VERSUCH\n\nGrund: {{ $('Prepare Locked Offer Failure').first().json.failureMessage }}\n\nDer Fehler ist als sicher wiederholbar eingestuft. Die Karte bleibt in der Verarbeitungsliste; es wurde noch keine Kundenmail versendet.\n\nRecovery: {{ $('Prepare Locked Offer Failure').first().json.automaticRecoveryKind }}\nNaechster Versuch: {{ $('Prepare Locked Offer Failure').first().json.nextAttempt }}/{{ $('Prepare Locked Offer Failure').first().json.automaticRecoveryAttemptLimit }}\nExecution: {{ $('Prepare Locked Offer Failure').first().json.executionId || '-' }}";

const providerRetryGate = {
  id: "provider-retry-available-if",
  name: "Provider Retry Available?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [2256, 1184],
  parameters: {
    conditions: {
      options: {
        version: 2,
        leftValue: "",
        caseSensitive: true,
        typeValidation: "strict",
      },
      conditions: [
        {
          id: "provider-retry-available",
          leftValue:
            "={{ Number($('Config').first().json.jobAttempts || 1) < Number($('Config').first().json.jobMaxAttempts || 3) }}",
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
};

const providerFallback = {
  id: "prepare-provider-offer-only-fallback",
  name: "Prepare Provider Offer-only Fallback",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2480, 1312],
  parameters: {
    jsCode: `const source = $input.first().json || {};
const config = $('Config').first().json || {};
return [{ json: {
  ...source,
  cardId: config.cardId,
  cardName: config.cardName || source.cardName || '',
  deliveryWithoutVideo: true,
  videoOmittedReason: 'video_provider_unavailable_after_retries',
  videoContentQcDecision: 'provider_unavailable',
  videoContentQcConfidence: null,
  automaticRecoveryKind: 'offer_without_video',
  customerCommunicationSent: false,
  recoveredAt: new Date().toISOString(),
} }];`,
  },
};

workflow.nodes.push(providerRetryGate, providerFallback);

const retryOutputs = [
  { node: "Notify Grok Rate Limit", type: "main", index: 0 },
  { node: "Release Video Lease", type: "main", index: 0 },
  { node: "Comment Provider Retry", type: "main", index: 0 },
];
workflow.connections["Grok Rate Limited?"].main[0] = [
  { node: "Provider Retry Available?", type: "main", index: 0 },
];
workflow.connections["Transient Video Provider Failure?"].main[0] = [
  { node: "Provider Retry Available?", type: "main", index: 0 },
];
workflow.connections["Provider Retry Available?"] = {
  main: [
    retryOutputs,
    [{ node: "Prepare Provider Offer-only Fallback", type: "main", index: 0 }],
  ],
};
workflow.connections["Prepare Provider Offer-only Fallback"] = {
  main: [[{ node: "Get Card Labels for Video QC", type: "main", index: 0 }]],
};

const successComment = node("Trello: Preview Success Comment");
successComment.parameters.queryParameters.parameters[0].value =
  "={{ $json.delivery_without_video === true ? '✅ **Angebot ohne KI-Video versendet**\\n\\n📧 An: ' + ($json.customer_email || 'keine E-Mail erkannt') + '\\n🔗 Angebot: ' + ($json.neontrip_offer_url || $json.preview_url) + '\\nℹ️ Grund: ' + ($json.video_omitted_reason || 'Video konnte nicht sicher verwendet werden') + '. Das Video wurde nicht an den Kunden ausgeliefert.\\n🏷 Label: Angebot gesendet\\n⏰ ' + new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '✅ **Angebot mit KI-Video versendet**\\n\\n📧 An: ' + ($json.customer_email || 'keine E-Mail erkannt') + '\\n🎬 Vorschau/Angebot: ' + ($json.neontrip_offer_url || $json.preview_url) + '\\n🏷 Labels: Video gesendet + Angebot gesendet\\n⏰ ' + new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) }}";

const names = new Set(workflow.nodes.map((entry) => entry.name));
for (const [source, outputs] of Object.entries(workflow.connections || {})) {
  if (!names.has(source)) throw new Error(`Connection source missing: ${source}`);
  for (const branch of outputs.main || []) {
    for (const target of branch || []) {
      if (!names.has(target.node)) {
        throw new Error(`Connection target missing: ${source} -> ${target.node}`);
      }
    }
  }
}

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
