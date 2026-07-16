import assert from "node:assert/strict";
import fs from "node:fs";

const [videoPath, deliveryPath] = process.argv.slice(2);
if (!videoPath || !deliveryPath) {
  throw new Error(
    "Usage: node scripts/test_ki_video_inconclusive_fallback_workflows.mjs <video-workflow.json> <delivery-workflow.json>",
  );
}

const videoWorkflow = JSON.parse(fs.readFileSync(videoPath, "utf8"));
const deliveryWorkflow = JSON.parse(fs.readFileSync(deliveryPath, "utf8"));

function byName(workflow, name) {
  const match = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(match, `Missing node: ${name}`);
  return match;
}

function runCode(workflow, name, globals) {
  const code = byName(workflow, name).parameters.jsCode;
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

function parseQc(payload, attempt) {
  return runCode(videoWorkflow, "Parse Video Content QC", {
    $input: { first: () => ({ json: { text: JSON.stringify(payload) } }) },
    $: nodeAccessor({ Config: { jobAttempts: attempt } }),
  })[0].json;
}

const strongApproval = parseQc({ approved: true, confidence: 0.92, issues: [], evidence: [] }, 1);
assert.equal(strongApproval.videoContentQcDecision, "pass");
assert.equal(strongApproval.videoContentQcOk, true);
assert.equal(strongApproval.videoContentQcFallbackWithoutVideo, false);

const firstInconclusive = parseQc({ approved: true, confidence: 0.5, issues: [], evidence: [] }, 1);
assert.equal(firstInconclusive.videoContentQcDecision, "inconclusive");
assert.equal(firstInconclusive.failureType, "video_content_qc_inconclusive");
assert.equal(firstInconclusive.videoContentQcFallbackWithoutVideo, false);

const secondInconclusive = parseQc({ approved: true, confidence: 0.6, issues: [], evidence: [] }, 2);
assert.equal(secondInconclusive.videoContentQcDecision, "inconclusive");
assert.equal(secondInconclusive.videoContentQcFallbackWithoutVideo, true);

const evidenceBackedFailure = parseQc({
  approved: false,
  confidence: 0.95,
  issues: ["DESIGN_MORPH"],
  evidence: [{ code: "DESIGN_MORPH", timestamps: [1.2, 2.8], description: "The customer logo changes shape visibly." }],
}, 2);
assert.equal(evidenceBackedFailure.videoContentQcDecision, "reject");
assert.equal(evidenceBackedFailure.videoContentQcFallbackWithoutVideo, true);
assert.equal(
  evidenceBackedFailure.videoContentQcFallbackReason,
  "content_rejected_after_two_video_attempts",
);
assert.equal(evidenceBackedFailure.failureType, "video_content_qc_failed");

const unsupportedRejection = parseQc({
  approved: false,
  confidence: 0.8,
  issues: ["COLOR_SHIFT"],
  evidence: [],
}, 2);
assert.equal(unsupportedRejection.videoContentQcDecision, "inconclusive");
assert.equal(unsupportedRejection.videoContentQcFallbackWithoutVideo, true);

const unavailable = runCode(videoWorkflow, "Parse Video Content QC", {
  $input: { first: () => ({ json: { text: "not-json" } }) },
  $: nodeAccessor({ Config: { jobAttempts: 2 } }),
})[0].json;
assert.equal(unavailable.failureType, "video_content_qc_unavailable");
assert.equal(unavailable.videoContentQcFallbackWithoutVideo, true);

assert.equal(
  videoWorkflow.connections["Video Content QC Passed?"].main[1][0].node,
  "Send Offer Without Video After QC?",
);
assert.equal(
  videoWorkflow.connections["Send Offer Without Video After QC?"].main[0][0].node,
  "Fallback Reusable Video Exists?",
);
assert.equal(
  videoWorkflow.connections["Send Offer Without Video After QC?"].main[1][0].node,
  "Rejected Reusable Video?",
);
assert.equal(
  videoWorkflow.connections["Fallback Reusable Video Exists?"].main[0][0].node,
  "Delete Reusable Video for Offer-only",
);
assert.equal(
  videoWorkflow.connections["Fallback Reusable Video Exists?"].main[1][0].node,
  "Get Card Labels for Video QC",
);
assert.equal(
  videoWorkflow.connections["Delete Reusable Video for Offer-only"].main[0][0].node,
  "Get Card Labels for Video QC",
);
assert.equal(
  videoWorkflow.connections["Video Watchdog Passed?"].main[0][0].node,
  "Prepare Offer Delivery Mode",
);
assert.equal(
  videoWorkflow.connections["Preview Delivery OK?"].main[0][0].node,
  "Video Included in Delivery?",
);
assert.equal(
  videoWorkflow.connections["Video Included in Delivery?"].main[1][0].node,
  "Skip Video gesendet Label",
);

const fallbackPayload = runCode(videoWorkflow, "Build Preview Delivery Payload", {
  $input: { first: () => ({ json: {} }) },
  $: nodeAccessor({
    "Validate Preview Quote": {
      requestId: "request-1",
      firstName: "Anna",
      lastName: "Test",
      email: "anna@example.com",
      phone: "+4915112345678",
      country: "DE",
      cardId: "card-1",
      cardName: "Test Angebot",
    },
    "Create NEONTRIP Offer": {
      publicUrl: "https://angebote.neontrip.de/offer/public-token",
      emailThumbnailUrl: "https://angebote.neontrip.de/api/public/image/mockup-ai-1.jpg",
      offerId: "offer-1",
      offerNumber: "A/N 1",
    },
    "Prepare Offer Delivery Mode": {
      deliveryWithoutVideo: true,
      videoOmittedReason: "inconclusive_after_two_qc_attempts",
      videoContentQcDecision: "inconclusive",
      videoContentQcConfidence: 0.6,
    },
    "Find Mockup": {
      selectedMockupAttachmentId: "attachment-1",
      selectedMockupFileName: "Mockup_AI_1.jpg",
    },
    Config: { jobId: "job-1", deliveryCycleKey: "cycle-1", regenerateOnly: false },
  }),
})[0].json;
assert.equal(fallbackPayload.delivery_without_video, true);
assert.equal(fallbackPayload.delivery_mode, "send_offer_without_video");
assert.equal(fallbackPayload.video_url, "");
assert.equal(fallbackPayload.trello_video_attachment_id, "");
assert.equal(fallbackPayload.video_hosting_status, "omitted_after_inconclusive_qc");

const normalPayload = runCode(videoWorkflow, "Build Preview Delivery Payload", {
  $input: { first: () => ({ json: {} }) },
  $: nodeAccessor({
    "Validate Preview Quote": {
      requestId: "request-2",
      firstName: "Ben",
      lastName: "Test",
      email: "ben@example.com",
      phone: "+4915112345679",
      country: "DE",
      cardId: "card-2",
      cardName: "Normal Video Angebot",
    },
    "Create NEONTRIP Offer": {
      publicUrl: "https://angebote.neontrip.de/offer/public-token-2",
      emailThumbnailUrl: "https://angebote.neontrip.de/api/public/image/mockup-ai-2.jpg",
      offerId: "offer-2",
      offerNumber: "A/N 2",
    },
    "Prepare Offer Delivery Mode": { deliveryWithoutVideo: false },
    "Find Mockup": {
      selectedMockupAttachmentId: "attachment-2",
      selectedMockupFileName: "Mockup_AI_2.jpg",
    },
    "Upload Video to Trello": { id: "video-attachment-2", fileName: "Mockup01_video.mp4" },
    "Upload Video to Supabase Storage": {},
    "Download Video": { videoUrl: "https://provider.example/video-2.mp4" },
    Config: { jobId: "job-2", deliveryCycleKey: "cycle-2", regenerateOnly: false },
  }),
})[0].json;
assert.equal(normalPayload.delivery_without_video, false);
assert.equal(normalPayload.delivery_mode, "send_preview_email");
assert.match(normalPayload.video_url, /preview-videos\/request-2\/Mockup01_video\.mp4/);
assert.equal(normalPayload.trello_video_attachment_id, "video-attachment-2");

function validateDelivery(body) {
  return runCode(deliveryWorkflow, "Validate Preview Payload", {
    $json: { body },
    URL,
  })[0].json;
}

const validatedFallback = validateDelivery({
  customer_name: "Anna",
  customer_email: "anna@example.com",
  pandadoc_customer_link: "https://angebote.neontrip.de/offer/public-token",
  preview_url: "https://angebote.neontrip.de/offer/public-token",
  thumb_url: "https://angebote.neontrip.de/api/public/image/mockup-ai-1.jpg",
  delivery_without_video: true,
  delivery_mode: "send_offer_without_video",
});
assert.equal(validatedFallback.ok, true);
assert.equal(validatedFallback.delivery_without_video, true);
assert.equal(validatedFallback.video_url, "");

const invalidNormal = validateDelivery({
  customer_name: "Anna",
  customer_email: "anna@example.com",
  pandadoc_customer_link: "https://angebote.neontrip.de/offer/public-token",
  preview_url: "https://angebote.neontrip.de/offer/public-token",
});
assert.equal(invalidNormal.ok, false);
assert.ok(invalidNormal.errors.includes("video_url_missing_or_invalid"));

const validatedNormal = validateDelivery({
  customer_name: "Ben",
  customer_email: "ben@example.com",
  pandadoc_customer_link: "https://angebote.neontrip.de/offer/public-token-2",
  preview_url: "https://video.neontrip.de/v/demo/?offer=https%3A%2F%2Fangebote.neontrip.de%2Foffer%2Fpublic-token-2&video=https%3A%2F%2Fvideo.neontrip.de%2Fmedia%2Fvideo%3FcardId%3Dcard-2",
  video_url: "https://video.neontrip.de/media/video?cardId=card-2",
  thumb_url: "https://angebote.neontrip.de/api/public/image/mockup-ai-2.jpg",
  delivery_mode: "send_preview_email",
});
assert.equal(validatedNormal.ok, true);
assert.equal(validatedNormal.delivery_without_video, false);

const fallbackEmail = runCode(deliveryWorkflow, "Build Test Email", {
  $json: { statusCode: 200 },
  $: nodeAccessor({ "Validate Preview Payload": validatedFallback }),
})[0].json;
assert.equal(fallbackEmail.subject, "Ihr NEONTRIP-Angebot ist fertig");
assert.doesNotMatch(fallbackEmail.html, /Video-Vorschau ansehen/);
assert.doesNotMatch(fallbackEmail.html, /kurze Video-Vorschau/);
assert.match(fallbackEmail.html, /Angebot ansehen/);
assert.match(fallbackEmail.html, /Fabienne Trapp/);

const normalEmail = runCode(deliveryWorkflow, "Build Test Email", {
  $json: { statusCode: 200 },
  $: nodeAccessor({ "Validate Preview Payload": validatedNormal }),
})[0].json;
assert.equal(normalEmail.subject, "Ihr NEONTRIP-Angebot mit Vorschau");
assert.match(normalEmail.html, /Video-Vorschau ansehen/);
assert.match(normalEmail.html, /kurze Video-Vorschau/);

const successCode = byName(deliveryWorkflow, "Success Response").parameters.jsCode;
assert.match(successCode, /delivery_without_video/);
assert.match(successCode, /video_omitted_reason/);

const createBody = byName(videoWorkflow, "Create NEONTRIP Offer").parameters.jsonBody;
assert.match(createBody, /deliveryWithoutVideo === true \? ''/);

const successComment = JSON.stringify(byName(videoWorkflow, "Trello: Preview Success Comment").parameters);
assert.match(successComment, /Angebot ohne KI-Video versendet/);
assert.match(successComment, /Video gesendet \+ Angebot gesendet/);

console.log("KI video inconclusive-QC no-video fallback contracts: PASS");
