# KI-Video Offer Delivery Auto-Recovery

## Scope

This change hardens the active `KI-Video Generator v1.0 - Neue Angebote schicken + KI-Video`
workflow. It does not weaken recipient validation, pricing validation, offer acceptance, or
customer-email idempotency.

## Recovery Matrix

| Failure | Automatic action | Limit | Customer communication |
| --- | --- | ---: | --- |
| Video QC inconclusive | Generate one locked/static retry video | 2 video attempts | None before a valid/fallback delivery |
| Video QC finds a concrete defect | Generate one locked/static retry video, then discard the rejected video and send the offer without video | 2 video attempts | One idempotent offer delivery |
| Grok/xAI 429/502/503/504 or transient network failure | Release the queue lease and retry; after the queue attempt limit, send the offer without video | Queue `max_attempts` | One idempotent offer delivery |
| Offer/Trello API 429 or transient 5xx/network failure | Rebuild on the next queue attempt | Queue `max_attempts` | None before confirmed delivery |
| Preview-delivery payload blocked before Outlook | Rebuild on the next queue attempt | Queue `max_attempts` | None; the delivery workflow confirmed it did not send |
| Missing or invalid customer email | Manual data correction | No blind retry | Never redirected to an internal address |
| Pricing/size-ladder validation failure | Manual pricing correction | No blind retry | None |
| Ambiguous Outlook/network outcome | Manual delivery-proof review | No blind retry | Prevents duplicate customer emails |

## Important Guards

- A system-generated `FEHLER` prefix no longer blocks the workflow's own recovery.
- Moving a corrected `FEHLER` card back into the send list enqueues it again; sent labels remain
  the duplicate-send guard.
- Explicit `ANGEBOT NICHT SENDEN` / `DO NOT SEND` still blocks delivery.
- Video-specific blocking labels still block delivery.
- Rejected generated or reused videos are removed before offer-only fallback.
- Offer-only fallback never adds the `Video gesendet` label.
- `Angebot gesendet` is still set only after the delivery workflow confirms customer delivery.
- Existing delivery-cycle and email-idempotency keys remain unchanged.

## Rollback

1. Restore the pre-change workflow JSON backup with the n8n API.
2. Confirm workflow `9FoJMH6OUdsi36FB` is active and its version ID matches the restored copy.
3. Run a send-free queue-empty execution and verify that no card is claimed.
4. Do not replay failed customer deliveries until the delivery ledger has been checked.

## Verification

```bash
node scripts/build_ki_video_auto_recovery_workflow.mjs before.json after.json
node scripts/test_ki_video_auto_recovery_workflow.mjs after.json
```
