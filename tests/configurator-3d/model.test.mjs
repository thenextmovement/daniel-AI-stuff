import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT,normalize,validate,description} from '../../deploy/3d-konfigurator/model.js';
import {quote3D} from '../../deploy/3d-konfigurator/pricing.js';
import {layoutLetters} from '../../deploy/3d-konfigurator/renderer.js';
import {FontLoader} from '../../deploy/3d-konfigurator/vendor/FontLoader.js';
const font=new FontLoader().parse(JSON.parse(await readFile(new URL('../../deploy/3d-konfigurator/fonts/modern.json',import.meta.url),'utf8')));
test('Stored drafts cannot enable unsupported options or inject executable markup',()=>{
 const s=normalize({version:99,text:'<script>Hallo</script>',font:'../../../secret',mount:'other',width:Infinity,depth:-5,color:'url(javascript:alert(1))',night:'true'});
 assert.equal(s.version,1);assert.equal(s.font,'modern');assert.equal(s.mount,'individual');assert.equal(s.width,120);assert.equal(s.depth,3);assert.equal(s.color,DEFAULT.color);assert.equal(s.night,false);assert.equal(s.text.includes('<'),false);
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
  const q=quote3D([{design:{...DEFAULT,lighting,mount},quantity:1}]);assert.equal(q.grossCents,null);assert.equal(q.purchaseEnabled,false);assert.equal(q.status,'unavailable');
 }
});
test('Review description retains light, support and physical size choices',()=>{
 const text=description({...DEFAULT,lighting:'back',mount:'plate',width:210,depth:8},46.7);
 assert.match(text,/Rückbeleuchtet/);assert.match(text,/Auf Platte/);assert.match(text,/210 cm/);assert.match(text,/8 cm/);assert.match(text,/46,7/);
});
