import * as THREE from './vendor/three.js';
import {FontLoader} from './vendor/FontLoader.js';
import {materialSpec,paintMaterialSpec,lightColor} from './model.js?v=26';
const fontCache=new Map();
const SILVER_REFLECTION_FILL=.8;
const wallColors={warm:'#b9ab97',concrete:'#989d9c',dark:'#34363b'};
async function loadFont(id){
 if(!fontCache.has(id))fontCache.set(id,fetch(new URL(`./fonts/${id}.json`,import.meta.url)).then(r=>{if(!r.ok)throw new Error('Die Schrift konnte nicht geladen werden.');return r.json();}).then(data=>new FontLoader().parse(data)).catch(e=>{fontCache.delete(id);throw e;}));
 return fontCache.get(id);
}
export function layoutLetters(font,text,spacing){
 let shapes=[],bounds=new THREE.Box2(),lines=text.split('\n');
 const lineHeight=145;
 lines.forEach((line,lineIndex)=>{
  let cursor=0;const row=[];const rowBounds=new THREE.Box2();
  for(const c of Array.from(line)){
   if(!font.data.glyphs[c])throw new Error(`Das Zeichen „${c}“ ist in diesem Schriftstil nicht verfügbar.`);
   const glyphShapes=font.generateShapes(c,100);
   for(const shape of glyphShapes){
    const geometry=new THREE.ShapeGeometry(shape,10);geometry.computeBoundingBox();const box=geometry.boundingBox;
    if(box&&!box.isEmpty()){rowBounds.expandByPoint(new THREE.Vector2(box.min.x+cursor,box.min.y-lineIndex*lineHeight));rowBounds.expandByPoint(new THREE.Vector2(box.max.x+cursor,box.max.y-lineIndex*lineHeight));}
    geometry.dispose();row.push({shape,x:cursor,y:-lineIndex*lineHeight});
   }
   cursor+=font.data.glyphs[c].ha*100/font.data.resolution+spacing;
  }
  if(!row.length)return;
  const center=(rowBounds.min.x+rowBounds.max.x)/2;
  for(const item of row){item.x-=center;shapes.push(item);}
  bounds.expandByPoint(new THREE.Vector2(rowBounds.min.x-center,rowBounds.min.y));bounds.expandByPoint(new THREE.Vector2(rowBounds.max.x-center,rowBounds.max.y));
 });
 if(bounds.isEmpty()||!shapes.length)throw new Error('Gib einen sichtbaren Schriftzug ein.');
 const center=bounds.getCenter(new THREE.Vector2());
 for(const item of shapes){item.x-=center.x;item.y-=center.y;}
 return {shapes,width:bounds.max.x-bounds.min.x,height:bounds.max.y-bounds.min.y};
}
// Preview depth emphasis prevents a 1 cm layer on a 4 m sign disappearing
// below a pixel. Never expand its x/y contour or alter the saved product depth.
export function acrylicPreviewDepth(s){return s.lighting==='back'?Math.max(1,Math.min(3,s.width/120)):0;}
export function letterGeometries(shape,scale,s,preview=false){
 const physicalBacking=s.lighting==='back'?Math.min(1,s.depth/3):0;
 const backingDepth=preview?acrylicPreviewDepth(s):physicalBacking,displayDepth=s.depth+backingDepth-physicalBacking;
 const shell=new THREE.ExtrudeGeometry(shape,{depth:(s.depth-physicalBacking)/scale,bevelEnabled:true,bevelThickness:.04/scale,bevelSize:.04/scale,bevelSegments:1,curveSegments:10,steps:1});
 shell.scale(scale,scale,scale);shell.translate(0,0,backingDepth);
 const groups=shell.groups.slice();shell.clearGroups();
 for(const g of groups){
  // Drop the front cap (separate face), and drop the metal rear cap only for backlit construction.
  if(g.materialIndex===1)shell.addGroup(g.start,g.count,0);
  else if(s.lighting==='front')shell.addGroup(g.start,g.count/2,0);
 }
 const front=new THREE.ShapeGeometry(shape,10);front.scale(scale,scale,scale);front.translate(0,0,displayDepth+.05);
 const rear=s.lighting==='back'?new THREE.ExtrudeGeometry(shape,{depth:backingDepth/scale,bevelEnabled:false,curveSegments:10,steps:1}):null;
 if(rear)rear.scale(scale,scale,scale);
 return {shell,front,rear};
}
export function mountingLayout(s,height){
 // All z values are measured from the wall towards the viewer.
 // The rail is centred behind the lettering and rests against the wall.
 // Only the spacers span the gap to the rear of the letters.
 const rail={depth:4,z:2,y:0,height:Math.min(8,height*.22)};
 rail.front=rail.z+rail.depth/2;
 const letterRear=s.mount==='rail'?rail.front+5:s.mount==='plate'?4:3;
 return {letterRear,rail};
}
export function detailBounds(layout,scale){
 // Keep every contour of the last letter together (including umlaut dots).
 const glyphs=new Map();
 for(const item of layout.shapes){
  const key=`${item.x},${item.y}`,box=glyphs.get(key)||new THREE.Box2();
  for(const point of item.shape.getPoints(10))box.expandByPoint(new THREE.Vector2((point.x+item.x)*scale,(point.y+item.y)*scale));
  glyphs.set(key,box);
 }
 const box=[...glyphs.values()].sort((a,b)=>b.max.x-a.max.x)[0],center=box.getCenter(new THREE.Vector2());
 return {x:center.x,y:center.y,width:box.max.x-box.min.x,height:box.max.y-box.min.y};
}
export function railAttachment(item,scale,y){
 // Find a solid section of the actual contour, excluding holes such as A / D / R.
 const intersections=[];
 for(const contour of [item.shape,...item.shape.holes]){
  const points=contour.getPoints(10);
  for(let i=0,j=points.length-1;i<points.length;j=i++){
   const a=points[j],b=points[i],ay=(a.y+item.y)*scale,by=(b.y+item.y)*scale;
   if((ay>y)!==(by>y))intersections.push((a.x+(b.x-a.x)*(y-ay)/(by-ay)+item.x)*scale);
  }
 }
 intersections.sort((a,b)=>a-b);let widest=null;
 for(let i=0;i+1<intersections.length;i+=2){const start=intersections[i],end=intersections[i+1];if(!widest||end-start>widest.width)widest={x:(start+end)/2,width:end-start};}
 return widest;
}
function dispose(group){group.traverse(obj=>{obj.geometry?.dispose();for(const mat of Array.isArray(obj.material)?obj.material:obj.material?[obj.material]:[]){if(mat.map&&!mat.map.userData.shared)mat.map.dispose();mat.dispose();}});group.clear();}
function wallTexture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');
 const image=ctx.createImageData(512,512);let seed=29;
 for(let i=0;i<image.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;const n=220+(seed%25);image.data.set([n,n,n,255],i);}ctx.putImageData(image,0,0);
 const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(30,30);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
function brushedTexture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d'),image=ctx.createImageData(512,512),roughness=ctx.createImageData(512,512);let seed=73;
 const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 // Fine, broken horizontal strokes with enough contrast to survive the
 // normal-view texture filtering. Keep each stroke one texel thin; no broad
 // bands or normal gradient that would make the flat face look inflated.
 const rows=Array.from({length:512},()=>({base:random(),strokes:Array.from({length:17},()=>random())}));
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){
  const cell=x/32,row=rows[y],grain=row.base*.3+(row.strokes[Math.floor(cell)]*(1-cell%1)+row.strokes[Math.floor(cell)+1]*(cell%1))*.7;
  const shade=Math.round(222+grain*33);
  image.data.set([shade,shade,shade,255],(y*512+x)*4);
  const rough=Math.round(188+grain*67);roughness.data.set([rough,rough,rough,255],(y*512+x)*4);
 }
 ctx.putImageData(image,0,0);
 const roughCanvas=document.createElement('canvas');roughCanvas.width=roughCanvas.height=512;roughCanvas.getContext('2d').putImageData(roughness,0,0);
 const textures={color:new THREE.CanvasTexture(canvas),roughness:new THREE.CanvasTexture(roughCanvas)};
 for(const texture of Object.values(textures)){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.userData.shared=true;}
 return textures;
}
function studioEnvironment(renderer,brushed=false){
 // A neutral, local studio environment gives polished metal view-dependent reflections.
 // It is illustrative and never captures the customer's camera or surroundings.
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d');
 const room=ctx.createLinearGradient(0,0,0,512);room.addColorStop(0,'#c6c9cc');room.addColorStop(.43,'#8a8f95');room.addColorStop(.52,'#41464b');room.addColorStop(.7,'#888079');room.addColorStop(1,'#b3a493');ctx.fillStyle=room;ctx.fillRect(0,0,1024,512);
 for(const x of [0,128,256,384,512,640,768,896,1024]){const light=ctx.createLinearGradient(x-35,0,x+55,0);light.addColorStop(0,'#5c6269');light.addColorStop(.25,'#e5e8ea');light.addColorStop(.32,'#ffffff');light.addColorStop(.8,'#f8fafb');light.addColorStop(1,'#5c6269');ctx.fillStyle=light;ctx.fillRect(x-35,55,90,244);ctx.fillStyle='#373c42';ctx.fillRect(x+8,55,4,244);ctx.fillRect(x-35,190,90,4);}
 if(brushed){
  // A softly filled studio keeps the metal hue consistent across the sign.
  // Muted cards still move in reflection; the separate fine grain is unchanged.
  const base=ctx.createLinearGradient(0,0,0,512);base.addColorStop(0,'#b3b6ba');base.addColorStop(.48,'#85898f');base.addColorStop(1,'#96989b');ctx.fillStyle=base;ctx.fillRect(0,0,1024,512);
  for(const [x,width] of [[140,170],[540,170],[730,150],[920,100]]){
   const card=ctx.createLinearGradient(x,0,x+width,0);card.addColorStop(0,'#8b8e92');card.addColorStop(.18,'#bec1c5');card.addColorStop(.42,'#d5d4d0');card.addColorStop(.7,'#cecdc7');card.addColorStop(1,'#8b8e92');ctx.fillStyle=card;ctx.fillRect(x,65,width,365);
  }
  if(brushed==='silver'){
   // Scale the room fill down to balance the stronger reflection intensity.
   // The base stays mid-grey while only the softboxes produce brighter glints.
   const fill=hex=>new THREE.Color(hex).multiplyScalar(SILVER_REFLECTION_FILL).getStyle();
   const steel=ctx.createLinearGradient(0,0,0,512);steel.addColorStop(0,fill('#a2a5a8'));steel.addColorStop(.48,fill('#91969a'));steel.addColorStop(1,fill('#9a9ea2'));ctx.fillStyle=steel;ctx.fillRect(0,0,1024,512);
   for(const [x,width] of [[140,170],[540,170],[730,150],[920,100]]){
    const card=ctx.createLinearGradient(x,0,x+width,0);card.addColorStop(0,'rgba(192,196,199,0)');card.addColorStop(.4,fill('#bec2c5'));card.addColorStop(.7,fill('#b6bbc0'));card.addColorStop(1,'rgba(192,196,199,0)');ctx.fillStyle=card;ctx.fillRect(x,65,width,365);
   }
  }
  // Slim softboxes add moving highlights without reintroducing dark areas
  // in the studio fill. Their limited width keeps the gold base readable.
  for(const x of [180,425,650,860]){
   if(brushed==='silver'){
    // Wider, capped softbox reflections survive the directional filtering.
    // Their moving highlight stays silver; the mid-grey room remains filled.
    const glint=ctx.createLinearGradient(x-44,0,x+44,0);glint.addColorStop(0,'rgba(173,181,190,0)');glint.addColorStop(.24,'rgba(173,181,190,.5)');glint.addColorStop(.35,'#e4e9ee');glint.addColorStop(.65,'#e4e9ee');glint.addColorStop(.76,'rgba(173,181,190,.5)');glint.addColorStop(1,'rgba(173,181,190,0)');ctx.fillStyle=glint;ctx.fillRect(x-44,65,88,365);continue;
   }
   const glint=ctx.createLinearGradient(x-22,0,x+22,0);glint.addColorStop(0,'rgba(255,255,255,0)');glint.addColorStop(.4,'rgba(255,255,255,.3)');glint.addColorStop(.5,'rgba(255,255,255,.9)');glint.addColorStop(.6,'rgba(255,255,255,.3)');glint.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glint;ctx.fillRect(x-22,65,44,365);
  }
 }
 const texture=new THREE.CanvasTexture(canvas);texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.SRGBColorSpace;
 const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromEquirectangular(texture);texture.dispose();pmrem.dispose();return target;
}
export function materialFromSpec(spec,brush,night,environment=null){
 const {brushed,metalTone,...properties}=spec;
 if(!brushed)return new THREE.MeshStandardMaterial({...properties,envMapIntensity:night?.24:1});
 if(metalTone==='silver')return new THREE.MeshPhysicalMaterial({...properties,roughness:properties.roughness*.55,map:brush.color,roughnessMap:brush.roughness,bumpMap:brush.roughness,bumpScale:.012,anisotropy:.5,anisotropyRotation:0,clearcoat:.24,clearcoatRoughness:.14,clearcoatRoughnessMap:brush.roughness,envMap:environment,envMapIntensity:(night?.75:.95)/SILVER_REFLECTION_FILL});
 // Sharper directional metal reflections and a restrained lacquer highlight
 // sit over the same evenly lit gold base. Keep the filled studio and grain.
 return new THREE.MeshPhysicalMaterial({...properties,roughness:properties.roughness*.8,map:brush.color,roughnessMap:brush.roughness,bumpMap:brush.roughness,bumpScale:.012,anisotropy:.65,anisotropyRotation:0,clearcoat:.38,clearcoatRoughness:.14,envMap:environment,envMapIntensity:night?.55:1.2});
}
export function brushedUVs(geometry,tileSize){
 // Align the grain across separate letters and supports, including side
 // walls. A minimum screen-readable scale keeps it visible on large signs.
 const positions=geometry.attributes.position,normals=geometry.attributes.normal,uv=geometry.attributes.uv;
 for(let i=0;i<uv.count;i++){
  const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
  if(Math.abs(normals.getZ(i))>.5)uv.setXY(i,x/tileSize,y/tileSize);
  else if(Math.abs(normals.getX(i))>.5)uv.setXY(i,z/tileSize,y/tileSize);
  else uv.setXY(i,x/tileSize,z/tileSize);
 }
}
function silhouette(layout,scale,width,height,pad){
 const w=width+pad*2,h=height+pad*2,canvas=document.createElement('canvas');
 canvas.width=2048;canvas.height=Math.max(128,Math.round(2048*h/w));
 const ctx=canvas.getContext('2d'),px=canvas.width/w;ctx.beginPath();
 for(const {shape,x,y} of layout.shapes)for(const loop of [shape,...shape.holes]){
  loop.getPoints(20).forEach((p,i)=>{const a=canvas.width/2+(p.x+x)*scale*px,b=canvas.height/2-(p.y+y)*scale*px;i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.closePath();
 }
 ctx.fillStyle='#fff';ctx.fill('evenodd');
 return {canvas,px,width:w,height:h};
}
function canvasTexture(canvas){const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;}
export function glowColor(hex){
 const color=new THREE.Color(hex),rgb=color.clone().convertLinearToSRGB();
 // Pastel picker chips describe a colour, not its light output. Keep the
 // selected hue vivid at high radiance instead of clipping it towards white.
 if(Math.max(rgb.r,rgb.g,rgb.b)-Math.min(rgb.r,rgb.g,rgb.b)>.24){
  const hsl=color.getHSL({},THREE.SRGBColorSpace);color.setHSL(hsl.h,Math.max(.9,hsl.s),.55,THREE.SRGBColorSpace);
 }
 return color;
}
export function frontLightColor(hex){
 const base=new THREE.Color(hex),rgb=base.clone().convertLinearToSRGB();
 const value=Math.max(rgb.r,rgb.g,rgb.b),min=Math.min(rgb.r,rgb.g,rgb.b);
 if(value<.08)return base;
 const hue=base.getHSL({},THREE.SRGBColorSpace).h,saturation=(value-min)/value;
 // One luminous colour across the entire flat acrylic face. HSV brightening
 // retains the hue and 76% of its saturation without an inflated-looking gradient.
 const v=value+(1-value)*.9,s=saturation*.76,l=v*(1-s/2);
 return new THREE.Color().setHSL(hue,l===0||l===1?0:(v-l)/Math.min(l,1-l),l,THREE.SRGBColorSpace);
}
function glowTexture(layout,scale,width,height,front,night){
 const spread=Math.min(front?(night?13:8):(night?20:13),height*(front?.36:.6));
 const mask=silhouette(layout,scale,width,height,Math.max(front?12:25,spread*4));
 const canvas=document.createElement('canvas');canvas.width=mask.canvas.width;canvas.height=mask.canvas.height;const ctx=canvas.getContext('2d');
 // A white light mask keeps saturated colours bright. Colour and radiance
 // are applied in linear space by the material, separately from opacity.
 for(const [radius,alpha] of [[spread,.85],[spread*.4,.75],[Math.min(2,spread*.12),.7]]){
  ctx.globalAlpha=alpha;ctx.filter=`blur(${radius*mask.px}px)`;ctx.drawImage(mask.canvas,0,0);
 }
 // Front glow surrounds the acrylic rather than adding a second exposure
 // over its face. The letter counters still receive the soft light spill.
 if(front){ctx.globalAlpha=1;ctx.filter='none';ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask.canvas,0,0);}
 return {texture:canvasTexture(canvas),width:mask.width,height:mask.height};
}
export class SignRenderer{
 constructor(host){
  this.host=host;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#b9ab97');
  this.camera=new THREE.PerspectiveCamera(36,1,.1,3000);this.camera.position.set(20,10,240);
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.35;
  host.append(this.renderer.domElement);
  this.brush=brushedTexture();for(const texture of Object.values(this.brush))texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.environment=studioEnvironment(this.renderer);this.brushedEnvironment=studioEnvironment(this.renderer,true);this.silverEnvironment=studioEnvironment(this.renderer,'silver');this.scene.environment=this.environment.texture;
  this.ambient=new THREE.HemisphereLight('#fff4e2','#54505a',2);this.scene.add(this.ambient);
  this.sun=new THREE.DirectionalLight('#fff3dc',3.2);this.sun.position.set(-100,190,200);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-300;this.sun.shadow.camera.right=300;this.sun.shadow.camera.top=250;this.sun.shadow.camera.bottom=-250;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=900;this.sun.shadow.normalBias=.3;this.sun.shadow.bias=-.0003;this.scene.add(this.sun);
  this.fill=new THREE.DirectionalLight('#c4d6ff',1.2);this.fill.position.set(150,10,80);this.scene.add(this.fill);
  this.wall=new THREE.Mesh(new THREE.PlaneGeometry(8000,4500),new THREE.MeshStandardMaterial({color:wallColors.warm,roughness:.95,map:wallTexture()}));this.wall.position.z=-.3;this.wall.receiveShadow=true;this.scene.add(this.wall);
  this.group=new THREE.Group();this.scene.add(this.group);this.width=120;this.height=30;this.zoom=1.2;this.angle=.68;this.elevation=.18;this.closeup=false;this.revision=0;
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);
  let drag=null;
  host.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,angle:this.angle,elevation:this.elevation};if(e.pointerType==='mouse')host.setPointerCapture(e.pointerId);});
  host.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(e.pointerType!=='mouse'&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}this.angle=Math.max(-1.05,Math.min(1.05,drag.angle-dx*.004));this.elevation=Math.max(-.25,Math.min(.45,drag.elevation+dy*.003));this.positionCamera();this.host.dispatchEvent(new CustomEvent('viewchange'));});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(name,()=>{drag=null;});
  this.renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();host.dispatchEvent(new CustomEvent('rendererror',{detail:'Die 3D-Ansicht wurde unterbrochen. Bitte lade die Seite neu. Dein Entwurf bleibt gespeichert.'}));});
 }
 resize(){const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.positionCamera();}
 positionCamera(){
  const detail=this.closeup&&this.detail,halfFov=THREE.MathUtils.degToRad(this.camera.fov/2);
  const padding=detail?Math.max(8,detail.height*.18):35;
  const fitW=((detail?detail.width+this.depth*2:this.width)+padding)/(2*Math.tan(halfFov)*this.camera.aspect),fitH=((detail?detail.height:this.height)+padding)/(2*Math.tan(halfFov));
  const d=Math.max(fitW,fitH)*1.22/this.zoom;const target=detail?new THREE.Vector3(detail.x,detail.y,this.letterRear+this.depth/2):new THREE.Vector3(0,0,3);
  // Match depth precision to the framed sign. A fixed 0.1 cm near plane made
  // the acrylic face and its glow fight for the same depth at 400 cm width.
  this.camera.near=Math.max(1,d*.05);this.camera.far=Math.max(3000,d*3);this.camera.updateProjectionMatrix();
  this.camera.position.set(Math.sin(this.angle)*d,Math.sin(this.elevation)*d,Math.cos(this.angle)*d).add(target);this.camera.lookAt(target);this.render();
 }
 view(mode){this.closeup=mode==='side'||mode==='mounting';this.zoom=mode==='perspective'?1.2:1;this.angle=mode==='mounting'?1.05:mode==='front'?0:mode==='side'?.7:.68;this.elevation=mode==='mounting'?.08:mode==='front'?0:.18;this.positionCamera();}
 changeZoom(delta){this.zoom=Math.max(.65,Math.min(1.5,this.zoom+delta));this.positionCamera();}
 render(){this.renderer.render(this.scene,this.camera);}
 async update(s){
  const rev=++this.revision;const font=await loadFont(s.font);if(rev!==this.revision)return null;
  const layout=layoutLetters(font,s.text,s.spacing),scale=s.width/layout.width,width=s.width,height=layout.height*scale;
  const group=new THREE.Group(),spec=materialSpec(s),brushTile=Math.max(20,s.width*.4),makeMaterial=spec=>materialFromSpec(spec,this.brush,s.night,(spec.metalTone==='silver'?this.silverEnvironment:this.brushedEnvironment).texture);
  const bodyMaterial=makeMaterial(spec.shell),rearMaterial=s.lighting==='back'?makeMaterial(spec.rear):null;
  // Colour-bounded illumination remains independent of scene exposure.
  const faceMaterial=s.lighting==='front'&&s.lightOn?new THREE.MeshBasicMaterial({color:frontLightColor(s.acrylic),toneMapped:false}):makeMaterial(spec.face);
  // With the LEDs off, the acrylic only reflects the scene light. Its diffuse
  // surface must stay dimmer than the illuminated colour instead of turning pastel.
  if(s.lighting==='front'&&!s.lightOn){faceMaterial.color.multiplyScalar(.25);faceMaterial.roughness=.6;faceMaterial.envMapIntensity=s.night?.04:.15;faceMaterial.toneMapped=false;}
  // Keep the solid opal edge readable separately from the bright rear face
  // and the halo on the wall; all three are physically separate surfaces.
  const rearEdgeMaterial=s.lighting==='back'?makeMaterial({...spec.rear,emissive:s.lightOn?'#f3f6ff':'#000000',emissiveIntensity:s.night?2:.8}):null;
  const mounting=mountingLayout(s,height),backOffset=mounting.letterRear;
  for(const item of layout.shapes){
   const parts=letterGeometries(item.shape,scale,s,true);
   for(const geometry of Object.values(parts))if(geometry){geometry.translate(item.x*scale,item.y*scale,backOffset);brushedUVs(geometry,brushTile);}
   const mesh=new THREE.Mesh(parts.shell,[bodyMaterial]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
   const face=new THREE.Mesh(parts.front,faceMaterial);face.castShadow=true;face.receiveShadow=true;group.add(face);
   if(parts.rear){const rear=new THREE.Mesh(parts.rear,[rearMaterial,rearEdgeMaterial]);rear.castShadow=true;group.add(rear);}
  }
  const supportSpec=s.mount==='plate'||s.railCustomColor?paintMaterialSpec(s,s.mount==='plate'?'plate':'railColor'):{color:'#a8adb1',brushed:false};
  const supportMaterial=s.mount==='individual'?null:supportSpec.brushed?makeMaterial(supportSpec):new THREE.MeshStandardMaterial({color:supportSpec.color,roughness:.5,metalness:.15,envMapIntensity:s.night?.08:1});
  if(s.mount==='rail'){
   const support=mounting.rail;
   const rail=new THREE.Mesh(new THREE.BoxGeometry(width,support.height,support.depth),supportMaterial);brushedUVs(rail.geometry,brushTile);rail.position.set(0,support.y,support.z);rail.castShadow=true;rail.receiveShadow=true;group.add(rail);
   const postMaterial=new THREE.MeshStandardMaterial({color:'#94999c',roughness:.42,metalness:.65,envMapIntensity:s.night?.15:1});
   for(const item of layout.shapes){
    const point=railAttachment(item,scale,support.y);if(!point||point.width<.15)continue;
    const radius=Math.min(1.1,point.width*.3,height*.025),length=backOffset-support.front;
    const post=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,12),postMaterial);post.rotation.x=Math.PI/2;post.position.set(point.x,support.y,support.front+length/2);post.castShadow=true;post.receiveShadow=true;group.add(post);
   }
  }
  if(s.mount==='plate'){
   const plate=new THREE.Mesh(new THREE.BoxGeometry(width+16,height+16,1.2),supportMaterial);brushedUVs(plate.geometry,brushTile);plate.position.z=1;plate.castShadow=true;plate.receiveShadow=true;group.add(plate);
   const screwMat=new THREE.MeshStandardMaterial({color:'#9a9a96',metalness:.8,roughness:.35,envMapIntensity:s.night?.15:1});
   for(const x of [-1,1])for(const y of [-1,1]){const screw=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.25,12),screwMat);screw.rotation.x=Math.PI/2;screw.position.set(x*(width/2+5.5),y*(height/2+5.5),1.75);group.add(screw);}
  }
  // A silhouette texture behind the letters gives the halo its actual outline and holes.
  if(s.lightOn){
   const front=s.lighting==='front',g=glowTexture(layout,scale,width,height,front,s.night);
   const radiance=glowColor(lightColor(s)).multiplyScalar(front?(s.night?1.8:.9):(s.night?3.2:1.55));
   const halo=new THREE.Mesh(new THREE.PlaneGeometry(g.width,g.height),new THREE.MeshBasicMaterial({map:g.texture,color:radiance,transparent:true,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}));
   halo.position.z=front?backOffset+s.depth+.13:s.mount==='plate'?1.65:.05;group.add(halo);
  }
  dispose(this.group);this.scene.remove(this.group);this.group=group;this.scene.add(group);
  const bg=new THREE.Color(wallColors[s.wall]);if(s.night)bg.multiplyScalar(.06);
  this.wall.material.color.set(wallColors[s.wall]).multiplyScalar(s.night?.25:1);this.wall.material.envMapIntensity=s.night?.04:1;
  this.scene.background.copy(bg);this.ambient.intensity=s.night?.04:2;this.sun.intensity=s.night?.06:3.2;this.fill.intensity=s.night?.025:1.2;this.renderer.toneMappingExposure=s.night?1.15:1.35;
  const layerEmphasis=Math.max(0,acrylicPreviewDepth(s)-1);
  this.width=width+(s.mount==='plate'?16:8);this.height=height+(s.mount==='plate'?16:0);this.detail=detailBounds(layout,scale);this.letterRear=backOffset;this.depth=s.depth+layerEmphasis;this.positionCamera();
  return {width,height,overallWidth:this.width,overallHeight:this.height,layerEmphasis:layerEmphasis>0};
 }
 snapshot(){this.render();return this.renderer.domElement.toDataURL('image/png');}
}
