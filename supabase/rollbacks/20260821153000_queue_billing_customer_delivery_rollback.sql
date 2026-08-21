drop trigger if exists billing_mark_document_sent_after_job_trigger on public.billing_jobs;
drop function if exists public.billing_mark_document_sent_after_job();
drop trigger if exists billing_queue_customer_document_after_finalize_trigger on public.billing_documents;
drop function if exists public.billing_queue_customer_document_after_finalize();
