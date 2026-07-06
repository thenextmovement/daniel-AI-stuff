# Design Ops

## Scope

Design Ops is the source-of-truth backed workflow for manual NEONTRIP mockup generation, Trello design cleanup planning, and reviewed offer asset mapping.

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
- `OPS_OPENAI_IMAGE_FORMAT` defaults to `webp`
- `DESIGN_ASSET_BUCKET` defaults to `design-assets`

Downstream n8n worker credentials are configured in n8n credentials, not in the Next.js client.

## Internal API Contract

Ops UI:

- `GET /api/ops/design?query=...`
- `GET /api/ops/design/jobs?status=queued&limit=20`
- `POST /api/ops/design/jobs`
- `POST /api/ops/design/jobs/:jobId/queue`
- `POST /api/ops/design/jobs/:jobId/generate`
- `POST /api/ops/design/jobs/:jobId/trello`
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

Direct generation uses OpenAI's Images API from the server route only. OpenAI's current Image API supports GPT Image models through the image generation endpoint and returns generated image data or URLs depending on model/options. The implementation requests one 1024x1024 image and stores it in Supabase Storage before writing the DB asset row.

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
    "storagePath": "request-id/job-id/mockup.webp",
    "publicUrl": "https://...",
    "mimeType": "image/webp",
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

## Offer-Link Guard

Offer integration always starts from a generated `design_assets` row. The operator selects:

- offer
- existing offer image slot, if the visible offer image should be updated
- product/price anchor, if the design belongs to a specific item

The API loads the live offer, rejects hard locks, supports dry-run checks, and stores the mapping in `design_offer_asset_links`. The current offer API can update existing image metadata but does not create new image rows. If no image slot is selected, the DB link remains `needs_price_review`.

## Rollback

- DB migration rollback: `supabase/rollbacks/20260706102534_create_design_ops_tables_rollback.sql`
- Generated asset rollback: mark `design_assets.status = removed`; remove object from Storage only after DB audit.
- Trello removal rollback: use `design_trello_removal_backups` attachment URLs to restore manually to the card if a confirmed delete was wrong.
- Offer rollback: use the Offer API audit/diff path; `design_offer_asset_links` can be marked `superseded` or `rejected`.

## Production Limits

- Offer image creation is not available through the current internal Offer API; Design Ops only updates an existing image slot or stores a review link.
- No customer-visible communication.
- No direct client access to service-role keys.
