"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, Plus, RotateCcw, ShieldCheck, X } from "lucide-react";
import type { VoiceKnowledgeCandidate, VoiceKnowledgeEntry } from "@/lib/ops/voice-knowledge";

type KnowledgePanelProps = { operatorName: string };

export function KnowledgePanel({ operatorName }: KnowledgePanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<VoiceKnowledgeEntry[]>([]);
  const [candidates, setCandidates] = useState<VoiceKnowledgeCandidate[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [knowledgeResponse, candidateResponse] = await Promise.all([
        fetch("/api/ops/voice-copilot/knowledge", { cache: "no-store" }),
        fetch("/api/ops/voice-copilot/candidates", { cache: "no-store" }),
      ]);
      const knowledge = await knowledgeResponse.json().catch(() => null);
      const candidateData = await candidateResponse.json().catch(() => null);
      if (!knowledgeResponse.ok) throw new Error(knowledge?.error || "Wissen konnte nicht geladen werden.");
      if (!candidateResponse.ok) throw new Error(candidateData?.error || "Kandidaten konnten nicht geladen werden.");
      setEnabled(Boolean(knowledge.enabled));
      setEntries(Array.isArray(knowledge.entries) ? knowledge.entries : []);
      setCandidates(Array.isArray(candidateData.candidates) ? candidateData.candidates : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Wissen konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/voice-copilot/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          allowedModes: ["lead_qualification", "follow_up"],
          riskClass: "standard",
          sourceRefs: sourceLabel.trim() ? [{ label: sourceLabel.trim() }] : [],
          author: operatorName,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Entwurf konnte nicht angelegt werden.");
      setTitle("");
      setContent("");
      setSourceLabel("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Entwurf konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function review(versionId: string, decision: "approve" | "request_changes" | "retire") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/voice-copilot/knowledge/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId, decision, reviewer: operatorName }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Review konnte nicht gespeichert werden.");
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Review konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function decideCandidate(candidateId: string, decision: "promote" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/voice-copilot/candidates/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId, decision, reviewer: operatorName }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Kandidat konnte nicht entschieden werden.");
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Kandidat konnte nicht entschieden werden.");
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) {
    return (
      <section className="flex min-h-32 items-center justify-center rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-500">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Wissen wird geladen.
      </section>
    );
  }

  if (enabled === false) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Wissenssystem nicht aktiviert</div>
        <p className="mt-2">Migration und Feature-Flag sind noch nicht live. Bestehende Realtime-Tests bleiben davon unberuehrt.</p>
      </section>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-stone-500">Neuer Eintrag</p>
            <h2 className="mt-1 text-lg font-semibold text-stone-950">Wissensentwurf</h2>
          </div>
          <button type="button" title="Neu laden" aria-label="Neu laden" onClick={load} disabled={busy} className="grid h-9 w-9 place-items-center rounded-lg border border-stone-200 text-stone-700 disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          </button>
        </div>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titel" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-stone-500" />
        <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Gepruefte Aussage und klare Grenzen" className="min-h-36 resize-y rounded-lg border border-stone-200 px-3 py-3 text-sm outline-none focus:border-stone-500" />
        <input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="Quelle / interner Beleg" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-stone-500" />
        <button type="button" onClick={createDraft} disabled={busy || operatorName.trim().length < 2 || title.trim().length < 4 || content.trim().length < 20} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
          <Plus className="h-4 w-4" /> Zur Pruefung einreichen
        </button>
      </section>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-4"><h2 className="font-semibold text-stone-950">Wissensversionen</h2></div>
        <div className="divide-y divide-stone-100">
          {entries.map((entry) => (
            <article key={entry.versionId} className="grid gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="font-semibold text-stone-950">{entry.title}</h3><p className="text-xs text-stone-500">Version {entry.versionNumber} · {entry.status} · {entry.authoredBy}</p></div>
                <div className="flex gap-2">
                  {entry.status === "review" || entry.status === "draft" ? <>
                    <button type="button" title="Freigeben" aria-label="Freigeben" disabled={busy} onClick={() => review(entry.versionId, "approve")} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-200 text-emerald-800"><Check className="h-4 w-4" /></button>
                    <button type="button" title="Aenderungen anfordern" aria-label="Aenderungen anfordern" disabled={busy} onClick={() => review(entry.versionId, "request_changes")} className="grid h-9 w-9 place-items-center rounded-lg border border-amber-200 text-amber-800"><RotateCcw className="h-4 w-4" /></button>
                  </> : null}
                  {entry.status === "approved" ? <button type="button" title="Stilllegen" aria-label="Stilllegen" disabled={busy} onClick={() => review(entry.versionId, "retire")} className="grid h-9 w-9 place-items-center rounded-lg border border-stone-200 text-stone-700"><X className="h-4 w-4" /></button> : null}
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6 text-stone-700">{entry.content}</p>
            </article>
          ))}
          {!entries.length && !busy ? <p className="px-5 py-6 text-sm text-stone-500">Noch keine Wissensversionen.</p> : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center gap-2 border-b border-stone-200 px-5 py-4"><ShieldCheck className="h-4 w-4 text-stone-500" /><h2 className="font-semibold text-stone-950">Offene Kandidaten</h2></div>
        <div className="divide-y divide-stone-100">
          {candidates.map((candidate) => (
            <article key={candidate.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div><p className="text-sm text-stone-800">{candidate.proposedStatement}</p><p className="mt-1 text-xs text-stone-500">{candidate.sourceType} · {candidate.requestId || "ohne Vorgang"}</p></div>
              <div className="flex gap-2">
                <button type="button" title="Als Wissensentwurf uebernehmen" aria-label="Als Wissensentwurf uebernehmen" disabled={busy} onClick={() => decideCandidate(candidate.id, "promote")} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-200 text-emerald-800"><Check className="h-4 w-4" /></button>
                <button type="button" title="Kandidat ablehnen" aria-label="Kandidat ablehnen" disabled={busy} onClick={() => decideCandidate(candidate.id, "rejected")} className="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 text-rose-800"><X className="h-4 w-4" /></button>
              </div>
            </article>
          ))}
          {!candidates.length && !busy ? <p className="px-5 py-6 text-sm text-stone-500">Keine offenen Kandidaten.</p> : null}
        </div>
      </section>
    </div>
  );
}
