import test from 'node:test';
import assert from 'node:assert/strict';
import {leadQueue, type LeadProgress} from '../../src/lib/ops/voice-hot-lead-rules';
const now=new Date('2026-11-23T15:00:00Z');
const inquiry='2026-11-01T09:00:00Z',sent='2026-11-23T12:00:00Z';
const empty:LeadProgress={status:null,stage:null,dueDate:null,dueAt:null,outcomes:{},handledAt:null};
test('draft remains inquiry; old unhandled requests stay overdue',()=>{
 const q=leadQueue(inquiry,null,empty,null,now);assert.equal(q.stage,1);assert.equal(q.visible,true);assert.equal(q.overdueDays,22);
});
test('missed inquiry then send creates offer call while preserving missed icon',()=>{
 const q=leadQueue(inquiry,sent,{...empty,status:'not_reached',stage:1,outcomes:{'1':'not_reached'}},null,now);
 assert.equal(q.stage,2);assert.equal(q.visible,true);assert.deepEqual(q.indicators,['not_reached','open','open']);
});
test('unsent inquiry without attempt is skipped after send, not marked missed',()=>{
 assert.equal(leadQueue(inquiry,sent,empty,null,now).indicators[0],'skipped');
});
test('reached offer without scheduling remains visible for planning',()=>{
 const q=leadQueue(inquiry,sent,{...empty,status:'reached',stage:2,outcomes:{'2':'reached'}},null,now);
 assert.equal(q.stage,3);assert.equal(q.needsPlanning,true);assert.equal(q.visible,true);
});
test('scheduled next call honors date and exact callback time',()=>{
 const p={...empty,status:'scheduled' as const,stage:3 as const,dueDate:'2026-11-25',outcomes:{'2':'reached' as const}};
 assert.equal(leadQueue(inquiry,sent,p,null,now).visible,false);
 assert.equal(leadQueue(inquiry,sent,p,null,new Date('2026-11-25T00:00:00Z')).visible,true);
 assert.equal(leadQueue(inquiry,sent,{...p,dueAt:'2026-11-25T14:00:00Z'},null,new Date('2026-11-25T12:00:00Z')).visible,false);
});
test('ignored/no-followup never resurrect on send or open; callbacks defer',()=>{
 for(const status of ['ignored','no_followup'] as const)assert.equal(leadQueue(inquiry,sent,{...empty,status},null,now).visible,false);
 assert.equal(leadQueue(inquiry,sent,empty,'2026-11-24T10:00:00Z',now).visible,false);
});
test('a future retry of missed inquiry does not delay new offer stage',()=>{
 const q=leadQueue(inquiry,sent,{...empty,status:'scheduled',stage:1,dueDate:'2026-11-25',outcomes:{'1':'not_reached'}},null,now);
 assert.equal(q.stage,2);assert.equal(q.visible,true);
});
test('new explicit schedule wins over an old cadence callback',()=>{
 const q=leadQueue(inquiry,sent,{...empty,status:'scheduled',stage:3,dueDate:'2026-11-26',outcomes:{2:'reached'}},'2026-11-22T10:00:00Z',now);
 assert.equal(q.visible,false);assert.equal(q.dueDate,'2026-11-26');assert.equal(q.overdueDays,0);
});
import {stageAtCallStart} from '../../src/lib/ops/voice-hot-lead-rules';
test('offer sent during an inquiry call cannot move its outcome to second call',()=>{
 assert.equal(stageAtCallStart(2,'2026-11-23T13:00:00Z','2026-11-23T12:00:00Z'),1);
 assert.equal(stageAtCallStart(2,'2026-11-23T11:00:00Z','2026-11-23T12:00:00Z'),2);
 assert.equal(stageAtCallStart(3,'2026-11-20T11:00:00Z','2026-11-23T12:00:00Z'),3);
});

test('refreshed first-send time corrects stale inquiry baseline without moving call start',()=>{
 assert.equal(stageAtCallStart(1,'2026-11-23T09:00:00Z','2026-11-23T10:00:00Z'),2);
 assert.equal(stageAtCallStart(3,'2026-11-23T09:00:00Z','2026-11-23T10:00:00Z'),3);
});
