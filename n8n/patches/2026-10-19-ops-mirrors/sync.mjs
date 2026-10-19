export function validateBankItems(items) {
  const byId=new Map();
  for (const item of items) {
    const t=item.json;
    if (!t || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(t.id||'') || !t.transaction_id || t.amount==null || String(t.amount).trim()==='' || !Number.isFinite(Number(t.amount)) || Number(t.amount)<0 || !['credit','debit'].includes(t.side) || !/^[A-Z]{3}$/.test(t.currency||''))
      throw Error('QONTO_MIRROR_INVALID_TRANSACTION');
    if (byId.has(t.id)) throw Error('QONTO_MIRROR_DUPLICATE_TRANSACTION');
    byId.set(t.id,item);
  }
  if (!byId.size) throw Error('QONTO_MIRROR_EMPTY_READ');
  return [...byId.values()];
}
export function validateShopifyPages(items, expectedCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) throw Error('SHOPIFY_MIRROR_COUNT_INVALID');
  const ids=new Set(); const out=[];
  for (const [index,item] of items.entries()) {
    const p=item.json;
    if (p.statusCode!==200 || !Array.isArray(p.body?.orders)) throw Error('SHOPIFY_MIRROR_PAGE_INVALID');
    const link=String(p.headers?.link||p.headers?.Link||'');
    const hasNext=/rel="next"/.test(link);
    if (hasNext !== (index < items.length-1)) throw Error('SHOPIFY_MIRROR_TERMINAL_PAGE_MISSING');
    for (const o of p.body.orders) {
      if (!/^\d+$/.test(String(o.id||'')) || ids.has(String(o.id)) || !o.name || [o.total_outstanding,o.total_price].some(v=>v==null||String(v).trim()===''||!Number.isFinite(Number(v))||Number(v)<0) || !/^[A-Z]{3}$/.test(o.currency||'') || typeof o.test!=='boolean' || !Number.isFinite(Date.parse(o.updated_at))) throw Error('SHOPIFY_MIRROR_ORDER_INVALID');
      ids.add(String(o.id));
    }
    out.push({json:p.body});
  }
  if (ids.size!==expectedCount) throw Error('SHOPIFY_MIRROR_COUNT_MISMATCH');
  return out;
}
export function verifyMirrorWrite(responses, batches, source) {
  const key=source==='bank'?'id':'shopify_order_id';
  const expected=new Set(batches.flatMap(x=>x.json.batch.map(r=>String(r[key]))));
  const actual=new Set();
  for (const item of responses) {
    if (![200,201].includes(item.json.statusCode) || !Array.isArray(item.json.body)) throw Error('OPS_MIRROR_WRITE_NOT_CONFIRMED');
    for(const row of item.json.body) {
      const id=String(row[key]||'');
      if (!expected.has(id)||actual.has(id)) throw Error('OPS_MIRROR_WRITE_IDS_DIFFER');
      actual.add(id);
    }
  }
  if(!expected.size||actual.size!==expected.size) throw Error('OPS_MIRROR_WRITE_INCOMPLETE');
  const observedAt=batches[0].json.batch[0].ingested_at;
  return [{json:{workflow_name:'OPS Source Mirror',action:'ops_source_mirror_verified',status:'success',metadata:{schema:'ops.source-mirror.v1',source,source_complete:true,source_count:expected.size,written_count:actual.size,observed_at:observedAt,verified_at:new Date().toISOString()}}}];
}
export function patchWorkflow(original,source) {
  const id=source==='bank'?'FyZCGkPNoA6EQI3N':'m6VJ0hvDT7I40xy0';
  if(original.id!==id)throw Error('WRONG_WORKFLOW');
  const w=structuredClone(original);
  const map=w.nodes.find(n=>n.id==='map'), write=w.nodes.find(n=>n.id==='sb');
  const code=map.parameters.jsCode;
  if(!code.includes('const items = $input.all();'))throw Error('MAP_SOURCE_CHANGED');
  const observed="const observedAt = new Date().toISOString();\n";
  if(source==='bank'){
    const read=w.nodes.find(n=>n.id==='qonto');
    read.parameters.filters={}; // Native returnAll paginates the whole account, including old corrections.
    read.retryOnFail=true; read.maxTries=3; read.waitBetweenTries=2000; read.alwaysOutputData=true; read.executeOnce=true;
    map.parameters.jsCode=code.replace('const items = $input.all();',observed+'const items = ('+validateBankItems.toString()+')($input.all());').replace('raw: t','ingested_at: observedAt,\n    raw: t');
  }else{
    const read=w.nodes.find(n=>n.id==='shopify');
    read.parameters.url="={{ 'https://galaxybuzzdk.myshopify.com/admin/api/2026-07/orders.json?status=any&limit=250&created_at_max='+encodeURIComponent($('Prepare Sync Scope').first().json.cutoff) }}";
    read.parameters.options.response={response:{responseFormat:'json',fullResponse:true}};
    read.parameters.options.timeout=60000;
    read.parameters.options.pagination.pagination.limitPagesFetched=false;
    map.parameters.jsCode=code.replace('const items = $input.all();',observed+'const items = ('+validateShopifyPages.toString()+')($input.all(),$(\'Shopify: Count Orders\').first().json.count);').replace('return { shopify_order_id:', 'return { ingested_at: observedAt, shopify_order_id:');
    w.nodes.push({id:'sync-scope',name:'Prepare Sync Scope',type:'n8n-nodes-base.code',typeVersion:2,position:[60,650],parameters:{jsCode:"return [{json:{cutoff:new Date().toISOString()}}];"}});
    w.nodes.push({id:'sync-count',name:'Shopify: Count Orders',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[240,650],retryOnFail:true,maxTries:3,waitBetweenTries:2000,credentials:read.credentials,parameters:{url:"={{ 'https://galaxybuzzdk.myshopify.com/admin/api/2026-07/orders/count.json?status=any&created_at_max='+encodeURIComponent($json.cutoff) }}",authentication:'predefinedCredentialType',nodeCredentialType:'shopifyAccessTokenApi',options:{timeout:60000}}});
    for(const name of ['Sync starten','Webhook'])w.connections[name]={main:[[{node:'Prepare Sync Scope',type:'main',index:0}]]};
    w.connections['Prepare Sync Scope']={main:[[{node:'Shopify: Count Orders',type:'main',index:0}]]};
    w.connections['Shopify: Count Orders']={main:[[{node:read.name,type:'main',index:0}]]};
  }
  w.nodes.push({id:'sync-schedule',name:'Mirror every 15 minutes',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[-200,650],parameters:{rule:{interval:[{field:'minutes',minutesInterval:15}]}}});
  w.connections['Mirror every 15 minutes']={main:[[{node:source==='bank'?'Qonto: Transaktionen':'Prepare Sync Scope',type:'main',index:0}]]};
  write.parameters.url+='&select='+(source==='bank'?'id':'shopify_order_id');
  write.parameters.headerParameters.parameters.find(h=>h.name==='Prefer').value='resolution=merge-duplicates,return=representation';
  write.parameters.options={...write.parameters.options,timeout:60000,response:{response:{responseFormat:'json',fullResponse:true}}};
  w.nodes.push({id:'verify-sync-write',name:'Verify Mirror Write',type:'n8n-nodes-base.code',typeVersion:2,position:[940,300],parameters:{jsCode:'return ('+verifyMirrorWrite.toString()+')($input.all(),$(\'Mappen + Batchen\').all(),'+JSON.stringify(source)+');'}});
  w.nodes.push({id:'sync-audit',name:'Record Verified Sync',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[1160,300],retryOnFail:true,maxTries:3,credentials:write.credentials,parameters:{method:'POST',url:'https://klibiejfisijpagzkxls.supabase.co/rest/v1/workflow_audit_log',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendHeaders:true,headerParameters:{parameters:[{name:'Content-Type',value:'application/json'},{name:'Prefer',value:'return=minimal'}]},sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify($json) }}',options:{timeout:60000}}});
  w.connections['Supabase: Upsert']={main:[[{node:'Verify Mirror Write',type:'main',index:0}]]};
  w.connections['Verify Mirror Write']={main:[[{node:'Record Verified Sync',type:'main',index:0}]]};
  w.settings={...w.settings,errorWorkflow:'ArT3LN25Mb1PAuBE',executionTimeout:600};
  return w;
}
