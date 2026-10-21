import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../deploy/configurator/configurator.js',import.meta.url),'utf8');
const inputBody=source.split("$('#sign-text').addEventListener('input',()=>{\n")[1].split('\n});')[0];
const cartGuard=source.match(/function cartItemNeedsUpdate\(item\)\{[^\n]+\}/)[0];
function edit(rasterVersion,text,next){
 const state={rasterVersion,text,fontId:'Typewriter',lineHeight:.8,result:null};
 const elements={'#sign-text':{value:next},'#save-design':{disabled:false}};
 const saved=[];let render;
 const context=vm.createContext({state,$:id=>elements[id],spacingContent:s=>s.replace(/\s/g,''),spacingAnchor:null,
  designRendering:false,compactLineSpacing:false,revision:0,timer:null,invalidatePrice(){},
  scheduleDraft(){saved.push({version:state.rasterVersion,rendering:context.designRendering});},
  clearTimeout(){},setTimeout(fn){render=fn;},update(){return state.rasterVersion;}});
 vm.runInContext(inputBody,context);return {state,saved,render,context};
}
for(const version of [undefined,2,3])test(`text edit from V${version??1} renders V3 before cart and invalidates price`,()=>{
 const result=edit(version,'Daniel Klesse ABCDEGD','Interner Messcheck');
 assert.equal(result.render(),3);assert.equal(result.state.rasterVersion,3);
 assert.equal(result.context.designRendering,true);assert.equal(result.context.revision,1);
 assert.deepEqual(result.saved,[{version:3,rendering:true}]);
});
for(const version of [undefined,2])test(`unchanged V${version??1} draft keeps its original rendering`,()=>{
 assert.equal(edit(version,'Original','Original').render(),version);
});
test('old cart snapshots still require review, even if the edited draft is current',()=>{
 const needsUpdate=vm.runInNewContext(cartGuard+';cartItemNeedsUpdate');
 for(const version of [undefined,2]){
  const old={design:{rasterVersion:version},snapshot:{rasterVersion:version}};
  const edited=edit(version,'Original','New text');
  assert.equal(needsUpdate(old),true);
  assert.equal(needsUpdate({design:edited.state,snapshot:old.snapshot}),true);
  assert.equal(needsUpdate({design:edited.state,snapshot:{rasterVersion:3}}),false);
  assert.equal(old.design.rasterVersion,version);
 }
});
