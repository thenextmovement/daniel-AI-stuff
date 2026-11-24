-- Run against the arrival-label schema after the reprint migration. Always rolls back.
begin;
update arrival_label_browser_worker_settings set worker_enabled=true,live_purchase_enabled=true,approved_by='fixture',approved_at=now(),approved_products='{"standard":{"label":"B2C","maxPurchaseCents":500}}';
do $$
declare r uuid; c uuid; j arrival_label_browser_purchase_jobs%rowtype; n integer;
begin
 insert into arrival_label_runs(correlation_id,trigger_type,mode,local_date) values('reprint-fixture','fixture_test','execute',current_date) returning id into r;
 insert into arrival_label_cases(run_id,idempotency_key,incoming_dhl_tracking_number,shopify_order_id,shopify_order_name,destination_class,selected_dpd_product,status,source_snapshot)
 values(r,'arrival-reprint-fixture-20261124','123456789012','gid://shopify/Order/123456789','#1234','domestic_de','standard','label_planned','{"reuseExistingDpdTracking":"01476814750251"}') returning id into c;
 select * into j from arrival_labels_enqueue_browser_purchase(c);
 if j.reuse_existing_dpd_tracking <> '01476814750251' then raise exception 'missing reprint reference'; end if;
 perform arrival_labels_enqueue_browser_purchase(c);
 select count(*) into n from arrival_label_browser_purchase_jobs where case_id=c;
 if n<>1 then raise exception 'duplicate jobs'; end if;
 select count(*) into n from arrival_labels_claim_browser_purchase('hermes-server-easydpd-01',300,now(),true,false) where case_id=c;
 if n<>0 then raise exception 'legacy client claimed reprint'; end if;
 select * into j from arrival_labels_claim_browser_purchase('hermes-server-easydpd-01',300,now(),true,true) where case_id=c;
 if j.id is null then raise exception 'capable client could not claim'; end if;
 perform arrival_labels_update_browser_purchase(j.id,'hermes-server-easydpd-01','validated');
 begin
   perform arrival_labels_update_browser_purchase(j.id,'hermes-server-easydpd-01','dispatching');
   raise exception 'purchase incorrectly allowed';
 exception when others then
   if sqlerrm <> 'existing-label reprint cannot dispatch or record a purchase' then raise; end if;
 end;
 select * into j from arrival_labels_update_browser_purchase(j.id,'hermes-server-easydpd-01','reprint_ready');
 if j.status <> 'purchased' or j.purchased_at is not null or j.dispatching_at is not null or j.dpd_tracking_number <> '01476814750251' then raise exception 'reprint recorded a purchase'; end if;
 select count(*) into n from arrival_labels_claim_browser_purchase('hermes-server-easydpd-01',300,now(),true,true) where case_id=c;
 if n<>0 then raise exception 'reclaimed submitted reprint'; end if;
 -- Only a proven pre-purchase empty selection may be recovered.
 update arrival_label_browser_purchase_jobs set status='manual_review',lease_owner=null,lease_expires_at=null,last_error='uncertain purchase' where id=j.id;
 update arrival_label_cases set status='manual_review',manual_review_reason='fixture hold' where id=c;
 select * into j from arrival_labels_enqueue_browser_purchase(c);
 if j.status<>'manual_review' then raise exception 'uncertain job recovered'; end if;
 update arrival_label_browser_purchase_jobs set last_error='EasyDPD-Artikelmenge ist null; Artikelauswahl manuell pruefen, kein Kauf.' where id=j.id;
 select * into j from arrival_labels_enqueue_browser_purchase(c);
 if j.status<>'queued' then raise exception 'safe zero selection not recovered'; end if;
 raise notice 'PASS: reprint enqueue, deduplication, capability, no purchase, no reclaim, recovery boundaries';
end;
$$;
rollback;
