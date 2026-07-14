drop function if exists public.search_approved_support_knowledge(text, integer);

alter table public.email_agent_log
  drop constraint if exists email_agent_log_knowledge_match_count_check,
  drop column if exists knowledge_match_count,
  drop column if exists knowledge_version_ids;

alter table public.voice_knowledge_versions
  drop constraint if exists voice_knowledge_versions_modes_check;

update public.voice_knowledge_versions
set allowed_modes = case
      when cardinality(array_remove(allowed_modes, 'email_drafting')) = 0
        then array['internal_test']::text[]
      else array_remove(allowed_modes, 'email_drafting')
    end,
    status = case
      when cardinality(array_remove(allowed_modes, 'email_drafting')) = 0
        then 'retired'
      else status
    end,
    updated_at = now()
where 'email_drafting' = any(allowed_modes);

alter table public.voice_knowledge_versions
  add constraint voice_knowledge_versions_modes_check check (
    allowed_modes <@ array[
      'internal_test',
      'lead_qualification',
      'follow_up'
    ]::text[]
    and cardinality(allowed_modes) > 0
  );
