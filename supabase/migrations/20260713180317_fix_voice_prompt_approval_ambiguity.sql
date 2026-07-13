create or replace function public.approve_voice_prompt_version(
  p_prompt_version_id uuid,
  p_actor text,
  p_idempotency_key text
)
returns table (prompt_version_id uuid, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text;
begin
  perform pg_advisory_xact_lock(hashtext('voice_prompt_approval'));
  if exists (
    select 1
    from public.voice_platform_audit_log as audit
    where audit.idempotency_key = p_idempotency_key
  ) then
    return query
      select p_prompt_version_id,
        coalesce((
          select prompt.status
          from public.voice_prompt_versions as prompt
          where prompt.id = p_prompt_version_id
        ), 'retired');
    return;
  end if;

  select prompt.mode
  into v_mode
  from public.voice_prompt_versions as prompt
  where prompt.id = p_prompt_version_id
  for update;

  if v_mode is null then
    raise exception 'voice prompt version not found';
  end if;

  update public.voice_prompt_versions as prompt
  set status = 'retired', updated_at = now()
  where prompt.mode = v_mode
    and prompt.status = 'approved'
    and prompt.id <> p_prompt_version_id;

  update public.voice_prompt_versions as prompt
  set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
  where prompt.id = p_prompt_version_id;

  insert into public.voice_platform_audit_log (
    actor, action, target_type, target_id, idempotency_key
  ) values (
    p_actor,
    'prompt_approved',
    'voice_prompt_version',
    p_prompt_version_id::text,
    p_idempotency_key
  );

  return query select p_prompt_version_id, 'approved'::text;
end;
$$;
