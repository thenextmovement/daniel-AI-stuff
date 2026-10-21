import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT,FONTS,FINISHES,activeFinish,finishDescription,lightColor,materialSpec,normalize,validate,description} from '../../deploy/3d-konfigurator/model.js';
import {quote3D,railColorEstimate} from '../../deploy/3d-konfigurator/pricing.js';
import {layoutLetters,letterGeometries,mountingLayout,railAttachment} from '../../deploy/3d-konfigurator/renderer.js';
import {Mesh,MeshBasicMaterial,BoxGeometry,Raycaster,Vector3} from '../../deploy/3d-konfigurator/vendor/three.js';
import {FontLoader} from '../../deploy/3d-konfigurator/vendor/FontLoader.js';
const font=new FontLoader().parse(JSON.parse(await readFile(new URL('../../deploy/3d-konfigurator/fonts/modern.json',import.meta.url),'utf8')));
const fonts=Object.fromEntries(await Promise.all(Object.keys(FONTS).map(async id=>[id,new FontLoader().parse(JSON.parse(await readFile(new URL(`../../deploy/3d-konfigurator/fonts/${id}.json`,import.meta.url),'utf8')))])));
test('Font outlines preserve counters and saved choices; all six new fonts include German lettering',()=>{
 for(const [id,font] of Object.entries(fonts)){
  const layout=layoutLetters(font,id==='modern'?'ATLAS & 123':'ÄÖÜ äöü ß & 123',5);
  assert.ok(Number.isFinite(layout.width)&&layout.width>0,id);assert.ok(layout.height>0,id);
  assert.ok(layoutLetters(font,'ADO',5).shapes.filter(item=>item.shape.holes.length).length>=3,id);
  assert.equal(normalize({...DEFAULT,font:id}).font,id);
  for(const item of layout.shapes){const parts=letterGeometries(item.shape,120/layout.width,DEFAULT);for(const geometry of Object.values(parts)){geometry.computeBoundingBox();assert.ok(Number.isFinite(geometry.boundingBox.max.x),id);geometry.dispose();}}
 }
});
test('The rail stays behind each letter, with attachment points on solid material rather than counters',()=>{
 const material=new MeshBasicMaterial();
 for(const font of Object.values(fonts))for(const width of [30,120,400])for(const lighting of ['front','back'])for(const depth of [3,8]){
  const state={...DEFAULT,text:'PRADA',width,depth,lighting,mount:'rail'},layout=layoutLetters(font,state.text,5),scale=width/layout.width;
  const mounting=mountingLayout(state,layout.height*scale),support=mounting.rail;
  assert.ok(mounting.letterRear>support.front);
  const rail=new Mesh(new BoxGeometry(width,support.height,support.depth),material);rail.position.set(0,support.y,support.z);rail.updateMatrixWorld();
  for(const item of layout.shapes){
   const point=railAttachment(item,scale,support.y);assert.ok(point?.width>0);
   const parts=letterGeometries(item.shape,scale,state);
   parts.front.translate(item.x*scale,item.y*scale,mounting.letterRear);
   const face=new Mesh(parts.front,material);face.updateMatrixWorld();
   const hits=new Raycaster(new Vector3(point.x,support.y,100),new Vector3(0,0,-1)).intersectObjects([rail,face]);
   assert.equal(hits[0]?.object,face,'A solid letter face must hide its rail from the front');
   for(const geometry of Object.values(parts))geometry?.dispose();
  }
  rail.geometry.dispose();
 }
 material.dispose();
});
test('Stored drafts cannot enable unsupported options or inject executable markup',()=>{
 const s=normalize({version:99,text:'<script>Hallo</script>',font:'../../../secret',mount:'other',width:Infinity,depth:-5,color:'url(javascript:alert(1))',night:'true'});
 assert.equal(s.version,2);assert.equal(s.font,'modern');assert.equal(s.mount,'individual');assert.equal(s.width,120);assert.equal(s.depth,3);assert.equal(s.color,DEFAULT.color);assert.equal(s.night,false);assert.equal(s.text.includes('<'),false);
});
test('Empty, multiline and impossible dimensions never pass the review gate',()=>{
 for(const patch of [{text:'   '},{text:'A\nB\nC'},{width:0},{width:401},{width:NaN}])assert.notEqual(validate({...DEFAULT,...patch}),'');
 assert.equal(validate({...DEFAULT,text:'ÄÖÜ ß\nATLAS',width:120}),'');
});
test('Font geometry measures actual letters and retains counters',()=>{
 const single=layoutLetters(font,'A',5),wide=layoutLetters(font,'ATLAS',5),two=layoutLetters(font,'ATLAS\nSTUDIO',5);
 assert.ok(single.width>0&&single.height>0);assert.ok(wide.width>single.width);assert.ok(two.height>wide.height);assert.ok(single.shapes.some(g=>g.shape.holes.length>0));
 assert.throws(()=>layoutLetters(font,'🚀',5),/nicht verfügbar/);assert.throws(()=>layoutLetters(font,'  ',5),/sichtbaren/);
});
test('More letter spacing changes proportions while width remains an explicit customer constraint',()=>{
 const a=layoutLetters(font,'ATLAS',0),b=layoutLetters(font,'ATLAS',20);
 assert.ok(b.width>a.width);assert.equal(a.height,b.height);assert.ok(a.height*120/a.width>b.height*120/b.width);
});
test('3D products never fall through to neon pricing or purchase before approved rules exist',()=>{
 for(const lighting of ['front','back'])for(const mount of ['individual','rail','plate']){
  const q=quote3D([{design:{...DEFAULT,lighting,mount},quantity:1}]);assert.equal(q.grossCents,null);assert.equal(q.purchaseEnabled,false);assert.equal(q.status,'placeholder');
 }
});
test('Review description retains light, support and physical size choices',()=>{
 const text=description({...DEFAULT,lighting:'back',mount:'plate',width:210,depth:8},46.7);
 assert.match(text,/Rückbeleuchtet/);assert.match(text,/Auf Platte/);assert.match(text,/210 cm/);assert.match(text,/8 cm/);assert.match(text,/46,7/);
});

test('New designs start with gold brushed stainless steel and halo lighting',()=>{
 assert.equal(DEFAULT.lighting,'back');assert.equal(activeFinish(DEFAULT),'brushed-gold');assert.match(finishDescription(DEFAULT),/gold lackiert/);
 const spec=materialSpec(DEFAULT);assert.equal(spec.face.emissive,'#000000');assert.equal(spec.shell.brushed,true);
});
test('Front lighting uses independently colored acrylic with a stainless shell and rear',()=>{
 const state=normalize({...DEFAULT,lighting:'front',acrylic:'#134da8',color:'#fc6fa8',frontFinish:'mirror-steel'});
 const lit=materialSpec(state),off=materialSpec({...state,lightOn:false});
 assert.equal(lit.face.color,'#134da8');assert.equal(lit.face.metalness,0);assert.equal(lit.face.emissive,'#134da8');assert.equal(lit.shell.metalness,1);assert.equal(lit.shell.color,FINISHES['mirror-steel'].color);
 assert.equal(off.face.color,lit.face.color);assert.equal(off.face.emissive,'#000000');assert.equal(lightColor(state),'#134da8');
 assert.match(description(state,20),/Front: farbiges Acryl \(#134DA8\)/);assert.match(description(state,20),/Korpus und Rückseite: Edelstahl, poliert und verspiegelt/);
});
test('Polished and brushed finishes retain distinct surface properties and independent lighting',()=>{
 for(const id of Object.keys(FINISHES)){
  const state=normalize({...DEFAULT,backFinish:id,frontFinish:'brushed-steel',color:'#80baff'}),spec=materialSpec(state);
  assert.equal(spec.face.emissive,'#000000');assert.equal(lightColor(state),'#80baff');assert.equal(activeFinish({...state,lighting:'front'}),'brushed-steel');assert.equal(activeFinish(state),id);
 }
 const mirror=materialSpec({...DEFAULT,backFinish:'mirror-steel'}),brushed=materialSpec(DEFAULT);
 assert.ok(mirror.face.roughness<brushed.face.roughness);assert.equal(mirror.face.brushed,false);assert.equal(brushed.face.brushed,true);
});
test('Existing drafts migrate without losing color, lighting, text or cart-edit material choices',()=>{
 const old=normalize({version:1,text:'MEIN LOGO',lighting:'front',body:'#252525',color:'#fc6fa8'});
 assert.equal(old.version,2);assert.equal(old.text,'MEIN LOGO');assert.equal(old.lighting,'front');assert.equal(old.acrylic,'#fc6fa8');assert.equal(old.frontFinish,'painted-steel');assert.equal(old.body,'#252525');
 assert.equal(normalize({version:1,lighting:'back',body:'#b8995b'}).backFinish,'brushed-gold');
 const design=normalize({...DEFAULT,backFinish:'mirror-steel',frontFinish:'painted-steel',body:'#124578',acrylic:'#AABBCC'});
 assert.deepEqual(normalize(JSON.parse(JSON.stringify(design))),design);
 const unsafe=normalize({...design,backFinish:'__proto__',acrylic:'url(secret)',body:'red'});assert.equal(unsafe.backFinish,DEFAULT.backFinish);assert.equal(unsafe.acrylic,DEFAULT.acrylic);assert.equal(unsafe.body,DEFAULT.body);
});

test('Backlit letters have a separate matching white acrylic rear layer, including letter holes',()=>{
 const shape=layoutLetters(font,'A',5).shapes[0].shape;
 for(const depth of [3,5,8]){
  const state={...DEFAULT,depth,color:'#fc6fa8'},parts=letterGeometries(shape,1,state),materials=materialSpec(state);
  assert.ok(parts.rear);assert.ok(parts.rear.parameters.shapes.holes.length>0);
  for(const geometry of Object.values(parts))if(geometry)geometry.computeBoundingBox();
  assert.equal(parts.rear.boundingBox.min.z,0);assert.ok(parts.rear.boundingBox.max.z>0);
  assert.ok(Math.abs(parts.shell.boundingBox.min.z-parts.rear.boundingBox.max.z)<.05);
  for(const axis of ['x','y'])assert.ok(Math.abs(parts.rear.boundingBox.max[axis]-parts.front.boundingBox.max[axis])<.001);
  assert.ok(parts.front.boundingBox.min.z>parts.rear.boundingBox.max.z);
  assert.equal(materials.rear.color,'#ffffff');assert.equal(materials.rear.emissive,'#fc6fa8');assert.equal(materials.face.emissive,'#000000');
  assert.equal(materialSpec({...state,lightOn:false}).rear.color,'#ffffff');assert.equal(materialSpec({...state,lightOn:false}).rear.emissive,'#000000');
  for(const geometry of Object.values(parts))geometry?.dispose();
 }
 const front=letterGeometries(shape,1,{...DEFAULT,lighting:'front'});assert.equal(front.rear,null);front.shell.dispose();front.front.dispose();
});

test('The EUR 110/m estimate applies only to custom-colour rails and never enables checkout',()=>{
 const custom={...DEFAULT,mount:'rail',railCustomColor:true,railColor:'#fa31a2',width:120};
 assert.equal(railColorEstimate(custom).unitCents,13200);assert.equal(railColorEstimate(custom,2).totalCents,26400);
 assert.equal(railColorEstimate({...custom,width:200}).unitCents,22000);
 for(const patch of [{railCustomColor:false},{mount:'plate'},{mount:'individual'},{width:0},{width:NaN}])assert.equal(railColorEstimate({...custom,...patch}),null);
 assert.equal(railColorEstimate(custom,0),null);assert.equal(railColorEstimate(custom,1.5),null);
 const q=quote3D([{design:custom,quantity:2}]);assert.equal(q.estimates[0].totalCents,26400);assert.equal(q.estimates[0].taxBasis,null);assert.equal(q.grossCents,null);assert.equal(q.purchaseEnabled,false);
 const restored=normalize(JSON.parse(JSON.stringify(custom)));assert.equal(restored.railColor,'#fa31a2');assert.equal(restored.railCustomColor,true);assert.match(description(restored),/Wunschfarbe #FA31A2/);
});
