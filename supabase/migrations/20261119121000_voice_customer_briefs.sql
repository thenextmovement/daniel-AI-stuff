create table public.voice_customer_briefs (
 customer_id uuid not null references public.master_customers(id) on delete cascade,
 request_id text not null default '',
 summary text not null check(length(summary) between 1 and 16000),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz not null,
 updated_at timestamptz not null default now(),
 primary key(customer_id,request_id)
);
alter table public.voice_customer_briefs enable row level security;
revoke all on public.voice_customer_briefs from public,anon,authenticated;
grant select on public.voice_customer_briefs to service_role;
create function public.save_voice_customer_brief(p_customer uuid,p_request text,p_summary text,p_hash text,p_captured timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_request<>'' and not exists(select from public.master_requests r where r.request_id=p_request and (r.customer_id=p_customer or (r.customer_id is null and exists(select from public.master_customers c where c.id=p_customer and c.request_id=p_request))))
 then raise exception 'customer_binding_mismatch'; end if;
 insert into public.voice_customer_briefs(customer_id,request_id,summary,source_hash,captured_at)
 values(p_customer,p_request,p_summary,p_hash,p_captured)
 on conflict(customer_id,request_id) do update set summary=excluded.summary,source_hash=excluded.source_hash,
 captured_at=excluded.captured_at,updated_at=now()
 where voice_customer_briefs.captured_at<=excluded.captured_at;
end $$;
revoke all on function public.save_voice_customer_brief(uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_voice_customer_brief(uuid,text,text,text,timestamptz) to service_role;
