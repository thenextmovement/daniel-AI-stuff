import OpenAI from "openai";
import WebSocket from "ws";
import type { RuntimeConfig } from "./config.js";
import type { OpsClient } from "./ops-client.js";
import type { RecoveredRuntimeSession, RuntimeSession, StructuredOutcome } from "./types.js";
import { noClearOutcome, notReachedOutcome, technicalOutcome } from "./outcomes.js";

type ActiveCall = {
  attemptId: string;
  callId: string;
  socket: WebSocket;
  lastOutcome: StructuredOutcome | null;
  finalized: boolean;
  openingText: string;
  openingAttempts: number;
  disclosureConfirmed: boolean;
  hangupAfterResponse: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
};

const OPENING_INSTRUCTION = "Beginne jetzt exakt in dieser Reihenfolge: Identifiziere dich als Nia von NEONTRIP, nenne den konkreten Anfrage- oder Angebotsbezug, sage noch im selben Sprechzug 'Ich unterstuetze Sie dabei als digitaler Telefonassistent' und frage erst dann, ob es gerade kurz passt.";

function containsAssistantDisclosure(value: string) {
  return /digital(?:er|en)?\s+telefonassistent|ki[- ]?(?:telefon|sprach)?assistent/i.test(value);
}

export class OpenAiRealtimeAdapter {
  readonly client: OpenAI;
  private readonly calls = new Map<string, ActiveCall>();

  constructor(private readonly config: RuntimeConfig, private readonly ops: OpsClient) {
    this.client = new OpenAI({ apiKey: config.openAiApiKey, webhookSecret: config.openAiWebhookSecret });
  }

  async unwrapWebhook(body: string, headers: Record<string, string | string[] | undefined>) {
    return this.client.webhooks.unwrap(body, headers, this.config.openAiWebhookSecret);
  }

  async acceptIncomingCall(callId: string, attemptId: string, session: RuntimeSession) {
    const turnDetection = session.sessionConfig.turn_detection && typeof session.sessionConfig.turn_detection === "object"
      ? session.sessionConfig.turn_detection as Record<string, unknown>
      : { type: "server_vad" };
    await this.client.realtime.calls.accept(callId, {
      type: "realtime",
      model: session.modelId,
      instructions: session.instructions,
      output_modalities: ["audio"],
      audio: { input: { turn_detection: turnDetection as never }, output: { voice: session.voice } },
      tools: session.tools as never,
      tool_choice: "auto",
      max_output_tokens: 700,
      tracing: null,
    }, { headers: { "OpenAI-Safety-Identifier": session.safetyIdentifier } });
    await this.ops.updateAttempt(attemptId, { openAiCallId: callId, status: "live" });
    await this.connectSideband(callId, attemptId, session.safetyIdentifier, false);
  }

  async recoverCall(session: RecoveredRuntimeSession) {
    if (!session.openAiCallId || this.calls.has(session.openAiCallId)) return false;
    await this.connectSideband(session.openAiCallId, session.attemptId, session.safetyIdentifier, session.disclosureConfirmed);
    return true;
  }

  async reject(callId: string) {
    await this.client.realtime.calls.reject(callId, { status_code: 603 });
  }

  async stopAttempt(attemptId: string) {
    const active = [...this.calls.values()].find((entry) => entry.attemptId === attemptId);
    if (!active) return false;
    const previousOutcome = active.lastOutcome;
    active.lastOutcome = active.lastOutcome?.customerRequestedStop ? active.lastOutcome : {
      ...notReachedOutcome("canceled"),
      summaryForHuman: "Anruf wurde durch einen Operator gestoppt.",
    };
    if (active.stopTimer) clearTimeout(active.stopTimer);
    try {
      await this.client.realtime.calls.hangup(active.callId);
      active.socket.close(1000, "operator stop");
      return true;
    } catch (error) {
      active.lastOutcome = previousOutcome;
      if (active.hangupAfterResponse) active.stopTimer = setTimeout(() => void this.finishCustomerStop(active), 5_000);
      throw error;
    }
  }

  async handoffAttempt(attemptId: string) {
    if (!this.config.handoffUri) throw new Error("VOICE_HUMAN_HANDOFF_URI is not configured");
    const active = [...this.calls.values()].find((entry) => entry.attemptId === attemptId);
    if (!active) return false;
    const previousOutcome = active.lastOutcome;
    active.lastOutcome = {
      ...notReachedOutcome("completed"), terminalStatus: "handed_off", outcomeCode: "needs_human_followup",
      summaryForHuman: "Anruf wurde durch einen Operator an einen Menschen uebergeben.",
      humanHandoffRequested: true, humanHandoffCompleted: true,
    };
    if (active.stopTimer) clearTimeout(active.stopTimer);
    try {
      await this.client.realtime.calls.refer(active.callId, { target_uri: this.config.handoffUri });
      active.socket.close(1000, "operator handoff");
      return true;
    } catch (error) {
      active.lastOutcome = previousOutcome;
      throw error;
    }
  }

  private async connectSideband(callId: string, attemptId: string, safetyIdentifier: string, disclosureConfirmed: boolean) {
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
      headers: {
        authorization: `Bearer ${this.config.openAiApiKey}`,
        "OpenAI-Safety-Identifier": safetyIdentifier,
      },
    });
    const active: ActiveCall = {
      attemptId, callId, socket, lastOutcome: null, finalized: false, openingText: "", openingAttempts: 1,
      disclosureConfirmed, hangupAfterResponse: false, stopTimer: null,
    };
    this.calls.set(callId, active);

    socket.on("open", () => {
      void this.ops.event(attemptId, "runtime", "sideband.connected", `sideband-open:${callId}`, { call_id: callId })
        .catch((error) => console.error("voice sideband connect event failed", error instanceof Error ? error.message : "unknown error"));
      if (!active.disclosureConfirmed) socket.send(JSON.stringify({ type: "response.create", response: { instructions: OPENING_INSTRUCTION } }));
    });
    socket.on("message", (raw) => void this.handleMessage(active, String(raw)).catch((error) => this.handleProcessingError(active, error)));
    socket.on("error", (error) => {
      void this.ops.event(attemptId, "runtime", "sideband.error", `sideband-error:${callId}`, { error_code: error.name })
        .catch((eventError) => console.error("voice sideband error event failed", eventError instanceof Error ? eventError.message : "unknown error"));
    });
    socket.on("close", () => void this.handleClose(active));
  }

  private async handleMessage(active: ActiveCall, raw: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("invalid realtime event JSON");
    }
    const type = String(event.type || "");
    if (type === "response.function_call_arguments.done") {
      await this.handleTool(active, event);
    } else if (type === "response.output_audio_transcript.delta" || type === "response.output_text.delta") {
      if (!active.disclosureConfirmed) active.openingText += String(event.delta || "");
    } else if (type === "response.done" && !active.disclosureConfirmed) {
      if (containsAssistantDisclosure(active.openingText)) {
        active.disclosureConfirmed = true;
        await this.ops.event(active.attemptId, "runtime", "disclosure.confirmed", `disclosure:${active.callId}`, { status: "confirmed" });
      } else if (active.openingAttempts < 2 && active.socket.readyState === WebSocket.OPEN) {
        active.openingAttempts += 1;
        active.openingText = "";
        active.socket.send(JSON.stringify({ type: "response.create", response: { instructions: OPENING_INSTRUCTION } }));
      } else {
        await this.terminateCall(active, technicalOutcome("compliance_disclosure_failed", "Required first-turn digital assistant disclosure was not observed"), "disclosure failed");
      }
    } else if (type === "response.done" && active.hangupAfterResponse) {
      await this.finishCustomerStop(active);
    } else if (type === "error") {
      const error = event.error && typeof event.error === "object" ? event.error as Record<string, unknown> : {};
      await this.ops.event(active.attemptId, "openai", "realtime.error", `openai-error:${String(event.event_id || Date.now())}`, {
        error_code: String(error.code || error.type || "realtime_error"),
      });
    }
  }

  private async handleTool(active: ActiveCall, event: Record<string, unknown>) {
    const callId = String(event.call_id || "");
    const toolName = String(event.name || "");
    if (!callId || !toolName) return;
    if (!active.disclosureConfirmed) {
      if (active.socket.readyState === WebSocket.OPEN) {
        active.socket.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ ok: false, error: "disclosure_required" }) } }));
        active.socket.send(JSON.stringify({ type: "response.create", response: { instructions: OPENING_INSTRUCTION } }));
      }
      return;
    }
    let output: Record<string, unknown>;
    try {
      const toolResponse = await this.ops.tool(active.attemptId, callId, toolName, String(event.arguments || "{}"));
      output = { ok: true, ...toolResponse.result };
      if (toolName === "record_qualification") active.lastOutcome = this.outcomeFromQualification(toolResponse.result);
      if (toolName === "schedule_callback" && active.lastOutcome) active.lastOutcome.callbackAt = String(toolResponse.result.callbackAt || "") || null;
      if (toolName === "request_human_handoff" && this.config.handoffUri) {
        await this.client.realtime.calls.refer(active.callId, { target_uri: this.config.handoffUri });
        active.lastOutcome = {
          ...this.outcomeFromQualification({ outcomeCode: "needs_human_followup", summaryForHuman: "Das Gespraech wurde an einen Menschen uebergeben." }),
          terminalStatus: "handed_off", humanHandoffRequested: true, humanHandoffCompleted: true,
        };
        await this.ops.finalize(active.attemptId, active.lastOutcome).then(() => {
          active.finalized = true;
        }).catch((error) => {
          console.error("voice handoff finalization failed", active.attemptId, error instanceof Error ? error.message : "unknown error");
        });
        active.socket.close(1000, "human handoff");
        return;
      }
    } catch (error) {
      output = { ok: false, error: "tool_failed" };
      await this.ops.event(active.attemptId, "runtime", "tool.failed", `tool-failed:${callId}`, { tool_name: toolName, tool_call_id: callId });
    }
    if (active.socket.readyState === WebSocket.OPEN) {
      active.socket.send(JSON.stringify({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      }));
      active.socket.send(JSON.stringify({ type: "response.create" }));
    }
    if (active.lastOutcome?.customerRequestedStop) {
      active.hangupAfterResponse = true;
      if (active.stopTimer) clearTimeout(active.stopTimer);
      active.stopTimer = setTimeout(() => void this.finishCustomerStop(active), 5_000);
    }
  }

  private outcomeFromQualification(result: Record<string, unknown>): StructuredOutcome {
    return {
      terminalStatus: "completed",
      outcomeCode: String(result.outcomeCode || "no_clear_outcome"),
      summaryForHuman: String(result.summaryForHuman || "Gespraech beendet, ohne ein eindeutiges Ergebnis festzuhalten.").slice(0, 2000),
      customerIntent: String(result.customerIntent || "") || null,
      productInterest: String(result.productInterest || "") || null,
      objections: Array.isArray(result.objections) ? result.objections.map(String).slice(0, 10) : [],
      callbackAt: null,
      humanHandoffRequested: false, humanHandoffCompleted: false,
      customerRequestedStop: result.customerRequestedStop === true,
      unsafeOrUnsupportedRequest: result.unsafeOrUnsupportedRequest === true,
      failureCode: null, failureDetail: null,
    };
  }

  private async handleClose(active: ActiveCall) {
    this.calls.delete(active.callId);
    if (active.stopTimer) clearTimeout(active.stopTimer);
    if (active.finalized) return;
    active.finalized = true;
    const outcome = active.lastOutcome || noClearOutcome("Realtime connection closed before a structured result was recorded");
    await this.ops.finalize(active.attemptId, outcome).catch((error) => {
      console.error("voice close finalization failed", active.attemptId, error instanceof Error ? error.message : "unknown error");
    });
  }

  private async finishCustomerStop(active: ActiveCall) {
    if (active.finalized || !active.lastOutcome?.customerRequestedStop) return;
    await this.terminateCall(active, active.lastOutcome, "customer stop");
  }

  private async terminateCall(active: ActiveCall, outcome: StructuredOutcome, reason: string) {
    if (active.finalized) return;
    active.lastOutcome = outcome;
    if (active.stopTimer) clearTimeout(active.stopTimer);
    await this.ops.finalize(active.attemptId, outcome).then(() => {
      active.finalized = true;
    }).catch((error) => {
      console.error("voice termination finalization failed", active.attemptId, error instanceof Error ? error.message : "unknown error");
    });
    await this.client.realtime.calls.hangup(active.callId).catch((error) => {
      console.error("voice termination hangup failed", active.callId, error instanceof Error ? error.message : "unknown error");
    });
    active.socket.close(1000, reason);
  }

  private async handleProcessingError(active: ActiveCall, error: unknown) {
    console.error("voice sideband event processing failed", active.attemptId, error instanceof Error ? error.message : "unknown error");
    await this.ops.event(active.attemptId, "runtime", "sideband.processing_failed", `sideband-processing-failed:${active.callId}`, {
      error_code: "sideband_processing_failed",
    }).catch((eventError) => console.error("voice processing failure event failed", eventError instanceof Error ? eventError.message : "unknown error"));
    await this.terminateCall(active, technicalOutcome("sideband_processing_failed", "Realtime sideband event processing failed"), "processing failed");
  }
}
