// Compare complete published geometry, pricing and the worker metrics against
// an unchanged release. Usage: node this-file.mjs <baseline-root> <candidate-root>
// Roots contain the complete configurator artifact, including fonts/vendor files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [baselineRoot,candidateRoot]=process.argv.slice(2).map(p=>path.resolve(p));
assert.ok(baselineRoot&&candidateRoot,'Provide baseline and candidate configurator roots');
const moduleAt=(root,file)=>import(pathToFileURL(path.join(root,file)));
let response;
globalThis.self={postMessage:value=>{response=value;}};
await moduleAt(baselineRoot,'font-worker.js');const baseline=self.onmessage;
await moduleAt(candidateRoot,'font-worker.js');const source=self.onmessage;
await moduleAt(candidateRoot,'font-worker.min.js');const bundle=self.onmessage;
const oldPricing=await moduleAt(baselineRoot,'pricing.js');
const pricing=await moduleAt(candidateRoot,'pricing.js');
const manufacturing=await moduleAt(baselineRoot,'manufacturing-profile.js');
async function call(handler,data){
  response=undefined;await handler({data:{requestId:1,...data}});
  assert.equal(response?.ok,true,response?.error||'Worker did not reply');
  return structuredClone(response);
}
let geometryChecks=0,priceChecks=0;
for(const fontId of ['Amsterdam','Alexa','NeonLite']){
  const bytes=fs.readFileSync(path.join(baselineRoot,'assets/fonts',fontId+'.ttf'));
  for(const handler of [baseline,source,bundle])await call(handler,{type:'load',fontId,bytes});
  for(const rasterVersion of [2,3])for(const text of ['Dein Text','NEONTRIP\nWIR MACHEN LICHT']){
    const input={type:'render',fontId,text,rasterVersion,axis:'width',valueMm:1480,lineHeight:.9,alignment:'center'};
    const expected=await call(baseline,input);
    for(const handler of [source,bundle]){
      const actual=await call(handler,input);assert.deepEqual(actual,expected);geometryChecks++;
      const before=JSON.stringify(actual);
      const {minimum}=await call(handler,{type:'text-minimum',result:actual,text});
      assert.deepEqual(minimum,manufacturing.minimumTextDesign(expected,text));
      const {clearance}=await call(handler,{type:'line-clearance',layout:actual.layout});
      assert.deepEqual(clearance,manufacturing.minimumTextGroupClearance({...expected.layout,glyphs:expected.layout.glyphs.map(g=>({...g,wordIndex:0}))}));
      pricing.cacheMinimumTextDesign(actual,text,minimum);
      // No metrics become persisted geometry or an input accepted from a draft.
      assert.equal(JSON.stringify(actual),before);
      const design={fontId,text,mode:'text',mount:'wall-mount',lightMode:'static',color:'pink',finish:'clear'};
      for(const backing of ['contour','rectangle','square','freestanding']){
        const options={...design,backing};
        assert.deepEqual(pricing.sizeRangeForResult(options,actual),oldPricing.sizeRangeForResult(options,expected));
        assert.deepEqual(pricing.priceForResult(options,actual),oldPricing.priceForResult(options,expected));priceChecks++;
      }
      // A primed result must not synchronously traverse its route geometry again.
      const layout=actual.layout;Object.defineProperty(actual,'layout',{configurable:true,get(){throw new Error('UI recalculated geometry');}});
      pricing.minimumSizeForResult({...design,backing:'contour'},actual);
      Object.defineProperty(actual,'layout',{configurable:true,value:layout});
      const changed={...design,text:text+' extended text for another width',backing:'contour'};
      assert.deepEqual(pricing.minimumSizeForResult(changed,actual),oldPricing.minimumSizeForResult(changed,expected));
    }
  }
}
// Keep null and overlap outcomes, including two lines occupying the same route.
for(const glyphs of [[],[0,1].map(lineIndex=>({lineIndex,wordIndex:0,charText:'A',paths:[{points:[[4,4],[100,100]]}]}))]){
  const result={layout:{glyphs},size:{exact:{design:{widthMm:480,heightMm:120},backing:{widthMm:510,heightMm:150}}}};
  const {minimum}=await call(bundle,{type:'text-minimum',text:'A\nA',result});
  assert.deepEqual(minimum,manufacturing.minimumTextDesign(result,'A\nA'));
  if(glyphs.length)assert.equal(minimum.layoutConflict,'overlapping-text-groups');
}
console.log(JSON.stringify({geometryChecks,priceChecks,metricsEqual:true,cacheAvoidsUiTraversal:true,textChangesInvalidateCache:true,overlapPreserved:true}));
