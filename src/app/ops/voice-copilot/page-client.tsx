"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, Headphones, Mic, ShieldCheck, Square, WandSparkles } from "lucide-react";
import type { VoiceCopilotMode } from "@/lib/ops/voice-copilot";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass, OpsStatCard } from "../ops-design";

type VoiceCopilotClientProps = {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
};

type SessionStatus = "idle" | "connecting" | "live" | "stopped" | "error";

const modeOptions: Array<{
  mode: VoiceCopilotMode;
  label: string;
  objective: string;
  firstInstruction: string;
  suggestions: string[];
}> = [
  {
    mode: "internal_test",
    label: "Interner Test",
    objective: "Stimme, Latenz und Unterbrechungsverhalten pruefen.",
    firstInstruction: "Begruesse Daniel kurz und frage, ob Stimme, Latenz und Unterbrechungsverhalten natuerlich wirken.",
    suggestions: [
      "Antworten kuerzer machen, wenn der Kunde schnell spricht.",
      "Nachfragen, ob die Stimme natuerlich genug wirkt.",
      "Unterbrechung testen: Daniel kann mitten im Satz sprechen.",
    ],
  },
  {
    mode: "lead_qualification",
    label: "Lead-Qualifikation",
    objective: "Bedarf, Einsatz, grobe Spezifikation und naechsten Schritt klaeren.",
    firstInstruction:
      "Begruesse Daniel als Testkunden und frage zuerst, was auf dem Schild stehen soll oder welches Logo/Motiv geplant ist.",
    suggestions: [
      "Klaere Text, Logo oder Motiv.",
      "Klaere Einsatzort, grobe Groesse und Innen/Aussen.",
      "Klaere Farbe, Lichtwirkung und ob ein Rueckruf oder Angebot gewuenscht ist.",
    ],
  },
  {
    mode: "follow_up",
    label: "Follow-up",
    objective: "Interesse, Einwaende und naechsten Schritt nach Angebot klaeren.",
    firstInstruction:
      "Begruesse Daniel als Testkunden und frage freundlich, ob das Angebot noch interessant ist oder ob etwas offen ist.",
    suggestions: [
      "Frage, ob die Angebotsrichtung grundsaetzlich passt.",
      "Klaere den konkreten Blocker: Preis, Design, Timing oder interne Freigabe.",
      "Biete menschliche Pruefung an, statt Preise oder Termine zu versprechen.",
    ],
  },
];

const guardrails = [
  "Keine Preise, Rabatte oder Kulanzzusagen.",
  "Keine Liefertermine, Produktionsstarts oder Versandzusagen.",
  "Keine Zahlungsforderungen oder Mahnungen im Copilot-Test.",
  "Trello ist keine Source of Truth.",
];

function statusLabel(status: SessionStatus) {
  switch (status) {
    case "connecting":
      return "Verbindet";
    case "live":
      return "Live";
    case "stopped":
      return "Gestoppt";
    case "error":
      return "Fehler";
    default:
      return "Bereit";
  }
}

function logLine(message: string) {
  return `${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${message}`;
}

export function VoiceCopilotClient({ initialHasSession, opsEnabled }: VoiceCopilotClientProps) {
  const operatorNameKey = "neontrip-voice-copilot-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [operatorName, setOperatorName] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<VoiceCopilotMode>("internal_test");
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [requestSummary, setRequestSummary] = useState("");
  const [knownInterest, setKnownInterest] = useState("LED-Neonschild / Leuchtreklame");
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const selectedMode = useMemo(() => modeOptions.find((entry) => entry.mode === mode) || modeOptions[0], [mode]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (!operatorName) return;
    try {
      window.localStorage.setItem(operatorNameKey, operatorName);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, [operatorName]);

  function appendEvent(message: string) {
    setEvents((current) => [logLine(message), ...current].slice(0, 30));
  }

  async function stopSession() {
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    dataChannelRef.current = null;
    peerConnectionRef.current = null;
    mediaStreamRef.current = null;
    setStatus("stopped");
    appendEvent("Session beendet.");
  }

  async function startSession() {
    setError(null);
    setStatus("connecting");
    appendEvent("Mikrofon wird angefragt.");

    try {
      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      peerConnection.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        appendEvent("Audio-Ausgabe verbunden.");
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = mediaStream;
      peerConnection.addTrack(mediaStream.getTracks()[0]!, mediaStream);

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.addEventListener("open", () => {
        appendEvent("Realtime-Datenkanal offen.");
        dataChannel.send(JSON.stringify({
          type: "response.create",
          response: {
            instructions: selectedMode.firstInstruction,
          },
        }));
      });
      dataChannel.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "response.done") appendEvent("Antwort abgeschlossen.");
          if (payload.type === "input_audio_buffer.speech_started") appendEvent("Sprache erkannt.");
          if (payload.type === "error") appendEvent(`OpenAI Fehler: ${payload.error?.message || "unknown"}`);
        } catch {
          appendEvent(String(event.data));
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      appendEvent("SDP wird serverseitig an OpenAI gesendet.");

      const response = await fetch("/api/ops/voice-copilot/realtime-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sdp: offer.sdp,
          mode,
          requestSummary,
          knownInterest,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Realtime-Session konnte nicht gestartet werden.");
      }
      await peerConnection.setRemoteDescription({ type: "answer", sdp: await response.text() });
      setStatus("live");
      appendEvent("Session live.");
    } catch (sessionError) {
      const message = sessionError instanceof Error ? sessionError.message : "Unbekannter Fehler.";
      setError(message);
      setStatus("error");
      appendEvent(`Fehler: ${message}`);
      await stopSession();
      setStatus("error");
    }
  }

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError("Ops-Login fehlgeschlagen.");
      return;
    }
    setHasSession(true);
    setToken("");
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession) {
    return (
      <OpsLoginCard
        eyebrow="Voice Copilot"
        title="Voice Copilot anmelden"
        description="Melde dich fuer interne Realtime-Call-Assistenz, Lead-Qualifikation und Knowledge-Review an."
        activeApp="voiceCopilot"
        operatorName={operatorName}
        password={token}
        error={error}
        buttonLabel="Einloggen"
        onOperatorNameChange={setOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} grid gap-5 px-4 py-5 md:px-6`}>
        <OpsPageHeader active="voiceCopilot" label="Voice Copilot" />

        <OpsPageIntro
          eyebrow="Realtime Sales Assist"
          title="Voice Copilot"
          description="Interner gpt-realtime-2.1 Test fuer Live-Gespraechshilfe, Follow-up-Qualifikation und Knowledge-Kandidaten."
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-3 py-2 text-sm text-white/80">
            <Headphones className="h-4 w-4" />
            {statusLabel(status)}
          </div>
        </OpsPageIntro>

        <section className="grid gap-4 md:grid-cols-3">
          <OpsStatCard label="Modus" value={selectedMode.label} tone="info" icon={<BrainCircuit className="h-5 w-5" />} detail={selectedMode.objective} />
          <OpsStatCard label="Modell" value="2.1" tone="success" icon={<CheckCircle2 className="h-5 w-5" />} detail="Direkter OpenAI Realtime WebRTC-Pfad" />
          <OpsStatCard label="Freigabe" value="intern" tone="warning" icon={<ShieldCheck className="h-5 w-5" />} detail="Keine autonome Kundenkommunikation" />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <div className="grid gap-4 rounded-[18px] border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
            <div className="grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" htmlFor="mode">
                Modus
              </label>
              <select
                id="mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as VoiceCopilotMode)}
                disabled={status === "connecting" || status === "live"}
                className="min-h-11 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none focus:border-stone-500"
              >
                {modeOptions.map((entry) => (
                  <option key={entry.mode} value={entry.mode}>{entry.label}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" htmlFor="knownInterest">
                Interesse
              </label>
              <input
                id="knownInterest"
                value={knownInterest}
                onChange={(event) => setKnownInterest(event.target.value)}
                className="min-h-11 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none focus:border-stone-500"
              />
            </div>

            <div className="grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500" htmlFor="requestSummary">
                Kontext
              </label>
              <textarea
                id="requestSummary"
                value={requestSummary}
                onChange={(event) => setRequestSummary(event.target.value)}
                placeholder="Optionaler Testkontext fuer Lead oder Follow-up"
                className="min-h-28 resize-y rounded-lg border border-stone-200 bg-white px-3 py-3 text-sm text-stone-900 outline-none focus:border-stone-500"
              />
            </div>

            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startSession}
                disabled={status === "connecting" || status === "live"}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Mic className="h-4 w-4" />
                Start
              </button>
              <button
                type="button"
                onClick={stopSession}
                disabled={status !== "connecting" && status !== "live"}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Square className="h-4 w-4" />
                Stop
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            <section className="rounded-[18px] border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
              <div className="mb-4 flex items-center gap-2">
                <WandSparkles className="h-5 w-5 text-stone-500" />
                <h2 className="text-base font-semibold text-stone-950">Live-Vorschlaege</h2>
              </div>
              <div className="grid gap-2">
                {selectedMode.suggestions.map((suggestion) => (
                  <div key={suggestion} className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-sm leading-5 text-stone-700">
                    {suggestion}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[18px] border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-stone-500" />
                <h2 className="text-base font-semibold text-stone-950">Guardrails</h2>
              </div>
              <div className="grid gap-2">
                {guardrails.map((guardrail) => (
                  <div key={guardrail} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
                    {guardrail}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="rounded-[18px] border border-stone-200 bg-white p-5 shadow-[0_12px_32px_rgba(20,16,12,0.06)]">
          <h2 className="mb-3 text-base font-semibold text-stone-950">Session-Log</h2>
          <div className="min-h-32 rounded-lg border border-stone-100 bg-stone-50 p-3 text-sm leading-6 text-stone-700">
            {events.length ? events.map((entry) => <p key={entry}>{entry}</p>) : <p className="text-stone-400">Noch keine Session gestartet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
