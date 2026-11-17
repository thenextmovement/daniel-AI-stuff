import test from 'node:test';
import assert from 'node:assert/strict';
import {matchRecording,segmentsOf} from './matching.mjs';
import {workflow} from './workflow.mjs';

const claim={phone:'+4915112345678',source_phone:'+49301234567',dialed_at:'2026-11-17T09:00:00Z'};
const record={id:42,from:'0301234567',to:'015112345678',direction:'out',time:'2026-11-17T09:00:04Z',duration:42,file:'https://files.placetel.de/example.mp3'};
const match=rows=>matchRecording(claim,{statusCode:200,body:rows});
test('only a unique match of both parties, direction and time yields media',()=>{
 const r=match([record]);assert.equal(r.outcome,'found');assert.equal(r.recording.from,claim.source_phone);
 for(const patch of [{from:'0301999999'},{to:'015119999999'},{direction:'in'},{time:'2026-11-17T09:02:01Z'}])
   assert.equal(match([{...record,...patch}]).outcome,'missing');
 assert.equal(match([record,record]).outcome,'ambiguous');
 assert.equal(match(Array(100).fill(record)).outcome,'ambiguous');
 assert.equal(matchRecording({...claim,source_phone:null},{statusCode:200,body:[record]}).outcome,'ambiguous');
});
test('provider errors and dangerous media locations never produce an audio download',()=>{
 assert.equal(matchRecording(claim,{statusCode:404,body:[]}).outcome,'failed');
 for(const file of ['https://placetel.de.attacker.invalid/audio','http://placetel.de/audio','https://placetel.de@elsewhere.invalid/audio'])
   assert.equal(match([{...record,file}]).outcome,'failed');
});
test('unidentified speakers retain neutral labels and timestamps',()=>{
 const turn=(speaker,text,start,end)=>({speaker,text,start,end});
 const read=s=>segmentsOf({statusCode:200,body:{segments:s}});
 const one=turn('B','Guten Tag',0,1.25),two=turn('A','Hallo',2,3);
 assert.equal(read([one]).outcome,'single_speaker');
 const both=read([one,two,one]);assert.equal(both.outcome,'complete');
 assert.deepEqual(both.segments.map(s=>s.speaker),['speaker_1','speaker_2','speaker_1']);
 assert.equal(both.segments[0].endMs,1250);
 assert.equal(read([one,two,turn('C','Test',4,5)]).outcome,'ambiguous');
 assert.equal(read([]).outcome,'failed');assert.equal(read([turn('', 'Text',0,1)]).outcome,'failed');
});
test('workflow boundaries and internal notifications',()=>{
 const names=new Set(workflow.nodes.map(n=>n.name));
 assert.equal(names.size,workflow.nodes.length);
 for(const [from,outputs] of Object.entries(workflow.connections)){
   assert.ok(names.has(from));for(const edge of outputs.main.flat())assert.ok(names.has(edge.node));
 }
 assert.equal(workflow.nodes.find(n=>n.name==='Audio laden').credentials,undefined);
 assert.equal(workflow.nodes.find(n=>n.name==='Audio laden').parameters.options.redirect.redirect.followRedirects,false);
 assert.deepEqual(workflow.connections['In OPS abschließen'].main[0].map(e=>e.node),['Interner Hinweis']);
 assert.match(workflow.nodes.find(n=>n.name==='Interner Hinweis').parameters.conditions.conditions[0].leftValue,/notify === true/);
 assert.equal(workflow.settings.saveDataSuccessExecution,'none');assert.equal(workflow.settings.saveDataErrorExecution,'none');
 for(const n of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.code')) new (Object.getPrototypeOf(async function(){}).constructor)(n.parameters.jsCode);
});
