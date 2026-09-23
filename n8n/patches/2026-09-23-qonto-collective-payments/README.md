# TICKET-300: Exact Qonto collective payments

A bank credit referencing multiple NEONT orders previously entered the single-order matcher and failed its amount check. The new branch verifies the bank transaction, every Shopify order, its billing case, and the bound easybill document before allocating integer cents atomically.

The additive RPC uses one root receipt, deterministic case locks, and immutable per-order allocation IDs. Both Shopify projections must complete before invoice jobs become claimable. Cancellation, refund, tax review, or changed totals keep a tagged invoice job from being claimed. Untagged jobs retain their existing rules.

The projection worker rechecks current Shopify totals and verifies the mutation response. For easybill it reads the complete payment history and checks a stable allocation marker before POST. A later attempt without a matching durable payment receipt does **not** POST again; it stops for review. This intentionally favors manual reconciliation over repeating an ambiguous financial write.

## Scope and release order

- NEONTRIP only; n8n Qonto workflow `2fRdyqdyVDMWwH4O`, projection workflow `K9poQw3a1DOO16Vd`.
- Supabase: one additive RPC and a tagged-job-only extension of `billing_job_claim`.
- No application runtime files, bank mutation, price/tax changes, schedule changes, or unrelated workflow changes.
- Confirm authorization for the existing downstream customer invoice delivery before replaying the real receipt.
- Re-read live function definitions and both workflow versions immediately before applying. Abort on drift.
- Apply the SQL migration, publish the projection patch, then publish the Qonto patch. Keep existing activation and settings.
- Use the existing original bank event only after fresh read-only preflight. Verify both Shopify states, each actual final invoice and payment, and conserved bank cents.
- Native n8n history supplies workflow rollback. The SQL rollback restores the original claim function; stop the new intake and resolve pending tagged jobs before using it. Never delete payment evidence.

`build-patch.mjs /path/to/restricted-snapshots` reads `qonto.before.json` and `projection.before.json`, produces reviewable patch operations and after snapshots. Snapshots and real customer data remain outside Git. MCP update currently rejects the server schema; if unchanged, use the authenticated configured n8n API, preserving all unrelated fields, and re-read via MCP.

## Verification

```sh
node --test collective.test.mjs
docker exec -i t300-collective-db psql -U postgres -v ON_ERROR_STOP=1 < database-setup.test.sql
docker exec -i t300-collective-db psql -U postgres -v ON_ERROR_STOP=1 < ../../../supabase/migrations/20260923110000_qonto_collective_payments.sql
docker exec -i t300-collective-db psql -U postgres -v ON_ERROR_STOP=1 < database.test.sql
python3 concurrency.test.py
```

Use only an isolated PostgreSQL 17 container without external networking or production credentials. The schema fixture is synthetic; the ingest function fixture preserves the immediate existing consumer for integration tests. The race test asserts one original receipt and exactly two allocations for four simultaneous deliveries.

Results: 39 unit tests, SQL rollback/idempotency/claim-gate checks, and four simultaneous duplicate deliveries passed. Read-only n8n preflight with real source records reached the proposed allocation and Shopify projection decision without mutation. The general n8n validator reports baseline legacy issues and an unknown installed Qonto community node; connection validation has zero invalid connections. Actual n8n execution validates the added read branch.

## Limits

Shopify `orderMarkAsPaid` has no compare-and-swap amount argument. We verify immediately before the mutation and check the returned totals afterward; a conflicting external order edit can stop subsequent invoicing but cannot be made atomic across Shopify and the database. No automatic refund is attempted. Ambiguous easybill writes stop rather than retry blindly.
