import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
const require=createRequire(import.meta.url);
const f=JSON.parse(readFileSync(process.env.FIXTURE,'utf8'));
const address={firstName:'Test',lastName:'Person',street:'Teststrasse 1',zip:'40219',city:'Duesseldorf',country:'DE'};
function payload(net,vat,gross,exempt=false) {return {source:'neontrip-offers',event:'offer.completed',idempotencyKey:'tax-regression',offer:{id:'test-offer',currency:'EUR',vatRate:exempt?0:19,taxExempt:exempt,taxTreatment:exempt?'EU_INTRA_COMMUNITY':'TAXABLE'},customer:{firstName:'Test',lastName:'Person',email:'test@example.com'},billingAddress:address,deliveryAddress:address,totals:{subtotalNet:net,vatAmount:vat,totalGross:gross},lineItems:[{title:'Synthetic item',quantity:1,unitPriceNet:net,unitPriceGross:gross,lineNet:net,lineGross:gross}]};}
function create(p) {const rawBody=JSON.stringify(p),secret='synthetic-test-secret';const signature='sha256='+createHmac('sha256',secret).update(rawBody).digest('hex');return new Function('$input','$env','require','Buffer',f.create)({first:()=>({json:{body:p,rawBody,headers:{'x-neontrip-signature':signature}}})},{SHOPIFY_SALE_WEBHOOK_SECRET:secret},require,Buffer)[0].json;}
for(const [name,n,v,g,e,want] of [['DE',1058,201.02,1259.02,false,'201.02'],['small VAT',1,.19,1.19,false,'0.19'],['exempt',100,0,100,true,'0.00']]) {
 test('creation includes exact tax total: '+name,()=>{const x=create(payload(n,v,g,e));assert.equal(x.shouldCreate,true);assert.equal(x.baseOrder.total_tax,want);assert.equal(x.baseOrder.taxes_included,!e);assert.equal(x.baseOrder.send_receipt,false);assert.equal(x.baseOrder.line_items.reduce((s,l)=>s+Math.round(Number(l.price)*100)*l.quantity,0),Math.round(g*100));if(!e)assert.equal(x.baseOrder.tax_lines[0].price,want);});
}
test('contradictory offer totals remain blocked',()=>assert.throws(()=>create(payload(100,19,120)),/offer_tax_totals_invalid/));
test('exempt with nonzero VAT remains blocked',()=>assert.throws(()=>create(payload(100,19,119,true)),/tax_exempt_offer_contains_vat/));
function sync(order) {const expr=f.sync.replace(/^=\{\{\s*/,'').replace(/\s*\}\}$/,'');return JSON.parse(new Function('$','$json','return ('+expr+');')(name=>({item:{json:name==='Split Orders'?order:{id:'test-customer'}}}),{body:[]}));}
for(const [name,input,want] of [['current replaces stale zero',{total_tax:'0.00',current_total_tax:'201.02'},201.02],['current zero is valid',{total_tax:'19.00',current_total_tax:'0.00'},0],['legacy fallback',{total_tax:'19.00'},19],['null fallback',{total_tax:'19.00',current_total_tax:null},19],['regular tax',{total_tax:'19.00',current_total_tax:'19.00'},19]]) {
 test('mirror tax: '+name,()=>{const order={id:123,name:'#TEST',total_price:'119',subtotal_price:'119',financial_status:'paid',...input};const x=sync(order);assert.equal(x.total_tax,want);assert.equal(x.order_value,119);assert.equal(x.status,'paid');assert.equal(x.shopify_order_id,'123');});
}
