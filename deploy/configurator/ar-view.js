const status=document.querySelector('#shared-status'),host=document.querySelector('#shared-model'),link=document.querySelector('#shared-ar');
async function loadSharedModel(){
 const token=new URL(location.href).searchParams.get('token');
 // Capability is kept only in this link; no referrer or analytics receives it.
 if(!token||!/^\d{13}-[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Dieser AR-Link ist ungültig. Bitte erstellen Sie im Konfigurator einen neuen QR-Code.');
 if(Number(token.split('-')[0])<=Date.now())throw new Error('Dieser AR-Link ist abgelaufen. Bitte erstellen Sie im Konfigurator einen neuen QR-Code.');
 const endpoint=new URL(document.querySelector('meta[name=neontrip-ar-endpoint]').content,location.href);
 const url=new URL(endpoint.href.replace(/\/$/,'')+'/share/'+encodeURIComponent(token));
 const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});
 if(!response.ok)throw new Error(response.status===410?'Dieser AR-Link ist abgelaufen. Bitte erstellen Sie einen neuen QR-Code.':'Dieser Entwurf ist momentan nicht erreichbar. Bitte versuchen Sie es erneut.');
 const data=await response.json();
 if(data?.version!==1||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw new Error('Diese Modellfreigabe ist nicht mehr gültig.');
 // Resolve verified asset paths against the configured public API. Reverse proxies
 // can report an internal request origin; that origin must never become a download target.
 const assets={};for(const key of ['glb','usdz','poster']){const asset=new URL(data.assets?.[key]);if(asset.pathname!==url.pathname+'/'+key||asset.search||asset.hash)throw new Error('Die Modelldateien konnten nicht geprüft werden.');assets[key]=new URL(asset.pathname,endpoint.origin).href;}
 const poster=document.createElement('img');poster.src=assets.poster;poster.alt='Vorschau Ihres freigegebenen Neonschilds';host.replaceChildren(poster);
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(ios&&link.relList.supports('ar')){link.href=assets.usdz+'#allowsContentScaling=0';document.querySelector('#shared-poster').src=assets.poster;link.hidden=false;status.textContent='Ihr Entwurf ist bereit. Sehen Sie ihn jetzt in Originalgröße an Ihrer Wand.';}
 else{status.textContent='Die Vorschau wird vorbereitet. Für Wand-AR öffnen Sie diesen Link auf Ihrem iPhone in Safari.';await import('./vendor/ar/viewer.js');const model=document.createElement('model-viewer');model.setAttribute('src',assets.glb);model.setAttribute('poster',assets.poster);model.setAttribute('camera-controls','');model.setAttribute('alt','Ihr freigegebenes Neonschild');model.setAttribute('interaction-prompt','none');model.addEventListener('load',()=>{status.textContent='Ihr Entwurf ist bereit. Für Wand-AR öffnen Sie diesen Link auf Ihrem iPhone in Safari.';},{once:true});host.replaceChildren(model);model.addEventListener('error',()=>{host.replaceChildren(poster);status.textContent='Die 3D-Ansicht ist hier nicht verfügbar. Öffnen Sie den Link auf Ihrem iPhone in Safari.';},{once:true});}
 document.querySelector('#shared-expiry').textContent='Verfügbar bis '+new Intl.DateTimeFormat('de-DE',{dateStyle:'short',timeStyle:'short'}).format(new Date(data.expiresAt))+'. Diese Freigabe zeigt den Entwurf zum Zeitpunkt der Erstellung.';
}
loadSharedModel().catch(error=>{status.textContent=error.message;link.hidden=true;});
