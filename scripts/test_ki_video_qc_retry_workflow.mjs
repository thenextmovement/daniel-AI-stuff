import assert from "node:assert/strict";
import fs from "node:fs";

const [workflowPath] = process.argv.slice(2);
if (!workflowPath) {
  throw new Error("Usage: node scripts/test_ki_video_qc_retry_workflow.mjs <workflow.json>");
}

const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const byName = new Map(workflow.nodes.map((entry) => [entry.name, entry]));

function node(name) {
  const match = byName.get(name);
  assert.ok(match, `Missing node: ${name}`);
  return match;
}

function runCode(name, globals) {
  const code = node(name).parameters.jsCode;
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

const staticData = {};
const configResult = runCode("Config", {
  $input: { first: () => ({ json: { job: {
    id: "job-1",
    status: "leased",
    attempts: 1,
    max_attempts: 3,
    trello_card_id: "card-1",
    card_name: "Test Card",
    trello_card_url: "https://trello.com/c/test",
    source_list_id: "source-list",
  } } }) },
  $getWorkflowStaticData: () => staticData,
  console,
});
assert.equal(configResult[0].json.jobAttempts, 1);
assert.equal(configResult[0].json.jobMaxAttempts, 3);

function prepareFailure(attempt, failureType = "video_content_qc_failed") {
  return runCode("Prepare Locked Offer Failure", {
    $input: { first: () => ({ json: {
      failureType,
      failureMessage: "Video QC rejected",
      videoContentQcIssues: ["DESIGN_MORPH"],
      videoContentQcConfidence: 0.75,
    } }) },
    $: nodeAccessor({
      Config: { ...configResult[0].json, jobAttempts: attempt },
      "Check Reusable Trello Video": { videoGenerationFingerprint: "card-1:mockup-1" },
    }),
    $execution: { id: "execution-1" },
  })[0].json;
}

const firstFailure = prepareFailure(1);
assert.equal(firstFailure.retryable, true);
assert.equal(firstFailure.currentAttempt, 1);
assert.equal(firstFailure.nextAttempt, 2);
assert.deepEqual(firstFailure.videoQcIssues, ["DESIGN_MORPH"]);
assert.equal(firstFailure.videoGenerationFingerprint, "card-1:mockup-1");

const secondFailure = prepareFailure(2);
assert.equal(secondFailure.retryable, false);
assert.equal(secondFailure.nextAttempt, null);

const nonVideoFailure = prepareFailure(1, "neontrip_offer_failed");
assert.equal(nonVideoFailure.retryable, false);

function release(failure) {
  const releaseStaticData = {
    kiVideoLeaseCardId: "card-1",
    kiVideoLeaseUntil: "future",
  };
  return runCode("Release Video Lease", {
    $input: { first: () => ({ json: { trelloComment: true } }) },
    $: nodeAccessor({
      Config: { ...configResult[0].json, jobAttempts: failure.currentAttempt },
      "Prepare Locked Offer Failure": failure,
      "Audit: Company Brain Offer Failure": {},
    }),
    $getWorkflowStaticData: () => releaseStaticData,
  })[0].json;
}

const retryRelease = release(firstFailure);
assert.equal(retryRelease.previewDeliveryJobStatus, "retry");
assert.equal(retryRelease.previewDeliveryJobErrorCode, "video_content_qc_failed");
assert.equal(retryRelease.automaticRetryPlanned, true);
assert.equal(retryRelease.auditWriteOk, true);

const finalRelease = release(secondFailure);
assert.equal(finalRelease.previewDeliveryJobStatus, "failed");
assert.equal(finalRelease.previewDeliveryJobErrorCode, "video_content_qc_failed");
assert.equal(finalRelease.automaticRetryPlanned, false);

assert.equal(
  workflow.connections["Audit: Company Brain Offer Failure"].main[0][0].node,
  "Automatic Video Retry Available?",
);
assert.equal(
  workflow.connections["Automatic Video Retry Available?"].main[0][0].node,
  "Comment Automatic Video Retry",
);
assert.equal(
  workflow.connections["Automatic Video Retry Available?"].main[1][0].node,
  "Move Locked Offer -> Quote Ready",
);

const auditBody = node("Audit: Company Brain Offer Failure").parameters.jsonBody;
assert.match(auditBody, /status: 'error'/);
assert.match(auditBody, /automation_issue_key: failureType/);
assert.match(auditBody, /retry_safety: failure\.retryable \? 'automatic_retry_once' : 'blocked'/);

const finishBody = node("Supabase: Finish Preview Delivery Job").parameters.jsonBody;
assert.match(finishBody, /video_generation_fingerprint/);
assert.match(finishBody, /company_brain_audit_write_ok/);

console.log("KI video QC retry workflow contract: PASS");
