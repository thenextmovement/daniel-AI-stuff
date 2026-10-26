import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyNormalizePatch } from './outlook-attachment-metadata-patch.mjs';
const baseline = readFileSync(new URL('./fixtures/outlook-normalizer-before-metadata.js', import.meta.url), 'utf8');
const code = process.env.TEST_BASELINE === '1' ? baseline : applyNormalizePatch(baseline);
const run = (emails, attachments) => new Function('$', '$input', code)(() => ({all:()=>emails}), {all:()=>attachments});
function fixture(files, text='Project\nMit freundlichen Grüßen\n', htmlCleaned=true) {
  const email={json:{uid:23,mailboxPath:'Unstrukturierte Anfrage',envelope:{date:'2026-10-12T16:35:38Z',from:[{address:'person@example.org',name:'Person'}],subject:'Project',messageId:'<fixture@example.org>'},textContent:text,htmlContent:'<p>Project</p><p>Mit freundlichen Grüßen</p><img src="[Image removed - base64 data]">',htmlCleaned,attachmentsInfo:[]}};
  const attachment={json:{attachments:[]},binary:{}};
  for (const [i,f] of files.entries()) {
    const filename=f.name||`image00${i+1}.png`,key=`attachment_${i}`,cid=f.cid||`cid-${i}@example.org`,bytes=f.bytes??4906;
    email.json.attachmentsInfo.push({index:i,filename,contentType:f.mime||'image/png',size:bytes,contentId:`<${cid}>`});
    attachment.json.attachments.push({binaryFieldName:key,filename,contentType:f.mime||'image/png',disposition:f.disposition||'inline',expectedSize:999999});
    attachment.binary[key]={fileName:filename,mimeType:f.mime||'image/png',data:'filesystem-v2',id:`fixture:${i}`,fileSize:'4.91 kB',bytes};
    if(f.reference!==false)email.json.textContent+=`[cid:${cid}]\n`;
  }
  return {email,attachment};
}
test('seven signature images do not block the oldest inquiry when HTML CIDs were cleaned',()=>{
 const f=fixture([4906,688,1492,590,1066,1215,92705].map(bytes=>({bytes})));
 const [out]=run([f.email],[f.attachment]);
 assert.equal(out.json.attachmentCount,0);assert.equal(out.json.ignoredInlineAttachments.length,7);
 assert.equal(out.json.internetMessageId,'<fixture@example.org>');
});
test('a real inline product image before the salutation is retained unchanged',()=>{
 const f=fixture([{name:'product.png',bytes:782798,cid:'product@example.org',reference:false}], 'Project [cid:product@example.org]\nMit freundlichen Grüßen\n');
 const [out]=run([f.email],[f.attachment]);
 assert.equal(out.json.attachmentCount,1);assert.equal(out.binary.attachment_0.id,'fixture:0');
});
test('an inline image without reliable signature evidence stays a customer attachment',()=>{
 const f=fixture([{name:'image.png',bytes:782798,reference:false}], 'Best regards\n[Image]\n');
 assert.equal(run([f.email],[f.attachment])[0].json.attachmentCount,1);
});
test('ambiguous CID metadata cannot discard customer files',()=>{
 const f=fixture([{name:'drawing.png',bytes:10000}]);
 f.email.json.attachmentsInfo.push({...f.email.json.attachmentsInfo[0],contentId:'<different@example.org>'});
 assert.equal(run([f.email],[f.attachment])[0].json.attachmentCount,1);
});
test('six real customer files still stop processing',()=>{
 const f=fixture(Array.from({length:6},(_,i)=>({name:`drawing${i}.pdf`,mime:'application/pdf',bytes:5000,disposition:'attachment',reference:false})));
 assert.throws(()=>run([f.email],[f.attachment]),/Mehr als 5/);
});
test('the actual byte size enforces the existing 15 MB limit despite formatted fileSize',()=>{
 const f=fixture([{name:'large.pdf',mime:'application/pdf',bytes:16*1024*1024,disposition:'attachment',reference:false}]);
 assert.throws(()=>run([f.email],[f.attachment]),/groesser als 15 MB/);
});
test('oldest-mail sorting keeps attachment metadata paired with the same mail',()=>{
 const a=fixture([{bytes:4906}]),b=fixture([{name:'product.png',bytes:80000,reference:false}]);
 b.email.json.uid=25;b.email.json.envelope.date='2026-10-16T11:44:00Z';
 const [out]=run([b.email,a.email],[b.attachment,a.attachment]);
 assert.equal(out.json.imapUid,'23');assert.equal(out.json.attachmentCount,0);
});
test('incomplete IMAP result fails before any item is persisted',()=>{
 const f=fixture([]);assert.throws(()=>run([f.email],[]),/Anhangzuordnung unvollstaendig/);
});
test('plaintext CID fallback is disabled when HTML was not cleaned',()=>{
 const f=fixture([{name:'drawing.png',bytes:10000}], 'Project\nMit freundlichen Grüßen\n', false);
 assert.equal(run([f.email],[f.attachment])[0].json.attachmentCount,1);
});
test('the patch refuses a changed or already patched baseline',()=>{
 assert.throws(()=>applyNormalizePatch('changed workflow'),/baseline mismatch/);
 assert.throws(()=>applyNormalizePatch(applyNormalizePatch(baseline)),/baseline mismatch/);
});

test('ambiguous inline customer logo is retained without signature evidence',()=>{
 const f=fixture([{name:'logo.png',bytes:10000,reference:false}], 'Please manufacture this logo.');
 f.email.json.attachmentsInfo.push({...f.email.json.attachmentsInfo[0],contentId:'<other@example.org>'});
 assert.equal(run([f.email],[f.attachment])[0].json.attachmentCount,1);
});
test('small real customer logo is retained despite numeric byte metadata',()=>{
 const f=fixture([{name:'logo.png',bytes:1000,reference:false,disposition:'attachment'}], 'Please manufacture this logo.');
 assert.equal(run([f.email],[f.attachment])[0].json.attachmentCount,1);
});
