import OpenAI from "openai";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "./config.js";
import type { OpsClient } from "./ops-client.js";
import type {
  RuntimeSession,
  RecoveredRuntimeSession,
  StructuredOutcome,
} from "./types.js";
import {
  noClearOutcome,
  notReachedOutcome,
  technicalOutcome,
} from "./outcomes.js";
import {
  liveSessionConfig,
  liveTranscript,
  LiveToolCollector,
  type LiveSegment,
} from "./live-protocol.js";

type ActiveCall = {
  attemptId: string;
  callId: string;
  socket: WebSocket;
  session: RuntimeSession;
  outcome: StructuredOutcome | null;
  closed: boolean;
  gap: boolean;
  disclosed: boolean;
  opening: string;
  queue: Map<string, LiveSegment>;
  chain: Promise<void>;
  flush: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  collector: LiveToolCollector;
  finalizing: boolean;
};
export class OpenAiLiveAdapter {
  readonly client: OpenAI;
  private calls = new Map<string, ActiveCall>();
  constructor(
    private config: RuntimeConfig,
    private ops: OpsClient,
  ) {
    this.client = new OpenAI({
      apiKey: config.openAiApiKey,
      webhookSecret: config.openAiWebhookSecret,
    });
  }
  async unwrapWebhook(
    body: string,
    headers: Record<string, string | string[] | undefined>,
  ) {
    return this.client.webhooks.unwrap(
      body,
      headers,
      this.config.openAiWebhookSecret,
    );
  }
  private async command(
    id: string,
    action: string,
    body?: unknown,
    safetyIdentifier?: string,
  ) {
    const response = await fetch(
      "https://api.openai.com/v1/live/sessions/" +
        encodeURIComponent(id) +
        "/" +
        action,
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.config.openAiApiKey,
          "content-type": "application/json",
          ...(safetyIdentifier
            ? { "OpenAI-Safety-Identifier": safetyIdentifier }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error("live_" + action + "_http_" + response.status);
  }
  async acceptIncomingCall(
    id: string,
    attemptId: string,
    session: RuntimeSession,
  ) {
    const config = liveSessionConfig(session);
    await this.ops.updateAttempt(attemptId, { openAiCallId: id });
    await this.ops.transcript(attemptId, []);
    await this.command(
      id,
      "accept",
      { session: config },
      session.safetyIdentifier,
    );
    try {
      await this.ops.updateAttempt(attemptId, {
        openAiCallId: id,
        status: "live",
      });
      this.attach(id, session, false, false);
    } catch (error) {
      await this.hangup(id).catch(() => {});
      throw error;
    }
  }
  async reject(id: string) {
    await this.command(id, "reject", { status_code: 603 });
  }
  async hangup(id: string) {
    await this.command(id, "hangup");
  }
  async recoverCall(
    session: Extract<RecoveredRuntimeSession, { recoveryAction: "reconnect" }>,
  ) {
    if (!session.openAiCallId || this.calls.has(session.openAiCallId))
      return false;
    liveSessionConfig(session);
    this.attach(
      session.openAiCallId,
      session,
      session.disclosureConfirmed,
      true,
    );
    return true;
  }
  async stopAttempt(attemptId: string) {
    const active = [...this.calls.values()].find(
      (x) => x.attemptId === attemptId,
    );
    if (!active) return false;
    const previous = active.outcome;
    active.outcome = active.outcome?.customerRequestedStop
      ? active.outcome
      : {
          ...notReachedOutcome("canceled"),
          summaryForHuman: "Anruf wurde durch einen Mitarbeiter beendet.",
        };
    try {
      await this.hangup(active.callId);
      this.closeDeadline(active);
      return true;
    } catch (error) {
      active.outcome = previous;
      throw error;
    }
  }
  async handoffAttempt(attemptId: string) {
    const active = [...this.calls.values()].find(
      (x) => x.attemptId === attemptId,
    );
    if (!active) return false;
    if (!this.config.handoffUri) throw new Error("handoff_not_configured");
    if (active.session.allowlistOnly) throw new Error("test_handoff_disabled");
    await this.command(active.callId, "refer", {
      target_uri: this.config.handoffUri,
    });
    active.gap = true; // SIP REFER does not provide the subsequent employee audio.
    active.outcome = {
      ...noClearOutcome(
        "Uebergabe angefragt, Verbindung zum Mitarbeiter nicht bestaetigt.",
      ),
      summaryForHuman:
        "Übergabe angefragt; Verbindung zum Mitarbeiter noch nicht bestätigt.",
      outcomeCode: "needs_human_followup",
      humanHandoffRequested: true,
      humanHandoffCompleted: false,
    };
    await this.ops.event(
      attemptId,
      "runtime",
      "handoff.requested",
      "live-handoff:" + active.callId,
      { status: "requested" },
    );
    return true;
  }
  private send(active: ActiveCall, value: Record<string, unknown>) {
    if (active.socket.readyState === WebSocket.OPEN)
      active.socket.send(JSON.stringify({ ...value, event_id: randomUUID() }));
  }
  private closeDeadline(active: ActiveCall) {
    if (active.stopTimer) clearTimeout(active.stopTimer);
    active.stopTimer = setTimeout(() => {
      active.gap = true;
      active.socket.close(1000, "close timeout");
    }, 10000);
  }
  private attach(
    id: string,
    session: RuntimeSession,
    disclosed: boolean,
    gap: boolean,
  ) {
    const socket = new WebSocket(
      "wss://api.openai.com/v1/live/sessions/" +
        encodeURIComponent(id) +
        "/attach",
      {
        headers: {
          authorization: "Bearer " + this.config.openAiApiKey,
          "OpenAI-Safety-Identifier": session.safetyIdentifier,
        },
      },
    );
    const active: ActiveCall = {
      attemptId: session.attemptId,
      callId: id,
      socket,
      session,
      outcome: null,
      closed: false,
      gap,
      disclosed,
      opening: "",
      queue: new Map(),
      chain: Promise.resolve(),
      flush: null,
      timer: null,
      stopTimer: null,
      collector: new LiveToolCollector(),
      finalizing: false,
    };
    this.calls.set(id, active);
    socket.on("open", () => {
      if (!disclosed)
        this.send(active, {
          type: "session.instructions.append",
          delegation_id: null,
          content: session.allowlistOnly
            ? "Begrüße jetzt auf Deutsch: Du bist Nia, der KI-Telefonassistent von NEONTRIP. Dies ist ein freigegebener interner Test mit Kundendaten als Simulation. Frage, ob es gerade passt. Keine realen Folgeaktionen."
            : "Begrüße jetzt auf Deutsch: Du bist Nia, der KI-Telefonassistent von NEONTRIP. Nenne den gebundenen Anfragebezug und frage, ob es gerade passt. Keine Zusagen über Preise oder Liefertermine.",
        });
      active.timer = setInterval(
        () => void this.flush(active).catch(() => {}),
        1000,
      );
    });
    socket.on("message", (raw) => {
      active.chain = active.chain
        .then(() => this.event(active, String(raw)))
        .catch(async () => {
          active.gap = true;
          active.outcome = technicalOutcome(
            "live_event_failed",
            "Live-Ereignis konnte nicht sicher verarbeitet werden.",
          );
          await this.hangup(id).catch(() => {});
          this.closeDeadline(active);
        });
    });
    socket.on("error", () => {
      active.gap = true;
    });
    socket.on("close", () => {
      void active.chain.then(() => this.finish(active));
    });
  }
  private flush(active: ActiveCall): Promise<void> {
    if (active.flush) return active.flush;
    active.flush = (async () => {
      while (active.queue.size) {
        const batch: LiveSegment[] = [];
        for (const segment of active.queue.values()) {
          if (
            batch.length >= 30 ||
            Buffer.byteLength(JSON.stringify([...batch, segment]), "utf8") >
              54000
          )
            break;
          batch.push(segment);
        }
        if (!batch.length) throw new Error("transcript_segment_too_large");
        const result = await this.ops.transcript(active.attemptId, batch);
        if (!result.saved) throw new Error("transcript_not_acknowledged");
        for (const segment of batch) active.queue.delete(segment.id);
      }
    })().finally(() => {
      active.flush = null;
    });
    return active.flush;
  }
  private async event(active: ActiveCall, raw: string) {
    const event = JSON.parse(raw) as Record<string, unknown>;
    const segment = liveTranscript(event);
    if (segment) {
      active.queue.set(segment.id, segment);
      if (active.queue.size > 1000) throw new Error("transcript_backlog");
      if (segment.speaker === "assistant" && !active.disclosed) {
        active.opening = (active.opening + segment.text).slice(-2000);
        if (
          /KI[- ]?(Telefon)?assistent|digital(?:er|en)?\s+Telefonassistent/i.test(
            active.opening,
          )
        ) {
          active.disclosed = true;
          await this.ops.event(
            active.attemptId,
            "runtime",
            "disclosure.confirmed",
            "disclosure:" + active.callId,
            { status: "confirmed" },
          );
        }
      }
    }
    if (event.type === "session.closed") {
      active.closed = true;
      if (!["close_requested", "remote_hangup"].includes(String(event.reason)))
        active.gap = true;
      active.socket.close(1000, "session closed");
      return;
    }
    if (event.type === "error") throw new Error("live_protocol_error");
    const calls = active.collector.collect(event);
    if (calls?.length) {
      for (const call of calls) {
        let result: Record<string, unknown>;
        if (!active.disclosed)
          result = { ok: false, error: "disclosure_required" };
        else
          try {
            const response = await this.ops.tool(
              active.attemptId,
              call.call_id,
              call.name,
              call.arguments,
            );
            result = { ok: true, ...response.result };
            if (call.name === "record_qualification") {
              const x = response.result;
              active.outcome = {
                ...noClearOutcome(""),
                failureCode: null,
                failureDetail: null,
                outcomeCode: String(x.outcomeCode || "no_clear_outcome"),
                summaryForHuman: String(
                  x.summaryForHuman || "Kein eindeutiges Ergebnis.",
                ).slice(0, 2000),
                customerIntent: String(x.customerIntent || "") || null,
                productInterest: String(x.productInterest || "") || null,
                objections: Array.isArray(x.objections)
                  ? x.objections.map(String).slice(0, 10)
                  : [],
                customerRequestedStop: x.customerRequestedStop === true,
                unsafeOrUnsupportedRequest:
                  x.unsafeOrUnsupportedRequest === true,
              };
            }
            if (
              call.name === "request_human_handoff" &&
              response.result.simulated !== true
            ) {
              result = { ok: true, requested: true, connected: false };
              if (this.config.handoffUri)
                await this.handoffAttempt(active.attemptId);
            }
          } catch {
            result = { ok: false, error: "tool_failed" };
          }
        this.send(active, {
          type: "response.item.create",
          item: {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          },
        });
      }
      this.send(active, { type: "response.create" });
      if (active.outcome?.customerRequestedStop) {
        this.send(active, {
          type: "session.instructions.append",
          delegation_id: null,
          content:
            "Bestätige den Stop-Wunsch kurz. Verabschiede dich, ohne weitere Fragen.",
        });
        if (active.stopTimer) clearTimeout(active.stopTimer);
        active.stopTimer = setTimeout(() => {
          void this.hangup(active.callId)
            .then(() => this.closeDeadline(active))
            .catch(() => {
              active.gap = true;
              active.socket.close();
            });
        }, 5000);
      }
    }
  }
  private async finish(active: ActiveCall) {
    if (active.finalizing) return;
    active.finalizing = true;
    if (!active.closed)
      await this.hangup(active.callId).catch(() =>
        console.error("voice disconnect hangup unconfirmed", active.attemptId),
      );
    if (active.timer) clearInterval(active.timer);
    if (active.stopTimer) clearTimeout(active.stopTimer);
    this.calls.delete(active.callId);
    let saved = false;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      try {
        await this.flush(active);
        await this.ops.transcript(
          active.attemptId,
          [],
          active.closed && !active.gap ? "complete" : "interrupted",
        );
        saved = true;
      } catch {
        if (attempt < 4)
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * 2 ** attempt),
          );
      }
    }
    const outcome = saved
      ? active.outcome ||
        noClearOutcome(
          "Gespräch beendet; kein strukturiertes Ergebnis festgehalten.",
        )
      : technicalOutcome(
          "transcript_save_failed",
          "Transkriptspeicherung blieb nach Wiederholungen unvollständig.",
        );
    await this.ops
      .finalize(active.attemptId, outcome)
      .catch(() =>
        console.error("voice finalization pending", active.attemptId),
      );
  }
}
