
import test from 'node:test';
import assert from 'node:assert/strict';
import { existingLabelReprintUrl } from '../../deploy/local-easydpd-existing-chrome/extension/policy.mjs';
const url='https://easydpd.247apps.de/labels/123/download/token?attachment';
const job={parcelKind:'main',reuseExistingDpdTracking:'01476814750251'};
test('reprint downloads only the unique matching label',()=>{
 assert.equal(existingLabelReprintUrl({found:true,labelCount:1,trackingNumbers:['01476814750251'],downloadUrl:url},job),url);
 for(const evidence of [
  {found:false,labelCount:0,trackingNumbers:[]},
  {found:true,labelCount:1,trackingNumbers:['01476814750252'],downloadUrl:url},
  {found:true,labelCount:2,trackingNumbers:['01476814750251','01476814750252'],downloadUrl:url},
 ]) assert.throws(()=>existingLabelReprintUrl(evidence,job));
 assert.throws(()=>existingLabelReprintUrl({found:true,labelCount:1,trackingNumbers:['01476814750251'],downloadUrl:url},{...job,parcelKind:'acrylic_table_device'}));
});
