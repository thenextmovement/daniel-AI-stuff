import {designPayloadItems,createCheckoutClient} from './checkout-client.js?v=20261014-design-email-allfonts';

export function createDesignEmailClient({readSession,saveSession,readFile,fetcher=(...args)=>fetch(...args),cryptoApi=globalThis.crypto,apiBaseUrl='https://angebote.neontrip.de',timeoutMs=55_000}){
  if(!['','https://angebote.neontrip.de'].includes(apiBaseUrl))throw new Error('Unbekannter Versanddienst.');
  let pending=null;
  const assets=createCheckoutClient({readSession,saveSession,readFile,fetcher,cryptoApi,apiBaseUrl,timeoutMs});
  function send(email,item){
    if(pending)return pending;
    const normalizedEmail=email.trim().toLowerCase(),frozen=structuredClone(item);
    if(new TextEncoder().encode(JSON.stringify({email:normalizedEmail,items:designPayloadItems([frozen])})).length+500>2_000_000)throw new Error('Dieser Entwurf ist zu groß für den E-Mail-Versand. Bitte lokal speichern.');
    pending=(async()=>{
      const {payload,token}=await assets.prepareDesignAssets([frozen]);
      const body=JSON.stringify({email:normalizedEmail,...payload});
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await fetcher(apiBaseUrl+'/api/public/configurator/design-email',{method:'POST',body,
          headers:{'Content-Type':'application/json','X-Neontrip-Cart-Token':token},credentials:'omit',redirect:'error',signal:controller.signal});
        if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Der E-Mail-Versand ist gerade nicht verfügbar. Dein Entwurf bleibt erhalten.');
        const text=await response.text();if(text.length>32000)throw new Error('Der Versandstatus konnte nicht gelesen werden.');
        const result=JSON.parse(text);
        if(!response.ok){const error=new Error(result?.error?.message||'Der Versand ist noch nicht bestätigt. Bitte später den Status prüfen.');error.code=result?.error?.code;throw error;}
        if(!/^[a-f0-9]{64}$/.test(result.id)||!['SENDING','UNKNOWN','SENT'].includes(result.status))throw new Error('Der Versandstatus konnte nicht bestätigt werden.');
        return result;
      }catch(error){
        if(error?.name==='AbortError'||error instanceof TypeError)throw new Error('Die Verbindung wurde unterbrochen. Prüfe den Versandstatus erneut. Derselbe Entwurf wird dabei nicht erneut verschickt.');
        throw error;
      }finally{clearTimeout(timer);}
    })().finally(()=>{pending=null;});
    return pending;
  }
  return {send};
}

// Short email links restore a verified design and its pinned font. The recipient
// is never returned. Font retrieval waits until the visitor opens their own copy.
export function savedDesignEmailId(hash){
  if(!hash.startsWith('#saved-design='))return null;
  const id=hash.slice(14);if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Dieser Entwurfslink ist unvollständig.');
  return id;
}
export async function loadSavedEmailDesign(id,{apiBaseUrl='https://angebote.neontrip.de',fetcher=(...args)=>fetch(...args),cryptoApi=globalThis.crypto}={}){
  if(!['','https://angebote.neontrip.de'].includes(apiBaseUrl)||!/^[a-f0-9]{64}$/.test(id))throw new Error('Dieser Entwurfslink ist ungültig.');
  const path=apiBaseUrl+'/api/public/configurator/design-email/restore/'+id;
  async function read(font=false){
    const response=await fetcher(path+(font?'?font=1':''),{credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25_000)});
    const max=font?5_000_000:200_000;
    if(!response.ok||!response.body||Number(response.headers.get('content-length'))>max||!response.headers.get('content-type')?.includes(font?'application/octet-stream':'application/json'))throw new Error('Der gesicherte Entwurf konnte nicht geladen werden. Bitte versuche es erneut.');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Der gesicherte Entwurf ist ungültig.');chunks.push(value);}}
    catch(error){await reader.cancel();throw error;}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
  }
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read()));
  const d=result?.design,sha=result?.font?.sha256;
  if(!d||d.mode!=='text'||typeof d.fontId!=='string'||typeof d.text!=='string'||
    d.fontId.startsWith('upload-')!==!!result.font||result.font&&!/^[a-f0-9]{64}$/.test(sha)||
    result.font&&d.fontId!==(d.fontSource?`upload-google-${d.fontSource.entry?.id}-${d.fontSource.entry?.file?.gitBlobSha?.slice(0,12)}`:`upload-email-${sha}`))throw new Error('Die gesicherte Schrift ist ungültig.');
  return {design:d,loadFont:async()=>{
    if(!result.font)return null;
    const bytes=await read(true);
    const digest=[...new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==sha)throw new Error('Die gesicherte Schrift konnte nicht bestätigt werden.');
    return bytes.buffer;
  }};
}
