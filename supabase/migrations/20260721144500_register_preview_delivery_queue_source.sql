-- The preview-delivery queue emits Company Brain incidents from its database
-- trigger. Register the source before those incidents are written so queue
-- finalization cannot be rolled back by the source registry foreign key.

insert into public.company_source_registry (
  source_key,
  display_name,
  source_kind,
  authority,
  owner_team,
  criticality,
  expected_freshness,
  contains_personal_data,
  active,
  description,
  metadata
)
values (
  'preview_delivery_queue',
  'Preview Delivery Queue',
  'automation',
  'operational',
  'engineering',
  'critical',
  interval '5 minutes',
  true,
  true,
  'Queue state and delivery-attempt incidents for KI video and offer delivery.',
  jsonb_build_object(
    'workflow_id', '9FoJMH6OUdsi36FB',
    'queue_table', 'preview_delivery_jobs'
  )
)
on conflict (source_key) do update
set display_name = excluded.display_name,
    source_kind = excluded.source_kind,
    authority = excluded.authority,
    owner_team = excluded.owner_team,
    criticality = excluded.criticality,
    expected_freshness = excluded.expected_freshness,
    contains_personal_data = excluded.contains_personal_data,
    active = true,
    description = excluded.description,
    metadata = public.company_source_registry.metadata || excluded.metadata,
    updated_at = now();
