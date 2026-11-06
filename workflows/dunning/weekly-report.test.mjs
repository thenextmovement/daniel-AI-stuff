import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const code=fs.readFileSync(new URL('./daily-35-day-alert.js',import.meta.url),'utf8');
function run(iso,state={}){class Clock extends Date{constructor(...a){super(...(a.length?a:[iso]));}}return vm.runInNewContext('(function(){'+code+'})()',{Date:Clock,Intl,$getWorkflowStaticData:()=>state,$:name=>({first:()=>({json:name==='Build Daily OPS Reconciliation'?{audit_record:{status:'success',metadata:{cases:[{order:'#NEONT1234',status:'held'}]}}}:{audit_id:'test'}})})});}
test('weekly Berlin noon including DST',()=>{for(const iso of ['2026-10-23T10:00:00Z','2026-10-29T05:00:00Z','2026-10-29T17:00:00Z','2026-10-29T10:00:00Z'])assert.equal(run(iso).length,0);assert.equal(run('2026-10-29T11:02:00Z').length,1);assert.equal(run('2027-07-01T10:02:00Z').length,1);});
test('already delivered today and duplicates suppressed',()=>{assert.equal(run('2026-10-22T10:02:00Z').length,0);const state={};assert.equal(run('2026-10-29T11:02:00Z',state).length,1);assert.equal(run('2026-10-29T11:15:00Z',state).length,0);assert.equal(run('2026-11-05T11:02:00Z',state).length,1);});

