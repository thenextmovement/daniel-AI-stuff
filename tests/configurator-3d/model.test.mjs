import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT,FONTS,COLORS,ACRYLICS,FINISHES,activeFinish,finishDescription,lightColor,materialSpec,normalize,validate,description} from '../../deploy/3d-konfigurator/model.js';
import {quote3D,railColorEstimate} from '../../deploy/3d-konfigurator/pricing.js';
import {layoutLetters,letterGeometries,mountingLayout,railAttachment,detailBounds,frontLightColor} from '../../deploy/3d-konfigurator/renderer.js';
import {Mesh,MeshBasicMaterial,BoxGeometry,Raycaster,Vector3,Color,SRGBColorSpace} from '../../deploy/3d-konfigurator/vendor/three.js';
import {FontLoader} from '../../deploy/3d-konfigurator/vendor/FontLoader.js';
const font=new FontLoader().parse(JSON.parse(await readFile(new URL('../../deploy/3d-konfigurator/fonts/modern.json',import.meta.url),'utf8')));
const fonts=Object.fromEntries(await Promise.all(Object.keys(FONTS).map(async id=>[id,new FontLoader().parse(JSON.parse(await readFile(new URL(`../../deploy/3d-konfigurator/fonts/${id}.json`,import.meta.url),'utf8')))])));
test('The uniformly lit front preserves hue and saturation without clipping colours to white',()=>{
 const hsv=color=>{const c=color.clone().convertLinearToSRGB(),v=Math.max(c.r,c.g,c.b),min=Math.min(c.r,c.g,c.b);return {v,s:v?(v-min)/v:0,h:color.getHSL({},SRGBColorSpace).h};};
 for(const hex of [...ACRYLICS.map(([value])=>value),'#0044ff','#af004b','#000000','#777777']){
  const selected=hsv(new Color(hex)),lit=frontLightColor(hex),colour=hsv(lit);
  assert.ok(colour.v>=selected.v-1e-6,'Illumination must brighten the chosen colour');
  for(const channel of [lit.r,lit.g,lit.b])assert.ok(channel>=-1e-6&&channel<=1+1e-6,'No over-range channel clipping');
  if(selected.s>.01){
   const delta=Math.abs(selected.h-colour.h);assert.ok(Math.min(delta,1-delta)<1e-6,'Hue must not shift');assert.ok(colour.s>=selected.s*.75,'Coloured acrylic must not turn white');
  }else{assert.ok(colour.s<1e-6,'Neutral colours remain neutral');}
 }
 assert.equal(frontLightColor('#ffffff').getHexString(),'ffffff');assert.equal(frontLightColor('#000000').getHexString(),'000000');
});
test('All 17 light colours survive a saved draft; original colour values stay supported',()=>{
 assert.equal(COLORS.length,17);assert.equal(ACRYLICS.length,17);
 for(const palette of [COLORS,ACRYLICS])assert.equal(new Set(palette.map(([value])=>value)).size,17);
 for(const [color,name] of COLORS){
  const state=normalize(JSON.parse(JSON.stringify({...DEFAULT,color,acrylic:'#2474e5'})));
  assert.equal(state.color,color);assert.match(description(state),new RegExp(name));
  assert.equal(materialSpec(state).rear.color,'#ffffff','Changing the LED colour does not recolour the opal acrylic substrate');
  assert.equal(lightColor({...state,lighting:'front'}),'#2474e5');
 }
 for(const color of ['#fff1d6','#f5f7ff','#f5c35b','#fc6fa8','#80baff','#8bdfb1'])assert.equal(normalize({...DEFAULT,color}).color,color);
 for(const acrylic of ['#ffffff','#e62d38','#ff8b24','#ee67af','#2474e5','#26a86b'])assert.ok(ACRYLICS.some(([value])=>value===acrylic));
});
test('Font outlines preserve counters and saved choices; all six new fonts include German lettering',()=>{
 for(const [id,font] of Object.entries(fonts)){
  const layout=layoutLetters(font,id==='modern'?'ATLAS & 123':'ÄÖÜ äöü ß & 123',5);
  assert.ok(Number.isFinite(layout.width)&&layout.width>0,id);assert.ok(layout.height>0,id);
  assert.ok(layoutLetters(font,'ADO',5).shapes.filter(item=>item.shape.holes.length).length>=3,id);
  assert.equal(normalize({...DEFAULT,font:id}).font,id);
  for(const item of layout.shapes){const parts=letterGeometries(item.shape,120/layout.width,DEFAULT);for(const geometry of Object.values(parts)){geometry.computeBoundingBox();assert.ok(Number.isFinite(geometry.boundingBox.max.x),id);geometry.dispose();}}
 }
});
test('The detail camera keeps an entire letter, including umlaut dots, in its frame',()=>{
 for(const [id,font] of Object.entries(fonts)){
  const text=id==='modern'?'PRADA':'MÜ',layout=layoutLetters(font,text,5),scale=400/layout.width;
  const detail=detailBounds(layout,scale);
  assert.ok(Number.isFinite(detail.x)&&Number.isFinite(detail.y));
  assert.ok(detail.width>0&&detail.height>0&&detail.width<=400);
  assert.ok(detail.x>0,'The close-up selects the last letter');
  if(id!=='modern')assert.ok(Math.abs(detail.height-layout.height*scale)<.001,'The umlaut dots stay in frame');
 }
});
test('The rail is centred against the wall and separated from every letter by spacers',()=>{
 const material=new MeshBasicMaterial();
 for(const font of Object.values(fonts))for(const width of [30,120,400])for(const lighting of ['front','back'])for(const depth of [3,8])for(const preview of [false,true]){
  const state={...DEFAULT,text:'PRADA',width,depth,lighting,mount:'rail'},layout=layoutLetters(font,state.text,5),scale=width/layout.width;
  const mounting=mountingLayout(state,layout.height*scale),support=mounting.rail;
  assert.equal(support.y,0,'The rail must be halfway up the lettering');
  assert.equal(support.z-support.depth/2,0,'The rail sits against the wall');
  assert.equal(mounting.letterRear-support.front,5,'Only a spacer bridges the gap to the letters');
  const rail=new Mesh(new BoxGeometry(width,support.height,support.depth),material);rail.position.set(0,support.y,support.z);rail.updateMatrixWorld();
  for(const item of layout.shapes){
   const point=railAttachment(item,scale,support.y);assert.ok(point?.width>0);
   const parts=letterGeometries(item.shape,scale,state,preview);
   for(const geometry of Object.values(parts))if(geometry){
    geometry.translate(item.x*scale,item.y*scale,mounting.letterRear);geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.z>support.front,'Neither the shell, face nor acrylic rear may intersect the rail');
   }
   const face=new Mesh(parts.front,material);face.updateMatrixWorld();
   const target=new Vector3(point.x,support.y,parts.front.boundingBox.min.z);
   for(const angle of [-1.22,0,1.22]){
    const origin=target.clone().add(new Vector3(Math.sin(angle)*100,0,Math.cos(angle)*100));
    const hits=new Raycaster(origin,target.clone().sub(origin).normalize()).intersectObjects([rail,face]);
    assert.equal(hits[0]?.object,face,'The solid face stays in front of the rail even in the mounting side view');
   }
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
  assert.equal(parts.rear.boundingBox.min.z,0);assert.equal(parts.rear.boundingBox.max.z,1,'The rear acrylic is a full 1 cm volume');
  assert.ok(Math.abs(parts.shell.boundingBox.min.z-parts.rear.boundingBox.max.z)<.05);
  for(const axis of ['x','y'])assert.ok(Math.abs(parts.rear.boundingBox.max[axis]-parts.front.boundingBox.max[axis])<.001);
  assert.ok(parts.front.boundingBox.min.z>parts.rear.boundingBox.max.z);
  assert.equal(materials.rear.color,'#ffffff');assert.equal(materials.rear.emissive,'#fc6fa8');assert.equal(materials.face.emissive,'#000000');
  assert.equal(materialSpec({...state,lightOn:false}).rear.color,'#ffffff');assert.equal(materialSpec({...state,lightOn:false}).rear.emissive,'#000000');
  for(const geometry of Object.values(parts))geometry?.dispose();
 }
 const front=letterGeometries(shape,1,{...DEFAULT,lighting:'front'});assert.equal(front.rear,null);front.shell.dispose();front.front.dispose();
});

test('Preview layer emphasis adds depth behind the metal without widening the front silhouette or changing the product',()=>{
 const state={...DEFAULT,width:400,depth:8},saved=JSON.stringify(state);
 const shape=layoutLetters(font,'A',5).shapes[0].shape;
 const actual=letterGeometries(shape,1,state),preview=letterGeometries(shape,1,state,true);
 for(const parts of [actual,preview])for(const geometry of Object.values(parts))geometry.computeBoundingBox();
 assert.equal(actual.rear.boundingBox.max.z,1);assert.equal(preview.rear.boundingBox.max.z,3);
 assert.ok(Math.abs(preview.shell.boundingBox.min.z-preview.rear.boundingBox.max.z)<.05,'The white layer directly touches the steel');
 for(const part of ['rear','shell','front'])for(const axis of ['x','y'])for(const end of ['min','max'])assert.equal(preview[part].boundingBox[end][axis],actual[part].boundingBox[end][axis],'No expanded outline');
 assert.ok(Math.abs(preview.front.boundingBox.min.z-actual.front.boundingBox.min.z-2)<.0001);
 assert.equal(preview.rear.parameters.shapes.holes.length,actual.rear.parameters.shapes.holes.length);
 assert.equal(JSON.stringify(state),saved);assert.equal(normalize(state).depth,8);assert.match(description(state),/Wunschtiefe: 8 cm/);
 for(const parts of [actual,preview])for(const geometry of Object.values(parts))geometry.dispose();
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
