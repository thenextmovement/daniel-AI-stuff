drop function if exists public.claim_due_email_agent_retry_v2(text, integer);

-- The targeted data repair is intentionally not reversed: clearing a recovered
-- Graph message ID or restoring an incorrectly final status would recreate the
-- production incident. Deactivating the retry workflow removes all side effects.
