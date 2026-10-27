import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const patch=JSON.parse(fs.readFileSync(new URL('./cancel-pagination-20261022.json',import.meta.url)));
const code=patch.nodes[1].parameters.jsCode;
const page=(nodes,more=false)=>({json:{data:{orders:{nodes,pageInfo:{hasNextPage:more}}}}});
const order=(id)=>({id,legacyResourceId:id,name:'#NEONT'+id,cancelledAt:new Date().toISOString(),refunds:[]});
const run=(pages)=>vm.runInNewContext('(function(){'+code+'})()',{$input:{all:()=>pages}});
test('includes later pages and deduplicates order identity',()=>{const result=run([page([order('1')],true),page([order('1'),order('2')])]);assert.equal(result.length,2);assert.equal(result[1].json.shopifyOrderId,'2');});
test('fails closed on incomplete or invalid pages',()=>{assert.throws(()=>run([page([order('1')],true)]),/incomplete/);assert.throws(()=>run([{json:{errors:[{message:'throttled'}]}}]),/read_failed/);assert.throws(()=>run([{json:{}}]),/page_invalid/);});
test('empty complete set is valid',()=>assert.equal(run([page([])]).length,0));
test('reader requests cursor and quotes timestamp',()=>{const p=patch.nodes[0].parameters;assert.match(p.jsonBody,/after: \$after/);assert.match(p.jsonBody,/pageInfo/);assert.match(p.jsonBody,/updated_at:>='/);assert.equal(p.options.pagination.pagination.maxRequests,100);});

