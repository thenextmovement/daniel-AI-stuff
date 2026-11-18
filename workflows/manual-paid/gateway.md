# Manual-Paid claim independent of OPS deployments

Execution 12412959 failed at 2026-11-18 12:04:28 UTC with Cloudflare
origin_bad_gateway (502), immediately after a successful OPS health GET.
Coolify deployment hyppwwull2xslmcj0hf4bt7a ran 12:03:04–12:04:42 UTC.
This establishes deployment overlap and an origin failure, not the exact
proxy/socket cause (scoped API cannot read sensitive runtime logs).
No receipt exists for that execution; its selected order remains unknown.
Candidate #NEONT4863 already has paid/invoiced state and all jobs DONE.

The four-node patch changes only readiness and the main admit/claim transport.
It invokes the identical existing billing_manual_paid_claim RPC directly using
the workflow's existing Supabase credential, independent of the OPS web server.
Readiness reads zero receipt rows. The former OPS route's exact input validator
and source-revision normalization are embedded in Restore Verified Billing Intake.
A source-parity test prevents silent validator drift. The SQL RPC also validates
its input and remains service-role-only. No schema change or new credential.

No claim retries, recovery, payment replay, customer messages or changes to
selection/leases/completion. Existing 65-second pre-claim wait and error workflow
remain. Supabase/network failure can still happen and must remain visible; no
promise of zero future service failures. Other workflow operations are unchanged.

Verification: five node/contract tests; isolated PostgreSQL receipt/backoff/unknown
result/rollback/reapply tests; n8n validateOnly; real n8n probe reads readiness then
sends an empty invalid RPC request, rejected with 400 MANUAL_PAID_REQUEST_INVALID
before any mutation. Typecheck/build results recorded in task handoff.

Apply only against gateway-baseline version and affected-node equality, preserving
all other nodes, connections, settings, staticData and active state; verify readback
and a natural execution/receipt. Roll back through native n8n history if needed.
Existing support@neontrip.de alert routing and dedupe remain unchanged.
