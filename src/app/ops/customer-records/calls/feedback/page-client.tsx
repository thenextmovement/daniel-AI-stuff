"use client";
import { useEffect, useState } from "react";
import { OpsLoginCard } from "../../../ops-login-card";
import type { getSalesCallFeedbackContext } from "@/lib/ops/customer-call-module";
import { feedbackRetryDate, feedbackToday, type FeedbackPreset } from "@/lib/ops/sales-call-feedback-contract";

type Context = Awaited<ReturnType<typeof getSalesCallFeedbackContext>>;
const inputClass = "w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-base";
const labels: Record<FeedbackPreset, string> = {
  callback: "Gesprochen – Rückruf vereinbart", "needs-time": "Später kontaktieren",
  "needs-adjustment": "Gesprochen – Angebot anpassen", "called-done": "Gesprochen – Vorgang für Anrufe abgeschlossen",
  "not-reached": "Nicht erreicht", "not-interested": "Kein Interesse an diesem Vorgang", "do-not-call": "Keine weiteren Anrufe gewünscht",
};
export function CallFeedbackClient({ requestId, initialAction, enabled, initialHasSession }: {
  requestId: string; initialAction: string; enabled: boolean; initialHasSession: boolean;
}) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operator, setOperator] = useState("");
  const [context, setContext] = useState<Context | null>(null);
  const [preset, setPreset] = useState<FeedbackPreset>(initialAction === "not-reached" ? "not-reached" : initialAction === "later" ? "needs-time" : initialAction === "stop" ? "not-interested" : "callback");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const needsDate = ["callback", "needs-time", "not-reached"].includes(preset);
  async function load() {
    setBusy(true); setError(null); setContext(null);
    try {
      const response = await fetch("/api/ops/customer-records/calls/feedback?requestId=" + encodeURIComponent(requestId), { cache: "no-store" });
      if (response.status === 401) { setHasSession(false); return; }
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Vorgang nicht verfügbar.");
      setContext(data.context);
      setDate(feedbackRetryDate(data.context.retryCount));
      setSubmitted(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Vorgang konnte nicht geladen werden."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (hasSession && requestId) void load(); }, [hasSession, requestId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function login() {
    setError(null);
    try {
      const response = await fetch("/api/ops/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!response.ok) throw new Error("Anmeldung fehlgeschlagen.");
      setToken(""); setHasSession(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Anmeldung fehlgeschlagen."); }
  }
  async function save() {
    if (!context || busy || submitted) return;
    setBusy(true); setSubmitted(true); setError(null);
    try {
      const response = await fetch("/api/ops/customer-records/calls/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, version: context.version, expectedLatestResultId: context.latestResult?.id || null,
          preset, callbackDate: needsDate ? date : null, notes, operatorName: operator }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Speicherstand nicht bestätigt. Neu laden und Ergebnis prüfen.");
      setMessage(data.syncPending?.length
        ? "Ergebnis gespeichert. Synchronisierung noch offen: " + data.syncPending.join(", ") + ". Bitte in Ops prüfen; Ergebnis nicht erneut speichern."
        : "Ergebnis gespeichert und mit der Anrufplanung und den Aufgaben synchronisiert.");
    } catch (e) { setError(e instanceof Error ? e.message : "Speicherstand unklar. Neu laden und Ergebnis prüfen."); }
    finally { setBusy(false); }
  }
  if (!enabled) return <main className="p-8">Interner Zugang nicht konfiguriert.</main>;
  if (!hasSession) return <OpsLoginCard title="Anrufergebnis speichern" password={token} operatorName={operator}
    onOperatorNameChange={setOperator} onPasswordChange={setToken} onSubmit={login} error={error} />;
  return <main className="min-h-screen bg-[#f7f4ef] px-4 py-8 text-stone-950">
    <div className="mx-auto max-w-xl rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">NEONTRIP Ops</p>
      <h1 className="mt-3 text-3xl font-semibold">Anrufergebnis</h1>
      <p className="mt-3 text-sm text-stone-600">Prüfe den aktuellen Vorgang und bestätige das Ergebnis. Das Öffnen des Mail-Links speichert noch nichts.</p>
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
      {message && <p role="status" className="mt-5 rounded-xl bg-green-50 p-4 text-green-900">{message}</p>}
      {!requestId && <p role="alert" className="mt-5">Die Vorgangs-ID fehlt im Link.</p>}
      {busy && !context && <p className="mt-5" role="status">Aktuellen Stand laden …</p>}
      {context && !message && <>
        <section className="my-6 rounded-2xl bg-stone-50 p-4">
          <h2 className="font-semibold">{context.company ? context.company + " · " : ""}{context.name}</h2>
          <p className="mt-1 text-sm">{context.phone}</p>
          <p className="mt-2 break-all text-xs text-stone-500">Vorgang: {context.requestId}</p>
          <p className="mt-3 text-sm">Letztes Ergebnis: {context.latestResult ? (labels[context.latestResult.preset as FeedbackPreset] || context.latestResult.preset) + " · " + new Date(context.latestResult.createdAt!).toLocaleString("de-DE", { timeZone: "Europe/Berlin" }) : "Noch kein Gesprächsergebnis hinterlegt"}</p>
          {context.latestResult?.notes && <p className="mt-2 text-sm">{context.latestResult.notes}</p>}
          {context.pendingCallbackAt && <p className="mt-2 text-sm">Geplanter Rückruf: {context.pendingCallbackAt}</p>}
          {!context.guard.allowed && <p className="mt-2 text-sm font-medium">{context.guard.blockedReason}. Hier wird nur ein tatsächlich vorliegendes Ergebnis dokumentiert.</p>}
        </section>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="grid gap-2 text-sm font-medium">Ergebnis und nächste Aktion
            <select aria-label="Ergebnis und nächste Aktion" className={inputClass} value={preset} onChange={(e) => setPreset(e.target.value as FeedbackPreset)}>
              {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {needsDate && <label className="grid gap-2 text-sm font-medium">Nächster Kontakt am
            <input aria-label="Nächster Kontakt am" className={inputClass} type="date" min={feedbackToday()} required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>}
          {preset === "not-reached" && context.retryCount >= 2 && <p className="text-sm text-stone-600">Nach dem dritten erfolglosen Versuch wird der Fall zur manuellen Entscheidung vorgelegt.</p>}
          <label className="grid gap-2 text-sm font-medium">Kurze Notiz
            <textarea aria-label="Kurze Notiz" className={inputClass} rows={3} required minLength={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="grid gap-2 text-sm font-medium">Dein Name
            <input aria-label="Dein Name" className={inputClass} required minLength={2} maxLength={100} value={operator} onChange={(e) => setOperator(e.target.value)} />
          </label>
          <button className="rounded-xl bg-stone-950 px-4 py-3 font-medium text-white disabled:opacity-50" type="submit" disabled={busy || submitted}>{busy ? "Speichern …" : "Ergebnis bestätigen und speichern"}</button>
        </form>
      </>}
      {error && <button className="mt-4 underline" disabled={busy} onClick={() => { setMessage(null); void load(); }}>Aktuellen Stand neu laden</button>}
      <a className="mt-6 block text-sm underline" href={"/ops/customer-records?query=" + encodeURIComponent(requestId)}>Vorgang in Ops öffnen</a>
    </div>
  </main>;
}
