do $$
begin
  if exists (
    select 1
    from public.ops_internal_tasks
    where source_ref is not null
    group by source_app, source_ref
    having count(*) > 1
  ) then
    raise exception 'Cannot add ops_internal_tasks_source_ref_unique_idx while duplicate source_ref rows exist.';
  end if;

  if exists (
    select 1
    from public.sales_tasks
    where source = 'ops_internal'
      and source_ref is not null
    group by source_ref
    having count(*) > 1
  ) then
    raise exception 'Cannot add sales_tasks_ops_internal_source_ref_unique_idx while duplicate ops_internal source_ref rows exist.';
  end if;
end $$;

create unique index if not exists ops_internal_tasks_source_ref_unique_idx
  on public.ops_internal_tasks (source_app, source_ref)
  where source_ref is not null;

create unique index if not exists sales_tasks_ops_internal_source_ref_unique_idx
  on public.sales_tasks (source_ref)
  where source = 'ops_internal'
    and source_ref is not null;
