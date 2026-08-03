drop trigger if exists arrival_label_cases_preserve_browser_manual_review
  on public.arrival_label_cases;
drop function if exists public.arrival_labels_preserve_browser_manual_review();

create or replace function public.arrival_labels_enqueue_review_notification(
  p_case_id uuid,
  p_notification_key text,
  p_recipient_email text,
  p_subject text,
  p_body_text text,
  p_shopify_order_url text default null
)
returns setof public.arrival_label_review_notifications
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_case public.arrival_label_cases%rowtype;
  v_notification public.arrival_label_review_notifications%rowtype;
begin
  select * into v_case
  from public.arrival_label_cases
  where id = p_case_id
  for share;
  if not found then raise exception 'arrival label case not found'; end if;
  if v_case.status not in ('manual_review', 'missing_data', 'ambiguous_match', 'conflicting_instructions', 'special_case')
    or v_case.selected_dpd_product is not null then
    raise exception 'only a blocked case without DPD product can enqueue a review notification';
  end if;
  if coalesce(p_notification_key, '') !~ '^arrival-review:[0-9a-f]{64}$' then raise exception 'invalid notification key'; end if;
  if p_recipient_email <> 'info@neontrip.de' then raise exception 'review recipient is not allowlisted'; end if;
  if length(coalesce(p_subject, '')) not between 20 and 200 or p_subject ~ E'[\r\n]' then raise exception 'invalid review subject'; end if;
  if length(coalesce(p_body_text, '')) not between 50 and 4000 then raise exception 'invalid review body'; end if;
  if p_shopify_order_url is not null
    and p_shopify_order_url !~ '^https://[A-Za-z0-9-]+[.]myshopify[.]com/admin/orders/[0-9]+$' then
    raise exception 'invalid Shopify order URL';
  end if;

  insert into public.arrival_label_review_notifications (
    case_id, notification_key, recipient_email, subject, body_text, shopify_order_url
  ) values (
    p_case_id, p_notification_key, p_recipient_email, p_subject, p_body_text, p_shopify_order_url
  )
  on conflict (notification_key) do nothing
  returning * into v_notification;

  if not found then
    select * into v_notification
    from public.arrival_label_review_notifications
    where notification_key = p_notification_key;
    if v_notification.case_id <> p_case_id
      or v_notification.recipient_email <> p_recipient_email
      or v_notification.subject <> p_subject
      or v_notification.body_text <> p_body_text
      or v_notification.shopify_order_url is distinct from p_shopify_order_url then
      raise exception 'review notification idempotency key belongs to different input';
    end if;
  end if;

  insert into public.arrival_label_events (
    run_id, case_id, event_key, event_type, severity, actor, payload
  ) values (
    v_case.run_id,
    v_case.id,
    'review:' || v_notification.id::text || ':queued',
    'review_notification_queued',
    'warning',
    'arrival-label-review-outbox',
    jsonb_build_object('notificationId', v_notification.id, 'recipient', v_notification.recipient_email)
  ) on conflict (event_key) do nothing;

  return next v_notification;
end;
$$;

revoke execute on function public.arrival_labels_enqueue_review_notification(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.arrival_labels_enqueue_review_notification(uuid, text, text, text, text, text)
  to service_role;

comment on function public.arrival_labels_enqueue_review_notification(uuid, text, text, text, text, text)
  is 'Queues a fixed-recipient internal review mail only for blocked pre-purchase cases.';
