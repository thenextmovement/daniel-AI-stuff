import { createHash } from "node:crypto";
export async function notifyWriteFailure(input: {
 clientId:string; tool:string; args:unknown; correlationId:string; code:string;
 notify:(notice:{tool:string;actionId:string;code:string})=>Promise<unknown>;
}) {
 const args=input.args && typeof input.args==="object" ? input.args as Record<string,unknown> : {};
 const body=args.body && typeof args.body==="object" ? args.body as Record<string,unknown> : {};
 const key=args.idempotencyKey ?? body.idempotencyKey;
 const actionId=createHash("sha256").update(JSON.stringify(["gateway-write-alert",input.clientId,input.tool,typeof key==="string" && key.length<=200 ? key : input.correlationId])).digest("hex");
 const code=/^[A-Za-z0-9_]{1,76}$/.test(input.code) ? "MCP_"+input.code.toUpperCase().replace(/^MCP_/,"") : "MCP_ACTION_OUTCOME_UNKNOWN";
 let failureNotification:unknown;
 try { failureNotification=await input.notify({tool:input.tool,actionId,code}); }
 catch { failureNotification={status:"unknown",deliveryConfirmed:false}; }
 return {actionId,failureNotification};
}
