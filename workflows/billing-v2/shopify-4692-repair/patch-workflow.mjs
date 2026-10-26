import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(readFileSync(new URL('./affected-nodes.fixture.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('./shopify-repair.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const find=(w,name)=>{const a=w.nodes.filter(n=>n.name===name);if(a.length!==1)throw new Error('Missing/duplicate node '+name);return a[0];};
export function patchWorkflow(original){
 if(original.id!=='K9poQw3a1DOO16Vd'||original.versionId!==fixture.versionId||original.active!==true)throw new Error('Unexpected live workflow baseline');
 for(const n of fixture.nodes)if(digest(find(original,n.name))!==digest(n))throw new Error('Node drift: '+n.name);
 for(const [name,c] of Object.entries(fixture.connections))if(digest(original.connections[name])!==digest(c))throw new Error('Connection drift: '+name);
 const w=structuredClone(original),read=find(w,'Shopify Read Payment State'),decide=find(w,'Decide Shopify Payment'),success=find(w,'Prepare Projection Success');
 const extra=' app { id } paymentGatewayNames transactions(first: 100) { id kind status gateway manualPaymentGateway createdAt amountSet { shopMoney { amount currencyCode } } } ';
 const query=read.parameters.jsonBody.replace('id name canMarkAsPaid','id name'+extra+'canMarkAsPaid');
 if(query===read.parameters.jsonBody)throw new Error('Unexpected query baseline');
 read.parameters.jsonBody=query;
 const gate="const repairCtx=$('Normalize Projection Job').first().json;\nif(repairCtx.job.id==='c4ebb761-c3d9-47d0-afbe-49c4533a007d'||repairCtx.job.payload.repairShopifyPaid)";
 decide.parameters.jsCode='{\n'+source+'\n'+gate+"return [{json:decide(repairCtx,$json)}];\n}\n"+decide.parameters.jsCode;
 success.parameters.jsCode='{\n'+source+'\n'+gate+"{\nconst verified=$json.repairShopifyPaidVerified===true?$json:confirm(repairCtx,$('Shopify Mark Order Paid').first().json,$json);\nreturn [{json:completion(repairCtx,verified)}];\n}\n}\n"+success.parameters.jsCode;
 const verifyGate={id:'repair-4692-verify-gate',name:'Repair Shopify 4692 Verify?',type:'n8n-nodes-base.if',typeVersion:2.2,position:[1040,144],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'repair-4692-marker',leftValue:"={{ Boolean($('Normalize Projection Job').first().json.job.payload.repairShopifyPaid) }}",rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}};
 const finalRead=structuredClone(read);finalRead.id='repair-4692-final-read';finalRead.name='Repair Shopify 4692: Read Final';finalRead.position=[1248,144];
 finalRead.parameters.jsonBody=finalRead.parameters.jsonBody.replaceAll('$json.billingCase',"$('Normalize Projection Job').first().json.billingCase");
 if(w.nodes.some(n=>[verifyGate.id,finalRead.id].includes(n.id)||[verifyGate.name,finalRead.name].includes(n.name)))throw new Error('Repair already installed');
 w.nodes.push(verifyGate,finalRead);
 w.connections['Shopify Mark Order Paid'].main[0]=[{node:verifyGate.name,type:'main',index:0}];
 w.connections[verifyGate.name]={main:[[{node:finalRead.name,type:'main',index:0}],[{node:success.name,type:'main',index:0}]]};
 w.connections[finalRead.name]={main:[[{node:success.name,type:'main',index:0}],[{node:'Prepare Projection Failure',type:'main',index:0}]]};
 const operations=[
 {type:'updateNode',nodeId:read.id,updates:{'parameters.jsonBody':read.parameters.jsonBody}},
 {type:'updateNode',nodeId:decide.id,updates:{'parameters.jsCode':decide.parameters.jsCode}},
 {type:'updateNode',nodeId:success.id,updates:{'parameters.jsCode':success.parameters.jsCode}},
 {type:'addNode',node:verifyGate},{type:'addNode',node:finalRead},
 {type:'removeConnection',source:'Shopify Mark Order Paid',target:success.name,sourceOutput:'main',sourceIndex:0,targetInput:'main',targetIndex:0},
 {type:'addConnection',source:'Shopify Mark Order Paid',target:verifyGate.name,sourceOutput:'main',sourceIndex:0,targetInput:'main',targetIndex:0},
 {type:'addConnection',source:verifyGate.name,target:finalRead.name,sourceOutput:'main',sourceIndex:0,targetInput:'main',targetIndex:0},
 {type:'addConnection',source:verifyGate.name,target:success.name,sourceOutput:'main',sourceIndex:1,targetInput:'main',targetIndex:0},
 {type:'addConnection',source:finalRead.name,target:success.name,sourceOutput:'main',sourceIndex:0,targetInput:'main',targetIndex:0},
 {type:'addConnection',source:finalRead.name,target:'Prepare Projection Failure',sourceOutput:'main',sourceIndex:1,targetInput:'main',targetIndex:0}];
 return {workflow:w,operations};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const input=JSON.parse(readFileSync(0,'utf8'));const result=patchWorkflow(input.data??input);
 process.stdout.write(JSON.stringify(result));
}
