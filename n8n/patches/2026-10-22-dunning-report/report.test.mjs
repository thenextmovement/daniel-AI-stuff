import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const code=readFileSync(new URL('./build-review-alert.js',import.meta.url),'utf8');
const state={dunningReviewReportDay:'2026-10-21'};let instant='2026-10-22T04:05:00Z';let count=1;let valid=true;
const run=()=>vm.runInNewContext('(function(){'+code+'})()',{
Date:class extends Date {constructor(...args){super(...(args.length?args:[instant]));}},Intl,
$getWorkflowStaticData:()=>state,
$:name=>({first:()=>({json:name==='Verify Daily Dunning Audit'?{audit_id:'test'}:{audit_record:{status:valid?'success':'error',metadata:{cases:Array.from({length:count},(_,i)=>({order:'#NEONT'+(4000+i),status:'held',automation:{status:'excluded',reason:'held'}}))}}}})})
});
assert.equal(run().length,1);
count=3;assert.equal(run().length,0);
instant='2026-10-22T16:05:00Z';assert.equal(run().length,0);
instant='2026-10-22T22:05:00Z';assert.equal(run().length,1);
valid=false;assert.throws(run,/DUNNING_ALERT_SOURCE_UNVERIFIED/);
valid=true;count=0;instant='2026-10-24T04:00:00Z';assert.equal(run().length,0);
count=1;assert.equal(run().length,1);
delete state.dunningReviewReportDay; instant='2026-10-22T16:00:00Z'; assert.equal(run().length,0);
console.log('8 assertions passed: first, changed count, evening, Berlin midnight, invalid source, no cases, later cases');
