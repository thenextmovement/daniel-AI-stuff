/** Temporary model conversion through the existing NEONTRIP OFFER exporter. */
export async function requestOfferAr(payload,{signal,endpoint='/api/public/configurator/ar',fetchImpl=fetch}={}){
  let response;
  try{response=await fetchImpl(endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});}
  catch{throw new Error(signal?.aborted?'AR-Vorschau geschlossen.':'Die OFFER-AR-Anbindung ist momentan nicht erreichbar. Ihr Entwurf bleibt erhalten.');}
  if(!response.ok){let data;try{data=await response.json();}catch{}
    const known={INVALID_AR_PREVIEW:'Der Entwurf konnte nicht für AR geprüft werden.',AR_PREVIEW_TOO_LARGE:'Dieser Entwurf ist für die AR-Vorschau zu groß.',AR_EXPORT_BUSY:'Ein AR-Entwurf wird gerade vorbereitet. Bitte versuchen Sie es gleich erneut.',RATE_LIMITED:'Bitte warten Sie einen Moment und versuchen Sie es erneut.'};
    throw new Error(known[data?.error?.code]||'Die OFFER-AR-Anbindung ist in dieser Vorschau noch nicht verfügbar. Ihr Entwurf bleibt erhalten.');}
  const data=await response.json();
  if(data?.version!==1||data.exporter!=='neontrip-offer-native-v1')throw new Error('Die AR-Dateien konnten nicht geprüft werden.');
  const decode=(value,max)=>{if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Ungültige AR-Datei.');return Uint8Array.from(atob(value),c=>c.charCodeAt(0));};
  const glb=decode(data.glb,20*1024*1024),usdz=decode(data.usdz,20*1024*1024),poster=decode(data.poster,4*1024*1024);
  if(glb.length<12||new DataView(glb.buffer).getUint32(0,true)!==0x46546c67||usdz.length<4||new DataView(usdz.buffer).getUint32(0,true)!==0x04034b50||poster.length<8||new DataView(poster.buffer).getUint32(0)!==0x89504e47)throw new Error('Ungültige AR-Datei.');
  return {glb,usdz,poster,bytes:{glb:glb.byteLength,usdz:usdz.byteLength}};
}
