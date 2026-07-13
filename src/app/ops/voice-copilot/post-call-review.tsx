"use client";

import { useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { VoiceCopilotMode, VoiceKnowledgeProposal } from "@/lib/ops/voice-copilot";

type PostCallReviewProps = {
  mode: VoiceCopilotMode;
  operatorName: string;
  requestId: string | null;
  enabled: boolean;
};

export function PostCallReview({ mode, operatorName, requestId, enabled }: PostCallReviewProps) {
  const [summary, setSummary] = useState("");
  const [proposals, setProposals] = useState<VoiceKnowledgeProposal[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setBusy(true);
    setError(null);
    setProposals([]);
    setSaved([]);
    try {
      const response = await fetch("/api/ops/voice-copilot/post-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, requestId, summary }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Analyse fehlgeschlagen.");
      setProposals(Array.isArray(payload?.proposals) ? payload.proposals : []);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Analyse fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProposal(proposal: VoiceKnowledgeProposal, index: number) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/voice-copilot/candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "call_summary",
          requestId,
          proposedStatement: proposal.statement,
          evidenceRefs: [{ label: proposal.evidence }],
          confidence: proposal.confidence,
          proposedBy: operatorName,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Kandidat konnte nicht gespeichert werden.");
      setSaved((current) => [...current, index]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kandidat konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-stone-500" /><h2 className="font-semibold text-stone-950">Nachbereitung</h2></div>
      <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Kurze Mitarbeiter-Notiz zum Gespraech" className="min-h-28 resize-y rounded-lg border border-stone-200 px-3 py-3 text-sm outline-none focus:border-stone-500" />
      <button type="button" onClick={analyze} disabled={busy || summary.trim().length < 40} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Kandidaten pruefen
      </button>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {proposals.length ? <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
        {proposals.map((proposal, index) => (
          <div key={`${proposal.statement}-${index}`} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div><p className="text-sm text-stone-800">{proposal.statement}</p><p className="mt-1 text-xs text-stone-500">{proposal.reason} · {Math.round(proposal.confidence * 100)}%</p></div>
            <button type="button" title="Als Review-Kandidat speichern" aria-label="Als Review-Kandidat speichern" disabled={busy || saved.includes(index)} onClick={() => saveProposal(proposal, index)} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-200 text-emerald-800 disabled:opacity-40"><Check className="h-4 w-4" /></button>
          </div>
        ))}
      </div> : null}
    </section>
  );
}
