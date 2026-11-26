import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const nodes = JSON.parse(readFileSync(new URL('./nodes.json',import.meta.url)));
const run = (name, input) => new Function('$input','$',nodes[name])({first:()=>({json:input})},()=>{throw Error('no webhook')});
const tx={id:'01a20d36-6e86-7d6e-9f5c-dafe51d56bf7',side:'credit',amount:15000,label:'PAYPAL',reference:'INSTANT TRANSFER'};
let checks=0;
for(const label of ['PAYPAL','PayPal Europe',' paypal ','PAYPAL (EUROPE)']){
 for(const reference of ['INSTANT TRANSFER','','unbekannt','NEONT4881']){
 const result=run('Validate & Extract',{body:{data:{...tx,label,reference}}})[0].json;
 assert.equal(result.stop,true);assert.equal(result.sendEmail,false);assert.equal(result.reason,'paypal_balance_payout');checks++;
 }
}
const customer=run('Validate & Extract',{body:{data:{...tx,label:'Firma Beispiel',reference:'NEONT4881'}}})[0].json;
assert.equal(customer.stop,false);assert.equal(customer.neonNumber,'NEONT4881');checks++;
const uncertain=run('Validate & Extract',{body:{data:{...tx,label:'Firma Beispiel'}}})[0].json;
assert.equal(uncertain.sendEmail,true);checks++;
const mention=run('Validate & Extract',{body:{data:{...tx,label:'Firma Beispiel',reference:'PayPal NEONT4881'}}})[0].json;
assert.equal(mention.stop,false);checks++;
assert.equal(run('Validate & Extract',{body:{data:{...tx,label:'PayPalicious'}}})[0].json.sendEmail,true);checks++;
assert.deepEqual(run('Prepare Qonto Payment Review',{raw_transaction:tx}),[]);checks++;
assert.equal(run('Prepare Qonto Payment Review',{raw_transaction:{...tx,label:'Firma Beispiel'}}).length,1);checks++;
const row={id:'paypal-case',incident_type:'payment_review',status:'open',source_ref:'qonto:'+tx.id,metadata:{payer:'PAYPAL',amount:15000,reference:'INSTANT TRANSFER'}};
assert.deepEqual(run('Build Daily Payment Review',{statusCode:200,body:[row]}),[]);checks++;
const other={...row,id:'customer-case',metadata:{payer:'Firma Beispiel',amount:250}};
const mixed=run('Build Daily Payment Review',{statusCode:200,body:[row,other]})[0].json;
assert.deepEqual(mixed.caseIds,['customer-case']);assert.ok(!mixed.emailBody.includes('PAYPAL'));checks++;
assert.throws(()=>run('Build Daily Payment Review',{statusCode:500,body:[]}));checks++;
console.log(checks+' checks passed; no network, mail or payment side effects.');

