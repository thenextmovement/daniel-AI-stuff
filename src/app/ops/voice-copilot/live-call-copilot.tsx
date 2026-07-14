"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Headphones,
  HelpCircle,
  MessageSquareReply,
  Mic,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import type {
  VoiceCopilotMode,
  VoiceCopilotSpeaker,
  VoiceCopilotSuggestion,
  VoiceCopilotTranscriptTurn,
} from "@/lib/ops/voice-copilot";
import type { VoiceCustomerContext } from "@/lib/ops/voice-knowledge";
import { CustomerContextPanel } from "./customer-context-panel";

type LiveCallCopilotProps = {
  operatorName: string;
  knowledgeEnabled: boolean | null;
  enabled: boolean;
};

type LiveStatus = "idle" | "capturing" | "connecting" | "live" | "stopping" | "stopped" | "error";

type LiveTranscriptTurn = VoiceCopilotTranscriptTurn & {
  id: string;
  final: boolean;
};

const modes: Array<{ value: VoiceCopilotMode; label: string }> = [
  { value: "internal_test", label: "Interner Test" },
  { value: "lead_qualification", label: "Erstkontakt" },
  { value: "follow_up", label: "Follow-up" },
];

function statusLabel(status: LiveStatus) {
  if (status === "capturing") return "Audiofreigabe";
  if (status === "connecting") return "Verbindet";
  if (status === "live") return "Live";
  if (status === "stopping") return "Beendet";
  if (status === "stopped") return "Abgeschlossen";
  if (status === "error") return "Fehler";
  return "Bereit";
}

function suggestionStyle(kind: VoiceCopilotSuggestion["kind"]) {
  if (kind === "warning") return {
    icon: AlertTriangle,
    label: "Warnung",
    className: "border-amber-200 bg-amber-50 text-amber-950",
  };
  if (kind === "question") return {
    icon: HelpCircle,
    label: "Rueckfrage",
    className: "border-sky-200 bg-sky-50 text-sky-950",
  };
  return {
    icon: MessageSquareReply,
    label: "Antwort",
    className: "border-emerald-200 bg-emerald-50 text-emerald-950",
  };
}

function waitForIceGathering(peerConnection: RTCPeerConnection) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, 2_000);
    function done() {
      window.clearTimeout(timeout);
      peerConnection.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    }
    function handleChange() {
      if (peerConnection.iceGatheringState === "complete") done();
    }
    peerConnection.addEventListener("icegatheringstatechange", handleChange);
  });
}

export function LiveCallCopilot({ operatorName, knowledgeEnabled, enabled }: LiveCallCopilotProps) {
  const [mode, setMode] = useState<VoiceCopilotMode>("internal_test");
  const [selectedContext, setSelectedContext] = useState<VoiceCustomerContext | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [turns, setTurns] = useState<LiveTranscriptTurn[]>([]);
  const [suggestions, setSuggestions] = useState<VoiceCopilotSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const peerConnectionsRef = useRef<RTCPeerConnection[]>([]);
  const dataChannelsRef = useRef<RTCDataChannel[]>([]);
  const mediaStreamsRef = useRef<MediaStream[]>([]);
  const audioContextsRef = useRef<AudioContext[]>([]);
  const vadTimersRef = useRef<number[]>([]);
  const vadCommittersRef = useRef<Array<() => void>>([]);
  const sessionIdRef = useRef<string | null>(null);
  const turnsRef = useRef<LiveTranscriptTurn[]>([]);
  const suggestionAbortRef = useRef<AbortController | null>(null);
  const suggestionRequestRef = useRef(0);

  function appendEvent(message: string) {
    const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setEvents((current) => [`${time} ${message}`, ...current].slice(0, 12));
  }

  function setTranscript(next: LiveTranscriptTurn[]) {
    const limited = next.slice(-30);
    turnsRef.current = limited;
    setTurns(limited);
    return limited;
  }

  function upsertTranscript(input: {
    speaker: VoiceCopilotSpeaker;
    itemId: string;
    delta?: string;
    transcript?: string;
    final: boolean;
  }) {
    const id = `${input.speaker}:${input.itemId}`;
    const current = turnsRef.current;
    const existingIndex = current.findIndex((turn) => turn.id === id);
    const existing = existingIndex >= 0 ? current[existingIndex] : null;
    const text = input.transcript?.trim() || `${existing?.text || ""}${input.delta || ""}`.trim();
    if (!text) return current;
    const nextTurn: LiveTranscriptTurn = { id, speaker: input.speaker, text: text.slice(0, 1_200), final: input.final };
    const next = existingIndex >= 0
      ? current.map((turn, index) => index === existingIndex ? nextTurn : turn)
      : [...current, nextTurn];
    return setTranscript(next);
  }

  async function requestSuggestions(transcriptTurns = turnsRef.current) {
    const sessionId = sessionIdRef.current;
    const completedTurns = transcriptTurns.filter((turn) => turn.final).slice(-20);
    if (!sessionId || !completedTurns.some((turn) => turn.speaker === "customer")) return;
    suggestionAbortRef.current?.abort();
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    const requestNumber = ++suggestionRequestRef.current;
    setSuggestionsLoading(true);
    setSuggestionError(null);
    try {
      const response = await fetch("/api/ops/voice-copilot/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          turns: completedTurns.map(({ speaker, text }) => ({ speaker, text })),
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Live-Vorschlaege konnten nicht geladen werden.");
      if (requestNumber === suggestionRequestRef.current) setSuggestions(payload?.suggestions || []);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setSuggestionError(requestError instanceof Error ? requestError.message : "Live-Vorschlaege konnten nicht geladen werden.");
    } finally {
      if (requestNumber === suggestionRequestRef.current) setSuggestionsLoading(false);
    }
  }

  function bindTranscriptEvents(channel: RTCDataChannel, speaker: VoiceCopilotSpeaker) {
    channel.addEventListener("open", () => appendEvent(`${speaker === "customer" ? "Kunden" : "Mitarbeiter"}-Kanal offen.`));
    channel.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        const type = String(payload.type || "");
        const itemId = String(payload.item_id || payload.itemId || "pending");
        if (type === "conversation.item.input_audio_transcription.delta") {
          upsertTranscript({ speaker, itemId, delta: String(payload.delta || ""), final: false });
        }
        if (type === "conversation.item.input_audio_transcription.completed") {
          const next = upsertTranscript({ speaker, itemId, transcript: String(payload.transcript || ""), final: true });
          if (speaker === "customer") void requestSuggestions(next);
        }
        if (type === "error") {
          const detail = payload.error && typeof payload.error === "object"
            ? String((payload.error as Record<string, unknown>).message || "unknown")
            : "unknown";
          appendEvent(`OpenAI-Fehler (${speaker}): ${detail}`);
        }
      } catch {
        appendEvent(`Ungueltiges Realtime-Ereignis (${speaker}).`);
      }
    });
  }

  function startLocalVad(stream: MediaStream, channel: RTCDataChannel) {
    const AudioContextClass = window.AudioContext;
    const audioContext = new AudioContextClass();
    void audioContext.resume();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextsRef.current.push(audioContext);
    const samples = new Float32Array(analyser.fftSize);
    let speechStartedAt = 0;
    let lastVoiceAt = 0;

    const commit = () => {
      if (!speechStartedAt || channel.readyState !== "open") return;
      channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      speechStartedAt = 0;
      lastVoiceAt = 0;
    };
    vadCommittersRef.current.push(commit);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (rms > 0.014) {
        if (!speechStartedAt) speechStartedAt = now;
        lastVoiceAt = now;
      }
      if (speechStartedAt && ((lastVoiceAt && now - lastVoiceAt > 750) || now - speechStartedAt > 15_000)) commit();
    }, 100);
    vadTimersRef.current.push(timer);
  }

  async function createTranscriptionPeer(stream: MediaStream, speaker: VoiceCopilotSpeaker) {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error(`${speaker === "customer" ? "Kunden" : "Mitarbeiter"}-Audio fehlt.`);
    const peerConnection = new RTCPeerConnection();
    peerConnection.addTrack(track, stream);
    const channel = peerConnection.createDataChannel(`oai-${speaker}`);
    bindTranscriptEvents(channel, speaker);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    peerConnectionsRef.current.push(peerConnection);
    dataChannelsRef.current.push(channel);
    return { peerConnection, channel, sdp: peerConnection.localDescription?.sdp || offer.sdp || "" };
  }

  function cleanupMedia() {
    vadCommittersRef.current.forEach((commit) => commit());
    vadTimersRef.current.forEach((timer) => window.clearInterval(timer));
    dataChannelsRef.current.forEach((channel) => channel.close());
    peerConnectionsRef.current.forEach((peerConnection) => peerConnection.close());
    mediaStreamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    audioContextsRef.current.forEach((context) => void context.close());
    vadCommittersRef.current = [];
    vadTimersRef.current = [];
    dataChannelsRef.current = [];
    peerConnectionsRef.current = [];
    mediaStreamsRef.current = [];
    audioContextsRef.current = [];
  }

  async function finishSession(finalStatus: "completed" | "cancelled") {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    cleanupMedia();
    suggestionAbortRef.current?.abort();
    if (!sessionId) return;
    try {
      const response = await fetch("/api/ops/voice-copilot/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, status: finalStatus }),
      });
      if (!response.ok) appendEvent("Session-Audit konnte nicht abgeschlossen werden.");
    } catch {
      appendEvent("Session-Audit konnte nicht abgeschlossen werden.");
    }
  }

  async function stopSession() {
    if (!["capturing", "connecting", "live"].includes(status)) return;
    setStatus("stopping");
    vadCommittersRef.current.forEach((commit) => commit());
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    await finishSession("completed");
    setStatus("stopped");
    appendEvent("Live-Copilot beendet. Transkript wurde nicht serverseitig gespeichert.");
  }

  async function startSession() {
    setError(null);
    setSuggestionError(null);
    setSuggestions([]);
    setTranscript([]);
    setEvents([]);
    if (!enabled) {
      setError("Live-Copilot ist ueber das Betriebs-Flag deaktiviert.");
      return;
    }
    if (!knowledgeEnabled) {
      setError("Wissenssystem und Session-Audit muessen aktiviert sein.");
      return;
    }
    if (!operatorName.trim()) {
      setError("Mitarbeitername fehlt.");
      return;
    }
    if (mode !== "internal_test" && !selectedContext) {
      setError("Kundenvorgang muss ausgewaehlt sein.");
      return;
    }
    if (!consentConfirmed) {
      setError("Die aktive Einwilligung zur Live-Transkription muss bestaetigt sein.");
      return;
    }

    try {
      setStatus("capturing");
      appendEvent("Kunden-Audio wird angefragt.");
      const customerStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const customerAudio = customerStream.getAudioTracks()[0];
      if (!customerAudio) {
        customerStream.getTracks().forEach((track) => track.stop());
        throw new Error("Die ausgewaehlte Quelle liefert kein Audio. Im Freigabedialog muss Audio aktiviert sein.");
      }
      customerStream.getVideoTracks().forEach((track) => { track.enabled = false; });
      const operatorStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamsRef.current = [customerStream, operatorStream];

      setStatus("connecting");
      const customerPeer = await createTranscriptionPeer(customerStream, "customer");
      const operatorPeer = await createTranscriptionPeer(operatorStream, "operator");
      const response = await fetch("/api/ops/voice-copilot/transcription-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerSdp: customerPeer.sdp,
          operatorSdp: operatorPeer.sdp,
          mode,
          operatorName,
          requestId: selectedContext?.requestId || null,
          consentStatus: mode === "internal_test" ? "not_required_internal" : "confirmed",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Transkriptionssessions konnten nicht gestartet werden.");
      sessionIdRef.current = String(payload.sessionId || "") || null;
      await customerPeer.peerConnection.setRemoteDescription({ type: "answer", sdp: payload.customerSdp });
      await operatorPeer.peerConnection.setRemoteDescription({ type: "answer", sdp: payload.operatorSdp });
      startLocalVad(customerStream, customerPeer.channel);
      startLocalVad(operatorStream, operatorPeer.channel);
      setStatus("live");
      appendEvent("Beide Transkriptionskanaele sind live.");
    } catch (startError) {
      const message = startError instanceof Error ? startError.message : "Live-Copilot konnte nicht gestartet werden.";
      setError(message);
      appendEvent(`Fehler: ${message}`);
      await finishSession("cancelled");
      setStatus("error");
    }
  }

  useEffect(() => () => {
    suggestionAbortRef.current?.abort();
    cleanupMedia();
  }, []);

  const isBusy = ["capturing", "connecting", "live", "stopping"].includes(status);
  const canStart = enabled
    && knowledgeEnabled === true
    && operatorName.trim().length >= 2
    && consentConfirmed
    && (mode === "internal_test" || Boolean(selectedContext));

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-stone-500">Human-in-the-loop</p>
            <h2 className="mt-1 text-lg font-semibold text-stone-950">Live-Gespraechsbegleitung</h2>
          </div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
            <span className={`h-2.5 w-2.5 rounded-full ${status === "live" ? "bg-emerald-500" : status === "error" ? "bg-rose-500" : "bg-stone-300"}`} />
            {!enabled ? "Deaktiviert" : knowledgeEnabled === false ? "Wissen aus" : statusLabel(status)}
          </div>
        </div>

        {!enabled ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Live-Copilot ist ueber das Betriebs-Flag deaktiviert.
          </div>
        ) : knowledgeEnabled === false ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Wissenssystem und Session-Audit sind nicht aktiviert.
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(320px,1.2fr)]">
          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <span className="text-xs font-semibold uppercase text-stone-500">Gespraechstyp</span>
              <div className="inline-flex w-full rounded-lg border border-stone-200 bg-stone-50 p-1" role="group" aria-label="Gespraechstyp">
                {modes.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => {
                      setMode(entry.value);
                      if (entry.value === "internal_test") setSelectedContext(null);
                    }}
                    disabled={isBusy}
                    className={`min-h-9 flex-1 rounded-md px-2 text-sm font-semibold ${mode === entry.value ? "bg-stone-950 text-white" : "text-stone-600 hover:bg-white"}`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            {mode !== "internal_test" ? (
              <CustomerContextPanel selected={selectedContext} disabled={isBusy} onSelect={setSelectedContext} />
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Kein Kundenvorgang gebunden.
              </div>
            )}

            <label className="flex items-start gap-3 rounded-lg border border-stone-200 p-3 text-sm text-stone-800">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                disabled={isBusy}
                className="mt-0.5 h-4 w-4"
              />
              <span>Die aktive Einwilligung zur Live-Transkription wurde erteilt.</span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void startSession()}
                disabled={!canStart || isBusy}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Headphones className="h-4 w-4" /> Kunden-Audio teilen
              </button>
              <button
                type="button"
                onClick={() => void stopSession()}
                disabled={!(["capturing", "connecting", "live"] as LiveStatus[]).includes(status)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Square className="h-4 w-4" /> Stop
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-stone-500">
              <Mic className="h-4 w-4" /> Mikrofon und geteiltes Kunden-Audio werden getrennt verarbeitet.
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-stone-500" />
                <h3 className="text-sm font-semibold text-stone-950">Live-Transkript</h3>
              </div>
              {status === "stopped" || status === "error" ? (
                <button
                  type="button"
                  title="Transkript verwerfen"
                  onClick={() => {
                    setTranscript([]);
                    setSuggestions([]);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:text-stone-950"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="min-h-72 max-h-[440px] overflow-y-auto rounded-lg border border-stone-200 bg-stone-50 p-3" aria-live="polite">
              {turns.length ? (
                <div className="grid gap-3">
                  {turns.map((turn) => (
                    <div key={turn.id} className="grid gap-1">
                      <span className="text-xs font-semibold uppercase text-stone-500">
                        {turn.speaker === "customer" ? "Kunde" : "Mitarbeiter"}
                      </span>
                      <p className={`text-sm leading-6 text-stone-900 ${turn.final ? "" : "opacity-60"}`}>{turn.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 items-center justify-center text-sm text-stone-400">Noch kein Sprachsegment.</div>
              )}
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-stone-500">Nur fuer den Mitarbeiter</p>
              <h2 className="mt-1 text-base font-semibold text-stone-950">Antwortvorschlaege</h2>
            </div>
            <button
              type="button"
              title="Vorschlaege aktualisieren"
              onClick={() => void requestSuggestions()}
              disabled={suggestionsLoading || !turns.some((turn) => turn.final && turn.speaker === "customer") || !sessionIdRef.current}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 text-stone-500 hover:text-stone-950 disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${suggestionsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
          {suggestionError ? <p className="mb-3 text-sm text-rose-700">{suggestionError}</p> : null}
          <div className="grid gap-3" aria-live="polite">
            {suggestions.length ? suggestions.map((suggestion, index) => {
              const style = suggestionStyle(suggestion.kind);
              const Icon = style.icon;
              return (
                <article key={`${suggestion.kind}-${index}`} className={`grid gap-2 rounded-lg border p-3 ${style.className}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase">
                      <Icon className="h-4 w-4" /> {style.label}
                    </span>
                    <span className="text-xs tabular-nums">{Math.round(suggestion.confidence * 100)}%</span>
                  </div>
                  <p className="text-sm font-semibold leading-6">{suggestion.text}</p>
                  <p className="text-xs leading-5 opacity-75">{suggestion.reason}</p>
                  {suggestion.sourceLabels.length ? <p className="text-xs opacity-70">Quelle: {suggestion.sourceLabels.join(", ")}</p> : null}
                </article>
              );
            }) : (
              <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-stone-200 text-sm text-stone-400">
                {suggestionsLoading ? "Vorschlaege werden erstellt..." : "Wartet auf einen Kundenbeitrag."}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-stone-950">Session</h2>
          </div>
          <div className="grid gap-2 text-xs leading-5 text-stone-600">
            {events.length ? events.map((event) => <p key={event}>{event}</p>) : <p>Noch nicht gestartet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
