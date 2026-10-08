/** Explicit 24-hour model handoff. Reuses OFFER's physical mesh export. */
import {createOfferArRequest} from './ar-geometry.js?v=20260929-mobile-stage2';
export function arEndpoint(){return document.querySelector('meta[name=neontrip-ar-endpoint]')?.content||'/api/public/configurator/ar';}
export async function createArShare(snapshot,{signal,endpoint=arEndpoint(),fetchImpl=fetch,viewerOrigin=globalThis.location?.origin}={}){
  if(snapshot.mount?.id==='table-stand')throw new Error('Die Wand-AR ist für den Tischständer noch nicht verfügbar.');
  let response;
  try{response=await fetchImpl(endpoint.replace(/\/$/,'')+'/share',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(createOfferArRequest(snapshot)),signal});}
  catch(error){if(signal?.aborted)throw error;throw new Error('Die AR-Verbindung ist gerade nicht erreichbar. Bitte versuchen Sie es erneut.');}
  if(!response.ok){const data=await response.json().catch(()=>null);const code=data?.error?.code;throw new Error(code==='RATE_LIMITED'?'Bitte warten Sie kurz, bevor Sie einen neuen QR-Code erstellen.':code==='AR_PREVIEW_TOO_LARGE'?'Das AR-Modell enthält zu viele Geometriedaten. Die Zentimeterzahl ist nicht die Grenze. Bitte wählen Sie eine einfachere Schrift oder einen kürzeren Text.':'Die Modellfreigabe ist hier noch nicht verfügbar. Ihr Entwurf bleibt erhalten.');}
  const data=await response.json();
  if(data?.version!==1||!/^\d{13}-[A-Za-z0-9_-]{43}$/.test(data.token)||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()||Number(data.token.slice(0,13))!==Date.parse(data.expiresAt))throw new Error('Die Modellfreigabe konnte nicht geprüft werden.');
  const url=new URL(data.shareUrl);
  if(url.origin!==viewerOrigin||url.pathname!=='/configurator/ar-view.html'||url.searchParams.get('token')!==data.token)throw new Error('Der AR-Link konnte nicht geprüft werden.');
  return data;
}
export async function renderShareQr(canvas,url){const {default:qr}=await import('./vendor/qrcode.js');await qr.toCanvas(canvas,url,{width:256,margin:4,errorCorrectionLevel:'M',color:{dark:'#0a0a0a',light:'#ffffff'}});}
