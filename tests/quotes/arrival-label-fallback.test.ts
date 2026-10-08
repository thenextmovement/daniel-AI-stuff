import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { printDevice, printWorkerId, configuredPrintDevice } from '../../scripts/arrival_label_print_worker_config.mjs';
import { renderPlist } from '../../scripts/manage_arrival_label_print_workers.mjs';

test('existing Daniel installation keeps both worker identities; Rahim has distinct identities',()=>{
 assert.equal(printDevice(undefined),'daniel');
 assert.equal(printWorkerId('daniel','label'),'daniels-mac-arrival-label-a6-01');
 assert.equal(printWorkerId('daniel','delivery_note'),'daniels-mac-arrival-delivery-note-a4-01');
 assert.equal(printWorkerId('rahim','label'),'rahims-mac-arrival-label-a6-fallback-01');
 assert.equal(printWorkerId('rahim','delivery_note'),'rahims-mac-arrival-delivery-note-a4-fallback-01');
 assert.throws(()=>printDevice('other'));
 assert.throws(()=>printWorkerId('rahim','other'));
});

test('the installed plist preserves the explicitly selected device',()=>{
 const values={worker:{label:'test',kind:'label',logName:'a6'},runnerPath:'/runtime/scripts/runner.mjs',home:'/home/test',logDir:'/logs',opsBaseUrl:'https://ops.neontrip.de',account:'test',cfClientId:'',printDevice:'rahim'};
 const template=readFileSync(new URL('../../deploy/local-print-worker/de.neontrip.arrival-label-print.plist.template',import.meta.url),'utf8');
 const plist=renderPlist(template,values);
 assert.match(plist, /<key>NEONTRIP_PRINT_DEVICE<\/key>\s*<string>rahim<\/string>/);
 assert.doesNotMatch(plist, /\{\{/);
});

test('updates retain the installed fallback identity unless explicitly reconfigured',()=>{
 assert.equal(configuredPrintDevice(undefined,['rahim','rahim']),'rahim');
 assert.equal(configuredPrintDevice(undefined,['rahim']),'rahim');
 assert.equal(configuredPrintDevice(undefined,['daniel','daniel']),'daniel');
 assert.equal(configuredPrintDevice(undefined,[]),'daniel');
 assert.equal(configuredPrintDevice('rahim',['daniel','daniel']),'rahim');
 assert.throws(()=>configuredPrintDevice(undefined,['daniel','rahim']));
 assert.throws(()=>configuredPrintDevice('', ['rahim']));
});
