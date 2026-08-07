# RIESENOBJEKTE Missing-Attachment Safety Review

## Findings

- No high- or medium-severity finding remains before deployment.
- The change has no AI output, pricing, delivery promise, tracking or cross-brand data
  dependency.
- The existing normal deterministic copy retains its one-business-day wording; this
  patch does not expand or generate that commitment.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 5 | Direct binary-file count plus tested deterministic exceptions |
| reliability | 5 | Existing wait, SMTP verification and failure recording remain unchanged |
| idempotency | 5 | Existing submission lock and no-retry SMTP behavior remain unchanged |
| observability | 5 | Reply kind is stored in the existing context snapshot and SMTP result is recorded |
| security | 5 | Fixed templates, escaped name, untrusted project text never copied into reply |
| tracking impact | 5 | No analytics, attribution or routing fields are changed |
| cost risk | 5 | No model call or additional external service call |

## Required Fixes

None after strict patch validation and behavior tests pass.

## QA Plan

- Zero files plus ordinary project text selects `missing_design`.
- One or more files selects `normal`.
- “No design”, design-service request and supplied wording select `normal`.
- Prompt-injection-style text cannot alter either template.
- Sender, reply-to, BCC and six-minute wait remain unchanged.
- Strict n8n validation must report zero errors before and after publish.

## Rollback

Restore active workflow `1hRkUxPXUZoYRSgL` from inactive exact backup
`7BDTyn3zmGIj72Ub`, validate, publish and verify the webhook trigger.
