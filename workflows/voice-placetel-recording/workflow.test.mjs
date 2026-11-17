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

test('expired reservations route directly to the once-only support notification',()=>{
 const claim=workflow.nodes.find(n=>n.name==='Auftrag prüfen');
 const execute=new Function('$json',claim.parameters.jsCode);
 const payload={session_id:'fixture',expired_reservation:true,notify:true,status:'rejected'};
 assert.deepEqual(execute({body:payload}),[{json:payload}]);
 assert.deepEqual(execute({body:null}),[]);
 assert.throws(()=>execute({body:{...payload,notify:false}}));
 const edges=workflow.connections['Wahlauftrag abgelaufen'].main;
 assert.deepEqual(edges.map(output=>output.map(e=>e.node)),[['Interner Hinweis'],['Mitarbeiterzuordnung']]);
});

test('SIP source requires the exact bound endpoint, employee, extension and caller ID',()=>{
 const staff={placetel_target_id:'12',placetel_employee_id:'34',extension:'21'};
 const endpoint={id:12,webuser_id:34,did:'21',domain:'fpbx.de',sipuid:'456@fpbx.de',callerid:'0301234567'};
 const file='https://storage.googleapis.com/placetel-documents/uploads/recording/file/42/out_456@fpbx.de.mp3?GoogleAccessId=demo&Expires=123&Signature=demo';
 const run=(rows,changes={})=>matchRecording(claim,{statusCode:200,body:rows},
   {statusCode:200,body:[{voice_staff:staff}]},{statusCode:200,body:{...endpoint,...changes}});
 const row={...record,from:endpoint.sipuid,file};
 assert.equal(run([row]).outcome,'found');
 for (const patch of [{id:13},{webuser_id:35},{did:'23'},{callerid:'0307654321'},{domain:'other.invalid'}])
   assert.equal(run([row],patch).outcome,'failed');
 assert.equal(run([{...row,from:'777@fpbx.de'}]).outcome,'missing');
 assert.equal(run([row,{...row,id:43}]).outcome,'ambiguous');
 for (const url of [file.replace('/42/','/43/'),file.replace('placetel-documents','other'),file.split('?')[0],file.replace('Signature=demo','Signature=')])
   assert.equal(run([{...row,file:url}]).outcome,'failed');
});
test('provider query uses German national numbers and preserves international numbers',()=>{
 const expression=workflow.nodes.find(n=>n.name==='Aufnahmen abfragen').parameters.queryParameters.parameters[0].value.slice(3,-2);
 const run=phone=>new Function('$','return '+expression)(()=>({first:()=>({json:{phone}})}));
 assert.equal(run('+49301234567'),'0301234567');assert.equal(run('+43123456789'),'+43123456789');
});
test('MP3 uploaded under a generic storage filename is correctly labeled for transcription',async()=>{
 const js=workflow.nodes.find(n=>n.name==='Audiodatei prüfen').parameters.jsCode;
 const input={json:{statusCode:200},binary:{data:{fileName:'file',mimeType:'application/octet-stream',id:'fixture'}}};
 const bytes=Buffer.alloc(256);bytes.write('ID3');
 const fn=new (Object.getPrototypeOf(async function(){}).constructor)('$input',js);
 const [result]=await fn.call({helpers:{getBinaryDataBuffer:async()=>bytes}},{first:()=>input});
 assert.deepEqual(result.binary.data,{fileName:'recording.mp3',mimeType:'audio/mpeg',fileExtension:'mp3',id:'fixture'});
});
