import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const code=readFileSync(new URL('./error-mail-readable.js',import.meta.url),'utf8');
const run=(err={},wf={},state={})=>new Function('$input','$getWorkflowStaticData',code)({first:()=>({json:{workflow:{id:'other',name:'Test',...wf},execution:{id:'TEST',lastNodeExecuted:wf.id==='gdnW2tkXdwwHoKLy'?'Send VAT Review Through Error Mail':'Read Easybill Invoice',error:err}}})},()=>state);
const vat=(flags)=>run({message:'//ec.europa.eu/vies [line 1]',description:'https',stack:'Error: Auftrag: #NEONT4796 | Ops-Fall: https://ops.neontrip.de | Prüfstatus: '+flags+' | Firma: TEST GmbH\n    at test:1'},{id:'gdnW2tkXdwwHoKLy'})[0].json.body_html;
test('recover full VAT text and explain unavailable check',()=>{const h=vat('checked=false, valid=false');assert.match(h,/#NEONT4796/);assert.match(h,/Das bedeutet nicht, dass die Nummer ungültig ist/);assert.match(h,/TEST GmbH/);assert.doesNotMatch(h,/>https<|at test:1/);});
test('valid address mismatch',()=>assert.match(vat('checked=true, valid=true, addressComparison=DIFFERENT_REQUIRES_REVIEW'),/Rechnungsanschrift weicht/));
test('invalid VAT is distinct',()=>assert.match(vat('checked=true, valid=false'),/nicht als gültig bestätigt/));
test('easybill outage is understandable without raw HTML',()=>{const h=run({message:'Service unavailable',description:'<!DOCTYPE html><html>easybill.de data:image/svg+xml;base64,AAAA</html>'})[0].json.body_html;assert.match(h,/easybill war beim Abruf/);assert.doesNotMatch(h,/<!DOCTYPE|base64/);});
test('unknown error stays unconfirmed',()=>assert.match(run({message:'Unknown failure'})[0].json.body_html,/erfolgreiche Abschluss ist damit nicht bestätigt/));
test('HTML escaping',()=>assert.doesNotMatch(run({message:'<script>alert(1)</script>'},{name:'<img src=x onerror=1>'})[0].json.body_html,/<script|<img/));
test('deduplication preserved',()=>{const st={};assert.equal(run({message:'x'},{},st).length,1);assert.equal(run({message:'x'},{},st).length,0);});
test('hourly cap preserved',()=>{const st={alertDedupe:{fingerprints:{},hours:{[new Date().toISOString().slice(0,13)]:20}}};assert.equal(run({message:'x'},{},st).length,0);});

