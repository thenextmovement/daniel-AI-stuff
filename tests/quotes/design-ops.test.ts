import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { archiveMockupAttachmentName, extractTrelloMockupPromptBlocks, findUploadedDesignAttachment, isEligibleAiMockupSourceName, promptForImageEdit, quoteImageVariantKey, structuredDesignActionAttachmentName } from "@/lib/ops/design";
import {
  DESIGN_ACTION_CONSTRAINT_END,
  DESIGN_ACTION_CONSTRAINT_START,
  DESIGN_LIGHT_COLORS,
  MAX_DESIGN_BATCH_ITEMS,
  canonicalDesignActionValue,
  designActionPrompt,
  designBatchPrompt,
  designBatchPromptMatchesAction,
  hasJpegMagicBytes,
  openAiImageEditOutputSize,
  withoutDesignActionConstraint,
} from "@/lib/ops/design-contract";
import { designBatchItemKey, executeDesignBatchItem } from "@/lib/ops/design-batches";

test("ops design module is visible and destructive actions stay guarded", () => {
  const nav = readFileSync("src/app/ops/ops-app-switcher.tsx", "utf8");
  const page = readFileSync("src/app/ops/design/page.tsx", "utf8");
  const client = readFileSync("src/app/ops/design/page-client.tsx", "utf8");
  const route = readFileSync("src/app/api/ops/design/route.ts", "utf8");
  const jobsRoute = readFileSync("src/app/api/ops/design/jobs/route.ts", "utf8");
  const queueRoute = readFileSync("src/app/api/ops/design/jobs/[jobId]/queue/route.ts", "utf8");
  const generateRoute = readFileSync("src/app/api/ops/design/jobs/[jobId]/generate/route.ts", "utf8");
  const removalPlansRoute = readFileSync("src/app/api/ops/design/removal-plans/route.ts", "utf8");
  const removalApplyRoute = readFileSync("src/app/api/ops/design/removal-plans/[planId]/apply/route.ts", "utf8");
  const trelloAttachRoute = readFileSync("src/app/api/ops/design/jobs/[jobId]/trello/route.ts", "utf8");
  const offerLinksRoute = readFileSync("src/app/api/ops/design/offer-links/route.ts", "utf8");
  const quoteImageVariantsRoute = readFileSync("src/app/api/ops/design/quote-image-variants/route.ts", "utf8");
  const batchesRoute = readFileSync("src/app/api/ops/design/batches/route.ts", "utf8");
  const batchProcessRoute = readFileSync("src/app/api/ops/design/batches/[batchId]/process/route.ts", "utf8");
  const batchService = readFileSync("src/lib/ops/design-batches.ts", "utf8");
  const designContract = readFileSync("src/lib/ops/design-contract.ts", "utf8");
  const workerJobsRoute = readFileSync("src/app/api/ops/design/worker/jobs/route.ts", "utf8");
  const workerCallbackRoute = readFileSync("src/app/api/ops/design/worker/callback/route.ts", "utf8");
  const service = readFileSync("src/lib/ops/design.ts", "utf8");
  const envExample = readFileSync(".env.ops.example", "utf8");
  const deployCheck = readFileSync("scripts/check_customer_records_deploy_env.mjs", "utf8");
  const operationsDoc = readFileSync("docs/operations/design-ops.md", "utf8");
  const workflowPlan = readFileSync("workflows/plans/design-generation-worker-v0.1.md", "utf8");

  assert.match(nav, /key: "design"/);
  assert.match(nav, /href: "\/ops\/design"/);
  assert.match(nav, /Palette/);

  assert.match(page, /hasOpsSession/);
  assert.match(page, /DesignOpsClient/);

  assert.match(client, /active="design"/);
  assert.match(client, /\/ops\/company-brain/);
  assert.match(client, /Prompt/);
  assert.match(client, /sourceLabel/);
  assert.match(client, /Video-Prompt aus Trello/);
  assert.match(client, /promptWithMockupConstraint/);
  assert.match(client, /promptWithStudioConstraints/);
  assert.match(client, /NEONTRIP_DESIGN_STUDIO_CONSTRAINT/);
  assert.match(client, /Tischgerät/);
  assert.match(client, /Schaufenster/);
  assert.match(client, /Outdoor/);
  assert.match(client, /Leuchtfarbe/);
  assert.match(client, /activeLightColorLabel/);
  assert.match(client, /DESIGN_LIGHT_COLORS\.map/);
  assert.match(designContract, /Orange/);
  assert.doesNotMatch(client, /RGB-Farbverlauf|label: "RGB"|label: "Eigene"/);
  assert.match(client, /DESIGN_LIGHT_COLORS\.length/);
  assert.match(client, /PRODUCT_CHANGE_PRESETS/);
  assert.match(client, /Produktänderung/);
  assert.match(client, /3D Frontlit/);
  assert.match(client, /Produkt ändern \+ ersetzen/);
  assert.match(client, /activeProductChangeLabel/);
  assert.match(client, /Geprüfter neuer Nettopreis/);
  assert.match(client, /Produktlogik und Nettopreis wurden geprüft/);
  assert.match(client, /priceReviewConfirmed/);
  assert.match(client, /Ausgangsbild/);
  assert.match(client, /setSelectedReferenceAttachmentId/);
  assert.match(client, /setSelectedReferenceAssetId/);
  assert.match(client, /selectReferenceAttachmentForEdit/);
  assert.match(client, /selectReferenceAssetForEdit/);
  assert.match(client, /selectedRecolorAttachmentIds/);
  assert.match(client, /selectedColorAttachmentIds/);
  assert.match(client, /BulkRecolorProgress/);
  assert.match(client, /workspace\?\.cards \|\| \[\]/);
  assert.match(client, /preserveStatus/);
  assert.match(client, /Bulk-Farbänderung/);
  assert.match(client, /isEligibleAiMockupSourceName/);
  assert.match(client, /KI-JPG Quelle/);
  assert.match(client, /Nur JPG-Mockups mit Mockup und AI im Dateinamen/);
  assert.match(client, /Bulk läuft/);
  assert.match(client, /Ein Neuladen verliert den Batch nicht/);
  assert.match(client, /trelloAttachmentId/);
  assert.match(client, /toggleRecolorSelection/);
  assert.match(client, /selectAttachmentForRecolor/);
  assert.match(client, /createPromptDraft/);
  assert.match(client, /job \|\| \(await createPromptDraft\(\)\)/);
  assert.match(client, /Als Vorlage/);
  assert.match(client, /Farbe ändern \+ ersetzen/);
  assert.match(client, /recolorSelectedAttachments/);
  assert.match(batchService, /replacementAttachmentId/);
  assert.match(client, /Generiertes KI-Mockup wird als Image-Edit-Vorlage genutzt/);
  assert.match(client, /Offer Integration/);
  assert.match(client, /Draft speichern/);
  assert.match(client, /Generierung freigeben/);
  assert.match(client, /KI-Mockup generieren/);
  assert.match(client, /KI-Mockup aus Vorlage generieren/);
  assert.match(client, /Vorlage fehlt/);
  assert.match(client, /Auswahl fehlt/);
  assert.match(client, /Farbe fehlt/);
  assert.match(client, /Produkt fehlt/);
  assert.match(client, /Alle für Änderung/);
  assert.match(client, /<span>Löschen<\/span>/);
  assert.match(client, /"Ändern"/);
  assert.doesNotMatch(client, /disabled=\{busy \|\| !selectedColorAttachmentIds\.length \|\| !activeLightColorLabel\}/);
  assert.doesNotMatch(client, /disabled=\{busy \|\| !selectedColorAttachmentIds\.length \|\| !activeProductChangeLabel\}/);
  assert.match(client, /Removal vorbereiten/);
  assert.match(client, /Backup vor Delete/);
  assert.match(client, /ENTFERNEN/);
  assert.match(client, /An Trello/);
  assert.match(client, /In Angebot übernehmen/);
  assert.match(client, /Aktualisiertes Angebot senden/);
  assert.match(client, /sendUpdatedOffer/);
  assert.match(client, /customer-records\/offers/);
  assert.match(client, /CRM-Bildkontext/);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PATCH|DELETE)/);
  assert.match(route, /hasOpsSession/);
  assert.match(route, /loadDesignWorkspace/);

  assert.match(jobsRoute, /export async function POST/);
  assert.match(jobsRoute, /export async function GET/);
  assert.doesNotMatch(jobsRoute, /export async function (PATCH|DELETE)/);
  assert.match(jobsRoute, /createDesignJobDraft/);
  assert.match(jobsRoute, /listDesignJobs/);
  assert.match(jobsRoute, /idempotencyKey/);
  assert.match(jobsRoute, /referenceAttachmentIds/);
  assert.match(jobsRoute, /referenceAssetId/);

  assert.match(queueRoute, /export async function POST/);
  assert.doesNotMatch(queueRoute, /export async function (GET|PATCH|DELETE)/);
  assert.match(queueRoute, /queueDesignJob/);
  assert.match(queueRoute, /hasOpsSession/);

  assert.match(generateRoute, /generateDesignJobNow/);
  assert.match(generateRoute, /idempotencyKey/);
  assert.match(generateRoute, /hasOpsSession/);

  assert.match(removalPlansRoute, /export async function POST/);
  assert.doesNotMatch(removalPlansRoute, /export async function (GET|PATCH|DELETE)/);
  assert.match(removalPlansRoute, /prepareDesignRemovalPlan/);
  assert.match(removalPlansRoute, /idempotencyKey/);

  assert.match(removalApplyRoute, /applyDesignRemovalPlan/);
  assert.match(removalApplyRoute, /confirmText/);
  assert.match(removalApplyRoute, /hasOpsSession/);

  assert.match(trelloAttachRoute, /attachDesignAssetToTrello/);
  assert.match(trelloAttachRoute, /hasOpsSession/);
  assert.match(trelloAttachRoute, /replacementAttachmentId/);

  assert.match(offerLinksRoute, /linkDesignAssetToOffer/);
  assert.match(offerLinksRoute, /OpsOfferApiError/);
  assert.match(offerLinksRoute, /lightColorLabel/);
  assert.match(offerLinksRoute, /productChangeLabel/);
  assert.match(offerLinksRoute, /priceReviewConfirmed/);
  assert.match(offerLinksRoute, /dryRun/);

  assert.match(quoteImageVariantsRoute, /prepareQuoteImageVariantDraft/);
  assert.match(quoteImageVariantsRoute, /hasOpsSession/);
  assert.match(quoteImageVariantsRoute, /variantType/);
  assert.match(quoteImageVariantsRoute, /variantValue/);
  assert.match(quoteImageVariantsRoute, /sourceImageUrl/);
  assert.doesNotMatch(quoteImageVariantsRoute, /export async function (GET|PATCH|DELETE)/);

  assert.match(batchesRoute, /createDesignBatch/);
  assert.match(batchesRoute, /idempotencyKey/);
  assert.match(batchProcessRoute, /processNextDesignBatchItem/);
  assert.match(batchProcessRoute, /maxDuration = 180/);
  assert.match(batchService, /claim_next_design_batch_item/);
  assert.match(batchService, /retryableCount/);
  assert.match(batchService, /replaceTrello/);
  assert.match(batchService, /sourceFingerprint/);
  assert.match(designContract, /DESIGN_LIGHT_COLORS/);
  assert.match(designContract, /hasJpegMagicBytes/);

  assert.match(workerJobsRoute, /DESIGN_WORKER_API_KEY/);
  assert.match(workerJobsRoute, /listQueuedDesignJobsForWorker/);
  assert.match(workerJobsRoute, /markDesignJobGenerating/);
  assert.doesNotMatch(workerJobsRoute, /hasOpsSession/);

  assert.match(workerCallbackRoute, /DESIGN_WORKER_API_KEY/);
  assert.match(workerCallbackRoute, /applyDesignWorkerCallback/);
  assert.match(workerCallbackRoute, /idempotencyKey/);
  assert.doesNotMatch(workerCallbackRoute, /hasOpsSession/);

  assert.match(service, /loadDesignWorkspace/);
  assert.match(service, /extractTrelloMockupPromptBlocks/);
  assert.match(service, /selectPrimaryDesignCard/);
  assert.match(service, /isQuoteReadyLikeList/);
  assert.match(service, /#startprompt/);
  assert.match(service, /Trello #startprompt\/#endprompt wurde ignoriert/);
  assert.match(service, /Design-Studio Edit-Prompt/);
  assert.match(service, /buildDesignStudioEditPrompt/);
  assert.doesNotMatch(service, /KI-Mockup Prompt aus/);
  assert.doesNotMatch(service, /Quote-Ready KI-Prompt gefunden/);
  assert.doesNotMatch(service, /Rekonstruiert aus Trello-Karte/);
  assert.doesNotMatch(service, /buildReconstructedTrelloPrompt/);
  assert.doesNotMatch(service, /Fallback-Prompt aus Ops-Kontext/);
  assert.match(service, /createDesignJobDraft/);
  assert.match(service, /queueDesignJob/);
  assert.match(service, /generateDesignJobNow/);
  assert.match(service, /https:\/\/api\.openai\.com\/v1\/images\/generations/);
  assert.match(service, /https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(service, /input_fidelity/);
  assert.match(service, /promptForImageEdit/);
  assert.match(service, /referenceImageContentType/);
  assert.match(service, /assertEligibleAiJpegSource/);
  assert.match(service, /assertJpegOutput/);
  assert.match(service, /reference_attachments/);
  assert.match(service, /reference_assets/);
  assert.match(service, /referenceAssetsFromJob/);
  assert.match(service, /jobCard/);
  assert.match(service, /downloadTrelloAttachment/);
  assert.match(service, /storage\/v1\/object/);
  assert.match(service, /prepareDesignRemovalPlan/);
  assert.match(service, /applyDesignRemovalPlan/);
  assert.match(service, /attachDesignAssetToTrello/);
  assert.match(service, /archiveMockupAttachmentName/);
  assert.match(service, /structuredDesignActionAttachmentName/);
  assert.match(service, /renameTrelloCardAttachment/);
  assert.match(service, /trello_replacement_archived_name/);
  assert.match(service, /linkDesignAssetToOffer/);
  assert.match(service, /prepareQuoteImageVariantDraft/);
  assert.match(service, /quoteImageVariantKey/);
  assert.match(service, /quote_image_variants/);
  assert.match(service, /markQuoteImageVariantReady/);
  assert.match(service, /quote_image_variant_engine/);
  assert.match(service, /Direkte Source-Image-URLs sind nicht zulässig/);
  assert.match(service, /assertAllowedDesignSourceUrl/);
  assert.match(service, /isEligibleAiMockupSourceName/);
  assert.match(service, /Nur JPG-Mockups mit Mockup und AI im Dateinamen/);
  assert.match(service, /crm_quote_version_images/);
  assert.match(service, /getOrCreateCrmQuoteVersionImage/);
  assert.match(service, /crm_quote_image_id/);
  assert.match(service, /listDesignJobs/);
  assert.match(service, /listQueuedDesignJobsForWorker/);
  assert.match(service, /applyDesignWorkerCallback/);
  assert.doesNotMatch(service, /Prompt basiert nur auf Trello-Daten/);
  assert.match(service, /removalEligible: true/);
  assert.match(service, /prepared_without_delete: true/);
  assert.match(service, /confirmText/);
  assert.match(service, /ENTFERNEN/);
  assert.match(service, /deleteTrelloCardAttachment/);
  assert.match(service, /addTrelloCardAttachment/);
  assert.match(service, /patchOfferById/);
  assert.match(service, /upsertLightColorLine/);
  assert.match(service, /upsertProductChangeLine/);
  assert.match(service, /applyProductChangeToTitle/);
  assert.match(service, /ops_design_asset_and_light_color_link/);
  assert.match(service, /product_change_label/);
  assert.match(service, /product_change_requires_price_review/);
  assert.match(designContract, /Ändere ausschließlich die Schildtechnik/);
  assert.match(service, /dryRun/);
  assert.match(service, /manual_design_link_requires_price_review/);

  assert.match(envExample, /DESIGN_WORKER_API_KEY=/);
  assert.match(envExample, /OPS_OPENAI_IMAGE_MODEL=/);
  assert.match(envExample, /DESIGN_ASSET_BUCKET=/);
  assert.match(deployCheck, /DESIGN_WORKER_API_KEY/);
  assert.match(operationsDoc, /DESIGN_WORKER_API_KEY/);
  assert.match(operationsDoc, /Trello is a projection/);
  assert.match(operationsDoc, /ENTFERNEN/);
  assert.match(operationsDoc, /Offer-Link/);
  assert.match(workflowPlan, /max 30 nodes|Node Structure/);
  assert.match(workflowPlan, /No credential value belongs in workflow JSON/);
});

test("design ops quote image variant cache keys normalize costly color variants", () => {
  const quoteId = "11111111-1111-4111-8111-111111111111";
  const quoteImageId = "22222222-2222-4222-8222-222222222222";

  assert.equal(
    quoteImageVariantKey({
      quoteId,
      quoteImageId,
      variantType: "light_color",
      variantValue: "Blau",
    }),
    quoteImageVariantKey({
      quoteId,
      quoteImageId,
      variantType: "light_color",
      variantValue: "blue",
    }),
  );

  assert.notEqual(
    quoteImageVariantKey({
      quoteId,
      quoteImageId,
      variantType: "light_color",
      variantValue: "Blau",
    }),
    quoteImageVariantKey({
      quoteId,
      quoteImageId,
      variantType: "light_color",
      variantValue: "Kaltweiß",
    }),
  );

  assert.notEqual(
    quoteImageVariantKey({
      quoteId,
      quoteImageId,
      variantType: "light_color",
      variantValue: "Blau",
      sourceFingerprint: "source-v1",
    }),
    quoteImageVariantKey({
      quoteId,
      quoteImageId,
      variantType: "light_color",
      variantValue: "Blau",
      sourceFingerprint: "source-v2",
    }),
  );
});

test("design engine exposes exactly twelve canonical customer colors", () => {
  assert.equal(DESIGN_LIGHT_COLORS.length, 12);
  assert.deepEqual(DESIGN_LIGHT_COLORS.map((color) => color.label), [
    "Kaltweiß",
    "Warmweiß",
    "Grün",
    "Blau",
    "Eisblau",
    "Rot",
    "Orange",
    "Zitronengelb",
    "Goldgelb",
    "Pink",
    "Lila",
    "Türkis",
  ]);
  assert.equal(canonicalDesignActionValue("light_color", "orange"), "Orange");
  assert.equal(canonicalDesignActionValue("light_color", "amber"), null);
  assert.equal(canonicalDesignActionValue("light_color", "RGB"), null);
  assert.match(designActionPrompt("light_color", "Kaltweiß") || "", /6000 Kelvin/);
});

test("design engine validates JPEG bytes and structured replacement names", () => {
  assert.equal(hasJpegMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(hasJpegMagicBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46])), false);
  assert.equal(
    structuredDesignActionAttachmentName({
      actionType: "light_color",
      actionValue: "Orange",
      sourceName: "Mockup4600_AI_1.jpeg",
    }),
    "Orange_Mockup4600_AI_1.jpeg",
  );
});

test("design batches preserve editable notes while enforcing the canonical action prompt", () => {
  const orangePrompt = designBatchPrompt("light_color", "Orange", "Nur das Schild links im Bild bearbeiten.");
  assert.ok(orangePrompt);
  assert.match(orangePrompt, /Nur das Schild links im Bild bearbeiten/);
  assert.match(orangePrompt, new RegExp(DESIGN_ACTION_CONSTRAINT_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(orangePrompt, /sichtbare Leuchtfarbe.*orange/i);
  assert.match(orangePrompt, new RegExp(DESIGN_ACTION_CONSTRAINT_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const bluePrompt = designBatchPrompt("light_color", "Blau", orangePrompt);
  assert.ok(bluePrompt);
  assert.match(bluePrompt, /Nur das Schild links im Bild bearbeiten/);
  assert.match(bluePrompt, /sichtbare Leuchtfarbe.*blau/i);
  assert.doesNotMatch(bluePrompt, /sichtbare Leuchtfarbe.*orange/i);
  assert.equal(bluePrompt.match(/\[\[NEONTRIP_DESIGN_ACTION\]\]/g)?.length, 1);
  assert.equal(withoutDesignActionConstraint(bluePrompt), "Nur das Schild links im Bild bearbeiten.");
  assert.equal(designBatchPromptMatchesAction("light_color", "Blau", bluePrompt), true);
  assert.equal(designBatchPromptMatchesAction("light_color", "Orange", bluePrompt), false);
  assert.equal(designBatchPromptMatchesAction("product_change", "3D Frontlit", "Nur die Technik zu 3D Frontlit ändern."), true);
});

test("image edits use the visible saved prompt and automatic output size", () => {
  const prompt = designBatchPrompt("product_change", "3D Frontlit", "Die vorhandene Wortmarke exakt beibehalten.") || "";
  assert.equal(promptForImageEdit(`  ${prompt}  `), prompt);
  assert.equal(openAiImageEditOutputSize(), "auto");
});

test("bulk item keys stay unique per selected source and the limit is explicit", () => {
  const batchKey = "batch-1234567890";
  assert.notEqual(designBatchItemKey(batchKey, "attachment-a"), designBatchItemKey(batchKey, "attachment-b"));
  assert.equal(designBatchItemKey(batchKey, "attachment-a"), designBatchItemKey(batchKey, "attachment-a"));
  assert.equal(MAX_DESIGN_BATCH_ITEMS, 50);
});

test("Trello replacement retries recover only the exact generated upload", () => {
  const attachments = [
    { id: "source", name: "Mockup4600_AI_1.jpeg", url: "https://source.invalid/mockup.jpeg" },
    { id: "older", name: "Orange_Mockup4600_AI_1.jpeg", url: "https://assets.invalid/older.jpeg" },
    { id: "generated", name: "Orange_Mockup4600_AI_1.jpeg", url: "https://assets.invalid/generated.jpeg/" },
  ];
  assert.equal(
    findUploadedDesignAttachment(attachments, "Orange_Mockup4600_AI_1.jpeg", "https://assets.invalid/generated.jpeg", "source")?.id,
    "generated",
  );
  assert.equal(findUploadedDesignAttachment(attachments, "Orange_Mockup4600_AI_1.jpeg", "https://assets.invalid/missing.jpeg"), null);
});

test("bulk execution keeps every generated image bound to its own selected source", async () => {
  const createCalls: Array<Record<string, unknown>> = [];
  const generateCalls: Array<Record<string, unknown>> = [];
  const attachCalls: Array<Record<string, unknown>> = [];
  const patches: Array<{ itemId: string; body: Record<string, unknown> }> = [];
  const promptText = designBatchPrompt("light_color", "Orange") || "";
  const batch = {
    action_type: "light_color" as const,
    action_value: "Orange",
    operator_name: "Integration Test",
    replace_trello: true,
    source_query: "https://trello.com/c/non-3d-test",
  };
  const items = [
    {
      id: "item-a",
      item_key: designBatchItemKey("batch-integration-123", "attachment-a"),
      source_attachment_id: "attachment-a",
      source_attachment_name: "Mockup4600_AI_1.jpeg",
      source_fingerprint: "fingerprint-a",
    },
    {
      id: "item-b",
      item_key: designBatchItemKey("batch-integration-123", "attachment-b"),
      source_attachment_id: "attachment-b",
      source_attachment_name: "Mockup4600_AI_2.jpeg",
      source_fingerprint: "fingerprint-b",
    },
  ];
  const dependencies = {
    createJobDraft: async (input: Record<string, unknown>) => {
      createCalls.push(input);
      return { id: `job-${String((input.referenceAttachmentIds as string[])[0])}` };
    },
    generateJobNow: async (input: Record<string, unknown>) => {
      generateCalls.push(input);
      return { asset: { id: `asset-${input.jobId}` } };
    },
    attachAssetToTrello: async (input: Record<string, unknown>) => {
      attachCalls.push(input);
      return {
        trelloAttachmentId: `trello-${input.replacementAttachmentId}`,
        archivedAttachmentName: `alte_Vorschaubilder_${input.replacementAttachmentId}.jpeg`,
      };
    },
    patchItem: async (itemId: string, body: Record<string, unknown>) => {
      patches.push({ itemId, body });
      return null;
    },
    now: () => "2026-07-16T00:00:00.000Z",
  };

  const results = [];
  for (const item of items) {
    results.push(await executeDesignBatchItem({ batch, item, promptText }, dependencies));
  }

  assert.deepEqual(createCalls.map((call) => call.referenceAttachmentIds), [["attachment-a"], ["attachment-b"]]);
  assert.deepEqual(createCalls.map((call) => call.idempotencyKey), items.map((item) => item.item_key));
  assert.deepEqual(createCalls.map((call) => call.promptText), [promptText, promptText]);
  assert.deepEqual(generateCalls.map((call) => call.jobId), ["job-attachment-a", "job-attachment-b"]);
  assert.deepEqual(attachCalls.map((call) => call.replacementAttachmentId), ["attachment-a", "attachment-b"]);
  assert.deepEqual(results.map((result) => result.assetId), ["asset-job-attachment-a", "asset-job-attachment-b"]);
  assert.deepEqual(
    patches.map((patch) => [patch.itemId, patch.body.status]),
    [
      ["item-a", "generating"],
      ["item-a", "attaching"],
      ["item-a", "completed"],
      ["item-b", "generating"],
      ["item-b", "attaching"],
      ["item-b", "completed"],
    ],
  );
});

test("bulk execution without replacement completes without a Trello side effect", async () => {
  const patches: Array<Record<string, unknown>> = [];
  let attachCalls = 0;
  const promptText = designBatchPrompt("product_change", "3D Frontlit") || "";
  const result = await executeDesignBatchItem({
    batch: {
      action_type: "product_change",
      action_value: "3D Frontlit",
      operator_name: null,
      replace_trello: false,
      source_query: "https://trello.com/c/non-3d-test",
    },
    item: {
      id: "item-no-replace",
      item_key: designBatchItemKey("batch-no-replace-123", "attachment-no-replace"),
      source_attachment_id: "attachment-no-replace",
      source_attachment_name: "Mockup100_AI_1.jpg",
      source_fingerprint: "fingerprint-no-replace",
    },
    promptText,
  }, {
    createJobDraft: async () => ({ id: "job-no-replace" }),
    generateJobNow: async () => ({ asset: { id: "asset-no-replace" } }),
    attachAssetToTrello: async () => {
      attachCalls += 1;
      return { trelloAttachmentId: "unexpected" };
    },
    patchItem: async (_itemId, body) => {
      patches.push(body);
      return null;
    },
    now: () => "2026-07-16T00:00:00.000Z",
  });

  assert.equal(result.assetId, "asset-no-replace");
  assert.equal(result.trelloResult, null);
  assert.equal(attachCalls, 0);
  assert.deepEqual(patches.map((patch) => patch.status), ["generating", "completed"]);
  assert.equal(patches[1]?.finished_at, "2026-07-16T00:00:00.000Z");
});

test("design ops accepts only AI JPG mockups as customer variant sources", () => {
  for (const name of [
    "Mockup4600_AI_1.jpg",
    "Mockup4600_AI_1.jpeg",
    "Blau_Mockup4600_AI_1.jpg",
    "Orange-Mockup-4600-AI-2.JPG",
  ]) {
    assert.equal(isEligibleAiMockupSourceName(name), true, name);
  }

  for (const name of [
    "Mockup4600_AI_1.png",
    "Mockup4600_AI_1.webp",
    "Mockup4600_1.jpg",
    "AI_1.jpg",
    "Mockup_1.jpg",
    "alte_Vorschaubilder4600_AI_1.jpg",
    "Vorschaubilder4600_AI_1.jpg",
    "Raiffeisenbank Straubing.jpg",
  ]) {
    assert.equal(isEligibleAiMockupSourceName(name), false, name);
  }
});

test("design ops archives replaced Trello mockup names outside mockup detection", () => {
  assert.equal(archiveMockupAttachmentName("Mockup01.jpg"), "alte_Vorschaubilder01.jpg");
  assert.equal(archiveMockupAttachmentName("Mockup 02.webp"), "alte_Vorschaubilder 02.webp");
  assert.equal(archiveMockupAttachmentName("MOC AB 03.png"), "alte_Vorschaubilder 03.png");
  assert.equal(archiveMockupAttachmentName("Referenz.jpg"), "alte_Vorschaubilder_Referenz.jpg");
  assert.equal(archiveMockupAttachmentName("alte_Vorschaubilder01.jpg"), "alte_Vorschaubilder01.jpg");
});

test("design ops names replacement uploads from action and source mockup", () => {
  assert.equal(
    structuredDesignActionAttachmentName({ actionType: "light_color", actionValue: "Orange", sourceName: "Mockup4600_AI_1.jpeg" }),
    "Orange_Mockup4600_AI_1.jpeg",
  );
  assert.equal(
    structuredDesignActionAttachmentName({ actionType: "light_color", actionValue: "Blau", sourceName: "Orange_Mockup4600_AI_1.jpeg" }),
    "Blau_Mockup4600_AI_1.jpeg",
  );
  assert.equal(
    structuredDesignActionAttachmentName({
      actionType: "light_color",
      actionValue: "Orange",
      sourceName: "Eisblau_Mockup4600_AI_1.jpg",
    }),
    "Orange_Mockup4600_AI_1.jpg",
  );
  assert.match(
    promptForImageEdit(designActionPrompt("product_change", "3D Frontlit") || ""),
    /ausschließlich die Schildtechnik des vorhandenen Schildes zu 3D Frontlit/,
  );
  assert.equal(
    structuredDesignActionAttachmentName({ actionType: "product_change", actionValue: "3D Frontlit", sourceName: "Mockup4600_AI_1.jpeg" }),
    "3D_Frontlit_Mockup4600_AI_1.jpeg",
  );
});

test("design ops extracts the same Trello prompt markers used by quote-ready mockups", () => {
  const description = [
    "Kundendaten und interne Notizen",
    "#startprompt",
    "Ein realistisches Wandmockup mit warmweisser LED-Schrift.",
    "Bitte Acryltraeger sichtbar halten.",
    "#endprompt",
    "",
    "#startvideoprompt",
    "Langsame Kamerafahrt ueber das fertige Schild.",
    "#endvideoprompt",
  ].join("\n");

  const blocks = extractTrelloMockupPromptBlocks(description);

  assert.equal(blocks.hasMarkers, true);
  assert.equal(
    blocks.imagePrompt,
    "Ein realistisches Wandmockup mit warmweisser LED-Schrift.\nBitte Acryltraeger sichtbar halten.",
  );
  assert.equal(blocks.videoPrompt, "Langsame Kamerafahrt ueber das fertige Schild.");
});

test("design ops reports missing Trello prompt markers", () => {
  const blocks = extractTrelloMockupPromptBlocks("Nur normale Kartenbeschreibung ohne n8n Promptblock.");

  assert.deepEqual(blocks, {
    imagePrompt: null,
    videoPrompt: null,
    hasMarkers: false,
  });
});

test("design ops schema has source-of-truth tables, RLS and rollback", () => {
  const migration = readFileSync("supabase/migrations/20260706102534_create_design_ops_tables.sql", "utf8");
  const rollback = readFileSync("supabase/rollbacks/20260706102534_create_design_ops_tables_rollback.sql", "utf8");
  const variantMigration = readFileSync("supabase/migrations/20260708103749_create_quote_image_variants.sql", "utf8");
  const variantRollback = readFileSync("supabase/rollbacks/20260708103749_create_quote_image_variants_rollback.sql", "utf8");
  const batchMigration = readFileSync("supabase/migrations/20260715211543_harden_design_engine_batches.sql", "utf8");
  const batchRollback = readFileSync("supabase/rollbacks/20260715211543_harden_design_engine_batches_rollback.sql", "utf8");

  for (const table of [
    "design_jobs",
    "design_prompt_versions",
    "design_assets",
    "design_trello_removal_backups",
    "design_offer_asset_links",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant select, insert, update on public\\.${table} to service_role`));
    assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
  }

  assert.match(migration, /job_key text not null unique/);
  assert.match(migration, /backup_key text not null unique/);
  assert.match(migration, /attachments jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /insert into storage\.buckets/);
  assert.match(migration, /design-assets/);
  assert.match(migration, /selected_asset_id uuid null/);
  assert.match(migration, /attached_to_trello/);
  assert.match(migration, /linked_to_offer/);
  assert.doesNotMatch(migration, /grant .* to anon/i);
  assert.doesNotMatch(migration, /grant .* to authenticated/i);

  assert.match(variantMigration, /create table if not exists public\.quote_image_variants/);
  assert.match(variantMigration, /variant_key text not null unique/);
  assert.match(variantMigration, /quote_id text not null/);
  assert.match(variantMigration, /quote_image_id text not null/);
  assert.match(variantMigration, /quote_item_id text null/);
  assert.match(variantMigration, /design_job_id uuid null references public\.design_jobs/);
  assert.match(variantMigration, /constraint quote_image_variants_status_check/);
  assert.match(variantMigration, /alter table public\.quote_image_variants enable row level security/);
  assert.match(variantMigration, /grant select, insert, update on public\.quote_image_variants to service_role/);
  assert.doesNotMatch(variantMigration, /grant .* to anon/i);
  assert.doesNotMatch(variantMigration, /grant .* to authenticated/i);
  assert.match(variantRollback, /drop table if exists public\.quote_image_variants/);

  for (const table of ["design_batches", "design_batch_items"]) {
    assert.match(batchMigration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(batchMigration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(batchRollback, new RegExp(`drop table if exists public\\.${table}`));
  }
  assert.match(batchMigration, /for update of item skip locked/);
  assert.match(batchMigration, /claim_next_design_batch_item/);
  assert.match(batchMigration, /design_batch_items_asset_idx/);
  assert.match(batchMigration, /refresh_design_batch_status/);
});
