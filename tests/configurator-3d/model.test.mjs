import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT,FONTS,COLORS,ACRYLICS,FINISHES,activeFinish,classicLook,PAINT_PRESETS,PAINT_FIELDS,RAL_COLORS,ralCode,choosePaint,paintDescription,finishDescription,lightColor,materialSpec,paintMaterialSpec,normalize,validate,description} from '../../deploy/3d-konfigurator/model.js';
import {quote3D,railColorEstimate} from '../../deploy/3d-konfigurator/pricing.js';
import {layoutLetters,letterGeometries,mountingLayout,railAttachment,detailBounds,frontLightColor,materialFromSpec,brushedUVs} from '../../deploy/3d-konfigurator/renderer.js';
import {Mesh,MeshBasicMaterial,BoxGeometry,Raycaster,Vector3,Color,SRGBColorSpace,Texture} from '../../deploy/3d-konfigurator/vendor/three.js';
import {searchRal,RAL_GROUPS,ralGroup} from '../../deploy/3d-konfigurator/ral.js';
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
 assert.equal(s.version,3);assert.equal(s.font,'modern');assert.equal(s.mount,'individual');assert.equal(s.width,120);assert.equal(s.depth,3);assert.equal(s.color,DEFAULT.color);assert.equal(s.night,false);assert.equal(s.text.includes('<'),false);
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
 const state=normalize({...DEFAULT,lighting:'front',acrylic:'#134da8',color:'#fc6fa8',sideColor:'#d34275',backFinish:'mirror-steel'});
 const lit=materialSpec(state),off=materialSpec({...state,lightOn:false});
 assert.equal(lit.face.color,'#134da8');assert.equal(lit.face.metalness,0);assert.equal(lit.face.emissive,'#134da8');assert.equal(lit.shell.metalness,FINISHES['painted-steel'].metalness);assert.equal(lit.shell.color,'#d34275');assert.equal(lit.rear.color,'#d34275');
 assert.equal(off.face.color,lit.face.color);assert.equal(off.face.emissive,'#000000');assert.equal(lightColor(state),'#134da8');
 assert.match(description(state,20),/Leuchtfarbe vorne: Eigene Farbe \(#134DA8\)/);assert.match(description(state,20),/Korpus: Edelstahl · Seiten lackiert \(#D34275\)/);
});
test('Polished and brushed finishes retain distinct surface properties and independent lighting',()=>{
 for(const id of Object.keys(FINISHES)){
  const state=normalize({...DEFAULT,backFinish:id,sideColor:'#123456',color:'#80baff'}),spec=materialSpec(state);
  assert.equal(spec.face.emissive,'#000000');assert.equal(lightColor(state),'#80baff');assert.equal(activeFinish({...state,lighting:'front'}),'painted-steel');assert.equal(activeFinish(state),id);
 }
 const mirror=materialSpec({...DEFAULT,backFinish:'mirror-steel'}),brushed=materialSpec(DEFAULT);
 assert.ok(mirror.face.roughness<brushed.face.roughness);assert.equal(mirror.face.brushed,false);assert.equal(brushed.face.brushed,true);
});
test('Existing drafts migrate without losing color, lighting, text or cart-edit material choices',()=>{
 const old=normalize({version:1,text:'MEIN LOGO',lighting:'front',body:'#252525',color:'#fc6fa8'});
 assert.equal(old.version,3);assert.equal(old.text,'MEIN LOGO');assert.equal(old.lighting,'front');assert.equal(old.acrylic,'#fc6fa8');assert.equal(old.sideColor,'#252525');assert.equal(old.body,'#252525');
 assert.equal(normalize({version:1,lighting:'back',body:'#b8995b'}).backFinish,'brushed-gold');
 const design=normalize({...DEFAULT,backFinish:'mirror-steel',sideColor:'#D34275',body:'#124578',acrylic:'#AABBCC'});
 assert.deepEqual(normalize(JSON.parse(JSON.stringify(design))),design);
 const unsafe=normalize({...design,backFinish:'__proto__',acrylic:'url(secret)',sideColor:'url(secret)',body:'red'});assert.equal(unsafe.backFinish,DEFAULT.backFinish);assert.equal(unsafe.acrylic,DEFAULT.acrylic);assert.equal(unsafe.body,DEFAULT.body);assert.equal(unsafe.sideColor,DEFAULT.sideColor);
});


test('Version 2 front finishes migrate to side paint without changing rear choices',()=>{
 for(const [id,finish] of Object.entries(FINISHES)){
  const old={version:2,lighting:'front',text:'PRADA',acrylic:'#2474e5',frontFinish:id,backFinish:'mirror-steel',body:'#123456'};
  const migrated=normalize(old);
  assert.equal(migrated.version,3);assert.equal(migrated.sideColor,finish.color||old.body);
  assert.equal(migrated.backFinish,old.backFinish);assert.equal(migrated.body,old.body);assert.equal(migrated.acrylic,old.acrylic);
  assert.equal(Object.hasOwn(migrated,'frontFinish'),false);assert.deepEqual(normalize(JSON.parse(JSON.stringify(migrated))),migrated);
 }
});
test('Front light and side paint stay independent through save, variant switches and classic reset',()=>{
 const design=normalize({...DEFAULT,lighting:'front',sideColor:'#e46723',acrylic:'#2474e5',backFinish:'painted-steel',body:'#123456',color:'#fc6fa8'});
 const restored=normalize(JSON.parse(JSON.stringify(design)));
 assert.equal(materialSpec(restored).face.color,'#2474e5');assert.equal(materialSpec(restored).shell.color,'#e46723');
 const back={...restored,lighting:'back'};assert.equal(materialSpec(back).shell.color,'#123456');assert.equal(lightColor(back),'#fc6fa8');
 const frontReset=classicLook(restored);assert.equal(frontReset.acrylic,DEFAULT.acrylic);assert.equal(frontReset.sideColor,DEFAULT.sideColor);
 for(const key of ['backFinish','body','color','text','width','mount'])assert.equal(frontReset[key],design[key]);
 const backReset=classicLook(back);for(const key of ['acrylic','sideColor'])assert.equal(backReset[key],design[key]);
 assert.equal(backReset.backFinish,DEFAULT.backFinish);assert.equal(backReset.color,DEFAULT.color);
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


test('All RAL CLASSIC codes resolve to named preview colours and reject unknown or unsafe input',()=>{
 assert.equal(Object.keys(RAL_COLORS).length,216);
 for(const [code,{name,hex}] of Object.entries(RAL_COLORS)){
  assert.match(code,/^\d{4}$/);assert.ok(name.length>2);assert.match(hex,/^#[0-9a-f]{6}$/);
  for(const input of [code,`RAL ${code}`,` ral${code} `])assert.equal(ralCode(input),code);
 }
 for(const value of ['9999','1234','RAL 701','RAL 70166','RAL 7016 foo','<svg>',null,7016,'__proto__'])assert.equal(ralCode(value),'');
 assert.equal(RAL_COLORS['7016'].name,'Anthrazitgrau');assert.equal(RAL_COLORS['9005'].name,'Tiefschwarz');
});
test('Each painted part saves its own RAL code and matching preview colour without changing light colours',()=>{
 let design={...DEFAULT,lighting:'front',mount:'rail',railCustomColor:true,acrylic:'#2474e5'};
 for(const [key,code] of [['sideColor','9016'],['body','3000'],['railColor','7016'],['plate','6005']])design=choosePaint(design,key,{ral:code});
 const saved=normalize(JSON.parse(JSON.stringify(design)));assert.deepEqual(saved,design);
 for(const key of Object.keys(PAINT_FIELDS)){
  const code=ralCode(saved[PAINT_FIELDS[key]]);assert.equal(saved[key],RAL_COLORS[code].hex);assert.ok(paintDescription(saved,key).includes(`RAL ${code}`));
 }
 assert.equal(saved.acrylic,'#2474e5');assert.equal(saved.color,DEFAULT.color);assert.equal(saved.backFinish,'painted-steel');
 assert.match(description(saved),/Seiten lackiert \(RAL 9016 · Verkehrsweiß\)/);assert.match(description(saved),/Schiene: Wunschfarbe RAL 7016 · Anthrazitgrau/);
 assert.match(description({...saved,lighting:'back',mount:'plate'}),/RAL 3000 · Feuerrot/);assert.match(description({...saved,mount:'plate'}),/Lackfarbe der Platte: RAL 6005 · Moosgrün/);
 assert.equal(railColorEstimate(saved).unitCents,13200);assert.equal(quote3D([{design:saved,quantity:1}]).purchaseEnabled,false);
});
test('Paint presets and free colour clear the prior RAL specification only for the chosen part',()=>{
 assert.deepEqual(PAINT_PRESETS.map(([,name])=>name),['Schwarz','Weiß','Gold']);
 for(const key of Object.keys(PAINT_FIELDS)){
  const ralDesign=choosePaint({...DEFAULT,sideRal:'RAL 9005',bodyRal:'RAL 3000',railRal:'RAL 7016',plateRal:'RAL 6005'},key,{ral:'9016'});
  for(const color of [...PAINT_PRESETS.map(([value])=>value),'#1A2B3C']){
   const changed=choosePaint(ralDesign,key,{color});assert.equal(changed[key],color.toLowerCase());assert.equal(changed[PAINT_FIELDS[key]],'');
   for(const [other,field] of Object.entries(PAINT_FIELDS))if(other!==key)assert.equal(changed[field],ralDesign[field]);
  }
  assert.deepEqual(choosePaint(ralDesign,key,{ral:'9999'}),ralDesign);
 }
 const reset=classicLook({...DEFAULT,lighting:'front',sideRal:'RAL 7016',sideColor:RAL_COLORS['7016'].hex,bodyRal:'RAL 3000'});
 assert.equal(reset.sideRal,'');assert.equal(reset.sideColor,DEFAULT.sideColor);assert.equal(reset.bodyRal,'RAL 3000');
});
test('Incomplete RAL entries block review only when the corresponding painted part is active',()=>{
 assert.match(validate({...DEFAULT,lighting:'front',sideRal:'RAL 9999'}),/RAL/);
 assert.match(validate({...DEFAULT,backFinish:'painted-steel',bodyRal:'701'}),/RAL/);
 assert.match(validate({...DEFAULT,mount:'rail',railCustomColor:true,railRal:'oops'}),/RAL/);
 assert.match(validate({...DEFAULT,mount:'plate',plateRal:'RAL 0000'}),/RAL/);
 assert.equal(validate({...DEFAULT,sideRal:'9999',bodyRal:'701',railRal:'oops',plateRal:'0000'}),'');
 const unsafe=normalize({...DEFAULT,sideRal:'<script>',bodyRal:'RAL 9999',railRal:'url(secret)',plateRal:'__proto__'});
 for(const field of Object.values(PAINT_FIELDS))assert.equal(unsafe[field],'');
 const mismatched=normalize({...DEFAULT,sideRal:'RAL 9016',sideColor:'#ff0000'});assert.equal(mismatched.sideColor,RAL_COLORS['9016'].hex);
});


test('RAL swatch search finds names, numbers and combined queries without losing catalogue entries',()=>{
 assert.equal(searchRal('').length,216);
 for(const [code,{name}] of Object.entries(RAL_COLORS)){
  assert.ok(searchRal(name).some(([found])=>found===code),name);
  assert.deepEqual(searchRal('RAL '+code).map(([found])=>found),[code]);
 }
 assert.deepEqual(searchRal('  ANTHRAZIT ').map(([code])=>code),['7016']);
 assert.deepEqual(searchRal('RAL 70 anthrazit').map(([code])=>code),['7016']);
 assert.deepEqual(searchRal('gold').map(([code])=>code),['1004','1036']);
 assert.ok(searchRal('weiss').some(([code])=>code==='9016'));
 assert.ok(searchRal('grun').some(([code])=>code==='6005'));
 assert.deepEqual(searchRal('9999'),[]);assert.deepEqual(searchRal('<script>'),[]);
});


test('RAL colour groups partition the full catalogue and combine with the name/number search',()=>{
 const grouped=RAL_GROUPS.filter(({id,codes})=>id!=='all'&&!codes).flatMap(({id})=>{
  const matches=searchRal('',id);assert.ok(matches.length>0,id);
  for(const [code] of matches)assert.equal(ralGroup(code),id);
  return matches.map(([code])=>code);
 });
 assert.equal(grouped.length,216);assert.equal(new Set(grouped).size,216);
 assert.deepEqual(grouped.sort(),Object.keys(RAL_COLORS).sort());
 for(const [code,group] of [['9016','white'],['9012','white'],['9005','black'],['9017','black'],['7016','grey'],['9006','grey'],['9023','grey'],['5005','blue'],['6005','green'],['1036','yellow']]){
  assert.equal(ralGroup('RAL '+code),group);assert.deepEqual(searchRal(code,group).map(([found])=>found),[code]);
 }
 assert.deepEqual(searchRal('signal','blue').map(([code])=>code),['5005']);
 assert.deepEqual(searchRal('weiss','black'),[]);
 assert.deepEqual(searchRal('grun','green').map(([code])=>code),searchRal('grun').filter(([code])=>code.startsWith('6')).map(([code])=>code));
 assert.deepEqual(searchRal('signal','all'),searchRal('signal'));
 assert.deepEqual(searchRal('','unknown'),[]);assert.equal(ralGroup('9999'),'');
});


test('Gold and silver shortcuts preserve the original colour groups and combine with search',()=>{
 assert.deepEqual(searchRal('', 'gold').map(([code])=>code),['1004','1036']);
 assert.deepEqual(searchRal('', 'silver').map(([code])=>code),['7001','9006','9007','9022','9023']);
 assert.deepEqual(searchRal('perl','gold').map(([code])=>code),['1036']);
 assert.deepEqual(searchRal('aluminium','silver').map(([code])=>code),['9006','9007']);
 assert.deepEqual(searchRal('RAL 9006','silver').map(([code])=>code),['9006']);
 assert.deepEqual(searchRal('blau','gold'),[]);
 for(const group of ['gold','silver'])for(const [code] of searchRal('',group)){
  assert.ok(searchRal('',ralGroup(code)).some(([found])=>found===code));
 }
 assert.equal(searchRal('').length,216);
});


test('Gold and silver paint use brushed metal on each painted part while acrylic stays non-metallic',()=>{
 for(const key of Object.keys(PAINT_FIELDS))for(const group of ['gold','silver'])for(const [code] of searchRal('',group)){
  const state=choosePaint({...DEFAULT,lighting:'front',acrylic:'#2474e5'},key,{ral:code});
  const before=JSON.stringify(state),paint=paintMaterialSpec(state,key),lit=materialSpec(state);
  assert.equal(paint.color,RAL_COLORS[code].hex);assert.ok(paint.metalness>=.9);assert.equal(paint.brushed,true);
  assert.equal(lit.face.metalness,0);assert.equal(lit.face.brushed,false);assert.equal(lit.face.color,'#2474e5');
  assert.equal(JSON.stringify(state),before);
  assert.equal(quote3D([{design:state,quantity:1}]).purchaseEnabled,false);
 }
 for(const color of ['#c6a156','#c5c9cc','#a8adb1'])assert.equal(paintMaterialSpec({...DEFAULT,sideColor:color},'sideColor').brushed,true);
 for(const color of ['#ffffff','#252525','#ffdd00','#808080','#2474e5'])assert.equal(paintMaterialSpec({...DEFAULT,sideColor:color},'sideColor').brushed,false);
 for(const ral of ['1003','7016','9016'])assert.equal(paintMaterialSpec(choosePaint(DEFAULT,'body',{ral}),'body').brushed,false);
 const gold=materialSpec(choosePaint(DEFAULT,'body',{color:'#c6a156'}));assert.equal(gold.face.brushed,true);assert.equal(gold.face.emissive,'#000000');
});

test('Brushed surfaces use directional physical reflections; UV changes preserve geometry and dimensions',()=>{
 const brush={color:new Texture(),roughness:new Texture()},environment=new Texture();
 for(const night of [false,true]){
  const metal=materialFromSpec(materialSpec(DEFAULT).face,brush,night,environment);
  assert.equal(metal.isMeshPhysicalMaterial,true);assert.ok(metal.anisotropy>0);assert.equal(metal.envMap,environment);
  assert.equal(metal.map,brush.color);assert.equal(metal.roughnessMap,brush.roughness);assert.equal(metal.emissiveIntensity,0);
  const acrylic=materialFromSpec(materialSpec({...DEFAULT,lighting:'front'}).face,brush,night,environment);
  assert.equal(acrylic.metalness,0);assert.equal(acrylic.map,null);assert.equal(acrylic.bumpMap,null);assert.equal(acrylic.envMap,null);
  metal.dispose();acrylic.dispose();
 }
 const shape=font.generateShapes('A',100)[0],parts=letterGeometries(shape,1,{...DEFAULT},true);
 for(const geometry of [...Object.values(parts),new BoxGeometry(120,8,4)]){
  const positions=Array.from(geometry.attributes.position.array);brushedUVs(geometry,48);
  assert.deepEqual(Array.from(geometry.attributes.position.array),positions);
  assert.ok(Array.from(geometry.attributes.uv.array).every(Number.isFinite));
  geometry.dispose();
 }
 brush.color.dispose();brush.roughness.dispose();environment.dispose();
});
