import test from "node:test";
import assert from "node:assert/strict";
import {phoneManagementInput} from "../../src/lib/ops/voice-phone-management-contract";
const staffId="29500000-0000-4000-8000-000000000001",deviceId="29500000-0000-4000-8000-000000000101";
const values={displayName:" Demo Alpha ",accessEmail:" DEMO@example.test ",extension:" 101 ",enabled:true};
test("management accepts only a fixed profile shape and normalizes personal identity fields",()=>{
 assert.deepEqual(phoneManagementInput({action:"create",staffId,values}),{action:"create",staffId,values:{displayName:"Demo Alpha",accessEmail:"demo@example.test",extension:"101",enabled:true},revision:null,relatedId:null});
 const changed=phoneManagementInput({action:"update",staffId,revision:7,values:{...values,extension:"",accessEmail:""}});
 assert.equal(changed.revision,7);assert.equal(changed.values?.accessEmail,null);assert.equal(changed.values?.extension,null);
});
test("caller-supplied management role, actor, credential and provider routing fields are rejected",()=>{
 for(const value of [{...values,can_manage_phone:true},{...values,callback_phone:"+493055501234"},{...values,placetel_target_id:"1"}])
  assert.throws(()=>phoneManagementInput({action:"create",staffId,values:value}));
 for(const extra of [{actorDeviceId:deviceId},{code:"credential"},{canManagePhone:true},{revision:1}])
  assert.throws(()=>phoneManagementInput({action:"issue_invite",staffId,...extra}));
});
test("invalid identity values, IDs, revisions and actions cannot reach the management RPC",()=>{
 for(const value of [{...values,displayName:"A"},{...values,displayName:"Demo\nOther"},{...values,accessEmail:"shared invalid"},{...values,extension:"101#123"},{...values,enabled:"true"},[]])
  assert.throws(()=>phoneManagementInput({action:"create",staffId,values:value}));
 for(const revision of [undefined,0,1.2,"1",-1])assert.throws(()=>phoneManagementInput({action:"update",staffId,values,revision}));
 for(const action of ["grant_admin","bootstrap","delete","list","constructor","toString","__proto__"])assert.throws(()=>phoneManagementInput({action,staffId}));
 assert.throws(()=>phoneManagementInput({action:"issue_invite",staffId:"Rahim"}));
});
test("revocation requires an explicit profile and related resource without alternative identities",()=>{
 assert.deepEqual(phoneManagementInput({action:"revoke_device",staffId,relatedId:deviceId}),
  {action:"revoke_device",staffId,values:undefined,relatedId:deviceId,revision:null});
 assert.throws(()=>phoneManagementInput({action:"revoke_device",staffId}));
 assert.throws(()=>phoneManagementInput({action:"revoke_invite",staffId,relatedId:deviceId,staffName:"Other"}));
});
