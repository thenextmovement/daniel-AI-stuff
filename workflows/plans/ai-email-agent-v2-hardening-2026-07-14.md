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
- Exact inactive backup: `2bKIDtdwCeP5yVZs`
- Previous exact inactive backup: `sX1iLApuwN6O8tvI`
- Local audited builder: `/Users/danielklesse/n8n-audits/ai-email-agent-v2/build-workflow.mjs`
- Local regression suite: `/Users/danielklesse/n8n-audits/ai-email-agent-v2/test-workflow.mjs`

## Release gates

1. Apply `20260714145500_harden_email_agent_runtime.sql`.
2. Verify RPC execute grants are service-role only and RLS remains enabled.
3. Validate the generated n8n workflow with the runtime profile.
4. Update the inactive/draft n8n graph, run regression fixtures, and inspect the diff.
5. Publish only after the dry validation has zero errors and zero warnings.
6. Monitor executions, lock states, draft-only behavior, relay identity, and reply length.

## Rollback

1. Restore n8n from backup workflow `2bKIDtdwCeP5yVZs` or the version immediately preceding the hardening publish.
2. Apply `supabase/rollbacks/20260714145500_harden_email_agent_runtime_rollback.sql` only after the old n8n workflow is active again.
3. Confirm no `/send` or `sendMail` action exists and that existing Outlook drafts remain untouched.

## Required regression cases

- A current clarification with a quoted old message must not inherit attachment claims or dates from the quote.
- A Nerdy Apps form mail must resolve to its verified Reply-To customer, never `nerdy-apps.com`.
- A moved Outlook message must resolve to the current Graph ID through `internetMessageId`.
- A message that says an order confirmation is attached while only a delivery note is present must request the missing order confirmation and explain the address requirement.
- Internal viewed/opened metadata must never appear in the customer draft.
- A production-start promise without verified authorization must force a safe fallback.
- Acknowledgements must be no longer than two short paragraphs.
- The resulting workflow must contain exactly one `createReply` action and no send action.
