# NEONTRIP Design Generation Worker v0.1

## Plan

Build an inactive n8n worker that consumes queued Design Ops jobs, generates mockups, stores assets, and reports status back to Ops.

## Node Structure

1. Manual Trigger or Cron Trigger
2. HTTP Request: `GET /api/ops/design/worker/jobs?limit=5`
3. Code: validate `ok === true` and `jobs[]`
4. Split In Batches
5. HTTP Request: `POST /api/ops/design/worker/jobs` to mark `generating`
6. Code: build generator payload from `promptVersion.promptText`
7. Generator API request
8. Code: validate image URL/blob and dimensions
9. Storage upload
10. HTTP Request: `POST /api/ops/design/worker/callback` with `generated`
11. Error branch: `POST /api/ops/design/worker/callback` with `failed`
12. Alert/audit node

## Credentials

Use existing n8n credential stores where available:

- Supabase API credential for database/storage-side calls
- Trello API credential is not required in the worker; Trello attach/delete is performed by Ops API routes after operator review
- Shopify credential is not required for Design Worker v0.1
- `DESIGN_WORKER_API_KEY` as header auth for Ops worker API

No credential value belongs in workflow JSON or repository files.

## Idempotency

Use:

```text
design-worker:${execution.id}:${job.id}
```

For asset keys, either pass a stable `asset.assetKey` or let Ops derive one from job id, prompt version, and idempotency key.

## Risks

- Generator can return a broken or irrelevant image.
- Storage upload can succeed while callback fails.
- Worker can retry and create duplicate external artifacts if idempotency is not passed.
- Trello and Offer writes are intentionally separate operator actions after generation.

## Test Plan

1. Run against one queued staging job.
2. Verify job moves `queued -> generating -> generated`.
3. Verify one `design_assets` row is created or updated.
4. Repeat same execution payload and confirm no duplicate asset.
5. Force generator failure and verify job becomes `failed`.
6. Attach one generated asset from Ops UI and verify Trello receives a single attachment.
7. Re-run attach and verify no duplicate attachment is created when `trello_attachment_id` exists.

## Rollback

Deactivate workflow. Mark affected jobs back to `queued` or `failed` from DB after review. Remove generated storage objects only after checking `design_assets` audit state.
