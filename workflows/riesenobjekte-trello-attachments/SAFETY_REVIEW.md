# RIESENOBJEKTE attachment persistence and Trello projection safety review

## Scope

This is a repair and a bounded extension of the active first-party intake,
Supabase outbox and Trello Actions projection. Postgres remains the source of
truth and Trello remains a projection. No customer-email, pricing, tracking,
routing or NEONTRIP behavior is changed.

## Controls

- The Edge Function still requires Supabase gateway JWT verification and then
  independently requires the exact service-role secret, supplied as either the
  `apikey` header or the existing n8n Bearer credential.
- Storage bucket, object path, UUIDs, board, card, file name, MIME type, byte
  size and SHA-256 are allowlisted or validated before Trello access.
- One deterministic outbox idempotency key exists per database attachment.
- The worker checks Trello for an existing attachment with the same original
  file name and byte size before upload. The upload request itself is not
  automatically retried; a later outbox retry repeats the read-before-write
  check first.
- Card creation and attachment recording serialize through the project row, so
  either completion order produces exactly one projection job.
- Existing move, comment and supplier-label paths retain their nodes,
  credentials, payloads and completion behavior.

## Verification

- Exact inactive n8n backups exist for the intake, card creation and action
  worker workflows.
- The database migration and its race-order, idempotency, completion and
  unchanged-action assertions ran inside a production transaction followed by
  `ROLLBACK`; no test rows or schema changes remained.
- The full database rollback was applied after the migration inside a second
  transaction and rolled back; the original constraint and functions were
  restored in that test.
- The Edge Function auth test covers service-role `apikey`, service-role
  Bearer, wrong credentials and missing credentials.
- All eight new n8n nodes pass runtime node validation, and the 30-operation
  workflow patch passes n8n dry-run validation against the exact active
  version.

## Rollback

Restore the Trello Actions worker from inactive workflow
`zjDDMGNHBi9LZnfr` and publish it. Restore Edge Function version 6 from
`supabase/functions/ro-first-party-attachment-ingest/backups/index.v6.ts` with
`verify_jwt=true`. This immediately stops new Trello attachment projections.

The database extension may safely remain inert. A full database rollback is
available in
`supabase/rollbacks/20260811110000_riesenobjekte_trello_attachment_projection_rollback.sql`;
it intentionally refuses to run after attachment outbox rows exist, because
silently deleting operational history would be unsafe.
