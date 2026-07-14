import fs from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/build_ki_video_qc_retry_workflow.mjs <input.json> <output.json>");
}

const workflow = JSON.parse(fs.readFileSync(inputPath, "utf8"));

function node(name) {
  const match = workflow.nodes.find((entry) => entry.name === name);
  if (!match) throw new Error(`Required n8n node missing: ${name}`);
  return match;
}

function replaceOnce(value, search, replacement, label) {
  if (!value.includes(search)) throw new Error(`Expected ${label} source fragment missing`);
  if (value.indexOf(search) !== value.lastIndexOf(search)) throw new Error(`Expected one ${label} source fragment`);
  return value.replace(search, replacement);
}

if (workflow.nodes.some((entry) => entry.name === "Automatic Video Retry Available?")) {
  throw new Error("Workflow already contains the automatic video retry patch");
}

const config = node("Config");
config.parameters.jsCode = replaceOnce(
  config.parameters.jsCode,
  "  jobAttempts: job.attempts || 0,",
  "  jobAttempts: job.attempts || 0,\n  jobMaxAttempts: job.max_attempts || 3,",
  "Config job attempts",
);

const prepareFailure = node("Prepare Locked Offer Failure");
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  "const config = $('Config').first().json;",
  "const config = $('Config').first().json;\nconst jobAttempts = Math.max(1, Number(config.jobAttempts || 1));\nconst automaticVideoAttemptLimit = 2;",
  "failure queue context",
);
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  "return [{ json: {",
  `const videoQcFailure = failureType === 'video_content_qc_failed' || failureType === 'video_content_qc_unavailable';
const retryable = videoQcFailure && jobAttempts < automaticVideoAttemptLimit;
const videoQcIssues = Array.isArray(input.videoContentQcIssues) ? input.videoContentQcIssues : [];
const videoQcConfidence = Number.isFinite(Number(input.videoContentQcConfidence))
  ? Number(input.videoContentQcConfidence)
  : null;
let videoGenerationFingerprint = null;
try {
  videoGenerationFingerprint = $('Check Reusable Trello Video').first().json.videoGenerationFingerprint || null;
} catch (error) {
  videoGenerationFingerprint = null;
}

return [{ json: {`,
  "failure retry policy",
);
prepareFailure.parameters.jsCode = replaceOnce(
  prepareFailure.parameters.jsCode,
  "  rawError: serialized.slice(0, 1500),\n  handledAt: new Date().toISOString()",
  `  rawError: serialized.slice(0, 1500),
  retryable,
  automaticRetryPlanned: retryable,
  currentAttempt: jobAttempts,
  nextAttempt: retryable ? jobAttempts + 1 : null,
  automaticVideoAttemptLimit,
  videoQcIssues,
  videoQcConfidence,
  videoGenerationFingerprint,
  customerCommunicationSent: false,
  handledAt: new Date().toISOString()`,
  "failure output metadata",
);

const audit = node("Audit: Company Brain Offer Failure");
audit.parameters.jsonBody = replaceOnce(
  audit.parameters.jsonBody,
  "const failedNode = failureType.includes('locked') || failureType.includes('rate_limited') ? 'Create NEONTRIP Offer' : 'Preview Delivery OK?';",
  "const failedNode = failureType.startsWith('video_content_qc_') ? 'Analyze Video Content QC' : (failureType.includes('locked') || failureType.includes('rate_limited') ? 'Create NEONTRIP Offer' : 'Preview Delivery OK?');",
  "audit failed node",
);
audit.parameters.jsonBody = replaceOnce(
  audit.parameters.jsonBody,
  "    status: 'failed',",
  "    status: 'error',",
  "audit database status",
);
audit.parameters.jsonBody = replaceOnce(
  audit.parameters.jsonBody,
  "      retry_safety: 'blocked',",
  "      retry_safety: failure.retryable ? 'automatic_retry_once' : 'blocked',",
  "audit retry safety",
);
audit.parameters.jsonBody = replaceOnce(
  audit.parameters.jsonBody,
  "      failure_type: failureType,\n      raw_error: failure.rawError || null,",
  `      failure_type: failureType,
      automation_issue_key: failureType,
      retry_planned: failure.retryable === true,
      current_attempt: failure.currentAttempt || null,
      next_attempt: failure.nextAttempt || null,
      automatic_video_attempt_limit: failure.automaticVideoAttemptLimit || 2,
      video_qc_issues: failure.videoQcIssues || [],
      video_qc_confidence: failure.videoQcConfidence ?? null,
      video_generation_fingerprint: failure.videoGenerationFingerprint || null,
      customer_communication_sent: false,
      raw_error: failure.rawError || null,`,
  "audit video metadata",
);

const releaseLease = node("Release Video Lease");
releaseLease.parameters.jsCode = `const staticData = $getWorkflowStaticData('global');
const config = $('Config').first().json;
const input = $input.first().json || {};
let failure = {};
try {
  failure = $('Prepare Locked Offer Failure').first().json || {};
} catch (error) {
  failure = {};
}
const source = Object.keys(failure).length ? failure : input;
const currentLeaseCardId = staticData.kiVideoLeaseCardId || '';
const shouldRelease = !currentLeaseCardId || currentLeaseCardId === config.cardId;

if (shouldRelease) {
  staticData.kiVideoLeaseUntil = null;
  staticData.kiVideoLeaseCardId = null;
  staticData.kiVideoLeaseCardName = null;
  staticData.kiVideoLeaseAcquiredAt = null;
}

let sent = false;
try {
  sent = $('Preview Delivery OK?').first().json.ok === true;
} catch (error) {
  sent = false;
}

let auditWriteOk = null;
let auditWriteError = null;
try {
  const auditResult = $('Audit: Company Brain Offer Failure').first().json || {};
  auditWriteOk = !auditResult.error;
  auditWriteError = auditResult.error ? JSON.stringify(auditResult.error).slice(0, 1000) : null;
} catch (error) {
  auditWriteOk = null;
}

const serialized = JSON.stringify(source).slice(0, 4000);
const retryable = source.retryable === true;
const rateLimited = source.rateLimited === true || /\\b429\\b|rate limit|too many requests/i.test(serialized);
const previewDeliveryRejected = source.ok === false;
const failed = !sent && !retryable && !rateLimited && !previewDeliveryRejected;
const jobStatus = sent ? 'sent' : (retryable || rateLimited || previewDeliveryRejected ? 'retry' : 'failed');
const errorCode = sent ? null : (
  source.failureType ||
  source.failureCode ||
  source.errorCode ||
  (rateLimited ? 'rate_limited' : (previewDeliveryRejected ? 'preview_delivery_rejected' : 'preview_delivery_failed'))
);
const errorMessage = sent ? null : (
  source.failureMessage ||
  source.errorMessage ||
  source.mockupError ||
  source.reason ||
  serialized.slice(0, 1000) ||
  'Preview delivery did not complete successfully'
);

return [{ json: {
  leaseReleased: shouldRelease,
  releasedCardId: config.cardId,
  previousLeaseCardId: currentLeaseCardId || null,
  releasedAt: new Date().toISOString(),
  jobId: config.jobId || null,
  previewDeliveryJobStatus: jobStatus,
  previewDeliveryJobErrorCode: errorCode,
  previewDeliveryJobErrorMessage: errorMessage,
  previewDeliveryJobFailed: failed,
  automaticRetryPlanned: retryable,
  currentAttempt: source.currentAttempt || config.jobAttempts || null,
  nextAttempt: source.nextAttempt || null,
  automaticVideoAttemptLimit: source.automaticVideoAttemptLimit || 2,
  videoQcIssues: source.videoQcIssues || [],
  videoQcConfidence: source.videoQcConfidence ?? null,
  videoGenerationFingerprint: source.videoGenerationFingerprint || null,
  auditWriteOk,
  auditWriteError,
} }];`;

const finishJob = node("Supabase: Finish Preview Delivery Job");
finishJob.parameters.jsonBody = replaceOnce(
  finishJob.parameters.jsonBody,
  "p_metadata: { released_at: $json.releasedAt, released_card_id: $json.releasedCardId, lease_released: $json.leaseReleased === true }",
  "p_metadata: { released_at: $json.releasedAt, released_card_id: $json.releasedCardId, lease_released: $json.leaseReleased === true, automatic_retry_planned: $json.automaticRetryPlanned === true, current_attempt: $json.currentAttempt || null, next_attempt: $json.nextAttempt || null, automatic_video_attempt_limit: $json.automaticVideoAttemptLimit || 2, video_qc_issues: $json.videoQcIssues || [], video_qc_confidence: $json.videoQcConfidence ?? null, video_generation_fingerprint: $json.videoGenerationFingerprint || null, company_brain_audit_write_ok: $json.auditWriteOk, company_brain_audit_write_error: $json.auditWriteError || null }",
  "finish job metadata",
);

const retryGate = {
  id: "automatic-video-retry-available-if",
  name: "Automatic Video Retry Available?",
  type: "n8n-nodes-base.if",
  typeVersion: 2.3,
  position: [4048, 680],
  parameters: {
    conditions: {
      options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
      conditions: [{
        id: "automatic-video-retry-available",
        leftValue: "={{ $('Prepare Locked Offer Failure').first().json.retryable === true }}",
        rightValue: true,
        operator: { type: "boolean", operation: "equals" },
      }],
      combinator: "and",
    },
    options: {},
  },
};

const finalComment = node("Comment Offer Not Sent");
const retryComment = JSON.parse(JSON.stringify(finalComment));
retryComment.id = "comment-automatic-video-retry";
retryComment.name = "Comment Automatic Video Retry";
retryComment.position = [4272, 680];
retryComment.parameters.queryParameters.parameters = [{
  name: "text",
  value: "=AUTOMATISCHER VIDEO-RETRY\n\nGrund: {{ $('Prepare Locked Offer Failure').first().json.failureMessage }}\n\nEin zweiter und letzter Video-Versuch wird nach kurzem Backoff automatisch gestartet. Die Karte bleibt in der Verarbeitungsliste. Es wurde noch keine Kundenmail versendet.\n\nNaechster Versuch: {{ $('Prepare Locked Offer Failure').first().json.nextAttempt }}/{{ $('Prepare Locked Offer Failure').first().json.automaticVideoAttemptLimit }}\nExecution: {{ $('Prepare Locked Offer Failure').first().json.executionId || '-' }}",
}];

workflow.nodes.push(retryGate, retryComment);
workflow.connections["Audit: Company Brain Offer Failure"] = {
  main: [[{ node: "Automatic Video Retry Available?", type: "main", index: 0 }]],
};
workflow.connections["Automatic Video Retry Available?"] = {
  main: [
    [{ node: "Comment Automatic Video Retry", type: "main", index: 0 }],
    [{ node: "Move Locked Offer -> Quote Ready", type: "main", index: 0 }],
  ],
};
workflow.connections["Comment Automatic Video Retry"] = {
  main: [[{ node: "Release Video Lease", type: "main", index: 0 }]],
};

const names = new Set(workflow.nodes.map((entry) => entry.name));
for (const [source, outputs] of Object.entries(workflow.connections)) {
  if (!names.has(source)) throw new Error(`Connection source missing: ${source}`);
  for (const branch of outputs.main || []) {
    for (const target of branch || []) {
      if (!names.has(target.node)) throw new Error(`Connection target missing: ${source} -> ${target.node}`);
    }
  }
}

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
