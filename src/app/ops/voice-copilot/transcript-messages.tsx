"use client";
import { useState } from "react";
import styles from "./phone-central.module.css";

type Passage = { source_item_id: string; speaker: string; text: string; is_final: boolean; start_ms: number };
type Voice = "speaker_1" | "speaker_2";

function isVoice(value: unknown): value is Voice {
  return value === "speaker_1" || value === "speaker_2";
}

// Mixed Placetel audio has anonymous voice IDs. An explicit statement on behalf
// of the company is evidence for a role; the order of speaking is not.
function inferEmployee(passages: Passage[]) {
  const evidence = passages.filter(p => isVoice(p.speaker) &&
    /(?:bei uns (?:eine? |die |ihre )?(?:anfrage gestellt|bestellung aufgegeben)|(?:hier (?:ist|spricht)|sie sprechen mit) (?:der (?:firma|kundenbetreuung) )?neon\s*tri?p|wir (?:haben|bearbeiten) ihre (?:anfrage|bestellung))/i.test(p.text));
  const voices = new Set(evidence.map(p => p.speaker));
  return voices.size === 1 ? evidence[0].speaker : null;
}

export function TranscriptMessages({sessionId, employee, passages}: {
  sessionId: string; employee: string; passages: Passage[];
}) {
  const storageKey = "ops-transcript-employee-" + sessionId;
  const [choice, setChoice] = useState<Voice | null>(() => {
    try { const stored = localStorage.getItem(storageKey); return isVoice(stored) ? stored : null; }
    catch { return null; }
  });
  function choose(voice: Voice) {
    setChoice(voice);
    try { localStorage.setItem(storageKey, voice); } catch { /* Choice still applies for this view. */ }
  }
  const employeeVoice = choice || inferEmployee(passages);
  const mixed = passages.some(p => isVoice(p.speaker));
  return <div className={styles.transcriptMessages}>
    {mixed && <details className={styles.roleChoice}><summary>{choice ? "Sprecherzuordnung ändern" : employeeVoice ? "Sprecherzuordnung prüfen" : "Mitarbeiterstimme zuordnen"}</summary>
      <p>{choice ? "Zuordnung auf diesem Gerät gespeichert." : employeeVoice ? "Rollen aus dem Gesprächswortlaut abgeleitet." : "Die Aufnahme enthält keine eindeutige Rollenangabe."}</p>
      {(["speaker_1","speaker_2"] as const).map(voice => {
        const example = passages.find(p => p.speaker === voice);
        return example && <button key={voice} type="button" className={styles.button} aria-pressed={employeeVoice === voice} onClick={() => choose(voice)}>
          {employee || "Mitarbeiter"} sagt „{example.text}“
        </button>;
      })}
    </details>}
    {passages.map(p => {
      const role = isVoice(p.speaker) && employeeVoice ? (p.speaker === employeeVoice ? "operator" : "customer") : p.speaker;
      const label = role === "operator" ? (employee || "Mitarbeiter") : role === "customer" ? "Kunde" : role === "assistant" ? "KI-Assistent" : "Stimme " + (p.speaker === "speaker_2" ? "B" : p.speaker === "speaker_1" ? "A" : "unbekannt");
      const side = role === "operator" || role === "assistant" ? "outbound" : role === "customer" ? "inbound" : "unknown";
      return <div key={p.source_item_id} className={styles.historyMessage} data-kind={side}>
        <small><strong>{label}</strong> · {Math.floor(p.start_ms / 60000)}:{String(Math.floor(p.start_ms / 1000) % 60).padStart(2,"0")}{p.is_final ? "" : " · vorläufig"}</small>
        <p>{p.text}</p>
      </div>;
    })}
  </div>;
}
