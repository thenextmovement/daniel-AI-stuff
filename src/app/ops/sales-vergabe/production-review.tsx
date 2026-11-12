"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCcw, X } from "lucide-react";
import {
  defaultReviewApproval, renderProductionReview, reviewApprovalIssues, PRODUCTION_LISTS,
  type ProductionReview, type ReviewApproval, type ProductionPriority,
} from "@/lib/ops/supplier-sale-review";
import type { ProductionHandoff } from "@/lib/ops/supplier-sale-handoff";

const fieldClass = "w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50";
const safeLink = (value: string | null) => value?.startsWith("https://") ? value : undefined;

export function ProductionReviewPanel({ saleId, assignment, blockReason, paymentConfirmation, saving, onAction, onClose }: {
  saleId: string; assignment: Record<string, unknown>; blockReason: string | null; saving: boolean;
  paymentConfirmation?: string | null;
  onAction(body: Record<string, unknown>): Promise<unknown>; onClose(): void;
}) {
  const [review, setReview] = useState<ProductionReview | null>(null);
  const [approval, setApproval] = useState<ReviewApproval | null>(null);
  const [handoff, setHandoff] = useState<ProductionHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [editText, setEditText] = useState(false);
  const panel = useRef<HTMLElement>(null);
  function rendered(r: ProductionReview, decisions: ReviewApproval["decisions"]) {
    const text = renderProductionReview(r, decisions);
    const note = typeof assignment.assignmentNote === "string" ? assignment.assignmentNote.trim() : "";
    if (note) {
      text.description = `CHECK INFO\n${note}\n\n${text.description}`;
      if (!text.title.includes("CHECK INFO")) text.title = text.title.replace(r.orderName + " |", r.orderName + " | CHECK INFO |");
    }
    return text;
  }
  async function load(regenerate = false) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(regenerate ? "/api/ops/supplier-sales" : `/api/ops/supplier-sales?action=production_review&saleId=${encodeURIComponent(saleId)}`, regenerate ? {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_production_review", saleId }), signal: AbortSignal.timeout(180_000),
      } : { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error([payload.error, ...(payload.issues || [])].filter(Boolean).join(" "));
      if (!payload.review && !regenerate) { await load(true); return; }
      setReview(payload.review);
      const draft = payload.approval ? { ...payload.approval, confirmed: false } : payload.review ? defaultReviewApproval(payload.review) : null;
      if (draft && !payload.approval) Object.assign(draft, rendered(payload.review, draft.decisions));
      setApproval(draft);
      setHandoff(payload.handoff || null);
      setEdited(Boolean(payload.approval));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Vorbereitung konnte nicht geladen werden."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); panel.current?.scrollIntoView({ block: "start" }); /* Only on opening this sale. */ }, [saleId]); // eslint-disable-line react-hooks/exhaustive-deps
  function update(patch: Partial<ReviewApproval>) { setApproval(a => a && ({ ...a, ...patch, confirmed: false })); }
  function decide(id: string, action: "accept" | "reject", note?: string) {
    if (!review || !approval) return;
    const decisions = { ...approval.decisions, [id]: { action, note: note ?? approval.decisions[id]?.note ?? "" } };
    const linkedThread = review.analysis.changes.find(c => c.id === id)?.requiresThreadId;
    if (linkedThread) decisions[`thread:${linkedThread}`] = { action, note: action === "accept" ? "Wörtliche Logo-Korrektur dem Auftrag zugeordnet und Vorschau geprüft." : "Korrektur gehört zu einer anderen Bestellung." };
    update({ decisions, ...(!edited ? rendered(review, decisions) : {}) });
  }
  const issues = review && approval ? reviewApprovalIssues(review, { ...approval, confirmed: true }) : [];
  const locked = busy || saving || handoff?.status === "pending" || handoff?.status === "synced";
  async function release() {
    if (!review || !approval || issues.length || blockReason) return;
    if (paymentConfirmation && !window.confirm(paymentConfirmation)) return;
    setBusy(true); setError(null);
    try {
      const result = await onAction({ ...assignment, action: "assign_supplier", saleId, supplier: "quentin", productionApproval: { ...approval, confirmed: true } });
      const response = await fetch(`/api/ops/supplier-sales?action=production_review&saleId=${encodeURIComponent(saleId)}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Der Freigabestand konnte nicht zurückgelesen werden. Bitte Stand laden.");
      const state = await response.json(); setHandoff(state.handoff);
      if (state.handoff?.error) setError(state.handoff.error);
      else if (!result) setError("Die Freigabe wurde nicht bestätigt. Den angezeigten Stand prüfen, bevor du sie erneut auslöst.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Freigabestand unklar. Bitte Stand laden."); }
    finally { setBusy(false); }
  }
  return (
    <section ref={panel} aria-label="Vorbereitete Produktionsvergabe" className="mt-4 scroll-mt-4 rounded-lg border border-violet-200 bg-stone-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-semibold text-stone-950">Vergabe prüfen</h3><p className="mt-1 text-sm text-stone-600">Bestellung, E-Mails und Quentin-Karte gemeinsam prüfen.</p></div>
        <div className="flex gap-2">
          {handoff ? <button type="button" className={buttonClass} disabled={busy || saving} onClick={() => void load()}>Stand laden</button> : null}
          <button type="button" className={buttonClass} disabled={locked || handoff?.releaseAttempted} onClick={() => void load(true)}><RefreshCcw className="h-4 w-4" />Neu vorbereiten</button>
          <button type="button" className={buttonClass} aria-label="Produktionsvorschau schließen" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
      </div>
      {busy ? <p role="status" className="mt-4 text-sm text-stone-600">Vollständige Korrespondenz und gekauftes Design werden geprüft. Die Kundenkarte wird dabei nicht geändert.</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">{error}</p> : null}
      {handoff?.status === "synced" ? <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-emerald-900"><CheckCircle2 className="h-5 w-5" />Übergabe bestätigt: Karteninhalt, Dateien, Cover und Position wurden zurückgelesen.</p> : null}
      {handoff?.status === "pending" ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm">Freigabe läuft oder ihr Ergebnis ist noch unklar. Nicht erneut auslösen. Den Stand neu laden.</p> : null}
      {review && approval ? (
        <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="min-w-0 space-y-4">
            <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <p className="font-semibold">{issues.length ? `${issues.length} Punkte noch prüfen` : "Vorbereitet – bereit für deine Freigabe"}</p><p className="mt-2">{review.analysis.summary}</p>
              <p className="mt-2 text-xs text-stone-500">{review.mailCount} E-Mail-Volltexte · vorbereitet {new Date(review.preparedAt).toLocaleString("de-DE")}</p>
              <a href={safeLink(review.cardUrl)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-violet-800 underline">Zugeordnete Quentin-Karte öffnen</a>
            </div>
            {review.analysis.changes.filter(c => c.kind !== "addition" || c.questionOnly).map(change => {
              const decision = approval.decisions[change.id];
              const current = review.products.find(p => p.id === change.productId)?.fields.find(f => f.label.toLowerCase() === change.field.toLowerCase())?.value;
              return <div key={change.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="flex gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />{change.reason}</p>
                {current ? <p className="mt-2"><span className="font-medium">Bestellt:</span> {current}</p> : null}
                {change.value ? <p className="mt-2 whitespace-pre-wrap"><span className="font-medium">Vorschlag:</span> {change.kind === "obsolete" ? "Veralteten Hinweis entfernen" : change.value}</p> : null}
                <details className="mt-2"><summary className="cursor-pointer text-xs font-medium">Belege ansehen</summary>
                  {change.evidence.map((e, i) => { const source = review.sources.find(s => s.id === e.sourceId); return <div key={i} className="mt-2 border-l-2 border-amber-300 pl-2 text-xs"><p className="font-semibold">{source?.label} {source?.at ? new Date(source.at).toLocaleDateString("de-DE") : ""}</p><p className="whitespace-pre-wrap">{e.quote}</p>{source?.href ? <a href={safeLink(source.href)} target="_blank" rel="noreferrer" className="underline">Quelle öffnen</a> : null}</div>; })}
                </details>
                {change.questionOnly ? <input disabled={locked} aria-label={`Klärung: ${change.reason}`} placeholder="Geprüftes Ergebnis eintragen; nötige Textänderung unten übernehmen" value={decision?.note || ""} onChange={e => decide(change.id, "reject", e.target.value)} className={`${fieldClass} mt-3`} /> : <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={locked} aria-pressed={decision?.action === "accept"} className={`${buttonClass} ${decision?.action === "accept" ? "border-violet-600 bg-violet-50" : ""}`} onClick={() => decide(change.id, "accept")}>{change.requiresThreadId ? "Korrektur gehört zum Auftrag" : change.kind === "obsolete" ? "Hinweis entfernen" : "Vorschlag übernehmen"}</button>
                  <button type="button" disabled={locked} aria-pressed={decision?.action === "reject"} className={`${buttonClass} ${decision?.action === "reject" ? "border-violet-600 bg-violet-50" : ""}`} onClick={() => decide(change.id, "reject")}>{change.requiresThreadId ? "Andere Bestellung" : current ? "Bestellten Wert behalten" : "Vorschlag verwerfen"}</button>
                </div>}
              </div>;
            })}
            {review.analysis.changes.some(c => c.kind === "addition" && !c.questionOnly) ? <details className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><summary className="cursor-pointer font-medium">Bereits übernommen: {review.analysis.changes.filter(c => c.kind === "addition" && !c.questionOnly).length} belegte Hinweise</summary>{review.analysis.changes.filter(c => c.kind === "addition" && !c.questionOnly).map(change => <label key={change.id} className="mt-3 flex items-start gap-2"><input type="checkbox" disabled={locked} checked={approval.decisions[change.id]?.action === "accept"} onChange={e => decide(change.id, e.target.checked ? "accept" : "reject")} className="mt-1" /><span>{change.value}<span className="mt-1 block text-xs text-stone-600">{change.reason}</span>{change.evidence.map((e, i) => <span key={i} className="mt-1 block text-xs text-stone-500">{review.sources.find(s => s.id === e.sourceId)?.label}: {e.quote}</span>)}</span></label>)}</details> : null}
            {review.analysis.threads.filter(t => t.relevance === "uncertain" && !review.analysis.changes.some(c => c.requiresThreadId === t.id)).map(thread => {
              const decision = approval.decisions[`thread:${thread.id}`];
              return <div key={thread.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>{thread.reason}</p><details className="mt-2"><summary className="cursor-pointer text-xs">Mailverlauf ansehen</summary>{review.sources.filter(source => source.threadId === thread.id).map(source => <div key={source.id} className="mt-2"><p className="font-medium">{source.label}</p><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{source.text}</pre></div>)}</details><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={locked} aria-pressed={decision?.action === "reject"} className={buttonClass} onClick={() => decide(`thread:${thread.id}`, "reject")}>Andere Bestellung</button><button type="button" disabled={locked} aria-pressed={decision?.action === "accept"} className={buttonClass} onClick={() => decide(`thread:${thread.id}`, "accept")}>Gehört zu diesem Auftrag</button></div>{decision?.action === "accept" ? <input disabled={locked} className={`${fieldClass} mt-2`} aria-label={`Mailzuordnung: ${thread.reason}`} placeholder="Relevante Änderungen geprüft: Ergebnis dokumentieren" value={decision.note} onChange={e => decide(`thread:${thread.id}`, "accept", e.target.value)} /> : null}</div>;
            })}
            <div className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Fertige Trello-Karte</h4><button type="button" className={buttonClass} disabled={locked} onClick={() => setEditText(!editText)}>{editText ? "Vorschau anzeigen" : "Text anpassen"}</button></div>
              {editText ? <><label className="block text-sm font-medium">Kartentitel<input disabled={locked} className={`${fieldClass} mt-1`} value={approval.title} onChange={e => { setEdited(true); update({ title: e.target.value }); }} /></label><label className="mt-3 block text-sm font-medium">Produktionsbeschreibung (English)<textarea disabled={locked} className={`${fieldClass} mt-1 min-h-80 font-mono text-xs`} value={approval.description} onChange={e => { setEdited(true); update({ description: e.target.value }); }} /></label></> : <><p className="break-words text-sm font-semibold">{approval.title}</p><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-stone-700">{approval.description}</pre></>}
            </div>
            {edited ? <p className="text-xs text-stone-600">Der Text wurde manuell angepasst. Weitere Entscheidungen werden nicht automatisch in diesen Text eingetragen.</p> : null}
            <details className="rounded-lg border border-stone-200 bg-white p-3 text-sm"><summary className="cursor-pointer font-medium">Bisheriger Titel und Beschreibung</summary><p className="mt-3 font-semibold">{review.originalTitle}</p><pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs">{review.originalDescription}</pre></details>
            <details className="rounded-lg border border-stone-200 bg-white p-3 text-sm"><summary className="cursor-pointer font-medium">Geprüfte Korrespondenz und Zuordnung</summary>
              {review.analysis.threads.map(t => <div key={t.id} className="mt-3 border-t pt-3"><p className="font-semibold">{t.relevance === "related" ? "Dieser Auftrag" : t.relevance === "unrelated" ? "Andere Bestellung" : "Zuordnung offen"}: {t.reason}</p>{review.sources.filter(s => s.threadId === t.id).map(s => <details key={s.id} className="mt-2"><summary className="cursor-pointer text-xs">{s.label} · {s.at ? new Date(s.at).toLocaleString("de-DE") : ""}</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{s.text}</pre></details>)}</div>)}
            </details>
          </div>
          <div className="min-w-0 space-y-4">
            <fieldset disabled={locked}><legend className="mb-2 text-sm font-semibold">Gekauftes Design und Cover</legend><div className="grid grid-cols-2 gap-2">{review.products.map(product => <label key={product.id} className="min-w-0 rounded-lg border border-stone-200 bg-white p-2"><img src={product.imageUrl} alt={product.imageTitle} className="h-32 w-full object-contain" /><p className="mt-2 break-words text-xs">{product.title} · {product.imageTitle}</p><span className="mt-2 flex items-center gap-2 text-xs"><input type="radio" name={`cover-${saleId}`} checked={approval.coverProductId === product.id} onChange={() => update({ coverProductId: product.id })} />Als Cover</span></label>)}</div></fieldset>
            <div><h4 className="text-sm font-semibold">Dateien auf der Karte</h4><p className="mt-1 text-xs text-stone-500">Entfernte Dateien werden zuvor in der privaten Ablage bytegleich gesichert.</p>
              {review.attachments.map(a => <div key={a.id} className="mt-2 rounded-lg border border-stone-200 bg-white p-3">
                <div className="flex gap-3">{a.previewUrl ? <img src={a.previewUrl} alt="" className="h-14 w-20 object-contain" /> : null}<div className="min-w-0"><a href={safeLink(a.url)} target="_blank" rel="noreferrer" className="break-words text-sm font-medium underline">{a.name}</a><p className="mt-1 text-xs text-stone-500">{a.reason}</p></div></div>
                <select disabled={locked} aria-label={`Datei: ${a.name}`} className={`${fieldClass} mt-2`} value={approval.attachments[a.id] || ""} onChange={e => update({ attachments: { ...approval.attachments, [a.id]: e.target.value as "keep" | "remove" } })}>
                  <option value="">Bitte prüfen</option><option value="keep">Behalten</option><option value="remove" disabled={a.removable === false}>Sichern und entfernen</option>
                </select>
              </div>)}
            </div>
            <label className="block text-sm font-medium">Produktionsliste<select disabled={locked} className={`${fieldClass} mt-1`} value={approval.priority} onChange={e => update({ priority: e.target.value as ProductionPriority })}>{Object.entries(PRODUCTION_LISTS).map(([key, list]) => <option key={key} value={key}>{list.name} · ganz oben</option>)}</select></label>
            {approval.priority !== review.priority ? <input disabled={locked} className={fieldClass} aria-label="Abweichende Priorität begründen" placeholder="Abweichende Priorität begründen" value={approval.priorityReason} onChange={e => update({ priorityReason: e.target.value })} /> : null}
            <details className="text-sm"><summary className="cursor-pointer font-medium">Interne Prüfnote ergänzen</summary><textarea disabled={locked} aria-label="Interne Prüfnote" className={`${fieldClass} mt-2`} value={approval.operatorNote} placeholder="Zum Beispiel eine telefonisch bestätigte Absprache" onChange={e => update({ operatorNote: e.target.value })} /></details>
            {handoff?.backups.length ? <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm"><h4 className="font-medium">Gesicherte Dateien</h4>{handoff.backups.map(b => <a key={b.attachmentId} className="mt-2 block underline" href={`/api/ops/supplier-sales?action=production_file_backup&saleId=${encodeURIComponent(saleId)}&attachmentId=${encodeURIComponent(b.attachmentId)}`}>{b.name}</a>)}</div> : null}
            {issues.length || blockReason ? <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Vor der Freigabe offen</p><ul className="mt-2 list-disc space-y-1 pl-5">{[...(blockReason ? [blockReason] : []), ...issues].map((issue, i) => <li key={i}>{issue}</li>)}</ul></div> : null}
            {paymentConfirmation ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Zahlung offen oder unklar: Eine Vergabe vor Zahlung muss zusätzlich ausdrücklich bestätigt werden.</p> : null}
            <p className="text-xs text-stone-600">Mit der Freigabe bestätigst du Titel, Beschreibung, Dateien, Cover und Produktionsliste.</p>
            <button type="button" disabled={locked || issues.length > 0 || Boolean(blockReason)} onClick={() => void release()} className="w-full rounded-lg bg-stone-950 px-4 py-3 text-sm font-semibold text-white disabled:bg-stone-300">{saving ? "Übergabe wird geprüft …" : handoff?.status === "partial" ? "Geprüfte Übergabe fortsetzen" : "Geprüft – an Produktion freigeben"}</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
