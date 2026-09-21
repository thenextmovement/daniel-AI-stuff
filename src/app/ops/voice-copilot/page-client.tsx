"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { LIVE_GREETING_INSTRUCTION } from "../../../../services/voice-runtime/live-protocol";
import type { VoiceCopilotMode, VoiceCopilotSuggestion } from "@/lib/ops/voice-copilot";
import type { VoiceCustomerContext } from "@/lib/ops/voice-knowledge";
import { OpsLoginCard } from "../ops-login-card";
import { KnowledgePanel } from "./knowledge-panel";
import { LiveCallCopilot } from "./live-call-copilot";
import { VoiceTranscriptBuffer } from "@/lib/ops/voice-transcript-buffer";
import { PhoneCentral } from "./phone-central";
import styles from "./phone-central.module.css";
import { VoicePlatformPanel } from "./voice-platform-panel";

type VoiceCopilotClientProps = {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
  liveCopilotEnabled: boolean;
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
    firstInstruction: "Wenn ein gebundener Kundenkontext vorliegt, simuliere dessen konkreten Anlass; sonst nenne den vereinbarten Sprachtest. Frage nicht direkt nach einer Qualitaetsbewertung.",
    suggestions: [
      "Antworten kuerzer machen, wenn der Kunde schnell spricht.",
      "Nachfragen, ob die Stimme natuerlich genug wirkt.",
      "Unterbrechung testen: Die Testperson kann mitten im Satz sprechen.",
    ],
  },
  {
    mode: "lead_qualification",
    label: "Lead-Qualifikation",
    objective: "Bedarf, Einsatz, grobe Spezifikation und naechsten Schritt klaeren.",
    firstInstruction:
      "Nenne die konkrete gebundene Anfrage als Anlass; frage anschliessend, ob dazu noch Fragen offen sind.",
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
      "Nenne das konkrete gebundene Angebot als Anlass; frage anschliessend, ob dazu noch Fragen offen sind.",
    suggestions: [
      "Frage, ob die Angebotsrichtung grundsaetzlich passt.",
      "Klaere den konkreten Blocker: Preis, Design, Timing oder interne Freigabe.",
      "Biete menschliche Pruefung an, statt Preise oder Termine zu versprechen.",
    ],
  },
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

export function VoiceCopilotClient({ initialHasSession, opsEnabled, liveCopilotEnabled }: VoiceCopilotClientProps) {
  const [linkedTranscript, setLinkedTranscript] = useState<string | null>(null);
  useEffect(() => { setLinkedTranscript(new URLSearchParams(window.location.search).get("transcript")); }, []);
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
  const [workspace, setWorkspace] = useState<"prepare" | "assist" | "live">("prepare");
  const [humanBusy, setHumanBusy] = useState(false);
  const [copilotHints,setCopilotHints] = useState<VoiceCopilotSuggestion[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<Array<{id:string;speaker:string;text:string}>>([]);
  const [storageConsent, setStorageConsent] = useState(false);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState<boolean | null>(null);
  const [selectedContext, setSelectedContext] = useState<VoiceCustomerContext | null>(null);
  const [consentStatus, setConsentStatus] = useState<"pending" | "confirmed" | "declined">("pending");
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const voiceSessionIdRef = useRef<string | null>(null);
  const transcriptTokenRef = useRef("");
  const transcriptBufferRef = useRef<VoiceTranscriptBuffer | null>(null);
  const closedRef = useRef(false);
  const stoppingRef = useRef(false);
  const [transcriptSaveStatus, setTranscriptSaveStatus] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (transcriptBufferRef.current?.size) void transcriptBufferRef.current.flush().then(
        () => setTranscriptSaveStatus("Transkript gespeichert"),
        () => setTranscriptSaveStatus("Speicherung ausstehend – Seite offen lassen"),
      );
    }, 1000);
    const warn = (event: BeforeUnloadEvent) => {
      if (voiceSessionIdRef.current || transcriptBufferRef.current?.size) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { window.clearInterval(timer); window.removeEventListener("beforeunload", warn); };
  }, []);

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

  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    void fetch("/api/ops/voice-copilot/knowledge", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Wissensstatus konnte nicht geladen werden.");
        return payload;
      })
      .then((payload) => { if (!cancelled) setKnowledgeEnabled(Boolean(payload?.enabled)); })
      .catch((loadError) => {
        if (cancelled) return;
        setKnowledgeEnabled(null);
        setError(loadError instanceof Error ? loadError.message : "Wissensstatus konnte nicht geladen werden.");
      });
    return () => { cancelled = true; };
  }, [hasSession]);

  function appendEvent(message: string) {
    setEvents((current) => [logLine(message), ...current].slice(0, 30));
  }

  async function stopSession() {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (dataChannelRef.current?.readyState === "open" && !closedRef.current) {
      dataChannelRef.current.send(JSON.stringify({ type: "session.close" }));
      const deadline = Date.now() + 8_000;
      while (!closedRef.current && Date.now() < deadline) await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    dataChannelRef.current?.close();
    peerConnectionRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    dataChannelRef.current = null;
    peerConnectionRef.current = null;
    mediaStreamRef.current = null;
    const finishedSessionId = voiceSessionIdRef.current;
    if (finishedSessionId) {
      try {
        await transcriptBufferRef.current?.flush();
        const response = await fetch("/api/ops/voice-copilot/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-voice-session-token": transcriptTokenRef.current },
          body: JSON.stringify({ sessionId: finishedSessionId, status: closedRef.current ? "completed" : "cancelled" }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("save_failed");
        voiceSessionIdRef.current = null;
        transcriptTokenRef.current = "";
        setTranscriptSaveStatus(closedRef.current ? "Telefontranskript gespeichert" : "Gespeichert – Verbindung wurde unterbrochen");
      } catch {
        setTranscriptSaveStatus("Abschluss noch nicht gespeichert – Stop erneut drücken");
      }
    }
    setStatus("stopped");
    appendEvent("Session beendet.");
    stoppingRef.current = false;
  }

  async function startSession() {
    if (voiceSessionIdRef.current || transcriptBufferRef.current?.size) {
      setError("Vorheriges Gespräch zuerst mit Stop abschließen."); return;
    }
    if (!storageConsent) { setError("Bitte der Transkriptspeicherung zustimmen."); return; }
    setLiveTranscript([]);
    closedRef.current = false;
    transcriptBufferRef.current = new VoiceTranscriptBuffer(async (segments) => {
      if (!voiceSessionIdRef.current || !transcriptTokenRef.current) throw new Error("session_not_ready");
      const response = await fetch("/api/ops/voice-copilot/transcript", {
        method: "POST", headers: { "content-type": "application/json", "x-voice-session-token": transcriptTokenRef.current },
        body: JSON.stringify({ sessionId: voiceSessionIdRef.current, segments }), signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.saved) throw new Error("save_failed");
    });
    setError(null);
    setStatus("connecting");
    appendEvent("Mikrofon wird angefragt.");

    try {
      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;
      peerConnection.addEventListener("connectionstatechange", () => {
        if (peerConnection.connectionState === "failed" && !stoppingRef.current) {
          closedRef.current = false;
          setError("Audioverbindung unterbrochen. Das bisherige Transkript wird gespeichert.");
          void stopSession();
        }
      });

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
      dataChannel.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "session.started") {
            setStatus("live");
            dataChannel.send(JSON.stringify({
              type: "session.instructions.append", event_id: crypto.randomUUID(), delegation_id: null,
              content: LIVE_GREETING_INSTRUCTION + " " + selectedMode.firstInstruction,
            }));
          }
          if (payload.type === "session.closed") { closedRef.current = ["close_requested", "remote_hangup"].includes(String(payload.reason)); dataChannelRef.current = null; void stopSession(); }
          if (["session.input_transcript.delta", "session.output_transcript.delta"].includes(payload.type) && typeof payload.delta === "string" && payload.delta.length) {
            const fragmentId = String(payload.event_id || crypto.randomUUID());
            setLiveTranscript(current => current.some(fragment => fragment.id === fragmentId) ? current : [...current, {id:fragmentId,speaker:payload.type === "session.input_transcript.delta" ? "Du" : "KI-Assistent",text:payload.delta}].slice(-200));
            transcriptBufferRef.current?.stage({
              id: fragmentId,
              speaker: payload.type === "session.input_transcript.delta" ? "operator" : "assistant",
              text: payload.delta, revision: 1, final: true,
              startMs: payload.start_ms, endMs: payload.end_ms,
            });
            setTranscriptSaveStatus("Speichert …");
          }
          if (payload.type === "error") appendEvent("GPT-Live meldet einen Verbindungsfehler.");
        } catch { appendEvent("Ungültiges Live-Ereignis."); }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      if (peerConnection.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => { peerConnection.removeEventListener("icegatheringstatechange", changed); reject(new Error("Audioverbindung konnte nicht vorbereitet werden.")); }, 10_000);
          function changed() { if (peerConnection.iceGatheringState === "complete") { window.clearTimeout(timer); peerConnection.removeEventListener("icegatheringstatechange", changed); resolve(); } }
          peerConnection.addEventListener("icegatheringstatechange", changed);
          changed();
        });
      }
      appendEvent("Audioverbindung wird vorbereitet.");

      const response = await fetch("/api/ops/voice-copilot/realtime-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sdp: peerConnection.localDescription?.sdp,
          mode,
          requestSummary,
          knownInterest,
          operatorName,
          requestId: selectedContext?.requestId || null,
          consentStatus: mode === "internal_test" ? "not_required_internal" : consentStatus,
          transcriptStorageConsent: storageConsent,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Realtime-Session konnte nicht gestartet werden.");
      }
      voiceSessionIdRef.current = response.headers.get("x-neontrip-voice-session-id");
      transcriptTokenRef.current = response.headers.get("x-neontrip-transcript-token") || "";
      await peerConnection.setRemoteDescription({ type: "answer", sdp: await response.text() });
      appendEvent("GPT-Live-Verbindung vorbereitet.");
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

  const busy = status === "connecting" || status === "live" || humanBusy || Boolean(voiceSessionIdRef.current);
  return <PhoneCentral operatorName={operatorName} onOperatorNameChange={setOperatorName}
    selected={selectedContext} onSelect={context => { setSelectedContext(context); setCopilotHints([]); }} busy={busy} status={statusLabel(status)}
    workspace={workspace} onWorkspaceChange={setWorkspace} hints={copilotHints} linkedTranscript={linkedTranscript}
    settings={<div className="grid gap-8"><VoicePlatformPanel operatorName={operatorName}/><KnowledgePanel operatorName={operatorName}/></div>}>
    <div hidden={workspace !== "assist"}>
      <LiveCallCopilot operatorName={operatorName} knowledgeEnabled={knowledgeEnabled} enabled={liveCopilotEnabled} boundCustomer={selectedContext} onBusyChange={setHumanBusy} onSuggestionsChange={setCopilotHints}/>
    </div>
    <div hidden={workspace !== "live"}>
      <p className={styles.small}>Sprich hier selbst mit der KI. Es wird keine Telefonnummer angerufen. Ein ausgewählter Kunde dient als Testkontext; der Test erscheint nicht in seiner Gesprächshistorie.</p>
      <label className={styles.field}>Auftrag und Zusatzinformationen für die KI
        <textarea value={requestSummary} maxLength={1200} disabled={busy} onChange={e=>setRequestSummary(e.target.value)} placeholder="Zum Beispiel: Frag nach, ob die Lieferadresse richtig ist. Frage bei Unklarheiten nach und ändere keine Kundendaten."/>
      </label>
      <label className={styles.tone}><input type="checkbox" checked={storageConsent} disabled={busy} onChange={e=>setStorageConsent(e.target.checked)}/>Ich stimme der Speicherung dieses Testtranskripts zu.</label>
      {error?<p role="alert" className={styles.error}>{error}</p>:null}
      <div className={styles.actions}>
        <button className={styles.button+" "+styles.primary} onClick={()=>void startSession()} disabled={busy || knowledgeEnabled!==true || !storageConsent || operatorName.trim().length<2}><Mic size={17}/>KI-Test starten</button>
        <button className={styles.button} onClick={()=>void stopSession()} disabled={!voiceSessionIdRef.current && status!=="connecting" && status!=="live"}><Square size={17}/>Beenden / Abschluss speichern</button>
      </div>
      {transcriptSaveStatus?<p role="status" className={styles.small}>{transcriptSaveStatus}</p>:null}
      {liveTranscript.length?<div className={styles.transcript} aria-label="Live-Transkript">{liveTranscript.map(fragment=><p key={fragment.id}><strong>{fragment.speaker}: </strong>{fragment.text}</p>)}</div>:null}
      <details className="mt-5"><summary className={styles.small}>Verbindungsverlauf</summary>{events.map((entry,i)=><p key={i} className={styles.small}>{entry}</p>)}</details>
    </div>
  </PhoneCentral>;
}
