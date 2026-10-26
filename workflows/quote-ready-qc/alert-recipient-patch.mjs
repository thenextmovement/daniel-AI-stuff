import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/error-recipient-baseline.json',import.meta.url)));
export function buildAlertPatch(w){
 const n=w.nodes.find(n=>n.name==='Send Prepared Alert Email'),b=baseline.nodes[0];
 if(w.id!==baseline.id||w.versionId!==baseline.versionId||w.activeVersionId!==baseline.activeVersionId||w.active!==true||JSON.stringify(n?.parameters)!==JSON.stringify(b.parameters))
  throw new Error('QC_ALERT_BASELINE_DRIFT');
 const before=n.parameters.toRecipients;
 if(!before.includes("'6NZnfGpyfUVikqpf'].some"))throw new Error('QC_ALERT_BASELINE_DRIFT');
 return {workflowId:w.id,expectedVersionId:w.versionId,expectedActiveVersionId:w.activeVersionId,expectedActive:true,operations:[
  {type:'updateNode',nodeId:n.id,updates:{parameters:{...n.parameters,toRecipients:before.replace("'6NZnfGpyfUVikqpf'].some","'6NZnfGpyfUVikqpf', 'bvRcF5Xaj3eGY0J4'].some")}}}
 ]};
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(buildAlertPatch(JSON.parse(readFileSync(process.argv[2]||0,'utf8'))),null,2)+'\n');
