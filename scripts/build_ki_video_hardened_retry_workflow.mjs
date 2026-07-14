import fs from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/build_ki_video_hardened_retry_workflow.mjs <input.json> <output.json>");
}

const workflow = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));

function codeNode(name) {
  const node = byName.get(name);
  if (!node || typeof node.parameters?.jsCode !== "string") {
    throw new Error(`Missing code node: ${name}`);
  }
  return node;
}

const requestNode = codeNode("Build Runway Request");
let requestCode = requestNode.parameters.jsCode;
if (requestCode.includes("locked_static_retry")) {
  throw new Error("Workflow already contains the hardened automatic retry prompt");
}

requestCode = requestCode.replace(
  "const config = $('Config').first().json;",
  "const config = $('Config').first().json;\nconst isAutomaticVideoRetry = Number(config.jobAttempts || 1) >= 2;",
);

const promptMatch = requestCode.match(/const prompt = ("(?:\\.|[^"\\])*");/);
if (!promptMatch) throw new Error("Could not locate the standard video prompt");

const hardenedPrompt =
  "Create a short locked-off commercial product video from the provided image. This is a safety retry after a prior DESIGN_MORPH rejection. Treat the complete input image as a locked reference plate. Keep the camera fully static: no dolly, no zoom, no pan, no orbit, no crop change and no perspective change. The sign, logo and all letters must remain pixel-stable and identical in every frame: same text, font, symbols, outlines, proportions, spacing, position, mounting, material, hue, white temperature and light color. Do not redraw, interpolate, warp, bend, simplify, recolor, move, resize or replace any part of the sign. Animate only an extremely subtle, uniform light-intensity breathing of at most five percent and a natural reflection on the existing wall. Keep the background unchanged. Add no objects, people, text, branding, graphics or camera effects. If exact preservation is not possible, output a visually static shot rather than modifying the design. No audio.";

requestCode = requestCode.replace(
  promptMatch[0],
  `const standardPrompt = ${promptMatch[1]};\nconst hardenedRetryPrompt = ${JSON.stringify(hardenedPrompt)};\nconst prompt = isAutomaticVideoRetry ? hardenedRetryPrompt : standardPrompt;`,
);
requestCode = requestCode.replace(
  "return [{ json: {\n  cardId: config.cardId,\n  grokBody:",
  "return [{ json: {\n  cardId: config.cardId,\n  videoGenerationMode: isAutomaticVideoRetry ? 'locked_static_retry' : 'cinematic_standard',\n  videoGenerationAttempt: Number(config.jobAttempts || 1),\n  grokBody:",
);
requestNode.parameters.jsCode = requestCode;

const failureNode = codeNode("Prepare Locked Offer Failure");
let failureCode = failureNode.parameters.jsCode;
failureCode = failureCode.replace(
  "let videoGenerationFingerprint = null;",
  "let videoGenerationFingerprint = null;\nlet videoGenerationMode = jobAttempts >= 2 ? 'locked_static_retry' : 'cinematic_standard';",
);
failureCode = failureCode.replace(
  "videoGenerationFingerprint = null;\n}\n\nreturn [{ json: {",
  "videoGenerationFingerprint = null;\n}\ntry {\n  videoGenerationMode = $('Build Runway Request').first().json.videoGenerationMode || videoGenerationMode;\n} catch (error) {\n  // Keep the deterministic attempt-based fallback when generation did not start.\n}\n\nreturn [{ json: {",
);
failureCode = failureCode.replace(
  "videoGenerationFingerprint,\n  customerCommunicationSent",
  "videoGenerationFingerprint,\n  videoGenerationMode,\n  customerCommunicationSent",
);
failureNode.parameters.jsCode = failureCode;

const releaseNode = codeNode("Release Video Lease");
releaseNode.parameters.jsCode = releaseNode.parameters.jsCode.replace(
  "videoGenerationFingerprint: source.videoGenerationFingerprint || null,",
  "videoGenerationFingerprint: source.videoGenerationFingerprint || null,\n  videoGenerationMode: source.videoGenerationMode || null,",
);

const auditNode = byName.get("Audit: Company Brain Offer Failure");
if (!auditNode || typeof auditNode.parameters?.jsonBody !== "string") {
  throw new Error("Missing audit node");
}
auditNode.parameters.jsonBody = auditNode.parameters.jsonBody.replace(
  "video_generation_fingerprint: failure.videoGenerationFingerprint || null,",
  "video_generation_fingerprint: failure.videoGenerationFingerprint || null,\n      video_generation_mode: failure.videoGenerationMode || null,\n      workflow_id: '9FoJMH6OUdsi36FB',",
);

const finishNode = byName.get("Supabase: Finish Preview Delivery Job");
if (!finishNode || typeof finishNode.parameters?.jsonBody !== "string") {
  throw new Error("Missing finish-job node");
}
finishNode.parameters.jsonBody = finishNode.parameters.jsonBody.replace(
  "video_generation_fingerprint: $json.videoGenerationFingerprint || null,",
  "video_generation_fingerprint: $json.videoGenerationFingerprint || null, video_generation_mode: $json.videoGenerationMode || null,",
);

fs.writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`);
