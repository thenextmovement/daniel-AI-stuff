-- Disable the RPC only after reverting the workflow patch. Preserve incident evidence.
revoke execute on function public.claim_manual_paid_error_mail(text,text,text[]) from service_role;
