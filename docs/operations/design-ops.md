# Design Ops

## Scope

Design Ops is the source-of-truth backed workflow for manual NEONTRIP mockup edits, durable bulk generation, Trello replacement, and reviewed offer updates.

Trello is a projection. The database stores design jobs, prompt versions, generated assets, removal backups, and offer mapping proposals.

## Runtime Environment

Required server-side variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRELLO_API_KEY`
- `TRELLO_TOKEN`
- `DESIGN_WORKER_API_KEY`
- `OPS_OPENAI_API_KEY` or `OPENAI_API_KEY` for direct in-app generation

Optional:

- `OPS_OPENAI_IMAGE_MODEL` defaults to `gpt-image-1.5`
- `OPS_OPENAI_IMAGE_EDIT_MODEL` defaults to `OPS_OPENAI_IMAGE_MODEL` and then `gpt-image-1.5`
- `DESIGN_ASSET_BUCKET` defaults to `design-assets`
- `DESIGN_SOURCE_IMAGE_HOSTS` is a comma-separated allowlist for generated image sources outside the configured Supabase and Offers hosts

All Design Studio image edits request and store JPEG. Normal KI mockup generation accepts original and generated references whose filename contains `Mockup` and ends in `.jpg` or `.jpeg`. Structured color changes, product changes and customer variants additionally require `AI` in the filename. Downloaded bytes must have a JPEG signature, and archived `alte_Vorschaubilder...` files are always excluded.

## Structured Actions

The UI does not derive an action from free text for bulk work. It stores one immutable action per job and batch:

- `light_color`: exactly one of Kaltweiß, Warmweiß, Grün, Blau, Eisblau, Rot, Orange, Zitronengelb, Goldgelb, Pink, Lila, Türkis
- `product_change`: `3D Frontlit` or `3D Backlit`

Each selected source attachment creates one batch item, one design job, and one generated asset. The server builds the edit prompt. Each item is independently claimable and retryable up to three times.

Downstream n8n worker credentials are configured in n8n credentials, not in the Next.js client.

## Internal API Contract

Ops UI:

- `GET /api/ops/design?query=...`
- `GET /api/ops/design/jobs?status=queued&limit=20`
- `POST /api/ops/design/jobs`
- `POST /api/ops/design/jobs/:jobId/queue`
- `POST /api/ops/design/jobs/:jobId/generate`
- `POST /api/ops/design/jobs/:jobId/trello`
- `POST /api/ops/design/canaries`
- `POST /api/ops/design/batches`
- `GET /api/ops/design/batches/:batchId`
- `POST /api/ops/design/batches/:batchId/process`
- `DELETE /api/ops/design/batches/:batchId`
- `POST /api/ops/design/removal-plans`
- `POST /api/ops/design/removal-plans/:planId/apply`
- `GET /api/ops/design/offers/:offerId`
- `POST /api/ops/design/offer-links`

Worker only:

- `GET /api/ops/design/worker/jobs?limit=5`
- `POST /api/ops/design/worker/jobs`
- `POST /api/ops/design/worker/callback`

Worker routes require:

```http
Authorization: Bearer $DESIGN_WORKER_API_KEY
```

No worker route accepts browser sessions or public client keys.

Direct generation uses OpenAI's Image Edit API from the server only. The implementation sends exactly one eligible source image per structured action, requests one 1024x1024 JPEG, verifies its magic bytes and 12 MB limit, stores it in Supabase Storage, and only then writes the asset row.

`POST /api/ops/design/canaries` provisions one idempotent internal acceptance
job with its own generated source JPEG. The job has no request, customer,
Trello card or Offer reference and requires the exact confirmation
`CONTROL_TOWER_MOCKUP_CANARY_V1`. It exists only so operational clients can
prove generation and persisted-asset verification without touching customer
records.

## Durable Batch Lifecycle

1. `POST /batches` validates the selected Trello attachments and persists the batch plus one item per source image.
2. The UI stores the active batch ID in local storage before processing.
3. `POST /process` claims one item with `FOR UPDATE SKIP LOCKED`, generates it, and optionally replaces its own source attachment.
4. Failed or stale items are retryable up to three attempts. Reloading the page resumes the stored batch.
5. Progress reports generated, replaced, and failed item counts. A batch is complete only when no item is pending or retryable.

An interrupted parent row with no items is repaired by an idempotent create retry. A partially populated batch is blocked for administrative review rather than processed ambiguously.

## Worker Callback

Generated:

```json
{
  "jobId": "uuid",
  "idempotencyKey": "n8n-execution-id:job-id",
  "status": "generated",
  "workerRunId": "n8n-execution-id",
  "asset": {
    "assetKey": "optional-stable-key",
    "storageBucket": "design-assets",
    "storagePath": "request-id/job-id/mockup.jpg",
    "publicUrl": "https://...",
    "mimeType": "image/jpeg",
    "width": 1600,
    "height": 1200,
    "name": "Mockup 1"
  }
}
```

Failed:

```json
{
  "jobId": "uuid",
  "idempotencyKey": "n8n-execution-id:job-id",
  "status": "failed",
  "workerRunId": "n8n-execution-id",
  "errorMessage": "Generator returned invalid image"
}
```

## n8n Workflow Shape

One workflow, max 30 nodes:

1. Cron or manual trigger
2. Fetch queued jobs from `/api/ops/design/worker/jobs`
3. Validate response schema
4. Split in batches
5. Mark job as `generating`
6. Generate image
7. Validate image response
8. Store asset in Supabase Storage or S3
9. Callback `generated`
10. Error branch callback `failed`
11. Audit log / operator alert

Every side effect uses an idempotency key derived from n8n execution id plus job id.

## Trello Cleanup Guard

Bulk cleanup is two-step:

1. Ops creates a `design_trello_removal_backups` row with attachment id, name, type, original URL, card id, operator and reason.
2. Ops confirms deletion with the exact text `ENTFERNEN`.

Only the second request calls Trello DELETE. Repeated apply calls do not delete again once the backup row is `applied`.

## Trello Replacement

Replacement is per batch item:

1. Upload the generated JPEG using the structured action prefix and source name, for example `Orange_Mockup4600_AI_1.jpg`.
2. Persist the new Trello attachment ID on the generated asset.
3. Rename that item's old source to `alte_Vorschaubilder...` so it remains on the card but no longer matches offer mockup detection.
4. Repeated calls return the persisted attachment instead of uploading another copy.

## Offer-Link Guard

Offer integration always starts from a generated `design_assets` row. The operator selects:

- offer
- existing offer image slot, if the visible offer image should be updated
- product/price anchor, if the design belongs to a specific item

The API loads the live offer, rejects hard locks and Trello-card mismatches, supports dry-run checks, and stores the mapping in `design_offer_asset_links`. If the source Trello attachment already maps to an Offer image/product, a conflicting manual selection is rejected. A selected offer image slot is updated with the generated asset URL, not only renamed. Light-color labels come from the asset's stored structured action. Product changes update the item title/description and require an explicitly confirmed reviewed net price. Offer sending is blocked while any design link remains `needs_price_review`.

## Rollback

- DB migration rollback: `supabase/rollbacks/20260706102534_create_design_ops_tables_rollback.sql`
- Batch hardening rollback: `supabase/rollbacks/20260715211543_harden_design_engine_batches_rollback.sql`
- Generated asset rollback: mark `design_assets.status = removed`; remove object from Storage only after DB audit.
- Trello removal rollback: use `design_trello_removal_backups` attachment URLs to restore manually to the card if a confirmed delete was wrong.
- Offer rollback: use the Offer API audit/diff path; `design_offer_asset_links` can be marked `superseded` or `rejected`.

## Production Checks

- Design Ops updates an existing Offer image slot; it does not create an arbitrary new Offer image row.
- No customer-visible communication.
- No direct client access to service-role keys.
- Run `npm run test:quotes`, `npm run build`, and the linked Supabase migration dry run before release.
- Run `codex-predeploy offers` before the Offers deployment and `codex-predeploy ops` before the Ops deployment. Deploy only the exact commits printed by those commands.
