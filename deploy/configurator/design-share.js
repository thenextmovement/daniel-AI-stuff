// Small, versioned design copies in the URL fragment. No files, prices or server writes.
const PREFIX='#design=';
const MAX_LENGTH=16000;
const fail=message=>{throw new Error(message);};
const oneOf=(value,allowed)=>allowed.includes(value)?value:fail('Der geteilte Entwurf enthält eine unbekannte Einstellung.');
const number=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max?value:fail('Die Maße im geteilten Entwurf sind ungültig.');
function colors(value,palette){
 if(!Array.isArray(value)||value.length>160)fail('Die Farbzuordnung im Link ist ungültig.');
 return value.map(pair=>{if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||pair[0].length>200)fail('Die Farbzuordnung im Link ist ungültig.');return [pair[0],oneOf(pair[1],palette)];});
}
function cleanAccessoryQuantities(value){
 if(value==null)return undefined;
 const keys=['wall-mount','hanging-kit','adhesive-kit','table-stand','dimmer','extraCable2m','premium-white'];
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('Die Zubehörmengen im Link sind ungültig.');
 for(const [key,n] of Object.entries(value))if(!Number.isInteger(n)||n<(['wall-mount','premium-white'].includes(key)?1:0)||n>99)fail('Die Zubehörmengen im Link sind ungültig.');
 return {...value};
}
function clean(value,{fonts,palette,rooms}){
 if(!value||value.mode!=='text'||!fonts.includes(value.fontId))fail('Für Logos, Katalog- und Uploadschriften bitte das Vorschaubild teilen. Bearbeitbare Links unterstützen die 37 NEONTRIP-Schriften.');
 if(typeof value.text!=='string'||!value.text.trim()||value.text.length>160||value.text.split(/\r\n?|\n/).length>5)fail('Der Text im geteilten Entwurf ist ungültig.');
 const room=rooms.includes(value.room)?value.room:'reception',previousRoom=rooms.includes(value.previousRoom)?value.previousRoom:'reception';
 const finish=oneOf(value.plateFinish?.kind||'clear',['clear','uv-print','mirror-gold','mirror-silver']);
 const finishColor=value.plateFinish?.color||'#FFFFFF';if(!/^#[a-f\d]{6}$/i.test(finishColor))fail('Die Rückplattenfarbe im Link ist ungültig.');
 const positions=(value.positions||[]),cameras=(value.cameras||[]);
 const placement=(entries,camera)=>{if(!Array.isArray(entries)||entries.length>20)fail('Die Raumansicht im Link ist ungültig.');return entries.filter(pair=>Array.isArray(pair)&&rooms.includes(pair[0])).map(([id,p])=>[id,{x:number(p?.x,-1000,1000),y:number(p?.y,-650,650),...(camera?{zoom:number(p?.zoom,1,4)}:{})}]);};
 return {accessoryQuantities:cleanAccessoryQuantities(value.accessoryQuantities),mode:'text',text:value.text,fontId:value.fontId,font:value.fontId,axis:oneOf(value.axis,['width','height']),valueMm:number(value.valueMm,10,4000),alignment:oneOf(value.alignment,['left','center','right']),lineHeight:number(value.lineHeight??1.25,.8,2),color:oneOf(value.color,palette),wordColors:colors(value.wordColors||[],palette),charColors:colors(value.charColors||[],palette),lightMode:oneOf(value.lightMode||'static',['static','rgb']),light:value.light!==false,dimensions:value.dimensions!==false,backing:oneOf(value.backing,['contour','rectangle','square','freestanding']),mount:oneOf(value.mount,['wall-mount','hanging-kit','adhesive-kit','table-stand','none']),plateFinish:{kind:finish,color:finishColor},outdoor:value.outdoor===true,dimmer:value.dimmer===true,extraCable2m:value.extraCable2m===true,powerSupply:oneOf(value.powerSupply??'standard',['standard','premium-white','premium-black']),scene:value.scene==='technical'?'technical':'wall',room,previousRoom,positions:placement(positions,false),cameras:placement(cameras,true),photo:null,logo:null,fontSource:null};
}
// Compact positional fields keep ordinary one- and two-design links usable in email.
const fields=['text','fontId','axis','valueMm','alignment','lineHeight','color','wordColors','charColors','lightMode','light','dimensions','backing','mount','plateFinish','outdoor','dimmer','extraCable2m','scene','room','previousRoom','positions','cameras','powerSupply','accessoryQuantities'];
export function createDesignLink(designs,baseUrl,policy){
 if(!Array.isArray(designs)||designs.length<1||designs.length>2)fail('Bitte einen oder zwei Entwürfe teilen.');
 const packet={v:3,d:designs.map(d=>{const safe=clean(d,policy);return fields.map(key=>safe[key]);})};
 const bytes=new TextEncoder().encode(JSON.stringify(packet));
 const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 if(encoded.length>MAX_LENGTH)fail('Für diesen detailreichen Entwurf bitte das Vorschaubild teilen. Der Link wäre zu lang.');
 const url=new URL(baseUrl);if(!['https:','http:'].includes(url.protocol))fail('Teilen benötigt eine Webadresse.');url.search='';url.hash=PREFIX+encoded;return url.href;
}
export function readDesignLink(hash,policy){
 if(!hash.startsWith(PREFIX))return null;
 try{
  const encoded=hash.slice(PREFIX.length);if(!encoded||encoded.length>MAX_LENGTH||!/^[a-z\d_-]+$/i.test(encoded))throw new Error();
  const raw=atob(encoded.replaceAll('-','+').replaceAll('_','/')),packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
  if(![1,2,3].includes(packet?.v)||!Array.isArray(packet.d)||packet.d.length<1||packet.d.length>2)throw new Error();
  return packet.d.map(row=>{if(!Array.isArray(row)||row.length!==fields.length-(3-packet.v))throw new Error();return clean({...Object.fromEntries(fields.map((key,i)=>[key,row[i]])),mode:'text'},policy);});
 }catch{fail('Dieser Design-Link ist unvollständig oder nicht mehr lesbar. Bitte einen neuen Link anfordern.');}
}
export function isLocalShareUrl(url){
 const host=new URL(url).hostname.toLowerCase();
 return host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='[::1]'||/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}
export function shareMessage(records,message,link=''){
 const details=records.map((r,i)=>`${records.length>1?(i?'B':'A')+': ':''}${r.name}\n${r.size} · ${r.font} · ${r.color}`).join('\n\n');
 return `${message.trim()}\n\n${details}${link?'\n\nEntwurf öffnen und als eigene Variante weitergestalten:\n'+link:'\n\nDie Vorschau findest du im beigefügten Bild.'}`;
}
export function emailShareUrl(records,message,link=''){
 const subject=records.length===2?'Welcher NEONTRIP-Entwurf gefällt dir besser?':'Was hältst du von meinem NEONTRIP-Entwurf?';
 return 'mailto:?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(shareMessage(records,message,link));
}

const loadImage=url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Das Vorschaubild konnte nicht erstellt werden. Bitte den Entwurf erneut öffnen.'));image.src=url;});
function fittedText(ctx,text,x,y,width,size,color='#f9f4ee'){
 ctx.font=`500 ${size}px Arial, sans-serif`;ctx.fillStyle=color;
 let label=text.replace(/\s+/g,' ').trim();while(ctx.measureText(label).width>width&&label.length>1)label=label.slice(0,-2)+'…';ctx.fillText(label,x,y);
}
export async function createShareImage(records){
 const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1500;const ctx=canvas.getContext('2d');
 const gradient=ctx.createLinearGradient(0,0,1000,1500);gradient.addColorStop(0,'#211c22');gradient.addColorStop(1,'#0b0a0b');ctx.fillStyle=gradient;ctx.fillRect(0,0,1000,1500);
 const logo=await loadImage(new URL('../assets/brand/logo-white.svg',import.meta.url).href);ctx.drawImage(logo,66,58,255,255*logo.naturalHeight/logo.naturalWidth);
 fittedText(ctx,records.length===2?'Welches ist dein Licht?':'Was hältst du von diesem Entwurf?',66,177,870,37);
 const panelHeight=records.length===2?545:1070;
 for(const [i,record] of records.entries()){
  const top=220+i*panelHeight;
  const doc=new DOMParser().parseFromString(record.preview,'image/svg+xml'),root=doc.documentElement;
  if(root.localName!=='svg'||doc.querySelector('parsererror'))throw new Error('Die Vorschau fehlt. Bitte den Entwurf erneut öffnen.');
  for(const node of root.querySelectorAll('script,foreignObject,animate,animateTransform,style'))node.remove();
  for(const node of root.querySelectorAll('.rgb-neon')){node.setAttribute('stroke','#ff2a4d');node.style.animation='none';}
  for(const img of root.querySelectorAll('image')){
   const href=img.getAttribute('href')||img.getAttribute('xlink:href')||'';
   if(href.startsWith('blob:')){
    const blob=await (await fetch(href)).blob();if(!['image/png','image/jpeg','image/webp'].includes(blob.type))throw new Error('Die Bilddatei ist nicht verfügbar.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});img.setAttribute('href',data);img.removeAttribute('xlink:href');
   }else if(!/^data:image\/(png|jpeg|webp);base64,/i.test(href))throw new Error('Bitte den Entwurf zum Teilen erneut öffnen.');
  }
  root.setAttribute('width','880');root.setAttribute('height',String(panelHeight-175));
  const svgUrl=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)],{type:'image/svg+xml'}));
  try{const image=await loadImage(svgUrl);ctx.drawImage(image,60,top+20,880,panelHeight-175);}finally{URL.revokeObjectURL(svgUrl);}
  fittedText(ctx,(records.length===2?(i?'B · ':'A · '):'')+record.name,66,top+panelHeight-105,865,29);
  fittedText(ctx,record.size+' · '+record.font,66,top+panelHeight-61,865,25,'#d1c7cb');
  fittedText(ctx,record.color,66,top+panelHeight-25,865,22,'#d1c7cb');
 }
 ctx.fillStyle='#fa31a2';ctx.fillRect(66,1375,868,2);fittedText(ctx,'NEON-LED · DEINE IDEE. DEIN LICHT.',66,1430,868,21);
 fittedText(ctx,'Entwurfsvorschau · Farben und Leuchtwirkung können abweichen.',66,1472,868,16,'#afa2a9');
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Bildexport nicht verfügbar.')),'image/png'));
}
