/** Physical AR model. Input coordinates are millimetres, output units are metres.
 * No room-photo position, camera zoom or SVG glow is part of this model.
 */
import {THREE, GLTFExporter, USDZExporter, mergeGeometries} from './vendor/ar/runtime.js';
const MM=.001, RADIAL_SEGMENTS=12, MAX_POINTS=8000, MAX_TRIANGLES=220000, MAX_BYTES=20*1024*1024;
const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
const positive=(n)=>finite(n)&&n>0&&n<=10000;
const hex=(s)=>typeof s==='string'&&/^#[0-9a-f]{6}$/i.test(s);
function fail(message){throw new Error(message);}
const PLATE_FINISHES=new Set(['clear','solid','uv-print','mirror-gold','mirror-silver']);
function plateFinish(plate){
  // Older locally saved snapshots did not contain a finish selection.
  if(plate.finish===undefined)return {kind:'clear',color:'#FFFFFF'};
  const finish=plate.finish;
  if(!finish||typeof finish!=='object'||!PLATE_FINISHES.has(finish.kind)||!hex(finish.color))fail('Das Material oder die Farbe der Rückplatte ist für AR ungültig.');
  if(finish.kind==='solid'&&!['#FFFFFF','#000000','#D4AF37'].includes(finish.color.toUpperCase()))fail('Die feste Rückplattenfarbe ist ungültig.');
  return {kind:finish.kind,color:finish.color.toUpperCase()};
}

export function validateArSnapshot(snapshot){
  if(!snapshot||!snapshot.sign||!snapshot.plate)fail('Für AR fehlt ein vollständiger Entwurf.');
  const {sign,plate}=snapshot;
  const finish=plateFinish(plate);
  if(!positive(sign.widthMm)||!positive(sign.heightMm)||!positive(plate.widthMm)||!positive(plate.heightMm)||!positive(plate.base?.heightMm))fail('Die Maße für die 3D-Vorschau sind ungültig.');
  if(sign.tubeMm!==8)fail('Die AR-Vorschau benötigt den 8-mm-Neonpfad.');
  if(!positive(plate.acrylicThicknessMm)||plate.acrylicThicknessMm>30)fail('Die Acrylstärke für die 3D-Vorschau ist ungültig.');
  if(plate.widthMm<sign.widthMm||plate.base.heightMm<sign.heightMm||plate.heightMm<plate.base.heightMm)fail('Schriftzug und Rückplatte passen geometrisch nicht zusammen.');
  if(!Array.isArray(sign.glyphs)||!sign.glyphs.length||sign.glyphs.length>2000)fail('Für AR fehlen die tatsächlichen Neonlinien.');
  let count=0;
  for(const glyph of sign.glyphs){
    if(!hex(glyph.color?.color)||!Array.isArray(glyph.paths)||!glyph.paths.length)fail('Die Neonlinien oder ihre Farben sind unvollständig.');
    for(const path of glyph.paths){
      if(!Array.isArray(path.points)||!path.points.length)fail('Ein Neonpfad ist leer.');
      count+=path.points.length;
      if(count>MAX_POINTS)fail('Dieser Entwurf ist für die mobile 3D-Vorschau zu komplex. Bitte verwenden Sie die Maßansicht.');
      for(const p of path.points)if(!Array.isArray(p)||p.length!==2||!p.every(finite)||p[0]<3.9||p[1]<3.9||p[0]>sign.widthMm-3.9||p[1]>sign.heightMm-3.9)fail('Ein Neonpfad liegt außerhalb der angegebenen Maße.');
    }
  }
  const plateContours=plate.type==='freestanding'?parseRailContours(plate.path):[parsePlateContour(plate.path)];
  if(plateContours.some(points=>points.some(([x,y])=>x<-.5||y<-.5||x>plate.widthMm+.5||y>plate.heightMm+.5)))fail('Die Acrylkontur liegt außerhalb der angegebenen Maße.');
  if(plate.type==='freestanding'&&finish.kind!=='clear')fail('Freigestellte Acrylstreben müssen transparent bleiben.');
  return {plateContours,pointCount:count,finish};
}

function parseRailContours(path){
  if(typeof path!=='string'||path.length>5000)fail('Die Acrylstreben sind ungültig.');
  const parts=path.match(/M[^M]*Z/g)||[];
  if(parts.length<1||parts.length>13||parts.join('')!==path)fail('Die Acrylstreben oder ihre Verbindungen sind ungültig.');
  return parts.map(parsePlateContour);
}

// Our existing plate generator emits a single, closed M/L polygon. Reject any
// unsupported command instead of silently replacing a customer's contour.
export function parsePlateContour(path){
  if(typeof path!=='string'||path.length>500000||!/^M/i.test(path)||!/[zZ]\s*$/.test(path))fail('Die Acrylkontur für AR ist nicht geschlossen.');
  const tokens=path.match(/[MLZmlz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[];
  if(path.replace(/[MLZmlz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[\s,]/g,''))fail('Die Acrylkontur verwendet nicht unterstützte Kurven.');
  const points=[];let i=0;
  while(i<tokens.length){const command=tokens[i++];
    if(command==='Z'){if(i!==tokens.length)fail('Mehrteilige Acrylkonturen sind noch nicht für AR verfügbar.');break;}
    if(command!=='M'&&command!=='L')fail('Die Acrylkontur für AR ist ungültig.');
    if(command==='M'&&points.length)fail('Mehrteilige Acrylkonturen sind noch nicht für AR verfügbar.');
    const x=Number(tokens[i++]),y=Number(tokens[i++]);if(!finite(x)||!finite(y))fail('Die Acrylkontur enthält ungültige Punkte.');
    points.push([x,y]);if(points.length>6000)fail('Die Acrylkontur ist für AR zu komplex.');
  }
  if(points.length<3)fail('Die Acrylkontur enthält zu wenige Punkte.');
  let area=0;for(let k=0;k<points.length;k++){const a=points[k],b=points[(k+1)%points.length];area+=a[0]*b[1]-a[1]*b[0];}
  if(Math.abs(area)<1)fail('Die Acrylkontur hat keine Fläche.');
  return points;
}

function tubeGeometry(points,radius,closed){
  // Rings follow the existing polyline. Rounded end caps match SVG round caps.
  const clean=points.filter((p,i)=>!i||p.distanceToSquared(points[i-1])>1e-16);
  if(closed&&clean.length>1&&clean[0].distanceToSquared(clean.at(-1))<1e-16)clean.pop();
  if(clean.length===1){const g=new THREE.SphereGeometry(radius,12,8);g.deleteAttribute('uv');g.translate(...clean[0].toArray());return g;}
  const vertices=[],normals=[],indices=[],n=clean.length;
  for(let i=0;i<n;i++){
    const prev=clean[closed?(i+n-1)%n:Math.max(0,i-1)],next=clean[closed?(i+1)%n:Math.min(n-1,i+1)];
    const tangent=next.clone().sub(prev);
    // An out-and-back junction has equal neighbours: use an actual one-sided
    // segment, never the same cancelled central difference again.
    if(tangent.lengthSq()<1e-16)tangent.copy(next).sub(clean[i]);
    if(tangent.lengthSq()<1e-16)tangent.copy(clean[i]).sub(prev);
    tangent.normalize();
    const normal=new THREE.Vector3(-tangent.y,tangent.x,0);
    for(let j=0;j<RADIAL_SEGMENTS;j++){const angle=j/RADIAL_SEGMENTS*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),nx=normal.x*c,ny=normal.y*c;
      vertices.push(clean[i].x+radius*nx,clean[i].y+radius*ny,clean[i].z+radius*s);normals.push(nx,ny,s);
    }
  }
  for(let i=0;i<(closed?n:n-1);i++)for(let j=0;j<RADIAL_SEGMENTS;j++){const a=i*RADIAL_SEGMENTS+j,b=i*RADIAL_SEGMENTS+(j+1)%RADIAL_SEGMENTS,c=((i+1)%n)*RADIAL_SEGMENTS+j,d=((i+1)%n)*RADIAL_SEGMENTS+(j+1)%RADIAL_SEGMENTS;indices.push(a,b,c,b,d,c);}
  const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));body.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));body.setIndex(indices);
  // Preserve shared ring/cap vertices. Expanding every triangle duplicates all
  // positions and normals and can exceed the iPhone USDZ budget for one line.
  const parts=[body];
  if(!closed)for(const p of [clean[0],clean.at(-1)]){const sphere=new THREE.SphereGeometry(radius,12,8);sphere.deleteAttribute('uv');sphere.translate(...p.toArray());parts.push(sphere);}
  const merged=mergeGeometries(parts);parts.forEach(g=>g.dispose());merged.normalizeNormals();return merged;
}

export function createArGeometry(snapshot){
  const {plateContours,pointCount,finish}=validateArSnapshot(snapshot),{sign,plate}=snapshot;
  const scene=new THREE.Scene();scene.name='NEONTRIP';
  const meshes=[],materials=[],colorGroups=new Map(),thickness=plate.acrylicThicknessMm*MM,radius=sign.tubeMm*MM/2;
  const xOffset=(plate.widthMm-sign.widthMm)/2,yOffset=(plate.base.heightMm-sign.heightMm)/2;
  const toPoint=([x,y])=>new THREE.Vector3((x+xOffset-plate.widthMm/2)*MM,(plate.heightMm/2-y-yOffset)*MM,thickness+radius);
  try{
    const shapes=plateContours.map(points=>new THREE.Shape(points.map(([x,y])=>new THREE.Vector2((x-plate.widthMm/2)*MM,(plate.heightMm/2-y)*MM))));
    const plateGeometry=new THREE.ExtrudeGeometry(shapes,{depth:thickness,steps:1,bevelEnabled:false});
    const clear=finish.kind==='clear',mirror=finish.kind==='mirror-gold'||finish.kind==='mirror-silver';
    // Metallic PBR approximates the selected mirror finish; it is not a live
    // reflection of the customer's room or a calibrated material sample.
    const plateMaterial=new THREE.MeshStandardMaterial({name:'Acryl_'+finish.kind,color:finish.color,transparent:clear,opacity:clear?.13:1,roughness:mirror?.12:clear?.15:.55,metalness:mirror?1:0,depthWrite:!clear});materials.push(plateMaterial);
    const plateMesh=new THREE.Mesh(plateGeometry,plateMaterial);plateMesh.name='Acrylplatte';scene.add(plateMesh);meshes.push(plateMesh);
    for(const glyph of sign.glyphs){const color=snapshot.presentation?.light===false&&hex(glyph.color.off)?glyph.color.off:glyph.color.color;
      if(!colorGroups.has(color))colorGroups.set(color,[]);
      for(const path of glyph.paths)colorGroups.get(color).push(tubeGeometry(path.points.map(toPoint),radius,!!path.closed));
    }
    for(const [color,parts] of colorGroups){
      const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
      const material=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:snapshot.presentation?.light===false?0:1,roughness:.35,metalness:0});materials.push(material);
      const mesh=new THREE.Mesh(geometry,material);mesh.name='Neon_'+color.slice(1);scene.add(mesh);meshes.push(mesh);
    }
    scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(scene),plateBounds=new THREE.Box3().setFromObject(plateMesh),signBounds=new THREE.Box3();meshes.slice(1).forEach(mesh=>signBounds.union(new THREE.Box3().setFromObject(mesh)));
    const triangles=meshes.reduce((sum,m)=>sum+(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,0);
    if(triangles>MAX_TRIANGLES)fail('Dieser Entwurf ist für die mobile 3D-Vorschau zu komplex. Bitte verwenden Sie die Maßansicht.');
    const dim=(box)=>{const v=box.getSize(new THREE.Vector3());return {widthMm:v.x/MM,heightMm:v.y/MM,depthMm:v.z/MM};};
    const metrics={units:'metres',plateFinish:{...finish,reflectionApproximate:mirror},tubeMm:sign.tubeMm,acrylicThicknessMm:plate.acrylicThicknessMm,pointCount,triangles,colors:[...colorGroups.keys()],sign:dim(signBounds),plate:dim(plateBounds),model:dim(bounds),placement:snapshot.mount?.id==='table-stand'?'floor':'wall',hardwareIncluded:false,manufacturingApproved:false};
    return {scene,metrics,dispose(){for(const mesh of meshes)mesh.geometry.dispose();for(const material of materials)material.dispose();scene.clear();}};
  }catch(error){for(const mesh of meshes)mesh.geometry.dispose();for(const material of materials)material.dispose();for(const parts of colorGroups.values())parts.forEach(g=>g.dispose());throw error;}
}

export async function exportArGeometry(model,{includeUsdz=true}={}){
  const glb=await new GLTFExporter().parseAsync(model.scene,{binary:true,onlyVisible:true});
  if(!(glb instanceof ArrayBuffer)||glb.byteLength>MAX_BYTES)fail('Die 3D-Datei ist für diese mobile Vorschau zu groß.');
  let usdz=null;
  if(includeUsdz){usdz=await new USDZExporter().parseAsync(model.scene,{includeAnchoringProperties:true,ar:{anchoring:{type:'plane'},planeAnchoring:{alignment:model.metrics.placement==='wall'?'vertical':'horizontal'}}});
    if(usdz.byteLength>MAX_BYTES)fail('Die iPhone-AR-Datei ist für diese Vorschau zu groß.');
  }
  return {glb,usdz,bytes:{glb:glb.byteLength,usdz:usdz?.byteLength||0}};
}

/** Transfer exact physical meshes to the existing OFFER native exporter.
 * This preview request is not manufacturing or checkout authority.
 */
export function createOfferArRequest(snapshot){
  const model=createArGeometry(snapshot),{sign,plate}=snapshot;
  const encode=array=>{const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
  const pack=(geometry,role,color)=>({role,color,positions:encode(geometry.attributes.position.array),normals:encode(geometry.attributes.normal.array),indices:encode(geometry.index?new Uint32Array(geometry.index.array):Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i))});
  try{
    const meshes=model.scene.children.map((m,i)=>pack(m.geometry,i?'body':'plate',i?'#'+m.material.color.getHexString():plate.finish?.color||'#FFFFFF'));
    const width=plate.widthMm*.001,thickness=plate.acrylicThicknessMm*.001,radius=.004;
    const ox=(plate.widthMm-sign.widthMm)/2,oy=(plate.base.heightMm-sign.heightMm)/2;
    const groups=new Map();
    for(const glyph of sign.glyphs){
      const color=snapshot.presentation?.light===false&&hex(glyph.color.off)?glyph.color.off:glyph.color.color;
      if(!groups.has(color))groups.set(color,[]);
      for(const p of glyph.paths)groups.get(color).push({closed:!!p.closed,points:p.points.map(([x,y])=>[(x+ox-plate.widthMm/2)*.001,(plate.heightMm/2-y-oy)*.001])});
    }
    const regions=[];
    for(const [color,paths] of groups){
      const parts=paths.map(p=>tubeGeometry(p.points.map(([x,y])=>new THREE.Vector3(x,y,0)),radius*.7,p.closed));
      const core=mergeGeometries(parts);parts.forEach(p=>p.dispose());
      // Pale shallow core sits on the front surface, inside the 8-mm body.
      core.scale(1,1,.0003/(radius*.7));core.translate(0,0,thickness+.0077);core.computeVertexNormals();
      meshes.push(pack(core,'core',color));core.dispose();
      regions.push({color,warmWhite:sign.glyphs.some(g=>g.color.color===color&&g.color.id==='warm_white'),paths:paths.map(p=>({closed:p.closed,points:p.points.map(([x,y])=>[x/width,y/width])}))});
    }
    return {version:1,light:snapshot.presentation?.light!==false,plateFinish:plate.finish||{kind:'clear',color:'#FFFFFF'},widthMeters:width,heightMeters:plate.heightMm*.001,depthMeters:thickness+.008,meshes,regions};
  }finally{model.dispose();}
}
