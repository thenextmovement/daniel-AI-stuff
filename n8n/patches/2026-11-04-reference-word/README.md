# TICKET-245: Qonto exact-reference payment matching
Project PROJ-001 / NEONTRIP; owner Rahim; implementation Codex.
Repository thenextmovement/daniel-AI-stuff; production branch main.
Task branch codex/qonto-reference-word-match-20261104.
Worktree /home/rahim/worktrees/neontrip-ops/qonto-reference-word-match-20261104.
Base commit 3b4ba4e085c801c6ad24fd668995deb2710c5a55.
User authorization: 04 November 2026, focused permanent service repair.

## Scope
Workflow 2fRdyqdyVDMWwH4O (NEONTRIP Qonto Webhook v2 Aktiv).
Only Validate Order/jsCode and Send Error Email/bodyContent changed.
Existing already deployed changes from PR179/212 were compared and preserved;
their historical source files and other workflows are untouched.

For a unique strictly parsed reference and exact positive EUR amount, accept
below 200000 cents without payer identity. At or above that limit accept a
whole normalized payer word in company, customer name, billing/shipping/default
address identity fields. Existing normalization removes legal-form words.
The new rule does not apply to fuzzy references, amount-only rematching,
cancelled orders, foreign currencies or partial payments. Existing paths
including Skonto, duplicate protection, tagging and billing remain intact.
Already paid orders continue with shopifyNeedsUpdate=false.
Plain-text alerts use escaped HTML paragraphs and explicit br tags; existing
HTML and the internal alert gate footer are preserved.

## Verification and release
24 node-level behavioral/mail tests pass. Original matching source fails 10
of these cases. Tests cover exact threshold, mismatch, cancellation, fuzzy
references, duplicate reference candidates, existing paid status and HTML.
No app code changed, so application typecheck/build and app deployment N/A.
Saved and active version c9e69a06-6312-4832-b26e-3e01be2b5a10 verified through
MCP after publication. Only the two expected nodes differ; connections,
settings, credentials and activation are preserved.
MCP save failed due to API settings schema incompatibility; the existing
authenticated n8n API performed the update, retaining server-managed settings.
Native n8n history remains the rollback mechanism; no workflow backup created.
No payment replay, bank mutation or test customer email.

For the requested case, a temporary read-only n8n helper directly confirmed the
final easybill invoice has paid_amount equal to amount (178738 cents).
The existing manual-Shopify-paid reconciler completed both payment projections;
no extra booking was needed. Helper deleted and NOT_FOUND verified.
Internal error gate remains active and routing unchanged. The received alert
provided delivery evidence for the existing route; no new test email sent.
Next actual Outlook delivery of the new HTML has not yet been observed.

Status: service repair live; source PR records the service change, no app merge.
