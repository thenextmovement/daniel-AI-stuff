import fs from "node:fs";

const [videoInputPath, videoOutputPath, deliveryInputPath, deliveryOutputPath] = process.argv.slice(2);
if (!videoInputPath || !videoOutputPath || !deliveryInputPath || !deliveryOutputPath) {
  throw new Error(
    "Usage: node scripts/build_ki_video_inconclusive_fallback_workflows.mjs " +
      "<video-input.json> <video-output.json> <delivery-input.json> <delivery-output.json>",
  );
}

function readWorkflow(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function workflowNode(workflow, name) {
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

function validateConnections(workflow) {
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
}

function patchVideoWorkflow(workflow) {
  if (workflow.nodes.some((entry) => entry.name === "Send Offer Without Video After QC?")) {
    throw new Error("Video workflow already contains the inconclusive-QC fallback patch");
  }

  const parseQc = workflowNode(workflow, "Parse Video Content QC");
  parseQc.parameters.jsCode = `const input = $input.first().json || {};
const candidates = [
  input?.content?.parts?.[0]?.text,
  input?.text,
  input?.output,
  input?.response,
].filter((value) => typeof value === 'string' && value.trim());

let parsed = null;
let parseError = '';
for (const candidate of candidates) {
  const cleaned = candidate.trim()
    .replace(/^\`\`\`(?:json)?\\s*/i, '')
    .replace(/\\s*\`\`\`$/i, '');
  try {
    parsed = JSON.parse(cleaned);
    break;
  } catch (error) {
    parseError = String(error?.message || error);
  }
}

const allowedIssues = new Set([
  'DESIGN_MORPH',
  'COLOR_SHIFT',
  'INVENTED_TEXT',
  'INVENTED_OBJECT',
  'UNWANTED_BRANDING',
  'SIGN_DISAPPEARS',
  'FLOATING_SIGN',
  'BAD_CROP',
  'OTHER',
]);
const confidence = Number(parsed?.confidence);
const issues = Array.isArray(parsed?.issues)
  ? [...new Set(parsed.issues.map((issue) => String(issue || '').trim().toUpperCase()).filter((issue) => allowedIssues.has(issue)))]
  : [];
const evidence = Array.isArray(parsed?.evidence)
  ? parsed.evidence.map((entry) => {
      const code = String(entry?.code || '').trim().toUpperCase();
      const timestamps = Array.isArray(entry?.timestamps)
        ? [...new Set(entry.timestamps.map(Number).filter((value) => Number.isFinite(value) && value >= 0 && value <= 30))].sort((a, b) => a - b).slice(0, 6)
        : [];
      return {
        code,
        timestamps,
        description: String(entry?.description || '').trim().slice(0, 300),
      };
    }).filter((entry) => allowedIssues.has(entry.code) && entry.description.length >= 12 && entry.timestamps.length > 0)
  : [];
const issueEvidence = evidence.filter((entry) => issues.includes(entry.code));
const structurallyValid =
  parsed &&
  typeof parsed.approved === 'boolean' &&
  Number.isFinite(confidence) &&
  confidence >= 0 &&
  confidence <= 1 &&
  Array.isArray(parsed.issues);

let jobAttempts = 1;
try {
  jobAttempts = Math.max(1, Number($('Config').first().json.jobAttempts || 1));
} catch (error) {
  jobAttempts = 1;
}

const normalApproval =
  structurallyValid &&
  parsed.approved === true &&
  confidence >= 0.7 &&
  issues.length === 0;
const evidenceBackedRejection =
  structurallyValid &&
  parsed.approved === false &&
  issues.length > 0 &&
  issueEvidence.length > 0;
const inconclusive = !normalApproval && !evidenceBackedRejection;
const fallbackWithoutVideo = inconclusive && jobAttempts >= 2;
const decision = normalApproval ? 'pass' : (evidenceBackedRejection ? 'reject' : 'inconclusive');
const videoContentQcOk = normalApproval;

const evidenceText = issueEvidence.length > 0
  ? issueEvidence.map((entry) => entry.code + '@' + entry.timestamps.join('/')).join(', ')
  : 'kein konkreter Zeitbeleg';
const issueText = issues.length > 0 ? issues.join(', ') : 'keine belegte Inhaltsabweichung';
const failureType = evidenceBackedRejection
  ? 'video_content_qc_failed'
  : (structurallyValid ? 'video_content_qc_inconclusive' : 'video_content_qc_unavailable');
const failureMessage = evidenceBackedRejection
  ? 'KI-Video hat die Inhaltspruefung nicht bestanden (' + issueText + '; ' + evidenceText + '). Versand wurde gestoppt.'
  : (fallbackWithoutVideo
    ? 'KI-Video konnte auch im zweiten Versuch nicht eindeutig freigegeben werden. Das Angebot wird ohne dieses Video versendet.'
    : 'KI-Video konnte nicht eindeutig geprueft werden. Ein zweiter, statischer Video-Versuch wird gestartet.');

return [{ json: {
  videoContentQcOk,
  videoContentQcDecision: decision,
  videoContentQcInconclusive: inconclusive,
  videoContentQcFallbackWithoutVideo: fallbackWithoutVideo,
  videoContentQcApproved: structurallyValid ? parsed.approved : false,
  videoContentQcConfidence: Number.isFinite(confidence) ? confidence : null,
  videoContentQcIssues: issues,
  videoContentQcEvidence: evidence,
  videoContentQcEvidenceBackedRejection: evidenceBackedRejection,
  videoContentQcRaw: candidates[0] ? String(candidates[0]).slice(0, 2000) : '',
  failureType: videoContentQcOk ? null : failureType,
  failureMessage: videoContentQcOk ? null : failureMessage,
  videoContentQcParseError: structurallyValid ? '' : parseError.slice(0, 300),
  checkedAt: new Date().toISOString(),
} }];`;

  const prepareFailure = workflowNode(workflow, "Prepare Locked Offer Failure");
  prepareFailure.parameters.jsCode = replaceOnce(
    prepareFailure.parameters.jsCode,
    "const videoQcFailure = failureType === 'video_content_qc_failed' || failureType === 'video_content_qc_unavailable';",
    "const videoQcFailure = failureType === 'video_content_qc_failed' || failureType === 'video_content_qc_unavailable' || failureType === 'video_content_qc_inconclusive';",
    "retryable video QC failure types",
  );

  const watchdog = workflowNode(workflow, "Video Watchdog Gate");
  watchdog.parameters.jsCode = replaceOnce(
    watchdog.parameters.jsCode,
    "const titleBlocked = /^\\s*(?:❌\\s*)?(?:fehler|error)\\b/i.test(String(card.name || config.cardName || ''));",
    `const titleBlocked = /^\\s*(?:❌\\s*)?(?:fehler|error)\\b/i.test(String(card.name || config.cardName || ''));
let deliveryWithoutVideo = false;
let videoOmittedReason = '';
let videoQcDecision = '';
let videoQcConfidence = null;
try {
  const parsedQc = $('Parse Video Content QC').first().json || {};
  deliveryWithoutVideo = parsedQc.videoContentQcFallbackWithoutVideo === true;
  videoOmittedReason = deliveryWithoutVideo ? 'inconclusive_after_two_qc_attempts' : '';
  videoQcDecision = String(parsedQc.videoContentQcDecision || '');
  videoQcConfidence = Number.isFinite(Number(parsedQc.videoContentQcConfidence))
    ? Number(parsedQc.videoContentQcConfidence)
    : null;
} catch (error) {
  deliveryWithoutVideo = false;
}`,
    "watchdog delivery mode",
  );
  watchdog.parameters.jsCode = replaceOnce(
    watchdog.parameters.jsCode,
    "  videoQcTitleBlocked: titleBlocked,",
    `  videoQcTitleBlocked: titleBlocked,
  deliveryWithoutVideo,
  videoOmittedReason,
  videoContentQcDecision: videoQcDecision,
  videoContentQcConfidence: videoQcConfidence,`,
    "watchdog fallback output",
  );

  const createOffer = workflowNode(workflow, "Create NEONTRIP Offer");
  createOffer.parameters.jsonBody = replaceOnce(
    createOffer.parameters.jsonBody,
    "  previewVideoUrl: 'https://klibiejfisijpagzkxls.supabase.co/storage/v1/object/public/product-images/preview-videos/' + encodeURIComponent($('Validate Preview Quote').first().json.requestId) + '/Mockup01_video.mp4',",
    "  previewVideoUrl: $json.deliveryWithoutVideo === true ? '' : ('https://klibiejfisijpagzkxls.supabase.co/storage/v1/object/public/product-images/preview-videos/' + encodeURIComponent($('Validate Preview Quote').first().json.requestId) + '/Mockup01_video.mp4'),",
    "offer video URL",
  );
  createOffer.parameters.jsonBody = replaceOnce(
    createOffer.parameters.jsonBody,
    "  previewVideoPosterUrl: 'https://video.neontrip.de/media/image?cardId=' + encodeURIComponent($('Config').first().json.cardId) + '&attachmentId=' + encodeURIComponent($('Find Mockup').first().json.selectedMockupAttachmentId) + '&fileName=' + encodeURIComponent($('Find Mockup').first().json.selectedMockupFileName),",
    "  previewVideoPosterUrl: $json.deliveryWithoutVideo === true ? '' : ('https://video.neontrip.de/media/image?cardId=' + encodeURIComponent($('Config').first().json.cardId) + '&attachmentId=' + encodeURIComponent($('Find Mockup').first().json.selectedMockupAttachmentId) + '&fileName=' + encodeURIComponent($('Find Mockup').first().json.selectedMockupFileName)),",
    "offer video poster URL",
  );

  const buildDelivery = workflowNode(workflow, "Build Preview Delivery Payload");
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "const previewPdfUrl = String(offer.previewPdfUrl || '').trim();",
    `const previewPdfUrl = String(offer.previewPdfUrl || '').trim();
const deliveryModeContext = $('Prepare Offer Delivery Mode').first().json || {};
const deliveryWithoutVideo = deliveryModeContext.deliveryWithoutVideo === true;
const videoOmittedReason = deliveryWithoutVideo
  ? String(deliveryModeContext.videoOmittedReason || 'inconclusive_after_two_qc_attempts')
  : '';`,
    "delivery mode context",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "const trelloUpload = $('Upload Video to Trello').first().json || {};",
    `let trelloUpload = {};
if (!deliveryWithoutVideo) {
  trelloUpload = $('Upload Video to Trello').first().json || {};
}`,
    "optional Trello video upload",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "const runwayVideoUrl = ($('Download Video').first().json || {}).videoUrl || '';",
    `let runwayVideoUrl = '';
if (!deliveryWithoutVideo) {
  runwayVideoUrl = ($('Download Video').first().json || {}).videoUrl || '';
}`,
    "optional generated video URL",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "const supabaseUploadOk = !supabaseUploadError;",
    "const supabaseUploadOk = !deliveryWithoutVideo && !supabaseUploadError;",
    "Supabase upload status",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "if (!trelloUpload.id || !trelloUpload.fileName) {",
    "if (!deliveryWithoutVideo && (!trelloUpload.id || !trelloUpload.fileName)) {",
    "Trello upload requirement",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "const videoUrl = supabaseUploadOk ? supabaseVideoUrl : trelloProxyVideoUrl;",
    "const videoUrl = deliveryWithoutVideo ? '' : (supabaseUploadOk ? supabaseVideoUrl : trelloProxyVideoUrl);",
    "delivery video URL",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "const videoHostingStatus = supabaseUploadOk ? 'supabase_storage' : 'supabase_failed_trello_proxy';",
    "const videoHostingStatus = deliveryWithoutVideo ? 'omitted_after_inconclusive_qc' : (supabaseUploadOk ? 'supabase_storage' : 'supabase_failed_trello_proxy');",
    "video hosting status",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "  supabase_video_url: supabaseVideoUrl,",
    "  supabase_video_url: deliveryWithoutVideo ? '' : supabaseVideoUrl,",
    "delivery Supabase video URL",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "  trello_video_attachment_id: trelloUpload.id,",
    "  trello_video_attachment_id: deliveryWithoutVideo ? '' : trelloUpload.id,",
    "delivery Trello video attachment",
  );
  buildDelivery.parameters.jsCode = replaceOnce(
    buildDelivery.parameters.jsCode,
    "  delivery_mode: regenerateOnly ? 'regenerate_only' : (whatsappFallbackOnly ? 'whatsapp_fallback_only' : 'send_preview_email'),",
    `  delivery_mode: regenerateOnly
    ? 'regenerate_only'
    : (whatsappFallbackOnly
      ? 'whatsapp_fallback_only'
      : (deliveryWithoutVideo ? 'send_offer_without_video' : 'send_preview_email')),
  delivery_without_video: deliveryWithoutVideo,
  video_omitted_reason: videoOmittedReason,
  video_qc_decision: deliveryModeContext.videoContentQcDecision || '',
  video_qc_confidence: deliveryModeContext.videoContentQcConfidence ?? null,`,
    "delivery fallback metadata",
  );

  const successComment = workflowNode(workflow, "Trello: Preview Success Comment");
  successComment.parameters.queryParameters.parameters = [{
    name: "text",
    value:
      "={{ $json.delivery_without_video === true " +
      "? '✅ **Angebot ohne KI-Video versendet**\\n\\n📧 An: ' + ($json.customer_email || 'keine E-Mail erkannt') + " +
      "'\\n🔗 Angebot: ' + ($json.neontrip_offer_url || $json.preview_url) + " +
      "'\\nℹ️ Grund: Video-QA war nach zwei Versuchen nicht eindeutig; das geprüfte Video wurde nicht verwendet.\\n🏷 Label: Angebot gesendet\\n⏰ ' + " +
      "new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) " +
      ": '✅ **Angebot mit KI-Video versendet**\\n\\n📧 An: ' + ($json.customer_email || 'keine E-Mail erkannt') + " +
      "'\\n🎬 Vorschau/Angebot: ' + ($json.neontrip_offer_url || $json.preview_url) + " +
      "'\\n🏷 Labels: Video gesendet + Angebot gesendet\\n⏰ ' + " +
      "new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) }}",
  }];

  const auditComplete = workflowNode(workflow, "Audit: Company Brain Initial Delivery Complete");
  auditComplete.parameters.jsonBody = replaceOnce(
    auditComplete.parameters.jsonBody,
    "      source: 'n8n_company_brain_audit'",
    `      delivery_without_video: payload.delivery_without_video === true,
      video_omitted_reason: payload.video_omitted_reason || null,
      video_qc_decision: payload.video_qc_decision || null,
      video_qc_confidence: payload.video_qc_confidence ?? null,
      source: 'n8n_company_brain_audit'`,
    "initial delivery audit fallback metadata",
  );

  const fallbackGate = {
    id: "send-offer-without-video-after-qc-if",
    name: "Send Offer Without Video After QC?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [4048, 328],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
        conditions: [{
          id: "send-offer-without-video-after-qc",
          leftValue: "={{ $json.videoContentQcFallbackWithoutVideo === true }}",
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
        combinator: "and",
      },
      options: {},
    },
  };

  const fallbackReusableGate = {
    id: "fallback-reusable-video-exists-if",
    name: "Fallback Reusable Video Exists?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [4272, 328],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
        conditions: [{
          id: "fallback-reusable-video-exists",
          leftValue: "={{ $('Check Reusable Trello Video').first().json.reusableVideo === true && !!$('Check Reusable Trello Video').first().json.existingVideoAttachmentId }}",
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
        combinator: "and",
      },
      options: {},
    },
  };

  const deleteFallbackReusable = {
    ...structuredClone(workflowNode(workflow, "Delete Rejected Reusable Video")),
    id: "delete-reusable-video-for-offer-only",
    name: "Delete Reusable Video for Offer-only",
    position: [4496, 280],
  };

  const prepareDeliveryMode = {
    id: "prepare-offer-delivery-mode",
    name: "Prepare Offer Delivery Mode",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [4272, 560],
    parameters: {
      jsCode: `const input = $input.first().json || {};
const deliveryWithoutVideo = input.deliveryWithoutVideo === true || input.videoContentQcFallbackWithoutVideo === true;
return [{ json: {
  ...input,
  deliveryWithoutVideo,
  videoOmittedReason: deliveryWithoutVideo
    ? String(input.videoOmittedReason || 'inconclusive_after_two_qc_attempts')
    : '',
} }];`,
    },
  };

  const videoDeliveredGate = {
    id: "video-included-in-delivery-if",
    name: "Video Included in Delivery?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.3,
    position: [5616, 184],
    parameters: {
      conditions: {
        options: { version: 2, leftValue: "", caseSensitive: true, typeValidation: "strict" },
        conditions: [{
          id: "video-included-in-delivery",
          leftValue: "={{ $('Build Preview Delivery Payload').first().json.delivery_without_video !== true }}",
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
        combinator: "and",
      },
      options: {},
    },
  };

  const skipVideoLabel = {
    id: "skip-video-sent-label",
    name: "Skip Video gesendet Label",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [5840, 280],
    parameters: {
      jsCode: `return [{ json: {
  ...($input.first().json || {}),
  videoLabelSkipped: true,
  videoOmittedReason: $('Build Preview Delivery Payload').first().json.video_omitted_reason || 'inconclusive_after_two_qc_attempts',
} }];`,
    },
  };

  workflow.nodes.push(
    fallbackGate,
    fallbackReusableGate,
    deleteFallbackReusable,
    prepareDeliveryMode,
    videoDeliveredGate,
    skipVideoLabel,
  );
  workflow.connections["Video Content QC Passed?"] = {
    main: [
      [{ node: "Restore Video Binary after QC", type: "main", index: 0 }],
      [{ node: "Send Offer Without Video After QC?", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Send Offer Without Video After QC?"] = {
    main: [
      [{ node: "Fallback Reusable Video Exists?", type: "main", index: 0 }],
      [{ node: "Rejected Reusable Video?", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Fallback Reusable Video Exists?"] = {
    main: [
      [{ node: "Delete Reusable Video for Offer-only", type: "main", index: 0 }],
      [{ node: "Get Card Labels for Video QC", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Delete Reusable Video for Offer-only"] = {
    main: [[{ node: "Get Card Labels for Video QC", type: "main", index: 0 }]],
  };
  workflow.connections["Video Watchdog Passed?"] = {
    main: [
      [{ node: "Prepare Offer Delivery Mode", type: "main", index: 0 }],
      [{ node: "Prepare Locked Offer Failure", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Prepare Offer Delivery Mode"] = {
    main: [[{ node: "Create NEONTRIP Offer", type: "main", index: 0 }]],
  };
  workflow.connections["Preview Delivery OK?"] = {
    main: [
      [{ node: "Video Included in Delivery?", type: "main", index: 0 }],
      [{ node: "Prepare Locked Offer Failure", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Video Included in Delivery?"] = {
    main: [
      [{ node: "Set Video gesendet Label", type: "main", index: 0 }],
      [{ node: "Skip Video gesendet Label", type: "main", index: 0 }],
    ],
  };
  workflow.connections["Skip Video gesendet Label"] = {
    main: [[
      { node: "Build Post-Send Context", type: "main", index: 0 },
      { node: "Release Video Lease", type: "main", index: 0 },
    ]],
  };

  validateConnections(workflow);
  return workflow;
}

function patchDeliveryWorkflow(workflow) {
  const validatePayload = workflowNode(workflow, "Validate Preview Payload");
  let validateCode = validatePayload.parameters.jsCode;
  validateCode = replaceOnce(
    validateCode,
    "const incoming = $json.body && typeof $json.body === 'object' ? $json.body : $json;",
    `const incoming = $json.body && typeof $json.body === 'object' ? $json.body : $json;
const deliveryWithoutVideo =
  incoming.delivery_without_video === true ||
  incoming.delivery_without_video === 'true' ||
  incoming.delivery_mode === 'send_offer_without_video';`,
    "delivery explicit no-video flag",
  );
  validateCode = replaceOnce(
    validateCode,
    "if (!previewUrl && offerUrl && videoUrl) {",
    "if (!previewUrl && offerUrl && videoUrl && !deliveryWithoutVideo) {",
    "video preview URL construction",
  );
  validateCode = replaceOnce(
    validateCode,
    "if (!videoUrl && previewUrl) {",
    `if (!previewUrl && offerUrl && deliveryWithoutVideo) {
  previewUrl = offerUrl;
}

if (!deliveryWithoutVideo && !videoUrl && previewUrl) {`,
    "offer-only preview URL",
  );
  validateCode = replaceOnce(
    validateCode,
    "if (videoUrlIsTemporary && !FLAG_TEST_ONLY) errors.push('temporary_video_url_not_allowed_for_customer_send');",
    "if (!deliveryWithoutVideo && videoUrlIsTemporary && !FLAG_TEST_ONLY) errors.push('temporary_video_url_not_allowed_for_customer_send');",
    "temporary video validation",
  );
  validateCode = replaceOnce(
    validateCode,
    "if (!videoUrl) errors.push('video_url_missing_or_invalid');",
    "if (!deliveryWithoutVideo && !videoUrl) errors.push('video_url_missing_or_invalid');",
    "video URL requirement",
  );
  validateCode = replaceOnce(
    validateCode,
    "delivery_mode: skipCustomerEmail ? 'regenerate_only' : 'send_preview_email',",
    "delivery_mode: skipCustomerEmail ? 'regenerate_only' : (deliveryWithoutVideo ? 'send_offer_without_video' : 'send_preview_email'), delivery_without_video: deliveryWithoutVideo, video_omitted_reason: deliveryWithoutVideo ? String(incoming.video_omitted_reason || 'inconclusive_after_two_qc_attempts') : '',",
    "validated delivery mode",
  );
  validatePayload.parameters.jsCode = validateCode;

  const buildEmail = workflowNode(workflow, "Build Test Email");
  let emailCode = buildEmail.parameters.jsCode;
  emailCode = replaceOnce(
    emailCode,
    "const ctx = $('Validate Preview Payload').first().json;",
    `const ctx = $('Validate Preview Payload').first().json;
const deliveryWithoutVideo = ctx.delivery_without_video === true || ctx.delivery_mode === 'send_offer_without_video';`,
    "email delivery mode",
  );
  emailCode = replaceOnce(
    emailCode,
    "const thumbnailBlock = thumbUrl",
    "const videoThumbnailBlock = thumbUrl",
    "video thumbnail variable",
  );
  emailCode = replaceOnce(
    emailCode,
    "  : '';\n\nconst actionTable = [",
    `  : '';

const offerImageBlock = thumbUrl
  ? [
      '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:560px;margin:14px 0 12px 0;border-collapse:separate;border-spacing:0;">',
      '  <tr>',
      '    <td style="border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">',
      '      <a href="' + escapeHtml(offerUrl) + '" style="display:block;text-decoration:none;">',
      '        <img src="' + escapeHtml(thumbUrl) + '" alt="Ihr NEONTRIP-Angebot" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;">',
      '      </a>',
      '    </td>',
      '  </tr>',
      '</table>'
    ].join('\\n')
  : '';

const thumbnailBlock = deliveryWithoutVideo ? offerImageBlock : videoThumbnailBlock;

const videoActionTable = [`,
    "offer-only image block",
  );
  emailCode = replaceOnce(
    emailCode,
    "].join('\\n');\n\nconst signature = [",
    `].join('\\n');

const offerActionTable = [
  '<table cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 18px 0;">',
  '  <tr>',
  '    <td style="padding:0 0 8px 0;">' + button('Angebot ansehen', offerUrl, '#fa31a2', '#ffffff') + '</td>',
  '  </tr>',
  '</table>'
].join('\\n');
const actionTable = deliveryWithoutVideo ? offerActionTable : videoActionTable;
const introCopy = deliveryWithoutVideo
  ? 'Ihr Angebot ist fertig. Über den folgenden Link sehen Sie direkt alle Designs, Größen, Ausführungen und Preise.'
  : 'Ihr Angebot ist fertig. Hier sehen Sie zuerst die kurze Video-Vorschau - darunter kommen Sie direkt zu Preis, Größen und Ausführung.';

const signature = [`,
    "offer-only action table",
  );
  emailCode = replaceOnce(
    emailCode,
    "'<p style=\"margin:0 0 12px 0;\">Ihr Angebot ist fertig. Hier sehen Sie zuerst die kurze Video-Vorschau - darunter kommen Sie direkt zu Preis, Größen und Ausführung.</p>',",
    "'<p style=\"margin:0 0 12px 0;\">' + escapeHtml(introCopy) + '</p>',",
    "email intro copy",
  );
  emailCode = replaceOnce(
    emailCode,
    "return [{ json: { ...ctx, subject: 'Ihr NEONTRIP-Angebot mit Vorschau', html, preview_validated: true, preview_validation_status: $json.statusCode || 200 } }];",
    "return [{ json: { ...ctx, subject: deliveryWithoutVideo ? 'Ihr NEONTRIP-Angebot ist fertig' : 'Ihr NEONTRIP-Angebot mit Vorschau', html, preview_validated: true, preview_validation_status: $json.statusCode || 200 } }];",
    "email subject",
  );
  buildEmail.parameters.jsCode = emailCode;

  const success = workflowNode(workflow, "Success Response");
  success.parameters.jsCode = replaceOnce(
    success.parameters.jsCode,
    "    video_url_present: !!ctx.video_url,",
    `    video_url_present: !!ctx.video_url,
    delivery_without_video: ctx.delivery_without_video === true,
    video_omitted_reason: ctx.video_omitted_reason || '',
    delivery_mode: ctx.delivery_mode || '',`,
    "delivery response fallback metadata",
  );

  validateConnections(workflow);
  return workflow;
}

const videoWorkflow = patchVideoWorkflow(readWorkflow(videoInputPath));
const deliveryWorkflow = patchDeliveryWorkflow(readWorkflow(deliveryInputPath));

fs.writeFileSync(videoOutputPath, `${JSON.stringify(videoWorkflow, null, 2)}\n`);
fs.writeFileSync(deliveryOutputPath, `${JSON.stringify(deliveryWorkflow, null, 2)}\n`);
