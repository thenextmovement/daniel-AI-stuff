// Operational errors only. No analytics identifiers, design text, cart tokens or raw errors.
export const FAILURE_CODES=Object.freeze({
  calculation:['CALCULATION_FAILED','WORKER_TIMEOUT','WORKER_UNAVAILABLE','FONT_LOAD_FAILED','RENDER_FAILED'],
  cart:['CART_STORAGE_FAILED','CART_RESTORE_FAILED'],
  checkout:['GEOMETRY_MISMATCH','SNAPSHOT_MISMATCH','SERVER_GEOMETRY_UNAVAILABLE','SERVER_GEOMETRY_REQUIRED','INVALID_SERVER_PRICE','ASSET_INTEGRITY_FAILED','ASSET_STORAGE_UNAVAILABLE','STORAGE_UNAVAILABLE','CHECKOUT_NOT_CONFIGURED','CHECKOUT_UNCONFIRMED','PRICE_RULE_NOT_APPROVED','NETWORK_UNCONFIRMED','INVALID_RESPONSE','NOT_ENABLED','SERVER_ASSET_REQUIRED','SESSION_REQUIRED','PRICE_CHANGED','INVALID_CONSENT'],
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createFailureAttemptId(cryptoApi=globalThis.crypto){
  try{
    if(cryptoApi.randomUUID)return cryptoApi.randomUUID();
    const bytes=cryptoApi.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }catch{return null;}
}
export function failureBrowserFamily(ua=''){
  return /Firefox|FxiOS/i.test(ua)?'firefox':/Edg/i.test(ua)?'edge':/Chrome|CriOS/i.test(ua)?'chrome':/Safari/i.test(ua)?'safari':'other';
}
export function sanitizeFailureReport(input,now=Date.now()){
  if(!input||input.kind!=='configurator_failure'||input.version!==1||!Object.hasOwn(FAILURE_CODES,input.stage)||!FAILURE_CODES[input.stage].includes(input.code)||!UUID.test(input.attemptId||'')||!['client','server'].includes(input.source))return null;
  const occurredAt=Date.parse(input.occurredAt);
  if(!Number.isFinite(occurredAt)||Math.abs(now-occurredAt)>24*60*60*1000)return null;
  return {kind:'configurator_failure',version:1,stage:input.stage,code:input.code,attemptId:input.attemptId.toLowerCase(),source:input.source,
    browser:['chrome','safari','firefox','edge','other'].includes(input.browser)?input.browser:'other',
    build:typeof input.build==='string'&&/^[a-zA-Z0-9._-]{1,80}$/.test(input.build)?input.build:'unknown',
    path:'/configurator/',occurredAt:new Date(occurredAt).toISOString()};
}
export function createFailureReporter({fetcher=globalThis.fetch,cryptoApi=globalThis.crypto,userAgent=globalThis.navigator?.userAgent||'',build='20261012-purchase-repair',now=Date.now}={}){
  const seen=new Map(),windowMs=10*60*1000;
  return {report(input){
    const stamp=now(),attemptId=input?.attemptId||createFailureAttemptId(cryptoApi);
    const payload=sanitizeFailureReport({...input,attemptId,kind:'configurator_failure',version:1,source:'client',browser:failureBrowserFamily(userAgent),build,occurredAt:new Date(stamp).toISOString()},stamp);
    if(!payload)return Promise.resolve(false);
    for(const [key,time] of seen)if(time<=stamp-windowMs)seen.delete(key);
    const key=`${payload.stage}:${payload.attemptId}`;
    if(seen.has(key)||seen.size>=20)return Promise.resolve(false);
    seen.set(key,stamp); // One attempt; an uncertain network response never authorizes a resend.
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    return Promise.resolve().then(()=>fetcher('/api/r?kind=configurator_failure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'omit',redirect:'error',keepalive:true,signal:controller.signal}))
      .then(response=>response.ok).catch(()=>false).finally(()=>clearTimeout(timer));
  }};
}
