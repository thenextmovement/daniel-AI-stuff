import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../deploy/configurator/configurator.js',import.meta.url),'utf8');
const current=source.slice(source.indexOf('async function addCurrentDesign(){'),source.indexOf('async function addReviewedDesign(){'));
const reviewed=source.slice(source.indexOf('async function addReviewedDesign(){'),source.indexOf("$('#add-to-cart').addEventListener"));
const additional=source.slice(source.indexOf('function startAdditionalDesign(){'),source.indexOf("$('#cart-new-design').addEventListener"));
function setup(){
 const elements=new Map();
 const $=key=>{if(!elements.has(key))elements.set(key,{textContent:'',value:'1',inert:false,close(){},focus(){},select(){}});return elements.get(key);};
 let serial=0;
 const ctx=vm.createContext({window:{},$,structuredClone,crypto:{randomUUID:()=>`item-${++serial}`},setTimeout,requestAnimationFrame:f=>f(),XMLSerializer:class{serializeToString(){return '<svg/>';}}});
 vm.runInContext(`
 let cartAdding=false,cartReady=true,cartEditing=false,cartSyncing=false,designRendering=false,editingCartId=null;
 let cartItems=[],state={sizeValid:true,result:{},price:{status:'calculated'}},design={text:'Studio',backing:'contour'},orderDesign=null,orderSnapshot=null;
 let storedPriceCache=new Map(),PRICE_RULES={version:'test'},saved=null,tracked=[],cartShown=0;
 const captureDesign=()=>design,captureOrderSnapshot=()=>({mount:{valid:true},price:{status:'calculated',net:100},text:design.text}),orderPreview=()=>({});
 const refreshCartButtons=()=>{},commitHistory=()=>{},persistCart=async()=>{saved=structuredClone({items:cartItems,editingId:editingCartId});},showCart=()=>{cartShown++;},trackConfigurator=(name,data)=>tracked.push({name,data}),setStep=()=>{};
 ${current}\n${reviewed}\n${additional}
 `,ctx);
 return {run:s=>vm.runInContext(s,ctx),elements,$};
}
test('close, change backing, re-add updates one item and retains quantity and identity',async()=>{
 const h=setup();await h.run('addCurrentDesign()');
 h.run("cartItems[0].quantity=3;design={...design,backing:'freestanding'}");
 await h.run('addCurrentDesign()');
 assert.equal(h.run('cartItems.length'),1);assert.equal(h.run('cartItems[0].id'),'item-1');
 assert.equal(h.run('cartItems[0].quantity'),3);assert.equal(h.run('cartItems[0].design.backing'),'freestanding');
 assert.equal(h.run('saved.editingId'),'item-1');assert.equal(h.run('tracked.length'),1);
});
test('repeated confirmation cannot silently create another item',async()=>{
 const h=setup();await h.run('addCurrentDesign()');await h.run('addCurrentDesign()');await h.run('addCurrentDesign()');
 assert.equal(h.run('cartItems.length'),1);assert.equal(h.run('tracked.length'),1);
});
test('additional design is explicit; original remains unchanged',async()=>{
 const h=setup();await h.run('addCurrentDesign()');h.run('startAdditionalDesign()');
 assert.equal(h.run('saved.editingId'),null);
 h.run("design={...design,text:'Bar'}");await h.run('addCurrentDesign()');
 assert.equal(h.run('cartItems.length'),2);assert.equal(h.run('cartItems[0].design.text'),'Studio');
 assert.equal(h.run('cartItems[1].design.text'),'Bar');assert.equal(h.run('tracked.length'),2);
});
test('review confirmation keeps the cart binding and chosen quantity',async()=>{
 const h=setup();await h.run('addCurrentDesign()');h.run("orderDesign={...design,text:'Updated'};orderSnapshot=captureOrderSnapshot()");h.$('#review-quantity').value='4';
 await h.run('addReviewedDesign()');
 assert.equal(h.run('cartItems.length'),1);assert.equal(h.run('cartItems[0].quantity'),4);assert.equal(h.run('editingCartId'),'item-1');
 await h.run('addCurrentDesign()');assert.equal(h.run('cartItems.length'),1);assert.equal(h.run('cartItems[0].quantity'),4);
});
test('20-item cart still allows editing, but blocks an additional item',async()=>{
 const h=setup();await h.run('addCurrentDesign()');
 h.run("for(let i=2;i<=20;i++)cartItems.push({...structuredClone(cartItems[0]),id:'existing-'+i})");
 await h.run('addCurrentDesign()');assert.equal(h.run('cartItems.length'),20);assert.equal(h.$('#cart-add-status').textContent,'');
 h.run('startAdditionalDesign()');await h.run('addCurrentDesign()');assert.equal(h.run('cartItems.length'),20);assert.match(h.$('#cart-add-status').textContent,/20 Entwürfe/);
});
test('pending or invalid changes never overwrite the stored item',async()=>{
 const h=setup();await h.run('addCurrentDesign()');h.run("design={text:'Changed'};designRendering=true");await h.run('addCurrentDesign()');
 assert.equal(h.run('cartItems[0].design.text'),'Studio');h.run('designRendering=false;state.sizeValid=false');await h.run('addCurrentDesign()');
 assert.equal(h.run('cartItems[0].design.text'),'Studio');assert.equal(h.run('cartItems.length'),1);
});
