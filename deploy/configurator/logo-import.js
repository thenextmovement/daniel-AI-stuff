// Uploaded artwork is decoded locally and stored as a bounded PNG. No uploaded
// SVG DOM, scripts, links, fonts or external resources enter the document.
const SVG_NS='http://www.w3.org/2000/svg';
const SHAPES=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','title','desc','defs','linearGradient','radialGradient','stop','clipPath']);
const ATTRIBUTES=new Set(['xmlns','viewBox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points','transform','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','preserveAspectRatio','id','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','spreadMethod','fx','fy','fr','clip-path','clip-rule','clipPathUnits']);
const PAINT=new Set(['fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','stop-color','stop-opacity','clip-path','clip-rule']);
export const LOGO_MAX_BYTES=20_000_000;
const MAX_SIDE=8192,MAX_PIXELS=24_000_000;

export function sanitizeLogoSvg(text){
  if(text.length>LOGO_MAX_BYTES||/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('Bitte ein SVG ohne eingebettete Ressourcen verwenden.');
  const parsed=new DOMParser().parseFromString(text,'image/svg+xml');
  if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('Die SVG-Datei ist ungültig.');
  const safeValue=(value)=>{
    // Only local paint/clip references survive; external resources never reach a decoder.
    const stripped=value.replace(/url\(\s*['"]?#[a-zA-Z_][\w.-]*['"]?\s*\)/g,'');
    if(/url\s*\(|javascript:|data:|https?:|@|[\\<>]/i.test(stripped))throw new Error('Verknüpfte SVG-Inhalte werden nicht unterstützt.');
    return value;
  };
  const declarations=value=>{
    const result=[];
    for(const declaration of value.split(';')){
      if(!declaration.trim())continue;
      const i=declaration.indexOf(':');
      if(i<0)throw new Error('Die SVG-Stile sind ungültig.');
      const name=declaration.slice(0,i).trim(),v=declaration.slice(i+1).trim();
      if(PAINT.has(name))result.push([name,safeValue(v)]);
      else if(!['display','visibility','isolation','enable-background'].includes(name))throw new Error('Nicht unterstützter SVG-Stil. Bitte Schriften in Pfade umwandeln oder PNG/JPG verwenden.');
      else if((name==='display'&&v==='none')||(name==='visibility'&&v==='hidden'))result.push(['opacity','0']);
    }
    return result;
  };
  // Illustrator/Inkscape commonly export simple class styles. Convert this safe
  // subset to presentation attributes; uploaded CSS is never inserted into DOM.
  const rules=[];
  for(const style of parsed.querySelectorAll('style')){
    const css=style.textContent.replace(/\/\*[\s\S]*?\*\//g,'').trim();
    const matches=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    if(css.replace(/([^{}]+)\{([^{}]*)\}/g,'').trim()||css.includes('@'))throw new Error('Bitte SVG ohne externe oder verschachtelte CSS-Stile verwenden.');
    for(const [,selectors,body] of matches)for(const selector of selectors.split(',')){
      const key=selector.trim();
      if(!/^(?:[.#][a-zA-Z_][\w-]*|[a-zA-Z]+)$/.test(key))throw new Error('Bitte SVG mit einfachen Pfadfarben oder PNG/JPG verwenden.');
      rules.push({selector:key,values:declarations(body),specificity:key[0]==='#'?100:key[0]==='.'?10:1});
    }
  }
  rules.sort((a,b)=>a.specificity-b.specificity);
  let count=0;
  const clean=(node,depth=0)=>{
    if(++count>10000||depth>64||(node.namespaceURI!==SVG_NS&&node.namespaceURI!==null)||!SHAPES.has(node.localName))throw new Error('Dieses SVG enthält nicht unterstützte Elemente. Bitte Schriften in Pfade umwandeln oder PNG/JPG verwenden.');
    const copy=document.createElementNS(SVG_NS,node.localName);
    for(const attribute of node.attributes){
      const name=attribute.name;
      if(name==='style'||name==='class'||name.startsWith('xmlns:')||attribute.prefix)continue;
      if(!ATTRIBUTES.has(name)){
        if(/^(version|data-.+|aria-.+)$/.test(name))continue;
        throw new Error('Bitte ein SVG ohne Verknüpfungen, Effekte oder eingebettete Inhalte verwenden.');
      }
      if(name==='id'&&!/^[a-zA-Z_][\w.-]*$/.test(attribute.value))throw new Error('Ungültige SVG-Referenz.');
      copy.setAttribute(name,name==='xmlns'?SVG_NS:safeValue(attribute.value));
    }
    for(const rule of rules){
      const k=rule.selector;
      const matches=k[0]==='.'?(node.getAttribute('class')||'').split(/\s+/).includes(k.slice(1)):k[0]==='#'?node.getAttribute('id')===k.slice(1):node.localName===k;
      if(matches)for(const [name,value] of rule.values)copy.setAttribute(name,value);
    }
    for(const [name,value] of declarations(node.getAttribute('style')||''))copy.setAttribute(name,value);
    for(const child of node.children){
      if(child.localName==='style'||child.localName==='metadata'||(child.namespaceURI!==SVG_NS&&child.namespaceURI!==null))continue;
      copy.append(clean(child,depth+1));
    }
    return copy;
  };
  const root=clean(parsed.documentElement);
  if(!root.hasAttribute('viewBox')){
    const dimension=value=>/^\d+(?:\.\d+)?(?:px)?$/.test(value||'')?parseFloat(value):NaN;
    const w=dimension(root.getAttribute('width')),h=dimension(root.getAttribute('height'));
    if(!(w>0&&h>0&&w<=100000&&h<=100000))throw new Error('Das SVG braucht eine gültige viewBox oder Breite und Höhe.');
    root.setAttribute('viewBox',`0 0 ${w} ${h}`);
  }
  const box=root.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  if(box.length!==4||box.some(v=>!Number.isFinite(v))||box[2]<=0||box[3]<=0||box[2]/box[3]>100||box[3]/box[2]>100)throw new Error('Das Seitenverhältnis des Logos kann nicht verarbeitet werden.');
  const factor=768/Math.max(box[2],box[3]);
  root.setAttribute('width',Math.max(3,Math.round(box[2]*factor)));root.setAttribute('height',Math.max(3,Math.round(box[3]*factor)));
  return new XMLSerializer().serializeToString(root);
}

// Parse dimensions before browser decoding. Compressed upload size alone does
// not bound decoder memory (especially large single-colour PNGs).
export function inspectLogoRaster(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii=(start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
  let width=0,height=0,type='';
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&ascii(12,4)==='IHDR'){
    width=view.getUint32(16);height=view.getUint32(20);type='image/png';
  }else if(bytes[0]===255&&bytes[1]===216){
    type='image/jpeg';let offset=2;
    while(offset+3<bytes.length){
      if(bytes[offset++]!==255)break;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0xda||marker===0xd9)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(offset+2>bytes.length)break;
      const length=view.getUint16(offset);
      if(length<2||offset+length>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;}
      offset+=length;
    }
  }else if(bytes.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
    type='image/webp';const chunk=ascii(12,4);
    const u24=i=>bytes[i]+bytes[i+1]*256+bytes[i+2]*65536;
    if(chunk==='VP8X'){
      if(bytes[20]&2)throw new Error('Bitte ein unbewegtes WebP-Logo verwenden.');
      width=1+u24(24);height=1+u24(27);
    }else if(chunk==='VP8L'&&bytes[20]===0x2f){width=1+(view.getUint32(21,true)&0x3fff);height=1+((view.getUint32(21,true)>>>14)&0x3fff);}
    else if(chunk==='VP8 '&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a){width=view.getUint16(26,true)&0x3fff;height=view.getUint16(28,true)&0x3fff;}
  }
  if(!width||!height)throw new Error('Die Bilddatei ist ungültig. Bitte PNG, JPG, WebP oder SVG verwenden.');
  if(width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)throw new Error('Bitte ein Logo mit höchstens 8192 Pixeln je Seite und 24 Megapixeln verwenden.');
  return {width,height,type};
}

export function logoMaskFromRgba(rgba,width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<3||height<3||width>776||height>776||rgba.length!==width*height*4)throw new Error('Die Logodatei hat ungültige Rastermaße.');
  const alpha=[];for(let i=0;i<width*height;i++)if(rgba[i*4+3]<32)alpha.push(i);
  const transparent=alpha.length>width*height*.02;
  // For opaque raster images accept a near-uniform border; a photograph has no reliably
  // separable logo/background and must not silently turn into arbitrary routes.
  let background=[0,0,0];
  if(!transparent){
    const border=[];
    for(let x=0;x<width;x++)border.push(x,(height-1)*width+x);
    for(let y=1;y<height-1;y++)border.push(y*width,y*width+width-1);
    background=[0,1,2].map(c=>border.map(i=>rgba[i*4+c]).sort((a,b)=>a-b)[Math.floor(border.length/2)]);
    const same=border.filter(i=>Math.hypot(...background.map((v,c)=>rgba[i*4+c]-v))<42).length;
    if(same/border.length<.92)throw new Error('Der Hintergrund ist nicht eindeutig. Bitte ein freigestelltes Logo als transparentes PNG oder SVG verwenden.');
  }
  const mask=new Uint8Array(width*height);let count=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const i=y*width+x,a=rgba[i*4+3];
    const foreground=transparent?a>127:a>127&&Math.hypot(...background.map((v,c)=>rgba[i*4+c]-v))>65;
    if(foreground){mask[i]=1;count++;}
  }
  if(count<8||count>width*height*.98)throw new Error('Keine klare Logoform erkannt. Bitte ein freigestelltes Linienlogo verwenden.');
  return {mask,backgroundRemoved:!transparent};
}

export async function decodeLogoFile(file){
  if(!(file instanceof Blob)||!file.size||file.size>LOGO_MAX_BYTES)throw new Error('Bitte PNG, JPG, WebP oder SVG bis 20 MB auswählen.');
  const isSvg=file.type==='image/svg+xml'||/\.svg$/i.test(file.name||'');
  let source=file;
  if(isSvg)source=new Blob([sanitizeLogoSvg(await file.text())],{type:'image/svg+xml'});
  else{
    const bytes=new Uint8Array(await file.arrayBuffer());
    const info=inspectLogoRaster(bytes);
    source=new Blob([bytes],{type:info.type});
  }
  const url=URL.createObjectURL(source),image=new Image();
  try{
    image.src=url;
    try{await image.decode();}catch{throw new Error('Das Logo konnte nicht gelesen werden. Bitte eine gültige PNG-, JPG-, WebP- oder SVG-Datei auswählen.');}
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>MAX_SIDE||image.naturalHeight>MAX_SIDE||image.naturalWidth*image.naturalHeight>MAX_PIXELS)throw new Error('Die Bildmaße des Logos sind zu groß oder ungültig.');
    const factor=Math.min(1,768/Math.max(image.naturalWidth,image.naturalHeight));
    const w=Math.max(3,Math.round(image.naturalWidth*factor)),h=Math.max(3,Math.round(image.naturalHeight*factor));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Die Bildverarbeitung ist auf diesem Gerät nicht verfügbar.');
    ctx.drawImage(image,0,0,w,h);
    const sourcePixels=ctx.getImageData(0,0,w,h).data;
    const extracted=logoMaskFromRgba(sourcePixels,w,h);
    const width=w+8,height=h+8,mask=new Uint8Array(width*height);
    for(let y=0;y<h;y++)mask.set(extracted.mask.subarray(y*w,(y+1)*w),(y+4)*width+4);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('Das Logo konnte nicht gespeichert werden.');
    return {blob,mask,width,height,backgroundRemoved:extracted.backgroundRemoved};
  }finally{image.src='';URL.revokeObjectURL(url);}
}
