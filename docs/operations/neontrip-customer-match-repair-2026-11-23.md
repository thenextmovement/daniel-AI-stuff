# NEONTRIP Customer Match repair, 2026-11-23

## Scope and contract

- Ziel: admit current `neontrip.de` / `www.neontrip.de` form sources through the existing source and consent rules; resume receipt reconciliation after 26 provider checks.
- Nachbar: preserve existing source branches, consent requirements, buyer-first removal dependencies, provider terminal transitions, payload dispatch, list IDs, permissions and workflow graphs. RIESENOBJEKTE is outside scope.
- Wirkung: existing scheduled source refresh can create eligible memberships; existing provider-status workflow can read accepted request receipts again. No payload resend is introduced. No campaigns are activated.
- Allowed changes: three existing public functions in NEONTRIP database `klibiejfisijpagzkxls`, through the migration and its guarded function-only rollback.

## Concrete defects and repair

The live source function accepts the legacy inquiry host but omits the current main domains. Add an anchored, case-insensitive current-host match in all three existing source/consent locations. Preserve all other eligibility rules.

28 processing batches with 29 membership actions have status_attempts=26. The live due-status reader excludes attempts >=26, so these accepted requests stop being reconciled. Remove that hard stop. For a provider response still PROCESSING after 26 checks, use daily status reads and mark diagnostics for manual review. Never infer failure or resend an uncertain request. Existing provider failure and success handling remains unchanged.

One dispatching removal without a provider request ID is a separate unresolved case. This migration neither retries nor resets it. Four buyer-dependent removals can progress only after authoritative buyer confirmation.

## Canonical active implementation inspected

- Source Refresh: `Jtc6txdzcFSs4ZUH`, active version `43e8b5a0-e467-4a96-95f9-b180fb64960d`.
- Dispatcher: `iyd9dKfm5YWlV6jw`, active version `cce83b48-a67e-403b-b9dd-12ed7dad5258`.
- Provider Status: `Q2pMbUBb1VDTdfzX`, active version `35643b69-455a-46b8-aec2-30882268e0e8`.

No n8n workflow changes are required. Migration derives from freshly read pg_get_functiondef, not a historical workflow export. Function hash guards fail closed on drift. CREATE OR REPLACE preserves the existing signatures, security settings and grants. Existing tables are locked briefly within the migration transaction.

## Verification completed before release

All database checks ran in explicit transactions ending in ROLLBACK; no provider calls or committed membership mutations were triggered.

- Seven hostname boundary cases: both current hosts accepted; deceptive hosts, RIESENOBJEKTE and preview domains rejected by the added predicate.
- All 28 overdue requests were selected after the repair. A PROCESSING response for attempt 26 retained the batch, incremented its counter and scheduled the next read after 1440 minutes with explicit review diagnostics.
- A real-source refresh simulation added 79 all_inquiries memberships, 80 current_lp source memberships and 75 without_purchase memberships. Only 2 new all_inquiries rows and 3 source-only rows were consent/sync eligible. These segment counts overlap and are not unique people or immediate Ads reach.
- Latest inquiry in simulated membership source reached 2026-11-23 11:17 UTC. Existing google_state values did not change; no unrelated new source classes appeared.
- Apply followed by guarded rollback restored all three original function definitions exactly.
- Final function diff reviewed: only the three domain predicates, status cutoff and prolonged-PROCESSING cadence/diagnostics change.

## Release and runtime acceptance

Not yet released. Follow repository AGENTS.md: obtain approval for the exact clean full commit SHA; run codex-predeploy ops and the supported release helper from that same worktree before a potentially deploying push. Applying a database migration is a separate transactional step; Git publication alone does not prove its application.

Immediately before database application re-read function definitions and active workflow versions. Apply only this migration in one transaction through the existing supported Supabase path. Do not run the entire pending migration history. Verify the three resulting definitions, function privileges and unchanged workflow graphs. The existing dispatcher/refresh schedule should create eligible current-source memberships; the next status run should issue reads for formerly capped receipts. Record actual provider outcomes and buyer-dependent removals. If receipts are no longer retrievable, retain uncertainty and investigate instead of resending.

Rollback file restores function behavior only. It never overwrites membership/provider evidence created since release. It reintroduces the old domain/cutoff defects, so use only when a concrete regression warrants it.

## Deliberate self-review

A high historical signature share within seven days is not proof of advertising incrementality or a lead-to-payment distribution. This repair restores the existing pipeline only. It does not create offer-age segments, broaden consent, invent provider completion, increase spend or add a new service/schema/workflow. Final acceptance still requires current provider receipts and usable audience population; preparation and rollback tests are not runtime proof.
