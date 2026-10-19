import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(process.env.FIXTURE,'utf8'));
const code=name=>fixture.nodes.find(n=>n.name===name).parameters.jsCode;
function run(name,json,lookup={}) { return new Function('$input','$',code(name))({first:()=>({json})},key=>({first:()=>({json:lookup[key]})}))[0].json; }
const extract=(reference,extra={})=>run('Validate & Extract',{body:{data:{...fixture.tx,reference,...extra}}});
for(const reference of ['Proforma Rechnung PFNEONT4703','PF-NeonT4703','pfneont4703','PF NEONT4703','PF_NEONT4703','PF–NEONT4703','NEONT4703','Rechnung RNEONT4703','NEON-T4703','PFNEONT4703, 16.09.2026']) {
 test('strict reference: '+reference,()=>{const x=extract(reference);assert.equal(x.stop,false);assert.equal(x.neonNumber,'NEONT4703');assert.equal(x.fuzzyMatch,false);assert.equal(x.amountCents,125902);assert.equal(x.reference,reference);});
}
for(const reference of ['XPFNEONT4703','PFNEONT47030','PFNEONT470','PFNEONT4703A','PFNEONT123456','irrelevant invoice text']) {
 test('does not infer malformed reference: '+reference,()=>{assert.equal(extract(reference).stop,true);});
}
test('debit remains ignored',()=>assert.equal(extract('PFNEONT4703',{side:'debit'}).reason,'not_credit'));
test('existing fuzzy fallback remains',()=>assert.equal(extract('Zahlung 4703').fuzzyMatch,true));
for(const reference of ['PFNEONT4703/PFNEONT4704','PF-NEONT4703,PFNEONT4704','PF-NEONT4703/PF-NEONT4704']) {
 test('collective route recognizes both: '+reference,()=>assert.equal(run('Collective: Route',{reference}).collective,true));
 test('bank verification recognizes both: '+reference,()=>{
 const tx={...fixture.tx,reference,amount_cents:125902}; const expected={transaction_id:tx.id,amountCents:125902,reference};
 const x=run('Collective: Verify Bank',{transaction:tx},{'Collective: Route':expected});assert.deepEqual(x.references,['NEONT4703','NEONT4704']);});
}
test('duplicate reference remains single payment',()=>assert.equal(run('Collective: Route',{reference:'PFNEONT4703/PF-NEONT4703'}).collective,false));
const candidate={data:{orders:{nodes:[],pageInfo:{hasNextPage:false}}}};
function resolve(order) {return run('Validate Order',candidate,{'Shopify: Find Order':{orders:[order]},'Not Duplicate?':extract(fixture.tx.reference)});}
test('real case passes amount and payer checks',()=>{const x=resolve(fixture.order);assert.equal(x.stop,false);assert.equal(x.shopifyOrderId,'8525338018059');assert.equal(x.rematched,false);assert.equal(x.customerIdentityMatched,true);});
test('one-cent mismatch stays blocked',()=>assert.equal(resolve({...fixture.order,total_price:'1259.01'}).stop,true));
test('different payer stays blocked',()=>assert.equal(resolve({...fixture.order,billing_address:{company:'Unrelated Example GmbH'}}).stop,true));
test('cancelled order stays blocked',()=>assert.equal(resolve({...fixture.order,cancelled_at:'2026-09-20T00:00:00Z'}).stop,true));
