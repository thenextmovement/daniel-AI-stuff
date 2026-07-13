import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadRuntimeConfig } from "./config.js";
import { OpsClient } from "./ops-client.js";
import { OpenAiRealtimeAdapter } from "./realtime.js";
import { bearerMatches, verifyAttemptBinding, verifyTwilioSignature } from "./security.js";
import { TwilioSipAdapter } from "./telephony.js";
import { noClearOutcome, notReachedOutcome, technicalOutcome } from "./outcomes.js";

const config = loadRuntimeConfig();
const ops = new OpsClient(config);
const telephony = config.providerReadiness.telephony ? new TwilioSipAdapter(config) : null;
const realtime = config.providerReadiness.openAi ? new OpenAiRealtimeAdapter(config, ops) : null;

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
  if (event.type !== "realtime.call.incoming") return json(response, 200, { ok: true, ignored: true });
  const attemptHeader = event.data.sip_headers.find((header) => header.name.toLowerCase() === "x-neontrip-attempt-id");
  const bindingHeader = event.data.sip_headers.find((header) => header.name.toLowerCase() === "x-neontrip-binding");
  const attemptId = String(attemptHeader?.value || "").trim();
  const binding = String(bindingHeader?.value || "").trim();
  if (!attemptId || !verifyAttemptBinding(attemptId, binding, config.sipBindingSecret)) {
    await realtime.reject(event.data.call_id);
    return json(response, 422, { ok: false, error: "invalid_attempt_binding" });
  }
  try {
    const eventId = String(event.id || request.headers["webhook-id"] || "").trim();
    if (!eventId) {
      await realtime.reject(event.data.call_id);
      return json(response, 422, { ok: false, error: "missing_webhook_id" });
    }
    const session = await ops.getAttempt(attemptId);
    const registration = await ops.event(attemptId, "openai", "realtime.call.incoming", `openai-webhook:${eventId}`, {
      event_id: eventId,
      call_id: event.data.call_id,
    });
    if (registration.result?.duplicate) return json(response, 200, { ok: true, duplicate: true });
    await realtime.acceptIncomingCall(event.data.call_id, attemptId, session);
    return json(response, 200, { ok: true });
  } catch (error) {
    await realtime.reject(event.data.call_id).catch((rejectError) => {
      console.error("voice incoming call rejection failed", event.data.call_id, rejectError instanceof Error ? rejectError.message : "unknown error");
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
        providers: {
          openAi: config.providerReadiness.openAi,
          telephony: config.providerReadiness.telephony,
          missing: config.providerReadiness.missing,
        },
      });
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
      if (handedOff) await ops.finalize(attemptId, {
        ...notReachedOutcome("completed"), terminalStatus: "handed_off", outcomeCode: "needs_human_followup",
        summaryForHuman: "Anruf wurde durch einen Operator an einen Menschen uebergeben.",
        humanHandoffRequested: true, humanHandoffCompleted: true,
      });
      return json(response, handedOff ? 200 : 404, { ok: handedOff });
    }
    return json(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    console.error("voice runtime request failed", error instanceof Error ? error.message : "unknown error");
    return json(response, 500, { ok: false, error: "internal_error" });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`voice runtime listening on :${config.port}`);
  void recoverActiveCalls().catch((error) => console.error("voice runtime recovery request failed", error instanceof Error ? error.message : "unknown error"));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
