import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { archiveMockupAttachmentName, designActionAttachmentName, extractTrelloMockupPromptBlocks } from "@/lib/ops/design";

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
  assert.match(client, /Warmweiß/);
  assert.match(client, /Orange/);
  assert.match(client, /RGB/);
  assert.match(client, /PRODUCT_CHANGE_PRESETS/);
  assert.match(client, /Produktänderung/);
  assert.match(client, /3D Frontlit/);
  assert.match(client, /Produkt ändern \+ ersetzen/);
  assert.match(client, /activeProductChangeLabel/);
  assert.match(client, /Preisprüfung bleibt erforderlich/);
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
  assert.match(client, /Bulk läuft/);
  assert.match(client, /diese Seite nicht neu laden/);
  assert.match(client, /trelloAttachmentId/);
  assert.match(client, /toggleRecolorSelection/);
  assert.match(client, /selectAttachmentForRecolor/);
  assert.match(client, /createPromptDraft/);
  assert.match(client, /job \|\| \(await createPromptDraft\(\)\)/);
  assert.match(client, /Als Vorlage/);
  assert.match(client, /Farbe ändern \+ ersetzen/);
  assert.match(client, /recolorSelectedAttachments/);
  assert.match(client, /replacementAttachmentId/);
  assert.match(client, /Generiertes KI-Mockup wird als Image-Edit-Vorlage genutzt/);
  assert.match(client, /Offer Integration/);
  assert.match(client, /Draft speichern/);
  assert.match(client, /Generierung freigeben/);
  assert.match(client, /Jetzt generieren/);
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
  assert.match(offerLinksRoute, /dryRun/);

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
  assert.match(service, /unterstütztes Bildformat fuer Image-Edit/);
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
  assert.match(service, /designActionAttachmentName/);
  assert.match(service, /renameTrelloCardAttachment/);
  assert.match(service, /trello_replacement_archived_name/);
  assert.match(service, /linkDesignAssetToOffer/);
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
  assert.match(service, /Ändere ausschließlich die Schildtechnik zu/);
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

test("design ops archives replaced Trello mockup names outside mockup detection", () => {
  assert.equal(archiveMockupAttachmentName("Mockup01.jpg"), "alte_Vorschaubilder01.jpg");
  assert.equal(archiveMockupAttachmentName("Mockup 02.webp"), "alte_Vorschaubilder 02.webp");
  assert.equal(archiveMockupAttachmentName("MOC AB 03.png"), "alte_Vorschaubilder 03.png");
  assert.equal(archiveMockupAttachmentName("Referenz.jpg"), "alte_Vorschaubilder_Referenz.jpg");
});

test("design ops names replacement uploads from action and source mockup", () => {
  assert.equal(
    designActionAttachmentName(
      "Leuchtfarbe ändern:\nÄndere ausschließlich die sichtbare Leuchtfarbe des Schildes zu orange.",
      "Mockup4600_AI_1.jpeg",
      "3D Backlit Brigitte Kries",
    ),
    "Orange_Mockup4600_AI_1.jpeg",
  );
  assert.equal(
    designActionAttachmentName(
      "Ändere ausschließlich die sichtbare Leuchtfarbe des Schildes zu blau.",
      "Orange_Mockup4600_AI_1.jpeg",
      "3D Backlit Brigitte Kries",
    ),
    "Blau_Mockup4600_AI_1.jpeg",
  );
  assert.equal(
    designActionAttachmentName("Bitte Schildtechnik auf 3D Frontlit ändern.", "Mockup4600_AI_1.jpeg", "Kartenname"),
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
});
