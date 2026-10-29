import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRetry } from '../../src/lib/ops/arrival-labels/clients';
for(const kind of ['TimeoutError','SyntaxError']) test(`opt-in retries complete GET body within original three attempts: ${kind}`,async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return calls<3?{ok:true,json:async()=>{throw kind==='SyntaxError'?new SyntaxError('private'):new DOMException('private','TimeoutError');}} as unknown as Response:Response.json({ok:true});};
  try {const r=await fetchWithRetry('https://example.invalid',{}, {retryJsonBody:true});assert.deepEqual(await r.json(),{ok:true});assert.equal(calls,3);}
  finally {globalThis.fetch=original;}
});
test('persistent body error exhausts three attempts without nesting retries',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{invalid');};
  try {await assert.rejects(()=>fetchWithRetry('https://example.invalid',{}, {retryJsonBody:true}),SyntaxError);assert.equal(calls,3);}
  finally {globalThis.fetch=original;}
});
for(const options of [{},{retryJsonBody:true}]) test(`POST JSON errors do not gain retries: ${JSON.stringify(options)}`,async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{invalid');};
  try {const r=await fetchWithRetry('https://example.invalid',{method:'POST'},options);await assert.rejects(()=>r.json(),SyntaxError);assert.equal(calls,1);}
  finally {globalThis.fetch=original;}
});
test('default GET client body behavior is unchanged',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return new Response('{invalid');};
  try {const r=await fetchWithRetry('https://example.invalid',{});await assert.rejects(()=>r.json(),SyntaxError);assert.equal(calls,1);}
  finally {globalThis.fetch=original;}
});
