import * as THREE from './vendor/three.js';
import {FontLoader} from './vendor/FontLoader.js';
const fontCache=new Map();
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
function dispose(group){group.traverse(obj=>{obj.geometry?.dispose();for(const mat of Array.isArray(obj.material)?obj.material:obj.material?[obj.material]:[]){mat.map?.dispose();mat.dispose();}});group.clear();}
function wallTexture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');
 const image=ctx.createImageData(512,512);let seed=29;
 for(let i=0;i<image.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;const n=220+(seed%25);image.data.set([n,n,n,255],i);}ctx.putImageData(image,0,0);
 const tex=new THREE.CanvasTexture(canvas);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(6,6);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
function glowTexture(layout,scale,width,height,color,front){
 const pad=front?10:22,w=width+pad*2,h=height+pad*2;
 const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=Math.max(128,Math.round(1536*h/w));const ctx=canvas.getContext('2d');const px=canvas.width/w;
 function draw(){
  ctx.beginPath();
  for(const {shape,x,y} of layout.shapes){
   for(const loop of [shape,...shape.holes]){
    const points=loop.getPoints(14);points.forEach((p,i)=>{const a=canvas.width/2+(p.x+x)*scale*px,b=canvas.height/2-(p.y+y)*scale*px;i?ctx.lineTo(a,b):ctx.moveTo(a,b);});ctx.closePath();
   }
  }
  ctx.fill('evenodd');
 }
 ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=Math.min(90,(front?2.5:5.5)*px);ctx.shadowOffsetX=canvas.width*2;
 ctx.save();ctx.translate(-canvas.width*2,0);draw();ctx.restore();
 if(!front){ctx.shadowBlur=Math.min(50,2*px);ctx.save();ctx.translate(-canvas.width*2,0);draw();ctx.restore();}
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return {texture,width:w,height:h};
}
export class SignRenderer{
 constructor(host){
  this.host=host;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#b9ab97');
  this.camera=new THREE.PerspectiveCamera(36,1,.1,3000);this.camera.position.set(20,10,240);
  this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.35;
  host.append(this.renderer.domElement);
  this.ambient=new THREE.HemisphereLight('#fff4e2','#54505a',2);this.scene.add(this.ambient);
  this.sun=new THREE.DirectionalLight('#fff3dc',3.2);this.sun.position.set(-100,190,200);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-300;this.sun.shadow.camera.right=300;this.sun.shadow.camera.top=250;this.sun.shadow.camera.bottom=-250;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=900;this.sun.shadow.normalBias=.3;this.sun.shadow.bias=-.0003;this.scene.add(this.sun);
  this.fill=new THREE.DirectionalLight('#c4d6ff',1.2);this.fill.position.set(150,10,80);this.scene.add(this.fill);
  this.wall=new THREE.Mesh(new THREE.PlaneGeometry(1600,900),new THREE.MeshStandardMaterial({color:wallColors.warm,roughness:.95,map:wallTexture()}));this.wall.position.z=-.3;this.wall.receiveShadow=true;this.scene.add(this.wall);
  this.group=new THREE.Group();this.scene.add(this.group);this.width=120;this.height=30;this.zoom=1;this.angle=.15;this.elevation=.09;this.revision=0;
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);
  let drag=null;
  host.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY,angle:this.angle,elevation:this.elevation};if(e.pointerType==='mouse')host.setPointerCapture(e.pointerId);});
  host.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(e.pointerType!=='mouse'&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}this.angle=Math.max(-.8,Math.min(.8,drag.angle-dx*.004));this.elevation=Math.max(-.25,Math.min(.45,drag.elevation+dy*.003));this.positionCamera();this.host.dispatchEvent(new CustomEvent('viewchange'));});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])host.addEventListener(name,()=>{drag=null;});
  this.renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();host.dispatchEvent(new CustomEvent('rendererror',{detail:'Die 3D-Ansicht wurde unterbrochen. Bitte lade die Seite neu. Dein Entwurf bleibt gespeichert.'}));});
 }
 resize(){const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.positionCamera();}
 positionCamera(){
  const halfFov=THREE.MathUtils.degToRad(this.camera.fov/2),fitW=(this.width+30)/(2*Math.tan(halfFov)*this.camera.aspect),fitH=(this.height+35)/(2*Math.tan(halfFov));
  const d=Math.max(fitW,fitH)*1.22/this.zoom;const target=new THREE.Vector3(0,0,3);
  this.camera.position.set(Math.sin(this.angle)*d,Math.sin(this.elevation)*d,Math.cos(this.angle)*d+3);this.camera.lookAt(target);this.render();
 }
 view(mode){this.zoom=mode==='side'?1.12:1;this.angle=mode==='front'?0:mode==='side'?.57:.15;this.elevation=mode==='front'?0:mode==='side'?.18:.09;this.positionCamera();}
 changeZoom(delta){this.zoom=Math.max(.65,Math.min(1.5,this.zoom+delta));this.positionCamera();}
 render(){this.renderer.render(this.scene,this.camera);}
 async update(s){
  const rev=++this.revision;const font=await loadFont(s.font);if(rev!==this.revision)return null;
  const layout=layoutLetters(font,s.text,s.spacing),scale=s.width/layout.width,width=s.width,height=layout.height*scale;
  const group=new THREE.Group(),metal=s.body==='#a8adb1'||s.body==='#b8995b';
  const bodyMaterial=new THREE.MeshStandardMaterial({color:s.body,metalness:metal?.65:.15,roughness:metal?.34:.5});
  const faceMaterial=new THREE.MeshStandardMaterial({color:s.lighting==='front'?s.color:s.body,emissive:s.lighting==='front'&&s.lightOn?s.color:'#000000',emissiveIntensity:s.night?1.5:.65,roughness:s.lighting==='front'?.34:.45,metalness:s.lighting==='front'?.05:metal?.65:.15});
  const backOffset=s.mount==='rail'?8:s.mount==='plate'?4:3;
  for(const item of layout.shapes){
   const geometry=new THREE.ExtrudeGeometry(item.shape,{depth:s.depth/scale,bevelEnabled:true,bevelThickness:.09/scale,bevelSize:.1/scale,bevelSegments:1,curveSegments:10,steps:1});
   geometry.scale(scale,scale,scale);geometry.translate(item.x*scale,item.y*scale,backOffset);
   const mesh=new THREE.Mesh(geometry,[faceMaterial,bodyMaterial]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  const supportMaterial=new THREE.MeshStandardMaterial({color:s.mount==='plate'?s.plate:s.body,roughness:.5,metalness:.15});
  if(s.mount==='rail'){
   const rail=new THREE.Mesh(new THREE.BoxGeometry(width+8,Math.min(8,height*.27),5),supportMaterial);rail.position.set(0,-height*.12,3);rail.castShadow=true;rail.receiveShadow=true;group.add(rail);
  }
  if(s.mount==='plate'){
   const plate=new THREE.Mesh(new THREE.BoxGeometry(width+16,height+16,1.2),supportMaterial);plate.position.z=1;plate.castShadow=true;plate.receiveShadow=true;group.add(plate);
   const screwMat=new THREE.MeshStandardMaterial({color:'#9a9a96',metalness:.8,roughness:.35});
   for(const x of [-1,1])for(const y of [-1,1]){const screw=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.25,12),screwMat);screw.rotation.x=Math.PI/2;screw.position.set(x*(width/2+5.5),y*(height/2+5.5),1.75);group.add(screw);}
  }
  // A silhouette texture behind the letters gives the halo its actual outline and holes.
  if(s.lightOn){
   const front=s.lighting==='front',g=glowTexture(layout,scale,width,height,s.color,front);
   const halo=new THREE.Mesh(new THREE.PlaneGeometry(g.width,g.height),new THREE.MeshBasicMaterial({map:g.texture,transparent:true,opacity:front?.22:s.night?.95:.75,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}));
   halo.position.z=front?backOffset+s.depth+.13:s.mount==='plate'?1.65:.05;group.add(halo);
  }
  dispose(this.group);this.scene.remove(this.group);this.group=group;this.scene.add(group);
  const bg=new THREE.Color(wallColors[s.wall]);if(s.night)bg.multiplyScalar(.24);
  this.wall.material.color.set(wallColors[s.wall]);this.scene.background.copy(bg);this.ambient.intensity=s.night?.35:2;this.sun.intensity=s.night?.32:3.2;this.fill.intensity=s.night?.15:1.2;this.renderer.toneMappingExposure=s.night?1.15:1.35;
  this.width=width+(s.mount==='plate'?16:8);this.height=height+(s.mount==='plate'?16:0);this.positionCamera();
  return {width,height,overallWidth:this.width,overallHeight:this.height};
 }
 snapshot(){this.render();return this.renderer.domElement.toDataURL('image/png');}
}
