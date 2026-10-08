/** Keep original vector bytes; only the derived preview is rasterized. */
export async function vectorLogoKind(file){
 const bytes=new Uint8Array(await file.slice(0,128).arrayBuffer());
 if(bytes[0]===0xc5&&bytes[1]===0xd0&&bytes[2]===0xd3&&bytes[3]===0xc6)return 'eps';
 const head=new TextDecoder('latin1').decode(bytes);
 if(head.startsWith('%PDF-'))return 'pdf';
 if(head.startsWith('%!PS-Adobe-')&&head.includes('EPSF-'))return 'eps';
 if(/\.(pdf|eps)$/i.test(file.name||''))throw new Error('Die Datei ist keine unterstützte PDF- oder EPS-Datei. Bitte exportieren Sie das Logo erneut.');
 return null;
}
export async function vectorLogoPreview(file,{endpoint,fetchImpl=fetch,signal}={}){
 if(file.size>20_000_000)throw new Error('Bitte eine Logodatei bis 20 MB auswählen.');
 const kind=await vectorLogoKind(file);if(!kind)return null;
 const target=endpoint||(document.querySelector('meta[name=neontrip-ar-endpoint]')?.content||'/api/public/configurator/ar').replace(/\/ar\/?$/,'/logo-preview');
 const response=await fetchImpl(target,{method:'POST',credentials:'omit',headers:{'Content-Type':kind==='pdf'?'application/pdf':'application/postscript'},body:file,signal});
 if(!response.ok){const data=await response.json().catch(()=>null);const messages={LOGO_PREVIEW_BUSY:'Eine Vektorvorschau wird gerade erstellt. Bitte gleich erneut versuchen.',RATE_LIMITED:'Bitte warten Sie kurz, bevor Sie eine weitere Vektordatei hochladen.',INVALID_VECTOR:'Die Vektordatei konnte nicht gelesen werden. Bitte exportieren Sie eine ungeschützte PDF oder EPS.',LOGO_TOO_LARGE:'Bitte eine Logodatei bis 20 MB auswählen.'};throw new Error(messages[data?.error?.code]||'Die PDF-/EPS-Vorschau ist hier noch nicht verfügbar. Ihre bisherige Gestaltung bleibt erhalten.');}
 const data=await response.json();if(data?.version!==1||data.sourceFormat!==kind||data.page!==1||typeof data.png!=='string'||data.png.length>8_000_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.png))throw new Error('Die Vorschau Ihrer Vektordatei konnte nicht geprüft werden.');
 const bytes=Uint8Array.from(atob(data.png),c=>c.charCodeAt(0));if(bytes.length<24||new DataView(bytes.buffer).getUint32(0)!==0x89504e47)throw new Error('Ungültige Vektorvorschau.');
 return {file:new File([bytes],'logo-preview.png',{type:'image/png'}),sourceFormat:kind,page:1};
}
