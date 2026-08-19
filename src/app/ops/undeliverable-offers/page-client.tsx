"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, MailWarning, RefreshCw, XCircle } from "lucide-react";
import { OpsAppSwitcher } from "@/app/ops/ops-app-switcher";
import type { UndeliverableOfferCase } from "@/lib/ops/undeliverable-offers";

function statusLabel(value: UndeliverableOfferCase["status"]) {
  return ({ detected: "Erkannt", needs_research: "Recherche läuft", manual_review: "Prüfung nötig", approved: "Freigegeben", processing: "Wird verarbeitet", sent: "Erneut gesendet", failed: "Fehlgeschlagen", unknown: "Versand unklar", dismissed: "Geschlossen" } as const)[value];
}
function failureLabel(value: UndeliverableOfferCase["failure_kind"]) {
  return ({ domain_not_found: "Domain existiert nicht", mailbox_not_found: "Postfach existiert nicht", policy_rejected: "Vom Empfänger abgewiesen", temporary: "Temporärer Fehler", unknown: "Unbekannter Zustellfehler" } as const)[value];
}
function date(value: string) { return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }

export function UndeliverableOffersPageClient() {
  const [items, setItems] = useState<UndeliverableOfferCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operator, setOperator] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { setOperator(localStorage.getItem("neontrip-undeliverable-reviewer") || ""); }, []);
  useEffect(() => { if (operator) localStorage.setItem("neontrip-undeliverable-reviewer", operator); }, [operator]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/ops/undeliverable-offers?status=all&limit=150", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Prüfliste konnte nicht geladen werden.");
      setItems(payload.items || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prüfliste konnte nicht geladen werden."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function review(item: UndeliverableOfferCase, decision: "approve" | "dismiss") {
    const note = (notes[item.id] || "").trim();
    if (operator.trim().length < 2) return setError("Bitte deinen Namen eintragen.");
    if (note.length < 8) return setError("Bitte die Entscheidung mit mindestens acht Zeichen begründen.");
    if (decision === "approve" && !item.proposed_email) return setError("Ohne belegte Zieladresse ist keine Freigabe möglich.");
    setBusy(item.id); setError("");
    try {
      const response = await fetch("/api/ops/undeliverable-offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: item.id, decision, note, operatorName: operator.trim(), idempotencyKey: crypto.randomUUID() }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Entscheidung konnte nicht gespeichert werden.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Entscheidung konnte nicht gespeichert werden."); }
    finally { setBusy(null); }
  }

  const open = items.filter((item) => !["sent", "dismissed"].includes(item.status));
  return (
    <main className="min-h-screen bg-[#f5f1e9] text-stone-950">
      <header className="border-b border-black/10 bg-stone-950 px-5 py-5 text-white">
        <div className="mx-auto max-w-[1500px]">
          <OpsAppSwitcher active="undeliverableOffers" />
          <div className="mt-7 flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">TICKET-053</p><h1 className="mt-2 text-3xl font-black">Unzustellbare Angebote</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-stone-300">Recherchequellen prüfen, Adresskorrekturen freigeben und unklare Versandausgänge ohne Doppelversand stoppen.</p></div>
            <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-stone-950 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Aktualisieren</button>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-[1500px] space-y-5 px-5 py-7">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>Versandschutz:</strong> Öffentliche Webfunde werden nie automatisch versendet. A/N 14706 ist technisch von jeder automatischen Freigabe ausgeschlossen.</div>
          <label className="rounded-2xl border border-stone-200 bg-white p-4 text-sm font-semibold">Prüfer/in<input value={operator} onChange={(event) => setOperator(event.target.value)} maxLength={160} className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 font-normal" placeholder="Name" /></label>
        </div>
        {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-900">{error}</div> : null}
        {loading ? <p className="py-12 text-center text-stone-500">Prüfliste wird geladen …</p> : null}
        {!loading && !open.length ? <div className="rounded-3xl border border-stone-200 bg-white p-12 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><h2 className="mt-4 text-xl font-bold">Keine offenen Zustellfälle</h2></div> : null}
        <div className="grid gap-5 xl:grid-cols-2">
          {open.map((item) => (
            <article key={item.id} className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><span className="rounded-2xl bg-rose-100 p-3 text-rose-700"><MailWarning className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-stone-500">{item.offer_number ? `Angebot A/N ${item.offer_number}` : "Angebot nicht eindeutig"}</p><h2 className="mt-1 break-all text-lg font-black">{item.failed_email}</h2><p className="mt-1 text-sm text-stone-600">{failureLabel(item.failure_kind)} · {date(item.received_at)}</p></div></div><span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-bold">{statusLabel(item.status)}</span></div>
              {item.proposed_email ? <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Gefundener Kandidat</p><p className="mt-1 break-all text-lg font-black text-emerald-950">{item.proposed_email}</p><p className="mt-1 text-xs text-emerald-800">Konfidenz {Math.round(Number(item.confidence || 0) * 100)} % · {item.automatic_eligible ? "intern verifizierter Kontakt" : "menschliche Prüfung erforderlich"}</p></div> : <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mr-2 inline h-4 w-4" />Noch keine belegte Ersatzadresse gefunden.</div>}
              {item.evidence.length ? <div className="mt-4 space-y-2"><p className="text-xs font-bold uppercase tracking-wider text-stone-500">Quellen</p>{item.evidence.map((evidence, index) => <div key={`${evidence.type}-${index}`} className="rounded-xl border border-stone-200 p-3 text-sm"><p className="font-semibold">{evidence.type.replaceAll("_", " ")}</p><p className="mt-1 break-words text-stone-600">{evidence.value}</p>{evidence.sourceUrl ? <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-700">Quelle öffnen <ExternalLink className="h-3 w-3" /></a> : null}</div>)}</div> : null}
              {["manual_review", "approved", "failed"].includes(item.status) ? <div className="mt-5"><textarea value={notes[item.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} className="min-h-24 w-full rounded-xl border border-stone-300 p-3 text-sm" placeholder="Quelle geprüft und Entscheidung begründen …" /><div className="mt-3 flex gap-3"><button onClick={() => void review(item, "approve")} disabled={busy === item.id || !item.proposed_email} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Adresse freigeben</button><button onClick={() => void review(item, "dismiss")} disabled={busy === item.id} className="inline-flex items-center gap-2 rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-bold disabled:opacity-40"><XCircle className="h-4 w-4" />Schließen</button></div></div> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
