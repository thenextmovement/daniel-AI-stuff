drop function if exists public.promote_voice_knowledge_candidate(uuid, text, text, text, text);
drop function if exists public.review_voice_knowledge_version(uuid, text, text);
drop function if exists public.create_voice_knowledge_draft(text, text, text, text[], text, jsonb, text, text, text[]);
drop function if exists public.search_approved_voice_knowledge(text, text, integer);
drop table if exists public.voice_call_sessions;
drop table if exists public.voice_knowledge_candidates;
drop table if exists public.voice_knowledge_chunks;
drop table if exists public.voice_knowledge_versions;
drop table if exists public.voice_knowledge_articles;
