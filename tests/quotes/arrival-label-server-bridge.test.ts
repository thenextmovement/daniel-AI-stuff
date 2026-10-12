import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir} from 'node:os';
import {validateBridgeConfig, workerConfiguration} from '../../scripts/easydpd_existing_chrome_bridge_lib.mjs';
const common={mode:'dry_run',extensionId:'bgfphlbhdameagnafljlgpbpjdajmdhk',extensionBuildCommit:'a'.repeat(40),opsBaseUrl:'https://ops.neontrip.de',keychainAccount:'leo-buyer',workerId:'hermes-server-easydpd-01',tokenService:'NEONTRIP EasyDPD Browser Worker API Token',cfSecretService:'NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET'};
const server={...common,runtime:'linux-server',downloadRoot:homedir()+'/labels',statusPath:homedir()+'/state/bridge-status.json',activeJobPath:homedir()+'/state/active-job.json'};
test('server bridge keeps downloads and job state within the dedicated home',{skip:process.platform!=='linux'},()=>{
 const c=validateBridgeConfig(server);assert.equal(c.runtime,'linux-server');
 assert.throws(()=>validateBridgeConfig({...server,runtime:'unknown'}));
 for(const field of ['downloadRoot','statusPath','activeJobPath']) assert.throws(()=>validateBridgeConfig({...server,[field]:'/tmp/elsewhere'}));
 assert.throws(()=>validateBridgeConfig({...server,opsBaseUrl:'https://other.example'}));
});
test('server bridge uses explicit scoped environment credential without Keychain',{skip:process.platform!=='linux'},()=>{
 const before=process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN;
 try {process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN='x'.repeat(40);
 assert.equal(workerConfiguration(validateBridgeConfig(server)).token,'x'.repeat(40));
 }finally{if(before===undefined)delete process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN;else process.env.ARRIVAL_LABEL_BROWSER_WORKER_API_TOKEN=before;}
});
test('mac configuration remains pinned to its original directories',()=>{
 const c=validateBridgeConfig({...common,downloadRoot:homedir()+'/Downloads',statusPath:homedir()+'/Library/Logs/NEONTRIP/easydpd-existing-chrome-bridge/status.json',activeJobPath:homedir()+'/Library/Application Support/NEONTRIP/easydpd-existing-chrome-bridge/active-job.json'});
 assert.equal(c.liveEnabled,false);assert.throws(()=>validateBridgeConfig({...server,runtime:'mac'}));
});
