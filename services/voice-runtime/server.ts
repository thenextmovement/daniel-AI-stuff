import {BrowserPhoneCalls,TwilioPhoneProvider,browserCallingReady,browserPhoneControlReady,phoneWebhookParameters} from "./phone-calls.js";
import { browserPhoneReady, browserPhoneToken } from "./phone-token.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadRuntimeConfig } from "./config.js";
import { OpsClient } from "./ops-client.js";
import { OpenAiLiveAdapter } from "./live.js";
import { liveIncoming } from "./live-protocol.js";
import { bearerMatches, verifyAttemptBinding, verifyTwilioSignature } from "./security.js";
import { TwilioSipAdapter } from "./telephony.js";
import { noClearOutcome, notReachedOutcome, technicalOutcome } from "./outcomes.js";

const config = loadRuntimeConfig();
const ops = new OpsClient(config);
const browserCalls = browserPhoneControlReady(config) ? new BrowserPhoneCalls(config,ops,new TwilioPhoneProvider(config)) : null;
const telephony = config.providerReadiness.telephony ? new TwilioSipAdapter(config) : null;
const realtime = config.providerReadiness.openAi ? new OpenAiLiveAdapter(config, ops) : null;

async function recoverActiveCalls() {
  if (!telephony || !realtime) {
    console.warn(`voice runtime recovery disabled; missing provider configuration: ${config.providerReadiness.missing.join(", ")}`);
    return;
  }
  const sessions = await ops.recover();
  let recovered = 0;
  let reconciled = 0;
  for (const session of sessions) {
    try {
      if (session.providerCompleted) {
        await ops.finalize(session.attemptId, noClearOutcome("Provider completed event was recovered after runtime restart"));
        reconciled += 1;
      } else if (session.recoveryAction === "reconcile_provider") {
        if (session.providerCallId) {
          const status = await telephony.getCallStatus(session.providerCallId);
          if (["busy", "no-answer", "canceled"].includes(status)) {
            await ops.finalize(session.attemptId, notReachedOutcome(status));
            reconciled += 1;
            continue;
          }
          if (status === "failed") {
            await ops.finalize(session.attemptId, technicalOutcome("twilio_failed", status));
            reconciled += 1;
            continue;
          }
          if (status === "completed") {
            await ops.finalize(session.attemptId, noClearOutcome("Provider completed before sideband recovery"));
            reconciled += 1;
            continue;
          }
          await telephony.stopCall(session.providerCallId, ["queued", "ringing"].includes(status) ? "canceled" : "completed");
        }
        await ops.finalize(session.attemptId, technicalOutcome("provider_recovery_required", session.blockedReason));
        reconciled += 1;
      } else if (session.recoveryAction === "terminate") {
        await realtime.hangup(session.openAiCallId!);
        await ops.finalize(session.attemptId, {
          ...technicalOutcome("recovery_call_ineligible", session.blockedReason),
          terminalStatus: "cancelled",
          summaryForHuman: "Der aktive Anruf wurde beim Runtime-Neustart durch einen Berechtigungs- oder Kill-Switch-Gate beendet.",
        });
        reconciled += 1;
      } else if (await realtime.recoverCall(session)) recovered += 1;
    } catch (error) {
      console.error("voice sideband recovery failed", session.attemptId, error instanceof Error ? error.message : "unknown error");
    }
  }
  console.log(`voice runtime recovery complete: ${recovered} reconnected, ${reconciled} reconciled, ${sessions.length} found`);
}

function json(response: ServerResponse, status: number, body: Record<string, unknown>) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function rawBody(request: IncomingMessage, maxBytes = 128_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > maxBytes) throw new Error("payload_too_large");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function dispatch(response: ServerResponse) {
  if (!telephony || !realtime) {
    return json(response, 503, { ok: false, error: "provider_not_ready", missing: config.providerReadiness.missing });
  }
  const claimed = await ops.claim();
  if (!claimed) return json(response, 200, { ok: true, claimed: false });
  let session;
  try {
    session = await ops.getAttempt(claimed.attemptId);
  } catch (error) {
    await ops.finalize(claimed.attemptId, {
      ...technicalOutcome("pre_dial_eligibility_failed", error instanceof Error ? error.message : "unknown error"),
      terminalStatus: "cancelled",
      summaryForHuman: "Der Anruf wurde durch die erneute Berechtigungspruefung vor dem Waehlen blockiert.",
    });
    throw error;
  }
  try {
    const call = await telephony.startOutboundCall(session);
    await ops.updateAttempt(session.attemptId, { providerCallId: call.providerCallId, status: "dialing" });
    await ops.event(session.attemptId, "runtime", "dispatch.started", `dispatch:${session.attemptId}`, { status: "dialing" });
    return json(response, 202, { ok: true, claimed: true, attemptId: session.attemptId });
  } catch (error) {
    await ops.finalize(claimed.attemptId, technicalOutcome("telephony_start_uncertain", error instanceof Error ? error.message : "unknown error"));
    throw error;
  }
}

async function openAiWebhook(request: IncomingMessage, response: ServerResponse) {
  if (!realtime) return json(response, 503, { ok: false, error: "openai_not_ready", missing: config.providerReadiness.missing });
  const body = await rawBody(request);
  const event = await realtime.unwrapWebhook(body, request.headers);
  const incoming = liveIncoming(event);
  if (!incoming) return json(response, 200, { ok: true, ignored: true });
  const attemptHeader = incoming.headers.find((header) => header.name.toLowerCase() === "x-neontrip-attempt-id");
  const bindingHeader = incoming.headers.find((header) => header.name.toLowerCase() === "x-neontrip-binding");
  const attemptId = String(attemptHeader?.value || "").trim();
  const binding = String(bindingHeader?.value || "").trim();
  if (!attemptId || !verifyAttemptBinding(attemptId, binding, config.sipBindingSecret)) {
    await realtime.reject(incoming.sessionId);
    return json(response, 422, { ok: false, error: "invalid_attempt_binding" });
  }
  try {
    const eventId = String(incoming.id || request.headers["webhook-id"] || "").trim();
    if (!eventId) {
      await realtime.reject(incoming.sessionId);
      return json(response, 422, { ok: false, error: "missing_webhook_id" });
    }
    const session = await ops.getAttempt(attemptId);
    const registration = await ops.event(attemptId, "openai", "live.transport.incoming", `openai-webhook:${eventId}`, {
      event_id: eventId,
      call_id: incoming.sessionId,
    });
    if (registration.result?.duplicate) return json(response, 200, { ok: true, duplicate: true });
    await realtime.acceptIncomingCall(incoming.sessionId, attemptId, session);
    return json(response, 200, { ok: true });
  } catch (error) {
    await realtime.reject(incoming.sessionId).catch((rejectError) => {
      console.error("voice incoming call rejection failed", incoming.sessionId, rejectError instanceof Error ? rejectError.message : "unknown error");
    });
    await ops.finalize(attemptId, technicalOutcome("openai_accept_failed", error instanceof Error ? error.message : "unknown error")).catch((finalizeError) => {
      console.error("voice incoming call failure finalization failed", attemptId, finalizeError instanceof Error ? finalizeError.message : "unknown error");
    });
    throw error;
  }
}

async function twilioWebhook(request: IncomingMessage, response: ServerResponse) {
  if (!telephony) return json(response, 503, { ok: false, error: "telephony_not_ready", missing: config.providerReadiness.missing });
  const body = await rawBody(request);
  const params = new URLSearchParams(body);
  const requestUrl = new URL(request.url || "/webhooks/twilio", config.publicUrl);
  const callbackUrl = requestUrl.toString();
  if (!verifyTwilioSignature({ signature: request.headers["x-twilio-signature"] as string | undefined, url: callbackUrl, params, authToken: config.twilioAuthToken })) {
    return json(response, 401, { ok: false, error: "invalid_signature" });
  }
  const providerCallId = String(params.get("CallSid") || "");
  const status = String(params.get("CallStatus") || "").toLowerCase();
  const attemptId = String(requestUrl.searchParams.get("attemptId") || "");
  if (attemptId) await ops.event(attemptId, "telephony", `twilio.${status}`, `twilio:${providerCallId}:${status}`, { status, call_id: providerCallId });
  if (attemptId && providerCallId && ["initiated", "ringing", "answered"].includes(status)) {
    await ops.updateAttempt(attemptId, {
      providerCallId,
      ...(status === "ringing" || status === "answered" ? { status: "ringing" } : {}),
    }).catch((error) => {
      console.error("voice provider callback state update failed", attemptId, error instanceof Error ? error.message : "unknown error");
    });
  }
  if (attemptId && ["busy", "no-answer", "failed", "canceled"].includes(status)) {
    await ops.finalize(attemptId, status === "failed" ? technicalOutcome("twilio_failed", status) : notReachedOutcome(status));
  }
  if (attemptId && status === "completed") {
    setTimeout(() => void ops.finalize(attemptId, noClearOutcome("Twilio completed without an earlier structured finalization")).catch((error) => {
      console.error("voice provider completion reconciliation failed", attemptId, error instanceof Error ? error.message : "unknown error");
    }), 10_000);
  }
  return json(response, 200, { ok: true });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", config.publicUrl);
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        service: "neontrip-voice-runtime",
        commit: config.commitSha,
        ready: config.providerReadiness.dispatch,
        browserPhone: {tokens:browserPhoneReady(config),calls:browserCallingReady(config)},
        providers: {
          openAi: config.providerReadiness.openAi,
          telephony: config.providerReadiness.telephony,
          missing: config.providerReadiness.missing,
        },
      });
    }
    if (request.method==="POST" && ["/phone/twilio/client","/phone/twilio/conference","/phone/twilio/customer"].includes(url.pathname)) {
      if(!browserCalls)return json(response,503,{ok:false,error:"browser_calling_not_configured"});
      let params:URLSearchParams;
      try{params=phoneWebhookParameters(config,url,request.headers["x-twilio-signature"] as string|undefined,await rawBody(request,16000));}
      catch{return json(response,401,{ok:false,error:"invalid_phone_signature"});}
      if(url.pathname==="/phone/twilio/client") {
        const twiml=await browserCalls.client(params);
        response.writeHead(200,{"content-type":"text/xml","cache-control":"no-store"});response.end(twiml);return;
      }
      await browserCalls.event(url.searchParams.get("id")||"",url.pathname.endsWith("/conference")?"conference":"customer",params);
      return json(response,200,{ok:true});
    }
    if(request.method==="POST" && url.pathname==="/phone/cancel") {
      if(!bearerMatches(request.headers.authorization,config.dispatchToken))return json(response,401,{ok:false,error:"unauthorized"});
      if(!browserCalls)return json(response,503,{ok:false,error:"browser_calling_not_configured"});
      let input:Record<string,unknown>;
      try{input=JSON.parse(await rawBody(request,2048));}catch{return json(response,400,{ok:false,error:"invalid_phone_payload"});}
      if(!input || typeof input!=="object" || [input.callId,input.deviceId,input.staffId].some(x=>typeof x!=="string"))
        return json(response,422,{ok:false,error:"invalid_phone_identity"});
      await browserCalls.cancel(input.callId as string,input.deviceId as string,input.staffId as string);
      return json(response,200,{ok:true});
    }
    if (request.method === "POST" && url.pathname === "/phone/token") {
      if (!bearerMatches(request.headers.authorization, config.dispatchToken)) return json(response, 401, { ok: false, error: "unauthorized" });
      if (!browserPhoneReady(config)) return json(response,503,{ok:false,error:"browser_phone_not_configured"});
      let input:Record<string,unknown>;
      try {input=JSON.parse(await rawBody(request,2048));}
      catch {return json(response,400,{ok:false,error:"invalid_phone_payload"});}
      if(!input || typeof input!=="object" || Array.isArray(input))return json(response,422,{ok:false,error:"invalid_phone_identity"});
      try {
        const result=await browserPhoneToken(config,ops,input);
        return json(response,200,{ok:true,...result});
      } catch(error) {
        if(error instanceof Error && ["invalid_phone_identity","phone_identity_not_current"].includes(error.message))
          return json(response,403,{ok:false,error:"phone_identity_required"});
        throw error;
      }
    }
    if (request.method === "POST" && url.pathname === "/dispatch") {
      if (!bearerMatches(request.headers.authorization, config.dispatchToken)) return json(response, 401, { ok: false, error: "unauthorized" });
      return await dispatch(response);
    }
    if (request.method === "POST" && url.pathname === "/webhooks/openai") return await openAiWebhook(request, response);
    if (request.method === "POST" && url.pathname === "/webhooks/twilio") return await twilioWebhook(request, response);
    if (request.method === "POST" && url.pathname.startsWith("/attempts/") && url.pathname.endsWith("/stop")) {
      if (!bearerMatches(request.headers.authorization, config.dispatchToken)) return json(response, 401, { ok: false, error: "unauthorized" });
      const attemptId = url.pathname.split("/")[2] || "";
      const controlBody = JSON.parse((await rawBody(request)) || "{}") as { providerCallId?: unknown };
      const providerCallId = typeof controlBody.providerCallId === "string" ? controlBody.providerCallId.trim() : "";
      let stopped = false;
      const stopErrors: string[] = [];
      try {
        stopped = realtime ? await realtime.stopAttempt(attemptId) : false;
      } catch (error) {
        stopErrors.push(error instanceof Error ? error.message : "OpenAI stop failed");
      }
      if (providerCallId) {
        if (!telephony) return json(response, 503, { ok: false, error: "telephony_not_ready", missing: config.providerReadiness.missing });
        try {
          const providerStatus = await telephony.getCallStatus(providerCallId);
          if (!["completed", "failed", "busy", "no-answer", "canceled"].includes(providerStatus)) {
            await telephony.stopCall(providerCallId, ["queued", "ringing"].includes(providerStatus) ? "canceled" : "completed");
          }
          stopped = true;
        } catch (error) {
          stopErrors.push(error instanceof Error ? error.message : "provider stop failed");
        }
      }
      if (!stopped && stopErrors.length) throw new Error(`voice call stop failed: ${stopErrors.join("; ")}`);
      if (stopped) await ops.finalize(attemptId, { ...notReachedOutcome("canceled"), summaryForHuman: "Anruf wurde durch einen Operator gestoppt." });
      if (stopErrors.length) return json(response, 502, { ok: false, error: "partial_stop_failure", partialErrors: stopErrors });
      return json(response, stopped ? 200 : 404, { ok: stopped, partialErrors: stopErrors });
    }
    if (request.method === "POST" && url.pathname.startsWith("/attempts/") && url.pathname.endsWith("/handoff")) {
      if (!bearerMatches(request.headers.authorization, config.dispatchToken)) return json(response, 401, { ok: false, error: "unauthorized" });
      if (!realtime) return json(response, 503, { ok: false, error: "openai_not_ready", missing: config.providerReadiness.missing });
      const attemptId = url.pathname.split("/")[2] || "";
      const handedOff = await realtime.handoffAttempt(attemptId);
      return json(response, handedOff ? 202 : 404, { ok: handedOff, status: handedOff ? "handoff_requested" : "not_found", connected: false });
    }
    return json(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    console.error("voice runtime request failed", error instanceof Error ? error.message : "unknown error");
    return json(response, 500, { ok: false, error: "internal_error" });
  }
});

let reconcilingPhone=false;
const reconcilePhone=async()=>{
  if(!browserCalls || reconcilingPhone)return;
  reconcilingPhone=true;
  try{await browserCalls.reconcile();}catch{console.warn("browser phone recovery unavailable");}
  finally{reconcilingPhone=false;}
};
const phoneRecoveryTimer=browserCalls?setInterval(()=>void reconcilePhone(),20000):null;

server.listen(config.port, "0.0.0.0", () => {
  void reconcilePhone();
  console.log(`voice runtime listening on :${config.port}`);
  void recoverActiveCalls().catch((error) => console.error("voice runtime recovery request failed", error instanceof Error ? error.message : "unknown error"));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {if(phoneRecoveryTimer)clearInterval(phoneRecoveryTimer);server.close(() => process.exit(0));});
}
