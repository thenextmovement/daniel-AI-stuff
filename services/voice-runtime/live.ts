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
  LIVE_GREETING_INSTRUCTION,
  liveSessionConfig,
  liveTranscript,
  LiveToolCollector,
  type LiveSegment,
} from "./live-protocol.js";

export interface LiveMediaTransport {
  activateInput(consume: (audio: string) => void): void;
  output(audio: string): void;
  watchClose(handler: (clean: boolean) => void): void;
  finishPlayback(): Promise<boolean>;
  playbackBufferPeakMs?(): number;
  timingMetrics?(): Record<string, number>;
  close(): void;
}

type ActiveCall = {
  media?: LiveMediaTransport;
  started: boolean;
  mediaEnded: boolean;
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
  greetingTimer: ReturnType<typeof setTimeout> | null;
  collector: LiveToolCollector;
  finalizing: boolean;
};
export class OpenAiLiveAdapter {
  readonly client: OpenAI;
  private calls = new Map<string, ActiveCall>();
  private mediaFinalizations = new Set<Promise<void>>();
  private mediaStopping = false;
  constructor(
    private config: RuntimeConfig,
    private ops: OpsClient,
    private socketFactory: (url: string, options: WebSocket.ClientOptions) => WebSocket =
      (url, options) => new WebSocket(url, options),
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
          "OpenAI-Project": this.config.openAiProjectId,
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
    const storage = await this.ops.transcript(attemptId, []);
    if (!storage.saved) throw new Error("transcript_not_acknowledged");
    await this.command(
      id,
      "accept",
      { session: config },
      session.safetyIdentifier,
    );
    try {
      // SIP accept returns 200 with no session body. Record exactly the accepted
      // model/voice request; never invent a provider echo or negotiated codec.
      await this.ops.event(attemptId, "runtime", "live.session.accepted", "live-sip-accept:" + id, {
        call_id: id, model: config.model, voice: config.audio.output.voice, status: "accepted",
      });
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
  async connectMedia(session: RuntimeSession, media: LiveMediaTransport) {
    if (this.mediaStopping) throw new Error("media_runtime_stopping");
    if (!session.allowlistOnly) throw new Error("media_internal_test_only");
    liveSessionConfig(session);
    if ([...this.calls.values()].some(call => call.attemptId === session.attemptId))
      throw new Error("attempt_already_connected");
    const storage = await this.ops.transcript(session.attemptId, []);
    if (!storage.saved) throw new Error("transcript_not_acknowledged");
    if (this.mediaStopping) throw new Error("media_runtime_stopping");
    this.attach("pending-" + session.attemptId, session, false, false, media);
  }
  async shutdownMedia() {
    this.mediaStopping = true;
    for (const active of this.calls.values()) {
      if (!active.media) continue;
      active.gap = true;
      active.outcome ||= technicalOutcome("media_runtime_restart", "Der interne Test wurde durch einen Runtime-Neustart unterbrochen.");
      await this.hangup(active.callId).catch(() => active.socket.terminate());
    }
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline &&
      ([...this.calls.values()].some(call => call.media) || this.mediaFinalizations.size))
      await new Promise(resolve => setTimeout(resolve, 50));
  }
  async reject(id: string) {
    await this.command(id, "reject", { status_code: 603 });
  }
  async hangup(id: string) {
    const active = this.calls.get(id);
    if (active?.media) {
      if (active.started && active.socket.readyState === WebSocket.OPEN) {
        this.send(active, { type: "session.close" });
        this.closeDeadline(active);
      } else {
        active.gap = true;
        active.socket.terminate();
      }
      return;
    }
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
    }, active.media ? 15000 : 10000);
  }
  private attach(
    id: string,
    session: RuntimeSession,
    disclosed: boolean,
    gap: boolean,
    media?: LiveMediaTransport,
  ) {
    const socket = this.socketFactory(
      media ? "wss://api.openai.com/v1/live/sessions" :
        "wss://api.openai.com/v1/live/sessions/" + encodeURIComponent(id) + "/attach",
      {
        headers: {
          authorization: "Bearer " + this.config.openAiApiKey,
          "OpenAI-Safety-Identifier": session.safetyIdentifier,
          "OpenAI-Project": this.config.openAiProjectId,
        },
        ...(media ? { handshakeTimeout: 10000, maxPayload: 256000, perMessageDeflate: false } : {}),
      },
    );
    const active: ActiveCall = {
      media,
      started: !media,
      mediaEnded: false,
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
      greetingTimer: null,
      collector: new LiveToolCollector(),
      finalizing: false,
    };
    this.calls.set(id, active);
    if (media) {
      active.stopTimer = setTimeout(() => {
        active.gap = true;
        active.socket.terminate();
      }, 12000);
      media.watchClose((clean) => {
        active.mediaEnded = true;
        if (!clean) {
          active.gap = true;
          active.outcome ||= technicalOutcome("media_disconnected", "Die Audioverbindung wurde unterbrochen.");
        }
        if (!active.closed) void this.hangup(active.callId).catch(() => active.socket.terminate());
      });
    }
    socket.on("open", () => {
      if (media) {
        // Primary WebSocket sessions reject the SIP-only session.type field.
        const { type: _transportType, ...initial } = liveSessionConfig(session);
        this.send(active, {
          type: "session.start",
          session: { ...initial, audio: { ...initial.audio, format: { type: "audio/pcmu", rate: 8000 } } },
        });
      } else if (!disclosed) this.scheduleGreeting(active);
      active.timer = setInterval(
        () => void this.flush(active).catch(() => {}),
        1000,
      );
    });
    socket.on("message", (raw) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(String(raw));
        if (media && event.type === "session.started") {
          if (active.started) throw new Error("duplicate_live_start");
          const started = event.session as Record<string, unknown>;
          if (typeof started?.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(started.id))
            throw new Error("invalid_live_session_id");
          const audio = started.audio as { format?: { type?: string; rate?: number }; output?: { voice?: string } } | undefined;
          if (started.model !== "gpt-live-1" || audio?.format?.type !== "audio/pcmu" || audio.format.rate !== 8000 || audio.output?.voice !== session.voice)
            throw new Error("live_session_contract_mismatch");
          if (active.stopTimer) clearTimeout(active.stopTimer);
          active.stopTimer = null;
          this.calls.delete(active.callId);
          active.callId = started.id;
          active.started = true;
          this.calls.set(active.callId, active);
          active.chain = active.chain.then(async () => {
            await this.ops.event(active.attemptId, "runtime", "live.session.confirmed", "live-session:" + active.callId, {
              call_id: active.callId, model: started.model, voice: audio.output!.voice!, audio_format: audio.format!.type!, sample_rate: audio.format!.rate!,
            });
            await this.ops.updateAttempt(active.attemptId, { openAiCallId: active.callId, status: "live" });
          }).catch(async () => {
            active.gap = true;
            active.outcome = technicalOutcome("live_state_save_failed", "Der Gesprächsstatus konnte nicht gespeichert werden.");
            await this.hangup(active.callId);
          });
          media.activateInput((audio) => {
            if (!active.started || active.closed || socket.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > 128000) throw new Error("live_input_backlog");
            this.send(active, { type: "session.input_audio.append", audio });
          });
          this.scheduleGreeting(active);
          return;
        }
        // Audio must never wait for database writes or delegated tool work.
        if (media && event.type === "session.output_audio.delta") {
          if (!active.started || typeof event.delta !== "string") throw new Error("live_audio_before_start");
          // The caller may hang up before the final Live audio arrives.
          if (!active.mediaEnded) media.output(event.delta);
          return;
        }
      } catch (error) {
        active.gap = true;
        const code = error instanceof Error && /^[a-z_]{1,80}$/.test(error.message) ? error.message : "live_media_failed";
        active.outcome = technicalOutcome(code, "Der Audiostrom wurde unterbrochen.");
        void this.hangup(active.callId).catch(() => active.socket.terminate());
        return;
      }
      active.chain = active.chain
        .then(() => this.event(active, event))
        .catch(async () => {
          active.gap = true;
          active.outcome = technicalOutcome(
            "live_event_failed",
            "Live-Ereignis konnte nicht sicher verarbeitet werden.",
          );
          await this.hangup(active.callId).catch(() => {});
          this.closeDeadline(active);
        });
    });
    socket.on("error", () => {
      active.gap = true;
    });
    socket.on("close", () => {
      if (active.greetingTimer) clearTimeout(active.greetingTimer);
      active.greetingTimer = null;
      const completion = active.chain.then(() => this.finish(active)).catch(() => {
        active.gap = true;
        console.error("voice disconnect finalization failed", active.attemptId);
      });
      if (active.media) {
        this.mediaFinalizations.add(completion);
        void completion.finally(() => this.mediaFinalizations.delete(completion));
      }
    });
  }
  private scheduleGreeting(active: ActiveCall) {
    // Keep caller audio flowing during the opening pause.
    active.greetingTimer = setTimeout(() => {
      active.greetingTimer = null;
      if (active.closed || active.mediaEnded || active.socket.readyState !== WebSocket.OPEN) return;
      this.send(active, {
        type: "session.instructions.append",
        delegation_id: null,
        content: LIVE_GREETING_INSTRUCTION,
      });
    }, 1000);
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
  private async event(active: ActiveCall, event: Record<string, unknown>) {
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
      if (active.greetingTimer) clearTimeout(active.greetingTimer);
      active.greetingTimer = null;
      if (active.stopTimer) clearTimeout(active.stopTimer);
      active.stopTimer = null;
      if (!["close_requested", "remote_hangup"].includes(String(event.reason)))
        active.gap = true;
      if (active.media && !(await active.media.finishPlayback())) active.gap = true;
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
    if (active.greetingTimer) clearTimeout(active.greetingTimer);
    active.greetingTimer = null;
    if (active.timer) clearInterval(active.timer);
    if (active.stopTimer) clearTimeout(active.stopTimer);
    this.calls.delete(active.callId);
    active.media?.close();
    const playbackPeak = active.media?.playbackBufferPeakMs?.();
    if (playbackPeak !== undefined) await this.ops.event(active.attemptId, "runtime", "media.playback_buffer_peak", "playback-peak:" + active.callId, { duration_ms: playbackPeak }).catch(() => {});
    let saved = false;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      try {
        await this.flush(active);
        const completion = await this.ops.transcript(
          active.attemptId,
          [],
          active.closed && !active.gap ? "complete" : "interrupted",
        );
        if (active.media && !completion.saved) throw new Error("transcript_finish_not_acknowledged");
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
    // Diagnostics must not delay transcript storage or outcome finalization.
    await Promise.all(Object.entries(active.media?.timingMetrics?.() || {}).map(async ([name, duration]) => {
      if (!/^[a-z_]{1,50}$/.test(name) || !Number.isFinite(duration) || duration < 0) return;
      await this.ops.event(active.attemptId, "runtime", "media.timing." + name, "media-timing:" + active.callId + ":" + name,
        { duration_ms: duration }).catch(() => {});
    }));
  }
}
