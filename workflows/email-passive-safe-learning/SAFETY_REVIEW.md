# Safety Review — Email Agent Passive Safe Learning v4

## Scope and trust boundaries

Untrusted inputs include incoming email, WhatsApp/support relays, attachments, conversation history, offers, Shopify notes, AI drafts, and manually written sent replies. Any of them can contain incorrect facts, personal data, prompt injection, unsafe promises, or an outdated employee habit.

The AI only proposes a draft. Deterministic workflow code validates it. A human reviews and sends from Outlook. Supabase stores the audit trail and computes content-free style aggregates. No production workflow contains a mail-send action.

## Threat model and controls

- **Historical reply contains a factual correction:** amount, date, attachment, question, commitment, internal-detail, factual-correction, and rewrite signals are excluded.
- **Historical reply teaches “we will clarify internally”:** both draft and sent text are screened for vague deferral phrases; the sample is excluded.
- **Historical reply contains an unsafe promise or discount:** bounded commitment patterns exclude the sample.
- **A large rewrite is mistaken for style:** edit ratio above 0.65 is excluded.
- **A high-risk case pollutes the aggregate:** high-risk records are excluded regardless of manual status.
- **A previous manual decision bypasses the new gate:** approved rows must still satisfy the same v4 semantic, risk, deferral, commitment, and structure checks. Rejected or ignored rows remain excluded.
- **Customer content leaks through the style endpoint:** the reusable view has no draft or sent body columns. RPCs return aggregate numbers, booleans, bounded enums, and reason counts only.
- **A malformed or spoofed profile reaches the model:** workflows require the exact profile version and every deny/approval flag before applying any learned constraint.
- **Learning changes customer facts:** the profile can only tighten word and paragraph limits and select an allowed closing; it cannot add evidence or rewrite the core prompt.
- **Learning causes autonomous communication:** automatic sending remains false and human send approval remains true in the database, workflow context, UI, and final draft gate.

## Input and output validation

- Only valid comparisons from the last 90 days are evaluated.
- Word and paragraph metrics must be present and bounded.
- Three safe samples are required before any profile is eligible.
- Recommended word limits are bounded by reply class; paragraph limits remain within one through five.
- Closing values are limited to `Viele Grüße`, `Beste Grüße`, or no learned override.
- Main and retry paths both use the same generated v4 application code.
- The existing post-generation quality gate still rejects unsupported facts, vague deferral, unsupported commitments, imprecise customer actions, invalid format, and invalid closing.

## Blocked reusable content

Customer identities, email addresses, domains, phone numbers, order or offer numbers, prices, discounts, addresses, dates, attachment content, product details, factual assertions, promises, decisions, URLs, and customer-specific wording are not exposed by or embedded in the reusable profile.

## Authorization, observability, and recovery

- New database functions are `security invoker`; public, anonymous, and authenticated access is revoked; only `service_role` can read or execute them.
- Aggregate metrics expose safe, automatic, human, and blocked counts plus bounded block-reason totals.
- Each successful workflow log records the exact v4 profile version, learning mode, safe sample counts, applied limits, and all no-send safety flags.
- Manual override decisions retain the existing reviewer, reason, note, idempotency, and audit requirements.
- Validated inactive n8n backups and a tested non-destructive database rollback are documented in `README.md`.

## Pre-release evidence

- PostgreSQL 17 proves three safe pending examples activate a passive profile without manual review.
- PostgreSQL 17 proves amount changes, vague internal deferral, and manual rejection do not enter the profile.
- The reusable view exposes no customer body columns.
- Database rollback removes v4 only while preserving v3 and all feedback rows.
- Workflow tests prove both paths accept only the exact v4 safety contract and contain one draft action with no send action.

## Residual risks

- Deterministic patterns can miss unusual semantic changes. Controls: conservative label and ratio gates, no customer content reuse, bounded aggregate outputs, final draft validation, and mandatory human send review.
- Three samples can reflect a temporary style preference. Controls: 90-day window, scope fallback, bounded limits, continuous recomputation, optional manual exclusion, and immediate rollback.
- The matcher can associate an unusual sent reply with the wrong draft. Controls: conversation and time matching, metadata-only aggregation, large-edit exclusion, and no autonomous send.

## Safety scorecard

| Area | Score | Evidence |
| --- | ---: | --- |
| Human control | 5/5 | Draft-only; every customer send remains human-reviewed |
| Data minimization | 5/5 | Aggregate structure only; reusable view has no message bodies |
| Validation | 5/5 | Risk, semantic, ratio, deferral, commitment, version, and output gates |
| Idempotency and audit | 5/5 | Existing comparison and manual-override audit paths retained |
| Reversibility | 5/5 | Validated inactive backups and non-destructive tested rollback |
| Observability | 5/5 | Safe/blocked counts, bounded reasons, profile version, and applied limits logged |

Release condition: deploy only the exact commit printed by `codex-predeploy ops`, then verify the production RPC values and both active draft-only workflow graphs.
