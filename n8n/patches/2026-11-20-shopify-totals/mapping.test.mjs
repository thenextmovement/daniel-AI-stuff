import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./mapping.js',import.meta.url),'utf8');
const before=readFileSync(new URL('./mapping.before.js',import.meta.url),'utf8');
const run=(code,orders,count=orders.length,link='')=>new Function('$input','$',code)({all:()=>[{json:{statusCode:200,headers:{link},body:{orders}}}]},()=>({first:()=>({json:{count}})}));
const order={id:1,name:'#1',total_price:'120.00',current_total_price:'80.00',total_outstanding:'0',currency:'EUR',test:false,updated_at:'2026-11-20T09:00:00Z',email:'buyer@example.test'};
test('preserves all existing financial mapping; adds actual current amount, test flag and source time',()=>{
 const a=run(before,[order])[0].json.batch[0],b=run(source,[order])[0].json.batch[0];
 const {is_test,current_total_price,shopify_updated_at,ingested_at,...rest}=b;
 const {ingested_at:old,...expected}=a;
 assert.deepEqual(rest,expected);assert.equal(current_total_price,80);assert.equal(is_test,false);assert.equal(shopify_updated_at,order.updated_at);
});
test('test and cancelled orders remain in mirror for correct exclusion downstream',()=>{
 const row=run(source,[{...order,test:true,cancelled_at:order.updated_at}])[0].json.batch[0];
 assert.equal(row.is_test,true);assert.equal(row.cancelled_at,order.updated_at);
});
test('invalid amount or missing source metadata fails before any write',()=>{
 for(const patch of [{current_total_price:null},{current_total_price:''},{current_total_price:'bad'},{current_total_price:'-1'},{test:undefined},{updated_at:'bad'}])
 assert.throws(()=>run(source,[{...order,...patch}]),/ORDER_INVALID/);
});
test('partial pages, missing and duplicate IDs cannot produce a valid snapshot',()=>{
 assert.throws(()=>run(source,[order],2),/COUNT_MISMATCH/);
 assert.throws(()=>run(source,[order],1,'<next>; rel="next"'),/TERMINAL/);
 assert.throws(()=>run(source,[order,order]),/ORDER_INVALID/);
});
