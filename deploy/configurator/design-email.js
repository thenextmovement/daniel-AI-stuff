import {designPayloadItems} from './checkout-client.js?v=20261014-design-email';

export function createDesignEmailClient({readSession,saveSession,fetcher=(...args)=>fetch(...args),cryptoApi=globalThis.crypto,apiBaseUrl='https://angebote.neontrip.de',timeoutMs=55_000}){
  if(!['','https://angebote.neontrip.de'].includes(apiBaseUrl))throw new Error('Unbekannter Versanddienst.');
  let pending=null;
  async function session(){
    let token=await readSession();
    if(token==null){
      token=btoa(String.fromCharCode(...cryptoApi.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
      token=await saveSession(token);
    }
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Die Speicherung auf diesem Gerät ist nicht verfügbar. Es wurde keine E-Mail angefordert.');
    return token;
  }
  function send(email,item){
    if(pending)return pending;
    const body=JSON.stringify({email:email.trim().toLowerCase(),items:designPayloadItems([item])});
    if(new TextEncoder().encode(body).length>2_000_000)throw new Error('Dieser Entwurf ist zu groß für den E-Mail-Versand. Bitte lokal speichern.');
    pending=(async()=>{
      const token=await session(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
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
