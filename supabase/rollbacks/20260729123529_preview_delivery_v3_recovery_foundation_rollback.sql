-- Non-destructive rollback: stop all v3 writers and keep operational evidence.
-- The v2 queue and live workflow are not changed by the forward migration.

revoke all on function public.enqueue_preview_delivery_case_v3(jsonb) from service_role;
revoke all on function public.claim_preview_delivery_task_v3(text, text, text, integer) from service_role;
revoke all on function public.complete_preview_delivery_task_v3(uuid, uuid, text, text, jsonb) from service_role;
revoke all on function public.record_preview_delivery_failure_v3(jsonb) from service_role;
revoke all on function public.claim_preview_delivery_projection_v3(text, text, integer) from service_role;
revoke all on function public.finish_preview_delivery_projection_v3(uuid, uuid, text, text, text, text) from service_role;
revoke all on function public.request_preview_delivery_retry_v1(uuid, uuid, uuid, text, text, jsonb) from service_role;
revoke all on function public.reserve_preview_provider_capacity_v3(text, integer, integer, integer, integer) from service_role;
revoke all on function public.release_preview_provider_capacity_v3(text, integer) from service_role;
revoke all on function public.begin_preview_delivery_side_effect_v3(uuid, uuid, text, text, text, jsonb) from service_role;
revoke all on function public.finish_preview_delivery_side_effect_v3(uuid, text, text, jsonb, text) from service_role;
revoke all on function public.record_offer_delivery_receipt_v3(uuid, jsonb) from service_role;

update public.preview_delivery_tasks_v3
set status = 'CANCELLED',
    claim_token = null,
    worker_id = null,
    workflow_execution_id = null,
    locked_at = null,
    lease_until = null,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where status in ('QUEUED', 'LEASED', 'RETRY');

update public.preview_delivery_projection_outbox_v3
set status = 'CANCELLED',
    claim_token = null,
    worker_id = null,
    workflow_execution_id = null,
    locked_at = null,
    lease_until = null,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where status in ('QUEUED', 'LEASED', 'RETRY');

update public.preview_delivery_cases_v3
set status = 'CANCELLED',
    updated_at = now()
where status not in ('DELIVERED', 'CANCELLED');
