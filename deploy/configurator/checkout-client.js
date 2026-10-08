import {minimumDeliveryBusinessDays,deliveryDateIsoForBusinessDays,deliveryOptionForDate} from './delivery-calendar.js?v=20261008-ads1';
// Same-origin checkout preparation. Only a verified server receipt can navigate.
export const CHECKOUT_SESSION_KEY='neontrip-checkout-session-v1';
const MAX_JSON_BYTES=2_000_000;
const HEX64=/^[a-f0-9]{64}$/;
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const messages={
  SESSION_REQUIRED:'Die Warenkorbkennung fehlt. Bitte laden Sie die Vorschau erneut.',
  ORIGIN_NOT_ALLOWED:'Die Bestellvorbereitung ist unter dieser Vorschauadresse nicht verfügbar.',
  RATE_LIMITED:'Bitte warten Sie eine Minute und prüfen Sie den Warenkorb dann erneut.',
  ASSET_STORAGE_UNAVAILABLE:'Der Dateispeicher ist noch nicht eingerichtet. Ihr Entwurf bleibt auf diesem Gerät erhalten.',
  STORAGE_UNAVAILABLE:'Die Entwürfe konnten noch nicht dauerhaft gesichert werden. Ihr lokaler Warenkorb bleibt erhalten.',
  SERVER_ASSET_REQUIRED:'Eine benötigte Schrift- oder Logodatei konnte noch nicht gesichert werden.',
  SNAPSHOT_MISMATCH:'Entwurf und Bestellübersicht stimmen nicht überein. Bitte bearbeiten und prüfen Sie den Entwurf erneut.',
  INVALID_DESIGN:'Bitte prüfen Sie Text, Maße und Optionen im Entwurf.',
  SERVER_GEOMETRY_UNAVAILABLE:'Die Geometrieprüfung ist gerade nicht verfügbar. Ihr Warenkorb bleibt erhalten. Bitte versuchen Sie es später erneut.',
  GEOMETRY_MISMATCH:'Die Vorschau und die serverseitig berechnete Schildform stimmen nicht überein. Ihr Entwurf bleibt erhalten; eine Bestellung ist noch nicht möglich.',
  INVALID_GEOMETRY:'Die Neonlinien müssen vor der Bestellung noch geprüft werden.',
  INVALID_PLATE:'Die Rückplatte muss vor der Bestellung noch geprüft werden.',
  INVALID_MOUNT:'Die gewählte Montage passt nicht zur Schildgröße.',
  INVALID_FONT_SOURCE:'Die gespeicherte Schriftquelle passt nicht zur Schriftdatei.',
  INVALID_FONT:'Die Schriftdatei konnte nicht geprüft werden.',
  INVALID_LOGO:'Die Logodatei konnte nicht geprüft werden.',
  GEOMETRY_LIMIT:'Dieser Entwurf ist für die automatische Prüfung zu komplex.',
  PAYLOAD_TOO_LARGE:'Der Warenkorb ist für die automatische Prüfung zu umfangreich.',
  ASSET_TOO_LARGE:'Eine benötigte Datei überschreitet die erlaubte Größe.',
  DELIVERY_REQUIRED:'Bitte wählen Sie zuerst einen Liefertermin.',
  INVALID_DELIVERY:'Bitte wählen Sie einen gültigen Liefertermin für Deutschland.',
  DELIVERY_TOO_EARLY:'RGB- und Außenschilder benötigen mindestens 7 Werktage. Für eine schnellere Lieferung wählen Sie feste Leuchtfarben ohne RGB und den Innenbereich.',
  DELIVERY_CHANGED:'Der Liefertermin ist nicht mehr aktuell. Bitte öffnen Sie den Kalender erneut und bestätigen Sie Termin und Preis.',
  CHECKOUT_NOT_CONFIGURED:'Die Kasse ist noch nicht verfügbar. Dein Warenkorb bleibt gespeichert.',
  CHECKOUT_UNCONFIRMED:'Die Übergabe ist noch nicht bestätigt. Dein Warenkorb bleibt gespeichert. Bitte versuche es später erneut.',
  PRICE_CHANGED:'Der bestätigte Gesamtpreis hat sich geändert. Bitte prüfe deinen Warenkorb erneut.',
  INVALID_CONSENT:'Deine Datenschutzauswahl konnte nicht bestätigt werden. Bitte lade diese Seite erneut. Dein Warenkorb bleibt gespeichert.',
  CONSENT_CHANGED:'Deine Datenschutzauswahl wurde geändert. Bitte klicke erneut auf „Zur Kasse“, damit deine aktuelle Auswahl übernommen wird.',
  NOT_ENABLED:'Die Bestellvorbereitung ist hier noch nicht aktiviert.'
};
export class CheckoutClientError extends Error{
  constructor(code,message){super(message||messages[code]||'Die Bestellvorbereitung ist gerade nicht verfügbar. Ihr Warenkorb bleibt erhalten.');this.code=code;}
}

// Keep consent outside the cart identity and only forward an explicit visitor choice.
export function cookiebotVisitorConsent(cookiebot){
  if(cookiebot?.hasResponse!==true)return undefined;
  const c=cookiebot.consent;
  if(!c||!['statistics','marketing','preferences'].every(key=>typeof c[key]==='boolean'))throw new CheckoutClientError('INVALID_CONSENT');
  return {analytics:c.statistics,marketing:c.marketing,preferences:c.preferences};
}
function consentKey(choice){
  if(choice===undefined)return '';
  if(!choice||Object.keys(choice).length!==3||!['analytics','marketing','preferences'].every(key=>typeof choice[key]==='boolean'))throw new CheckoutClientError('INVALID_CONSENT');
  return ['analytics','marketing','preferences'].map(key=>String(choice[key])).join(':');
}

// Keep the chosen delivery tier while the date advances in our own cart.
// Pricing remains entirely in the existing delivery calendar.
export function rollingCheckoutDelivery(selection,context={}){
  if(!selection||!Number.isInteger(selection.businessDays)||selection.businessDays<2||selection.businessDays>15)return null;
  return deliveryOptionForDate(deliveryDateIsoForBusinessDays(selection.businessDays,context.now??Date.now()),context);
}
export function checkedCheckoutUrl(value){
  let url;try{url=new URL(value);}catch{throw new CheckoutClientError('INVALID_RESPONSE');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!['www.neontrip.de','neontrip.de','galaxybuzzdk.myshopify.com'].includes(url.hostname)||!/^\/(?:cart\/c\/|(?:\d+\/)?checkouts\/)[^\s]+$/.test(url.pathname))throw new CheckoutClientError('INVALID_RESPONSE');
  return url.href;
}

// Copy only the existing backend contract. Room photos, camera state, SVG
// previews, inactive uploads and browser price/approval claims never leave here.
export function checkoutPayload(cartItems,delivery){
  if(!Array.isArray(cartItems)||!cartItems.length||cartItems.length>20)throw new CheckoutClientError('INVALID_DESIGN');
  if(!delivery)throw new CheckoutClientError('DELIVERY_REQUIRED');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(delivery.dateIso)||!Number.isInteger(delivery.businessDays)||delivery.businessDays<2||delivery.businessDays>15)throw new CheckoutClientError('INVALID_DELIVERY');
  if(delivery.businessDays<minimumDeliveryBusinessDays(cartItems.flatMap(item=>[item?.design,item?.snapshot])))throw new CheckoutClientError('DELIVERY_TOO_EARLY');
  const selectedDelivery={dateIso:delivery.dateIso,businessDays:delivery.businessDays,countryCode:'DE'};
  const items=cartItems.map(item=>{
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99||!item.design||!item.snapshot)throw new CheckoutClientError('INVALID_DESIGN');
    const d=item.design,s=item.snapshot;
    const design=pick(d,['text','mode','fontId','fontSource','lightMode','alignment','lineHeight','backing','mount','axis','valueMm','plateFinish','outdoor','dimmer','extraCable2m','powerSupply','accessoryQuantities']);
    design.logo=d.mode==='logo'?pick(d.logo,['assetId','name']):null;
    const snapshot=pick(s,['text','mode','lightMode','alignment','lineHeight','outdoor','dimmer','extraCable2m','powerSupply','accessoryQuantities']);
    snapshot.logo=s.mode==='logo'?pick(s.logo,['assetId','name']):null;
    snapshot.font=pick(s.font,['id','source']);
    snapshot.sign=pick(s.sign,['widthMm','heightMm','tubeMm']);
    if(!Array.isArray(s.sign?.glyphs))throw new CheckoutClientError('INVALID_DESIGN');
    snapshot.sign.glyphs=s.sign.glyphs.map(g=>({...pick(g,['lineIndex','wordIndex','charIndex','charText','charLength','charMapping']),color:pick(g.color,['id']),paths:g.paths?.map(p=>({points:p.points,closed:p.closed}))}));
    snapshot.plate=pick(s.plate,['type','widthMm','heightMm','path','finish']);
    snapshot.mount=pick(s.mount,['id']);
    return {quantity:item.quantity,design,snapshot};
  });
  // A real immutable copy before an asynchronous upload can start.
  return JSON.parse(JSON.stringify({items,assetRefs:[],delivery:selectedDelivery}));
}
export function requiredCheckoutAssets(payload){
  const refs=new Map();
  for(const {design} of payload.items){
    const kind=design.mode==='logo'?'logo':design.fontId?.startsWith('upload-')?'font':null;
    if(!kind)continue;
    const id=kind==='logo'?design.logo?.assetId:design.fontId;
    if(typeof id!=='string'||!id||refs.has(id)&&refs.get(id)!==kind)throw new CheckoutClientError('INVALID_DESIGN');
    refs.set(id,kind);
  }
  return [...refs].map(([id,kind])=>({id,kind}));
}

export function createCheckoutClient({readSession,saveSession,readFile,readVisitorConsent=()=>undefined,fetcher=(...args)=>fetch(...args),cryptoApi=globalThis.crypto,timeoutMs=60_000,apiBaseUrl=''}){
  if(apiBaseUrl!==''&&apiBaseUrl!=='https://angebote.neontrip.de')throw new CheckoutClientError('ORIGIN_NOT_ALLOWED');
  let sessionPromise=null,pending=null;
  const uploads=new Map();
  async function session(){
    if(!sessionPromise)sessionPromise=(async()=>{
      const saved=await readSession();
      if(saved!==undefined&&saved!==null){
        if(typeof saved!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(saved))throw new CheckoutClientError('SESSION_REQUIRED');
        return saved;
      }
      const bytes=cryptoApi.getRandomValues(new Uint8Array(32));
      const token=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
      // Never send before ownership can survive a reload.
      const claimed=await saveSession(token);
      if(typeof claimed!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(claimed))throw new CheckoutClientError('SESSION_REQUIRED');
      return claimed;
    })().catch(error=>{sessionPromise=null;throw error instanceof CheckoutClientError?error:new CheckoutClientError('SESSION_REQUIRED','Die Warenkorbkennung konnte auf diesem Gerät nicht gespeichert werden. Es wurden keine Daten übertragen.');});
    return sessionPromise;
  }
  async function request(path,body,headers){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetcher(apiBaseUrl+path,{method:'POST',body,headers,credentials:'omit',redirect:'error',signal:controller.signal});
      if(!response.headers.get('content-type')?.includes('application/json'))throw new CheckoutClientError('NOT_ENABLED');
      const raw=await response.text();
      if(raw.length>32_000)throw new CheckoutClientError('INVALID_RESPONSE');
      let result;try{result=JSON.parse(raw);}catch{throw new CheckoutClientError('INVALID_RESPONSE');}
      return {status:response.status,result};
    }catch(error){
      if(error instanceof CheckoutClientError)throw error;
      throw new CheckoutClientError('NETWORK_UNCONFIRMED','Die Verbindung wurde unterbrochen. Die Speicherung ist noch nicht bestätigt. Ihr Warenkorb bleibt erhalten; eine erneute Prüfung verwendet dieselbe Kennung.');
    }finally{clearTimeout(timer);}
  }
  async function upload(ref,token){
    const file=await readFile(ref.id,ref.kind);
    const body=file instanceof Blob?file: file instanceof ArrayBuffer?new Blob([file],{type:'application/octet-stream'}):null;
    if(!body||!body.size||body.size>(ref.kind==='font'?5_000_000:2_000_000)||ref.kind==='logo'&&body.type!=='image/png')throw new CheckoutClientError('SERVER_ASSET_REQUIRED');
    const sha=[...new Uint8Array(await cryptoApi.subtle.digest('SHA-256',await body.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const cacheKey=`${ref.kind}:${sha}`;
    if(!uploads.has(cacheKey))uploads.set(cacheKey,(async()=>{
      const {status,result}=await request('/api/public/configurator/assets',body,{'Content-Type':ref.kind==='logo'?'image/png':'application/octet-stream','X-Neontrip-Asset-Kind':ref.kind,'X-Neontrip-Cart-Token':token});
      if(status!==200)throw new CheckoutClientError(result?.error?.code);
      if(!HEX64.test(result?.id)||!HEX64.test(result?.sha256)||result.kind!==ref.kind||!Number.isInteger(result.byteLength)||result.byteLength<1||result.byteLength>body.size||ref.kind==='font'&&(result.sha256!==sha||result.byteLength!==body.size))throw new CheckoutClientError('INVALID_RESPONSE');
      return result.id;
    })().catch(error=>{uploads.delete(cacheKey);throw error;}));
    return {localId:ref.id,id:await uploads.get(cacheKey)};
  }
  function prepare(cartItems,delivery,expectedTotalCents){
    if(pending)return pending;
    let payload;try{payload=checkoutPayload(cartItems,delivery);}catch(error){return Promise.reject(error);}
    pending=(async()=>{
      const refs=requiredCheckoutAssets(payload);
      // Reserve the reference length before uploading any bytes.
      if(new TextEncoder().encode(JSON.stringify(payload)).length+refs.length*240>MAX_JSON_BYTES)throw new CheckoutClientError('PAYLOAD_TOO_LARGE');
      const token=await session();
      for(const ref of refs)payload.assetRefs.push(await upload(ref,token));
      // Read after uploads, immediately before the existing checkout request.
      const visitorConsent=readVisitorConsent(),sentConsentKey=consentKey(visitorConsent);
      if(visitorConsent!==undefined)payload.visitorConsent={...visitorConsent};
      const body=JSON.stringify(payload);
      if(new TextEncoder().encode(body).length>MAX_JSON_BYTES)throw new CheckoutClientError('PAYLOAD_TOO_LARGE');
      const {status,result}=await request('/api/public/configurator/checkout',body,{'Content-Type':'application/json','X-Neontrip-Cart-Token':token});
      const known=['PRICE_RULE_NOT_APPROVED','SERVER_GEOMETRY_NOT_VERIFIED','MANUFACTURING_NOT_VERIFIED','TAX_SHIPPING_NOT_VERIFIED'];
      const deliveryMatches=result?.delivery?.dateIso===payload.delivery.dateIso&&result.delivery.businessDays===payload.delivery.businessDays&&result.delivery.countryCode===payload.delivery.countryCode;
      if(status===409&&deliveryMatches&&HEX64.test(result?.id)&&result.status==='BLOCKED'&&result.checkoutUrl===null&&result.priceVersion==='unapproved'&&Array.isArray(result.blockers)&&result.blockers.length&&result.blockers.every(code=>known.includes(code)))return {id:result.id,status:'BLOCKED',blockers:result.blockers,delivery:payload.delivery};
      if(status===200&&deliveryMatches&&HEX64.test(result?.id)&&result.status==='CREATED'&&typeof result.priceVersion==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(result.priceVersion)&&result.priceVersion!=='unapproved'&&result.currency==='EUR'&&Number.isSafeInteger(result.subtotalCents)&&result.subtotalCents>0&&Array.isArray(result.blockers)&&result.blockers.length===0){
        if(consentKey(readVisitorConsent())!==sentConsentKey)throw new CheckoutClientError('CONSENT_CHANGED');
        // An older backend must not silently ignore a supplied privacy choice.
        if(consentKey(result.visitorConsent)!==sentConsentKey)throw new CheckoutClientError('INVALID_CONSENT');
        const checkoutUrl=checkedCheckoutUrl(result.checkoutUrl);
        if(!Number.isSafeInteger(expectedTotalCents)||expectedTotalCents!==result.subtotalCents)throw new CheckoutClientError('PRICE_CHANGED');
        return {id:result.id,status:'CREATED',checkoutUrl,delivery:payload.delivery};
      }
      if((status===200||status===202)&&HEX64.test(result?.id)&&['CREATING','UNKNOWN'].includes(result.status))throw new CheckoutClientError('CHECKOUT_UNCONFIRMED');
      throw new CheckoutClientError(result?.error?.code||'INVALID_RESPONSE');
    })().finally(()=>{pending=null;});
    return pending;
  }
  return {prepare};
}
