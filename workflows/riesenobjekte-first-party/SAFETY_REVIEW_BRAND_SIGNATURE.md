# RIESENOBJEKTE Auto-Reply Brand Signature Safety Review

## Findings

- The published RIESENOBJEKTE auto-reply currently renders a text-only sign-off.
- The approved local RIESENOBJEKTE signature contains Fabienne Trapp's photo and
  the black/lime RIESENOBJEKTE wordmark.
- The NEONTRIP auto-reply already matches its approved local signature, including
  Fabienne's photo and the separate NEONTRIP logo image. It requires no workflow
  change.
- This patch changes only the deterministic RIESENOBJEKTE HTML signature shared by
  the normal and missing-design replies. Triggering, validation, delay, sender,
  recipients, BCC, idempotency and failure handling remain unchanged.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 5 | Both customer reply variants use one fixed brand signature |
| reliability | 5 | No trigger, wait, SMTP or failure-path changes |
| idempotency | 5 | Existing submission lock and result recording remain unchanged |
| observability | 5 | Existing reply-kind and SMTP result records remain unchanged |
| security | 5 | Fixed HTML only; no untrusted input is introduced into the signature |
| tracking impact | 5 | No tracking, attribution or routing field changes |
| cost risk | 5 | No additional service or model call |

## Required Fixes

None after strict patch validation, asset checks and rendered HTML QA pass.

## QA Plan

- Verify the published graph still has 25 nodes and the same connections.
- Verify both normal and missing-design HTML contain Fabienne's photo once and the
  RIESENOBJEKTE wordmark once.
- Verify no NEONTRIP branding or address leaks into RIESENOBJEKTE replies.
- Verify sender, reply-to, BCC and six-minute Wait node are unchanged.
- Strict n8n validation must report zero errors before and after publish.

## Rollback

Restore and publish the exact inactive pre-change backup recorded in
`production-backups-2026-08-07.json`, then verify the active graph and webhook.
