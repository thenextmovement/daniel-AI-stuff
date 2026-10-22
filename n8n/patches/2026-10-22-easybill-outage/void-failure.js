let ctx;
try { ctx = $('Prepare Proforma Void').first()?.json; } catch {}
if (!ctx?.job?.id || !ctx.job.lease_token) {
  const response = $('Claim Proforma Void Job').first()?.json;
  const claimed = (response?.body ?? response)?.claimed;
  if (!claimed?.job?.id || !claimed.job.lease_token) throw new Error('proforma_void_failure_claim_missing');
  ctx = {...claimed, opsBaseUrl:String($env.NEONTRIP_OPS_BASE_URL || 'https://ops.neontrip.de').replace(/\/+$/,'')};
}
return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,opsBaseUrl:ctx.opsBaseUrl,success:false,
  result:{worker:'n8n-easybill-proforma-void-v2'},
  error:String($json.error?.message||$json.message||'easybill_proforma_void_failed').slice(0,1800)}}];
