create or replace function public.select_voice_model_candidate(
  p_release_id uuid,
  p_actor text,
  p_idempotency_key text
)
returns table (release_id uuid, lifecycle text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('voice_model_candidate'));
  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    return query select p_release_id, coalesce((select model.lifecycle from public.voice_model_releases model where model.id = p_release_id), 'retired');
    return;
  end if;
  if not exists (select 1 from public.voice_model_releases as model where model.id = p_release_id and model.lifecycle in ('available', 'candidate')) then
    raise exception 'model release cannot become candidate';
  end if;
  update public.voice_model_releases as model set lifecycle = 'available', updated_at = now() where model.lifecycle = 'candidate';
  update public.voice_model_releases as model set lifecycle = 'candidate', updated_at = now() where model.id = p_release_id;
  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key)
  values (p_actor, 'model_candidate_selected', 'voice_model_release', p_release_id::text, p_idempotency_key);
  return query select p_release_id, 'candidate'::text;
end;
$$;

revoke all on function public.select_voice_model_candidate(uuid, text, text) from public, anon, authenticated;
grant execute on function public.select_voice_model_candidate(uuid, text, text) to service_role;
