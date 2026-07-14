# Email Support Knowledge

## Purpose

The Outlook draft agent retrieves only reviewed, time-valid knowledge from the existing Voice Copilot knowledge store. Postgres remains the source of truth. Customer email, attachments and organization history never become approved knowledge automatically.

## Retrieval contract

- Runtime mode: `email_drafting`
- Function: `search_approved_support_knowledge(text, integer)`
- Maximum results: 8; the workflow requests 6
- Only `approved`, time-valid and non-`restricted` versions are returned
- RLS stays enabled; `anon` and `authenticated` remain revoked
- The function is `security invoker` and executable only by `service_role`
- Used version IDs and match count are recorded on `email_agent_log`

## Starter knowledge

Seven low-risk or safety-bounded entries are seeded from the official NEONTRIP help center, the official product overview and the approved email-agent safety contract. Conflicting public claims about warranty duration, delivery time, pricing and service hours are deliberately excluded.

## Safety

Current customer-specific offer and order data outrank general knowledge. Knowledge cannot authorize a price, discount, delivery commitment, warranty decision, refund, credit note, legal conclusion or policy exception. If evidence conflicts or is missing, the draft must state that NEONTRIP will check internally.

## Rollback

1. Restore the pre-knowledge n8n backup or remove the knowledge retrieval node from the active workflow.
2. Apply `supabase/rollbacks/20260714083929_enable_email_support_knowledge_rollback.sql` only if the database feature itself must be disabled.
3. The rollback retires email-only knowledge versions instead of deleting their audit history.
