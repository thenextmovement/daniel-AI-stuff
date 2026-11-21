// Embedded verbatim in the corresponding n8n Code nodes.
export function confirmPersistedPaidCompletion(expected, response, failedResponse) {
  const fail = () => { throw new Error('MANUAL_PAID_COMPLETION_UNCONFIRMED'); };
  const e = expected?.request, error = failedResponse?.error;
  const codes = [error?.httpCode,error?.statusCode,error?.status,error?.response?.statusCode].filter(v=>v!==undefined);
  const code = Number(codes[0] || 0);
  const errorText = [error?.description,error?.message,...(Array.isArray(error?.messages)?error.messages:[])].join(' ');
  const allowed = codes.every(v=>Number(v)===code) && (
    (code===409 && errorText.includes('BILLING_JOB_LEASE_INVALID')) ||
    [500,502,503,504].includes(code) ||
    (!code && ['ETIMEDOUT','ESOCKETTIMEDOUT','ECONNRESET','ECONNABORTED'].includes(error?.code))
  );
  if (!allowed || !e || e.scope!=='MANUAL_SHOPIFY_PAID' || e.outcome!=='EXACT_INVOICE_PAID' ||
    !/^[0-9]{1,30}$/.test(e.executionId || '') || !Number.isSafeInteger(e.inputGeneration) || e.inputGeneration<1 ||
    !/^[a-f0-9]{64}$/.test(e.inputFingerprint || '') || !/^[a-f0-9]{64}$/.test(e.bindingFingerprint || '') ||
    response?.statusCode!==200 || !Array.isArray(response.body) || response.body.length!==1) fail();
  const row=response.body[0], claim=row?.claim, check=row?.last_check, p=e.proof;
  const sameProof=(a,b)=>a && b && Object.keys(a).length===Object.keys(b).length &&
    Object.keys(a).every(k=>Object.hasOwn(b,k) && a[k]===b[k]);
  if (!p || !/^[0-9]+$/.test(p.easybillDocumentId || '') || !/^#NEONT[0-9]+$/.test(p.easybillNumber || '') ||
    !Number.isSafeInteger(p.invoiceAmountCents) || p.invoiceAmountCents<=0 || p.currency!=='EUR' ||
    p.invoiceAmountCents!==p.paidCents || p.paidCents!==p.expectedAmountCents ||
    row?.id!==expected.jobId || !row.billing_case_id || row.job_type!=='RECONCILE' ||
    row.scope!=='MANUAL_SHOPIFY_PAID' || row.status!=='DONE' || row.last_error!==null ||
    row.next_attempt_at!==null || row.lease_expires_at!==null ||
    row.input_generation!==e.inputGeneration || row.input_fingerprint!==e.inputFingerprint ||
    claim?.executionId!==e.executionId || claim?.inputGeneration!==e.inputGeneration ||
    claim?.inputFingerprint!==e.inputFingerprint || claim?.bindingFingerprint!==e.bindingFingerprint ||
    check?.executionId!==e.executionId || check?.outcome!==e.outcome ||
    check?.inputFingerprint!==e.inputFingerprint || check?.bindingFingerprint!==e.bindingFingerprint ||
    !sameProof(p,check.proof) || !Number.isFinite(Date.parse(claim.startedAt)) ||
    !Number.isFinite(Date.parse(check.recordedAt)) || Date.parse(check.recordedAt)<Date.parse(claim.startedAt)) fail();
  const completed={jobId:row.id,billingCaseId:row.billing_case_id,
    status:'DONE',nextAttemptAt:null,outcome:e.outcome,disposition:'RECORDED'};
  return {statusCode:200,body:{ok:true,completed}
  };
}

export function restoreReadyIntake(prepared, response) {
  if (!prepared?.request || response?.statusCode!==200 || response.body?.ok!==true ||
    response.body.service!=='neontrip-ops' || !/^[a-f0-9]{40}$/.test(response.body.commit || '')) {
    throw new Error('BILLING_API_UNAVAILABLE');
  }
  return prepared;
}

// Build operations against fresh, fully published workflows; credentials stay referenced by ID.
export function buildAvailabilityPatch(workflow) {
  const versions={
    I9vCp27sS3jcH1am:'b49e7dce-380c-4c91-ad90-010e76ed7499',
    iyd9dKfm5YWlV6jw:'defaeb89-a31a-49f5-8692-f6d906c03ef4',
    '6NZnfGpyfUVikqpf':'37edc068-2b13-4422-a8bf-1ca1d81f222f'
  };
  if (!workflow.active || workflow.versionId!==versions[workflow.id] ||
    workflow.activeVersionId!==workflow.versionId) throw new Error('WORKFLOW_DRIFT');
  const ops=[];
  const add=node=>ops.push({type:'addNode',node});
  const update=(nodeId,updates)=>ops.push({type:'updateNode',nodeId,updates});
  const link=(source,target,sourceIndex=0)=>ops.push({type:'addConnection',source,target,sourceIndex,targetIndex:0});
  const unlink=(source,target)=>ops.push({type:'removeConnection',source,target});
  if (workflow.id==='I9vCp27sS3jcH1am') {
    const loop='Sync One Shopify Order at a Time';
    add({id:'shopify-master-serial-loop',name:loop,type:'n8n-nodes-base.splitInBatches',typeVersion:3,
      position:[620,240],parameters:{batchSize:1,options:{}}});
    unlink('Has Email?','Supabase: Upsert Customer');
    unlink('Supabase: Upsert Order','Sync Complete');
    link('Has Email?',loop);
    link(loop,'Sync Complete',0);
    link(loop,'Supabase: Upsert Customer',1);
    link('Supabase: Upsert Order',loop);
    ops.push({type:'updateSettings',settings:{errorWorkflow:'M4uG1HAtN9Zggxww'}});
  } else if (workflow.id==='iyd9dKfm5YWlV6jw') {
    update('cmv2-claim-dispatch',{'parameters.options.timeout':75000});
  } else {
    const health='Check Billing API Availability', recheck='Recheck Billing API Availability';
    const wait='Wait for Billing API Recovery', restore='Restore Verified Billing Intake';
    const prepare='Prepare Manual Paid Durable Intake', claim='Admit or Claim Manual Paid Reconciliation';
    const complete='Complete Manual Paid Reconciliation', read='Read Persisted Paid Completion';
    const confirm='Confirm Persisted Paid Completion', verify='Verify Manual Paid Reconciliation Completion';
    const getHealth=(id,name,position)=>({id,name,type:'n8n-nodes-base.httpRequest',typeVersion:4.3,position,
      parameters:{method:'GET',url:'https://ops.neontrip.de/api/health',options:{timeout:10000,
        response:{response:{fullResponse:true,responseFormat:'json'}}}}});
    add({...getHealth('manual-paid-health',health,[-1560,-440]),onError:'continueErrorOutput'});
    add({id:'manual-paid-health-wait',name:wait,type:'n8n-nodes-base.wait',typeVersion:1.1,position:[-1560,-640],
      parameters:{resume:'timeInterval',amount:65,unit:'seconds'}});
    add(getHealth('manual-paid-health-recheck',recheck,[-1330,-640]));
    add({id:'manual-paid-health-restore',name:restore,type:'n8n-nodes-base.code',typeVersion:2,position:[-1100,-440],
      parameters:{jsCode:restoreReadyIntake.toString()+"\nreturn [{json:restoreReadyIntake($('Prepare Manual Paid Durable Intake').first().json,$input.first()?.json)}];"}});
    unlink(prepare,claim);
    link(prepare,health);link(health,restore);link(health,wait,1);link(wait,recheck);link(recheck,restore);link(restore,claim);
    // Neither claim nor complete is safely repeatable after an unknown response.
    update('manual-paid-durable-intake',{retryOnFail:false});
    update('manual-paid-complete',{retryOnFail:false,onError:'continueErrorOutput','parameters.options.timeout':75000});
    const credential=workflow.nodes.find(n=>n.name==='Read Exact Billing Case')?.credentials;
    if (!credential?.httpHeaderAuth || credential.httpHeaderAuth.id!=='NTtNxoBGGzJCQi9u') throw new Error('WORKFLOW_DRIFT');
    const select='id,billing_case_id,job_type,status,last_error,next_attempt_at,lease_expires_at,scope:payload->>scope,claim:payload->claim,last_check:payload->lastCheck,input_generation:payload->input->generation,input_fingerprint:payload->input->>fingerprint';
    add({id:'manual-paid-completion-readback',name:read,type:'n8n-nodes-base.httpRequest',typeVersion:4.3,
      position:[-440,680],credentials:credential,retryOnFail:true,maxTries:3,waitBetweenTries:5000,
      parameters:{method:'GET',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
        url:"={{ 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/billing_jobs?select="+select+"&id=eq.' + encodeURIComponent($('Prepare Manual Paid Reconciliation Completion').first().json.jobId) + '&limit=2' }}",
        options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:'json'}}}}});
    add({id:'manual-paid-completion-confirm',name:confirm,type:'n8n-nodes-base.code',typeVersion:2,position:[-210,680],
      parameters:{jsCode:confirmPersistedPaidCompletion.toString()+"\nreturn [{json:confirmPersistedPaidCompletion($('Prepare Manual Paid Reconciliation Completion').first().json,$input.first()?.json,$('Complete Manual Paid Reconciliation').first(1).json)}];"}});
    link(complete,read,1);link(read,confirm);link(confirm,verify);
  }
  return ops;
}
