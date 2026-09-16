"use client";
import { useEffect, useRef, useState } from "react";
import type { VoiceHistoryEntry } from "@/lib/ops/voice-history";

type Transcript = {
  session: VoiceHistoryEntry;
  segments: Array<{
    source_item_id: string;
    speaker: string;
    text: string;
    is_final: boolean;
    start_ms: number;
  }>;
  nextOffset: number | null;
};
export function VoiceHistoryPanel({
  requestId,
  initialSessionId,
}: {
  requestId?: string;
  initialSessionId?: string;
}) {
  const [entries, setEntries] = useState<VoiceHistoryEntry[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  async function read(url: string) {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok)
      throw new Error("Gesprächshistorie ist gerade nicht erreichbar.");
    return data;
  }
  async function loadHistory(offset = 0) {
    const current = generation.current;
    try {
      const data = await read(
        "/api/ops/voice-copilot/transcript?requestId=" +
          encodeURIComponent(requestId || "") +
          "&offset=" +
          offset,
      );
      if (current !== generation.current) return;
      setEntries((old) => (offset ? [...old, ...data.entries] : data.entries));
      setNextOffset(data.nextOffset);
      setError("");
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "Historie nicht erreichbar.");
    }
  }
  async function open(id: string, offset = 0) {
    const current = generation.current,
      detail = ++detailGeneration.current;
    try {
      const data: Transcript = await read(
        "/api/ops/voice-copilot/transcript?sessionId=" +
          encodeURIComponent(id) +
          "&offset=" +
          offset,
      );
      if (current !== generation.current) return;
      if (detail !== detailGeneration.current) return;
      setTranscript((old) =>
        offset && old?.session.id === id
          ? { ...data, segments: [...old.segments, ...data.segments] }
          : data,
      );
      setError("");
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "Transkript nicht erreichbar.",
        );
    }
  }
  useEffect(() => {
    generation.current += 1;
    setEntries([]);
    setTranscript(null);
    setError("");
    if (requestId) void loadHistory();
    if (initialSessionId) void open(initialSessionId);
    return () => {
      generation.current += 1;
    };
  }, [requestId, initialSessionId]);
  return (
    <section className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex justify-between gap-3">
        <h3 className="font-semibold text-stone-950">Bisherige Telefonate</h3>
        {requestId ? (
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="text-xs underline"
          >
            Aktualisieren
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-amber-800">
          {error}
        </p>
      ) : null}
      {!entries.length && !error && !initialSessionId ? (
        <p className="text-sm text-stone-500">
          Noch kein gespeichertes Telefontranskript zu diesem Vorgang.
        </p>
      ) : null}
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.id}
          onClick={() => void open(entry.id)}
          className="rounded-lg border border-stone-200 p-3 text-left hover:bg-stone-50"
        >
          <span className="block text-sm font-semibold">
            {entry.startedAt
              ? new Date(entry.startedAt).toLocaleString("de-DE")
              : "Gesprächszeit fehlt"}{" "}
            · {entry.operatorName}
          </span>
          <span className="mt-1 block text-xs text-stone-500">
            {entry.captureStatus === "complete"
              ? "Transkript abgeschlossen"
              : "Transkript teilweise / noch laufend"}
          </span>
          {entry.summary ? (
            <span className="mt-2 block text-sm">{entry.summary}</span>
          ) : null}
        </button>
      ))}
      {nextOffset !== null ? (
        <button
          type="button"
          className="text-left text-sm underline"
          onClick={() => void loadHistory(nextOffset)}
        >
          Ältere Telefonate laden
        </button>
      ) : null}
      {transcript ? (
        <article className="grid gap-3 border-t border-stone-200 pt-3">
          <div className="flex justify-between gap-2">
            <h4 className="text-sm font-semibold">
              Telefontranskript ·{" "}
              {transcript.session.startedAt
                ? new Date(transcript.session.startedAt).toLocaleString("de-DE")
                : "Datum fehlt"}
            </h4>
            <button
              type="button"
              onClick={() => {
                detailGeneration.current += 1;
                setTranscript(null);
              }}
              aria-label="Transkript schließen"
            >
              Schließen
            </button>
          </div>
          <p className="text-xs text-stone-500">
            Automatische Transkription; Erkennungsfehler sind möglich.
          </p>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {transcript.segments.map((segment) => (
              <div key={segment.source_item_id}>
                <p className="text-xs font-semibold text-stone-500">
                  {segment.speaker === "customer"
                    ? "Kunde"
                    : segment.speaker === "assistant"
                      ? "KI-Assistent"
                      : "Mitarbeiter"}{" "}
                  · {Math.floor(segment.start_ms / 60000)}:
                  {String(Math.floor(segment.start_ms / 1000) % 60).padStart(
                    2,
                    "0",
                  )}
                  {segment.is_final ? "" : " · vorläufig"}
                </p>
                <p className="whitespace-pre-wrap text-sm text-stone-900">
                  {segment.text}
                </p>
              </div>
            ))}
          </div>
          {transcript.nextOffset !== null ? (
            <button
              type="button"
              onClick={() =>
                void open(transcript.session.id, transcript.nextOffset!)
              }
              className="text-left text-sm underline"
            >
              Weitere Passagen laden
            </button>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
