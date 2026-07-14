# AI Email Agent v2 hardening

## Scope

- Draft-only Outlook replies; no send action.
- Split the newest authored message from quoted history before intent, date, risk, attachment, and knowledge checks.
- Resolve moved Outlook messages by conversation plus `internetMessageId`.
- Normalize allowlisted form relays to the verified Reply-To customer and never treat the relay domain as a customer organization.
- Resolve related contacts through Postgres sources of truth with a bounded time window. Domain matches are candidates, not proof of a shared project.
- Replace permanent insert-only locks with leased, retry-aware processing state.
- Enforce concise reply classes and block unverified production-start promises.
- Store draft review metadata and provide an idempotent feedback RPC.
- Add approved email-drafting knowledge for attachments, concise replies, production promises, and organization context.

## Production workflow

- Workflow ID: `ET6R8SAOjAquCpaH`
- Name: `AI Email Agent v2 — Draft Only`
- Pre-change active version: `0dfb077e-d8a0-4691-9a33-2b126161e66f`
- Hardened active version: `b87ea75b-229e-4ea9-8aac-d0af10b0f315`
- Exact inactive backup: `2bKIDtdwCeP5yVZs`
- Previous exact inactive backup: `sX1iLApuwN6O8tvI`
- Local audited builder: `/Users/danielklesse/n8n-audits/ai-email-agent-v2/build-workflow.mjs`
- Local regression suite: `/Users/danielklesse/n8n-audits/ai-email-agent-v2/test-workflow.mjs`

## Feedback collector

- Workflow ID: `bAXM54PasUD8IFNx`
- Name: `AI Email Agent v2 — Review Feedback Collector`
- Active version: `06f76e47-70d7-4814-a296-6df5c8343ccb`
- Only rows with a request ID and stored draft body are eligible.
- Outlook desktop, Gmail, blockquote, and Outlook mobile quoted-history containers are removed before comparison.
- A sent reply is eligible only when its timestamp is at or after draft creation, with a 30-second clock tolerance.
- Known-invalid measurements from preflight execution `3104543` are retained for audit but marked `is_valid = false`.

## Release gates

1. Apply `20260714145500_harden_email_agent_runtime.sql`, `20260714150500_scope_email_agent_feedback.sql`, and `20260714151000_quarantine_faulty_email_feedback.sql` in that order.
2. Verify RPC execute grants are service-role only and RLS remains enabled.
3. Validate the generated n8n workflow with the runtime profile.
4. Update the inactive/draft n8n graph, run regression fixtures, and inspect the diff.
5. Publish only after the dry validation has zero errors and zero warnings.
6. Monitor executions, lock states, draft-only behavior, relay identity, and reply length.

## Release result

- Final repository commit: `1aeaa7f3b48a968e15da2278d3bb4d069a757ffc`
- `codex-predeploy ops` approved that exact commit before the final workflow update.
- Main regression suite: 141 checks passed.
- Feedback collector regression suite: passed, including empty legacy rows, Outlook mobile quotes, and pre-draft sent messages.
- Runtime validation: both production workflows have zero errors and zero warnings.
- Live graph: exactly one `createReply`, zero send actions, and the verified Fabienne photo/logo signature.
- First clean feedback schedule execution: `3104887`; no pending drafts, no Outlook sent-message lookup, no feedback write.
- First two post-publish main executions completed successfully and correctly ignored internal-only messages.

## Rollback

1. Restore n8n from backup workflow `2bKIDtdwCeP5yVZs` or the version immediately preceding the hardening publish.
2. Deactivate the feedback collector and apply the feedback rollbacks in reverse order: `20260714151000_quarantine_faulty_email_feedback_rollback.sql`, then `20260714150500_scope_email_agent_feedback_rollback.sql`.
3. Apply `supabase/rollbacks/20260714145500_harden_email_agent_runtime_rollback.sql` only after the old n8n workflow is active again.
4. Confirm no `/send` or `sendMail` action exists and that existing Outlook drafts remain untouched.

## Required regression cases

- A current clarification with a quoted old message must not inherit attachment claims or dates from the quote.
- A Nerdy Apps form mail must resolve to its verified Reply-To customer, never `nerdy-apps.com`.
- A moved Outlook message must resolve to the current Graph ID through `internetMessageId`.
- A message that says an order confirmation is attached while only a delivery note is present must request the missing order confirmation and explain the address requirement.
- Internal viewed/opened metadata must never appear in the customer draft.
- A production-start promise without verified authorization must force a safe fallback.
- Acknowledgements must be no longer than two short paragraphs.
- The resulting workflow must contain exactly one `createReply` action and no send action.
