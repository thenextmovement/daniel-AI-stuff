# Safety review

- Source of truth: immutable Shopify order ID plus unique BillingCase.
- Idempotency: unique job key, lease token, exact Easybill document lookup, unique Easybill ID and document number in Ops.
- Fail closed: unknown job type, invalid number, missing customer/document ID, stale lease, open VAT review, amount mismatch and terminal adapter error stop further financial actions.
- Retries: 1, 5 and 15 minutes; fourth failure becomes `BLOCKED`/`SYNC_BLOCKED` and raises `Fehler Rechnung Shopify/Easybill` through the existing n8n error workflow.
- Cancel sequencing: an uninvoiced Shopify cancellation queues the invoice first; the linked cancellation is created only after the invoice record is finalized. The case remains `CANCELLATION_PENDING` until the cancellation document is finalized, and duplicate events/jobs reuse stable idempotency keys.
- Customer communication: document creation never sends. A separate idempotent worker attaches the finalized Easybill PDF, prefers the explicit invoice email and falls back to the retained customer/order email. Missing or invalid recipients are retried and become an urgent FATAL incident after four attempts. The automatic cancel invoice is suppressed; the cancellation produces one message. `last_postbox_id` prevents resend.
- Credentials: placeholders only; no token is stored in this repository.
- Activation: prohibited until isolated migration proof, manual workflow validation, one observed test-recipient canary and explicit production cutover. Existing finalized documents are never backfilled automatically.
- Rollback: deactivate worker first, reconcile every `PROCESSING` job against Easybill by exact number, then use the supplied database rollback only if no created document would be orphaned.
