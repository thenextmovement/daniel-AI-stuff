# Internal n8n email inventory — 2026-07-20

This is the pre-change snapshot used to select the consolidation scope.

## Volume

- 530 workflows total.
- 148 active workflows.
- 326 inactive and unarchived workflows.
- 56 archived workflows.
- 48 direct internal-email nodes across 31 active workflows.
- Outlook inbox sample: 55 messages, of which 30 were self-sent internal messages.
- One observed burst contained 20 workflow-error emails within roughly 90 seconds.

## 30-day backtest

- Period: 2026-06-20 through 2026-07-20.
- Total mailbox messages inspected: 5,898.
- Technical handler messages: 466 mailbox objects for 233 actual n8n executions.
- Stable historical failure fingerprints: 43.
- Immediate technical emails with a 24-hour fingerprint cooldown: 84.
- Estimated reduction: 63.9%.
- Custom or critical business warnings excluded from suppression: 52.

## Central error handlers

| Workflow | ID | Active source workflows | Current recipient |
|---|---|---:|---|
| Error Notification → info@NeonTrip.de | `M4uG1HAtN9Zggxww` | 46 | `info@neontrip.de` |
| NEONTRIP Error Alerting v1.0 | `ArT3LN25Mb1PAuBE` | 10 | `support@neontrip.de,rh@neontrip.de` |
| Customs Error Notifier | separate workflow | 8 | unchanged in phase 1 |
| Mockup error handler | separate workflow | 2 | unchanged in phase 1 |

The first two handlers are adapters to the shadow router. The 56 source workflows are not repointed.

## High-confidence cleanup candidates

1. Repeated technical failures with the same workflow, node, root-cause class, and normalized error signature. These should become one open incident whose `last_seen_at` advances.
2. Success/status heartbeats that carry no decision or action. These should move to a digest only after workflow-specific review.
3. Active workflows whose names indicate obsolete state:
   - `Customs CI Cleanup (LÖSCHEN)`
   - `NEONTRIP Supplier Payment Reminder Email v0.1 (INACTIVE DRAFT)`
4. Two active KI-video generators with overlapping alerting and one-minute versus three-minute schedules. Their business outputs must be compared before one is disabled.

## Not safe to suppress globally

- first occurrence of a hard workflow failure;
- credential, permission, payment, order, fulfillment, or customer-impacting incidents;
- business notifications without a stable entity/idempotency key;
- any message whose only evidence is its subject line or workflow name.

Archive cleanup is a separate later phase. No workflow is deleted by this rollout.
