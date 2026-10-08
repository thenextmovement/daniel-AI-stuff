/** Lazy browser-only AR adapter. No network upload and no automatic camera. */
import {createArGeometry,exportArGeometry,createOfferArRequest} from './ar-geometry.js?v=20261005-refine1';
import {requestOfferAr} from './offer-ar-client.js?v=20260929-offer1';
let viewerModule;
const hostPreparations=new WeakMap();
const nativeQuickLook=()=>{
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  try{return ios&&document.createElement('a').relList.supports('ar');}catch{return false;}
};
function whenLoaded(element){return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timeout);element.removeEventListener('load',loaded);element.removeEventListener('error',failed);};
  const loaded=()=>{cleanup();resolve();};
  const failed=()=>{cleanup();reject(new Error('Die 3D-Vorschau konnte nicht geladen werden. Ihr Entwurf bleibt erhalten.'));};
  const timeout=setTimeout(()=>{cleanup();reject(new Error('Das Laden der 3D-Vorschau dauert zu lange. Bitte versuchen Sie es erneut.'));},30000);
  element.addEventListener('load',loaded,{once:true});element.addEventListener('error',failed,{once:true});
});}

/**
 * host should have a visible height (e.g. min-height: 320px).
 * Resolves when geometry and viewer are ready. Call activateAR() directly from
 * a later button click; never call it automatically after awaiting preparation.
 * dispose() is required when closing/replacing the dialog.
 */
export async function prepareArPreview(snapshot,host){
  if(!(host instanceof HTMLElement))throw new Error('Der Bereich für die 3D-Vorschau fehlt.');
  if(typeof WebGLRenderingContext==='undefined')throw new Error('Dieser Browser unterstützt die 3D-Vorschau nicht.');
  const token=Symbol('ar-preparation');hostPreparations.set(host,token);
  const ensureCurrent=()=>{if(hostPreparations.get(host)!==token)throw new Error('Die 3D-Vorschau wurde durch einen neueren Entwurf ersetzt.');};
  const model=createArGeometry(structuredClone(snapshot));let element,glbUrl,usdzUrl,posterUrl,quickLookLink,disposed=false;const abort=new AbortController();
  const cleanup=()=>{if(disposed)return;disposed=true;abort.abort();element?.remove();quickLookLink?.remove();if(posterUrl)URL.revokeObjectURL(posterUrl);if(glbUrl)URL.revokeObjectURL(glbUrl);if(usdzUrl)URL.revokeObjectURL(usdzUrl);model.dispose();};
  try{
    // Explicit USDZ ensures the vertical anchoring hint is retained; do not
    // enable Scene Viewer, whose native process cannot read browser Blob URLs.
    const quickLook=nativeQuickLook();
    const standing=snapshot.mount?.id==='table-stand';
    let data,exportError='';
    if(!standing){
      try{data=await requestOfferAr(createOfferArRequest(snapshot),{signal:abort.signal,endpoint:document.querySelector('meta[name=neontrip-ar-endpoint]')?.content||'/api/public/configurator/ar'});}
      catch(error){exportError=error.message;}
    }
    ensureCurrent();if(disposed)throw new Error('AR-Vorschau geschlossen.');
    // Preserve a local 3D fallback; never silently use the retired iPhone export.
    if(!data)data=await exportArGeometry(model,{includeUsdz:false});
    viewerModule ||= import('./vendor/ar/viewer.js').catch(error=>{viewerModule=null;throw error;});
    await viewerModule;await customElements.whenDefined('model-viewer');ensureCurrent();
    element=document.createElement('model-viewer');
    element.setAttribute('alt',`3D-Vorschau Ihres Neon-Leuchtschilds. Gesamte Außenbreite ${new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(snapshot.plate.widthMm/10)} cm. Ohne Montagezubehör.`);
    element.setAttribute('camera-controls','');element.setAttribute('ar-modes','webxr');element.setAttribute('ar-scale','fixed');element.setAttribute('ar-placement',model.metrics.placement);
    element.setAttribute('interaction-prompt','none');element.setAttribute('shadow-intensity','0');element.setAttribute('environment-image','neutral');
    element.style.cssText='display:block;width:100%;height:100%;min-height:0;background:#17191f;border-radius:14px;';
    // The application supplies the visible, separate button after readiness.
    const hiddenButton=document.createElement('span');hiddenButton.slot='ar-button';hiddenButton.hidden=true;element.append(hiddenButton);
    if(!standing&&!exportError&&self.isSecureContext)element.setAttribute('ar','');
    glbUrl=URL.createObjectURL(new Blob([data.glb],{type:'model/gltf-binary'}));
    if(data.usdz&&quickLook){
      usdzUrl=URL.createObjectURL(new Blob([data.usdz],{type:'model/vnd.usdz+zip'}));
      posterUrl=URL.createObjectURL(new Blob([data.poster],{type:'image/png'}));
      quickLookLink=document.createElement('a');quickLookLink.rel='ar';quickLookLink.type='model/vnd.usdz+zip';quickLookLink.href=usdzUrl+'#allowsContentScaling=0';
      quickLookLink.style.display='none';const poster=document.createElement('img');poster.src=posterUrl;poster.alt='';quickLookLink.append(poster);
    }
    const loaded=whenLoaded(element);element.setAttribute('src',glbUrl);host.replaceChildren(element);if(quickLookLink)host.append(quickLookLink);await loaded;ensureCurrent();
    // Wait for the browser's capability check as well as model-viewer's update.
    if(self.isSecureContext&&navigator.xr?.isSessionSupported)try{await navigator.xr.isSessionSupported('immersive-ar');}catch{}
    await element.updateComplete;ensureCurrent();
    const ready=()=>!exportError&&(quickLook?!!quickLookLink:!!element.canActivateAR);
    const reason=standing?'AR ist für den Tischständer noch nicht verfügbar. Die 3D-Vorschau zeigt das Schild ohne Steckfüße.':!self.isSecureContext?'AR benötigt eine sichere HTTPS-Verbindung. Die 3D-Vorschau bleibt nutzbar.':exportError?exportError:!ready()?'AR ist auf diesem Gerät oder in diesem Browser nicht verfügbar. Verwenden Sie Safari auf einem unterstützten iPhone oder Chrome auf einem AR-fähigen Android-Gerät.':'An der Wand in der gewählten Größe platzieren. Die Größe bleibt in AR gesperrt.';
    return {
      element,metrics:Object.freeze({...model.metrics,bytes:data.bytes}),availabilityMessage:reason,
      get canActivateAR(){return !disposed&&!standing&&self.isSecureContext&&ready();},
      activateAR(){
        if(disposed||standing||!self.isSecureContext||!ready())return Promise.reject(new Error(reason));
        // Keep this invocation synchronous with the caller's click handler.
        if(quickLookLink){quickLookLink.click();return Promise.resolve();}
        return element.activateAR();
      },
      dispose:cleanup
    };
  }catch(error){cleanup();throw error;}
}
