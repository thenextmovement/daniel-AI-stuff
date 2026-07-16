import assert from "node:assert/strict";
import fs from "node:fs";

const [workflowPath] = process.argv.slice(2);
if (!workflowPath) {
  throw new Error(
    "Usage: node scripts/test_ki_video_auto_recovery_workflow.mjs <workflow.json>",
  );
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));

function byName(name) {
  const match = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(match, `Missing node: ${name}`);
  return match;
}

function runCode(name, globals) {
  const code = byName(name).parameters.jsCode;
  const keys = Object.keys(globals);
  return new Function(...keys, code)(...keys.map((key) => globals[key]));
}

function nodeAccessor(outputs) {
  return (name) => ({
    first() {
      if (!(name in outputs)) throw new Error(`Node not executed: ${name}`);
      return { json: outputs[name] };
    },
  });
}

const queueDispatchCode = byName("Prepare Queue Dispatch").parameters.jsCode;
assert.doesNotMatch(queueDispatchCode, /!\s*\/\^fehler/);
assert.match(queueDispatchCode, /hasSentLabel\(card\)/);
const queueDispatchResult = runCode("Prepare Queue Dispatch", {
  $input: {
    all: () => [
      {
        json: {
          id: "recoverable-card",
          name: "FEHLER - automatisch korrigierter Fall",
          idLabels: [],
          pos: 1024,
        },
      },
      {
        json: {
          id: "already-sent-card",
          name: "Bereits gesendet",
          idLabels: ["63d13d82858ce1c1b71045c0"],
          pos: 2048,
        },
      },
    ],
  },
})[0].json;
assert.equal(queueDispatchResult.eligibleCardCount, 1);
assert.equal(queueDispatchResult.jobs[0].trello_card_id, "recoverable-card");
assert.equal(queueDispatchResult.sentLabelSkippedCount, 1);

function parseQc(payload, attempt) {
  return runCode("Parse Video Content QC", {
    $input: { first: () => ({ json: { text: JSON.stringify(payload) } }) },
    $: nodeAccessor({ Config: { jobAttempts: attempt } }),
  })[0].json;
}

const firstEvidenceFailure = parseQc({
  approved: false,
  confidence: 0.95,
  issues: ["DESIGN_MORPH"],
  evidence: [{
    code: "DESIGN_MORPH",
    timestamps: [1.2],
    description: "The customer logo changes shape visibly.",
  }],
}, 1);
assert.equal(firstEvidenceFailure.videoContentQcFallbackWithoutVideo, false);
assert.equal(firstEvidenceFailure.failureType, "video_content_qc_failed");

const secondEvidenceFailure = parseQc({
  approved: false,
  confidence: 0.95,
  issues: ["DESIGN_MORPH"],
  evidence: [{
    code: "DESIGN_MORPH",
    timestamps: [1.2],
    description: "The customer logo changes shape visibly.",
  }],
}, 2);
assert.equal(secondEvidenceFailure.videoContentQcFallbackWithoutVideo, true);
assert.equal(
  secondEvidenceFailure.videoContentQcFallbackReason,
  "content_rejected_after_two_video_attempts",
);

const secondInconclusive = parseQc({
  approved: true,
  confidence: 0.5,
  issues: [],
  evidence: [],
}, 2);
assert.equal(secondInconclusive.videoContentQcFallbackWithoutVideo, true);
assert.equal(
  secondInconclusive.videoContentQcFallbackReason,
  "inconclusive_after_two_qc_attempts",
);

function watchdog(cardName, labels = []) {
  return runCode("Video Watchdog Gate", {
    $input: {
      first: () => ({
        json: {
          name: cardName,
          labels: labels.map((name) => ({ name })),
        },
      }),
    },
    $: nodeAccessor({
      Config: { cardId: "card-1", cardName },
      "Parse Video Content QC": {
        videoContentQcFallbackWithoutVideo: false,
      },
    }),
  })[0].json;
}

assert.equal(watchdog("FEHLER - automatisch erneut versuchen").videoQcOk, true);
assert.equal(watchdog("ANGEBOT NICHT SENDEN - Kunde wartet").videoQcOk, false);
assert.equal(watchdog("Normaler Titel", ["Video Design Abweichung Fehler"]).videoQcOk, false);

const providerWatchdog = runCode("Video Watchdog Gate", {
  $input: {
    first: () => ({
      json: { name: "FEHLER - Provider war nicht erreichbar", labels: [] },
    }),
  },
  $: nodeAccessor({
    Config: { cardId: "card-1", cardName: "Provider Test" },
    "Prepare Provider Offer-only Fallback": {
      deliveryWithoutVideo: true,
      videoOmittedReason: "video_provider_unavailable_after_retries",
      videoContentQcDecision: "provider_unavailable",
    },
  }),
})[0].json;
assert.equal(providerWatchdog.videoQcOk, true);
assert.equal(providerWatchdog.deliveryWithoutVideo, true);
assert.equal(
  providerWatchdog.videoOmittedReason,
  "video_provider_unavailable_after_retries",
);

function prepareFailure(input, attempt, maxAttempts = 3) {
  return runCode("Prepare Locked Offer Failure", {
    $input: { first: () => ({ json: input }) },
    $: nodeAccessor({
      Config: {
        cardId: "card-1",
        cardName: "Test Card",
        cardUrl: "https://trello.com/c/test",
        jobAttempts: attempt,
        jobMaxAttempts: maxAttempts,
      },
      "Check Reusable Trello Video": {},
    }),
    $execution: { id: "execution-1" },
  })[0].json;
}

const firstRateLimit = prepareFailure({ statusCode: 429, message: "Too many requests" }, 1);
assert.equal(firstRateLimit.retryable, true);
assert.equal(firstRateLimit.automaticRecoveryKind, "infrastructure_retry");
assert.equal(firstRateLimit.nextAttempt, 2);

const finalRateLimit = prepareFailure({ statusCode: 429, message: "Too many requests" }, 3);
assert.equal(finalRateLimit.retryable, false);
assert.equal(finalRateLimit.nextAttempt, null);

const transientOfferFailure = prepareFailure({
  statusCode: 503,
  message: "upstream connect error",
}, 1);
assert.equal(transientOfferFailure.retryable, true);
assert.equal(transientOfferFailure.failureType, "neontrip_offer_transient_failure");

const preSendBlocked = prepareFailure({
  ok: false,
  blocked: true,
  errors: ["preview_url_missing_or_invalid"],
}, 1);
assert.equal(preSendBlocked.retryable, true);
assert.equal(preSendBlocked.automaticRecoveryKind, "pre_send_rebuild");

const invalidRecipient = prepareFailure({
  ok: false,
  blocked: true,
  errors: ["customer_email_missing_or_invalid"],
}, 1);
assert.equal(invalidRecipient.retryable, false);
assert.equal(invalidRecipient.failureType, "preview_delivery_customer_data_invalid");

const sizeLadderFailure = prepareFailure({
  failureType: "size_ladder_technical_validation_failed",
  failureMessage: "larger but cheaper",
}, 1);
assert.equal(sizeLadderFailure.retryable, false);
assert.equal(sizeLadderFailure.automaticRecoveryKind, "manual_review");

function release(preparedFailure, attempt, maxAttempts = 3) {
  const staticData = { kiVideoLeaseCardId: "card-1" };
  return runCode("Release Video Lease", {
    $input: { first: () => ({ json: preparedFailure }) },
    $: nodeAccessor({
      Config: {
        cardId: "card-1",
        jobId: "job-1",
        jobAttempts: attempt,
        jobMaxAttempts: maxAttempts,
      },
      "Prepare Locked Offer Failure": preparedFailure,
      "Audit: Company Brain Offer Failure": {},
    }),
    $getWorkflowStaticData: () => staticData,
  })[0].json;
}

const retryRelease = release(firstRateLimit, 1);
assert.equal(retryRelease.previewDeliveryJobStatus, "retry");
assert.equal(retryRelease.automaticRetryPlanned, true);

const finalRelease = release(finalRateLimit, 3);
assert.equal(finalRelease.previewDeliveryJobStatus, "failed");
assert.equal(finalRelease.automaticRetryPlanned, false);

const providerFallback = runCode("Prepare Provider Offer-only Fallback", {
  $input: {
    first: () => ({
      json: {
        transientVideoProviderFailure: true,
        errorCode: "service_unavailable",
      },
    }),
  },
  $: nodeAccessor({
    Config: { cardId: "card-1", cardName: "Provider Test" },
  }),
})[0].json;
assert.equal(providerFallback.deliveryWithoutVideo, true);
assert.equal(
  providerFallback.videoOmittedReason,
  "video_provider_unavailable_after_retries",
);

assert.equal(
  workflow.connections["Grok Rate Limited?"].main[0][0].node,
  "Provider Retry Available?",
);
assert.equal(
  workflow.connections["Transient Video Provider Failure?"].main[0][0].node,
  "Provider Retry Available?",
);
assert.equal(
  workflow.connections["Provider Retry Available?"].main[1][0].node,
  "Prepare Provider Offer-only Fallback",
);
assert.equal(
  workflow.connections["Prepare Provider Offer-only Fallback"].main[0][0].node,
  "Get Card Labels for Video QC",
);
assert.equal(
  workflow.connections["Automatic Video Retry Available?"].main[0][0].node,
  "Comment Automatic Video Retry",
);
assert.equal(
  workflow.connections["Automatic Video Retry Available?"].main[1][0].node,
  "Move Locked Offer -> Quote Ready",
);

assert.match(
  byName("Fallback Reusable Video Exists?").parameters.conditions.conditions[0].leftValue,
  /Upload Video to Trello/,
);
assert.match(
  byName("Delete Reusable Video for Offer-only").parameters.url,
  /Upload Video to Trello/,
);
assert.match(
  byName("Comment Automatic Video Retry").parameters.queryParameters.parameters[0].value,
  /AUTOMATISCHER RECOVERY-VERSUCH/,
);
assert.match(
  byName("Supabase: Finish Preview Delivery Job").parameters.jsonBody,
  /automatic_recovery_kind/,
);

console.log("KI video automatic recovery workflow contract: PASS");
