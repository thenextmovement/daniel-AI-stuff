import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.VALIDATE_ORDER_SOURCE,'utf8');
const run=new Function('$input','$',source);
function resolve({payer='Solarwerk GmbH',company='solar werk GmbH',order={},prev={},candidateNodes=[],hasNextPage=false,person=null}={}) {
 const p={neonNumber:'NEONT9001',amount:123.45,amountCents:12345,customer_name:payer,customer_identity_candidates:[payer],fuzzyMatch:false,...prev};
 const o={id:'9001001',name:'#NEONT9001',total_price:'123.45',current_total_price:'123.45',currency:'EUR',financial_status:'pending',cancelled_at:null,billing_address:{company},...order};
 if(person) {o.billing_address={first_name:person.first,last_name:person.last};}
 const payload={data:{orders:{nodes:candidateNodes,pageInfo:{hasNextPage}}}};
 return run({first:()=>({json:payload})},name=>({first:()=>({json:name==='Not Duplicate?'?p:{orders:[o]}})}))[0].json;
}
for(const [label,payer,company] of [
 ['split company','Solarwerk GmbH','solar werk GmbH'],
 ['reverse split','Solar Werk GmbH','solarwerk GmbH'],
 ['hyphen separator','Solar-Werk GmbH','Solarwerk GmbH'],
 ['nonbreaking space','Solarwerk GmbH','Solar\u00a0Werk GmbH'],
 ['case and repeated spaces','SOLARWERK GmbH',' solar   werk gmbh '],
 ['diacritics','Grünwerk GmbH','Grün Werk GmbH'],
 ['three words','Nordlichtbau GmbH','Nord Licht Bau GmbH']
]) test(label,()=>{const r=resolve({payer,company});assert.equal(r.stop,false);assert.equal(r.identityMatchType,'EXACT_COMPANY_COMPACT');assert.equal(r.rematched,false);assert.equal(r.shopifyOrderId,'9001001');assert.equal(r.sendEmail,false);});
test('identical name keeps existing match',()=>assert.equal(resolve({company:'Solarwerk GmbH'}).identityMatchType,'EXACT_NORMALIZED'));
test('existing token containment preserved',()=>assert.equal(resolve({payer:'Solar Werk Nord GmbH'}).identityMatchType,'TOKEN_CONTAINMENT'));
for(const [label,args,reason] of [
 ['unrelated payer',{payer:'Fremdfirma GmbH'},'customer_identity_mismatch'],
 ['one letter difference',{payer:'Solarwark GmbH'},'customer_identity_mismatch'],
 ['extra company word',{company:'Solar Werk Nord GmbH'},'customer_identity_mismatch'],
 ['wrong amount',{prev:{amount:123.44,amountCents:12344}},'amount_mismatch'],
 ['cancelled order',{order:{cancelled_at:'2026-01-01T00:00:00Z'}},'order_cancelled'],
 ['wrong reference',{prev:{neonNumber:'NEONT9002'}},'order_not_found'],
 ['fuzzy reference',{prev:{fuzzyMatch:true}},'customer_identity_mismatch'],
 ['personal names are not concatenated',{payer:'Anna Maria',person:{first:'Annamaria',last:''}},'customer_identity_mismatch'],
 ['legal form only',{payer:'GmbH',company:'GmbH'},'customer_identity_mismatch'],
 ['generic company only',{payer:'Service',company:'Ser vice GmbH'},'customer_identity_mismatch'],
 ['very short company',{payer:'ABCD GmbH',company:'ABC D GmbH'},'customer_identity_mismatch'],
 ['empty payer',{payer:''},'payer_identity_unavailable']
]) test(label,()=>{const r=resolve(args);assert.equal(r.stop,true);assert.equal(r.primaryFailureReason,reason);assert.equal(r.sendEmail,true);});
const graph={legacyResourceId:'9002002',name:'#NEONT9002',displayFinancialStatus:'PENDING',cancelledAt:null,totalPriceSet:{shopMoney:{amount:'123.45',currencyCode:'EUR'}},currentTotalPriceSet:{shopMoney:{amount:'123.45',currencyCode:'EUR'}},billingAddress:{company:'solar werk GmbH'}};
test('new rule does not broaden wrong-reference rematching',()=>{const r=resolve({prev:{neonNumber:'NEONT9003'},candidateNodes:[graph]});assert.equal(r.stop,true);assert.equal(r.rematchCandidateCount,0);});
test('already paid order does not ask for another Shopify payment',()=>{const r=resolve({order:{financial_status:'paid'}});assert.equal(r.stop,false);assert.equal(r.shopifyNeedsUpdate,false);assert.equal(r.shopifyAlreadyPaid,true);});
test('exact generic compact name is still rejected',()=>assert.equal(resolve({payer:'Hotel Service GmbH',company:'Hotelservice GmbH'}).stop,true));
