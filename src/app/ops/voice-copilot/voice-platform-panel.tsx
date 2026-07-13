"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Check, CircleStop, LoaderCircle, PhoneCall, Plus, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";

type Row = Record<string, unknown>;
type Dashboard = {
  enabled: boolean;
  storageReady: boolean;
  settings?: Row | null;
  models?: Row[];
  evaluations?: Row[];
  prompts?: Row[];
  campaigns?: Row[];
  targets?: Row[];
  attempts?: Row[];
  outcomes?: Row[];
  allowlist?: Row[];
  consents?: Row[];
};

function text(value: unknown) { return String(value || ""); }
function dateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("de-DE");
}
function badge(value: unknown) {
  return <span className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs font-semibold text-stone-700">{text(value) || "-"}</span>;
}

export function VoicePlatformPanel({ operatorName }: { operatorName: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [allowPhone, setAllowPhone] = useState("");
  const [allowLabel, setAllowLabel] = useState("Interner Test");
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState("lead_qualification");
  const [campaignScope, setCampaignScope] = useState("sandbox");
  const [campaignPrompt, setCampaignPrompt] = useState("");
  const [consentRequest, setConsentRequest] = useState("");
  const [consentPhone, setConsentPhone] = useState("");
  const [consentWording, setConsentWording] = useState("");
  const [consentPurpose, setConsentPurpose] = useState("lead_qualification");
  const [consentSourceRef, setConsentSourceRef] = useState("");
  const [consentSource, setConsentSource] = useState("website_form");
  const [consentFormVersion, setConsentFormVersion] = useState("");
  const [consentGrantedAt, setConsentGrantedAt] = useState("");
  const [targetCampaign, setTargetCampaign] = useState("");
  const [targetConsent, setTargetConsent] = useState("");
  const [targetRequest, setTargetRequest] = useState("");
  const [targetPhone, setTargetPhone] = useState("");
  const [newModelId, setNewModelId] = useState("");
  const [newModelVoice, setNewModelVoice] = useState("marin");
  const [evalModelId, setEvalModelId] = useState("");
  const [evalScenarioCount, setEvalScenarioCount] = useState("56");
  const [evalPassedCount, setEvalPassedCount] = useState("0");
  const [evalSafetyFailures, setEvalSafetyFailures] = useState("0");
  const [evalReportRef, setEvalReportRef] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/voice-platform", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Voice-Plattform konnte nicht geladen werden.");
      setDashboard(payload.dashboard as Dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Voice-Plattform konnte nicht geladen werden.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function action(name: string, input: Row, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/ops/voice-platform", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: name, input: { ...input, actor: operatorName } }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Aktion fehlgeschlagen.");
      setNotice("Aktion wurde gespeichert.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Aktion fehlgeschlagen.");
      setBusy(false);
    }
  }

  const approvedPrompts = useMemo(() => (dashboard?.prompts || []).filter((entry) => entry.status === "approved" || entry.status === "review"), [dashboard]);
  const activeAttempts = useMemo(() => (dashboard?.attempts || []).filter((entry) => ["reserved", "dialing", "ringing", "live"].includes(text(entry.status))), [dashboard]);
  const outcomesByAttempt = useMemo(() => new Map((dashboard?.outcomes || []).map((entry) => [text(entry.attempt_id), entry])), [dashboard]);

  if (!dashboard) return <div className="flex min-h-32 items-center justify-center text-sm text-stone-500"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Plattform wird geladen.</div>;
  if (!dashboard.enabled || !dashboard.storageReady) return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Plattform noch nicht aktiviert</div>
      <p className="mt-2">Feature-Flag und Datenbankmigration bleiben bis zu einem freigegebenen Deploy aus. Runtime und produktive Calls sind dadurch blockiert.</p>
    </section>
  );

  const settings = dashboard.settings || {};
  return <div className="grid gap-5 max-sm:px-6 xl:pr-52">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold text-stone-950">Call Platform</h2><p className="mt-1 text-sm text-stone-600">Consent, Dispatch, Modelle und laufende Versuche.</p></div>
      <button type="button" title="Neu laden" aria-label="Neu laden" onClick={load} disabled={busy} className="grid h-10 w-10 place-items-center rounded-lg border border-stone-200 bg-white text-stone-700 disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
    </div>
    {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
    {notice ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

    <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-stone-500" /><h3 className="font-semibold text-stone-950">Kill Switches</h3></div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ key: "global_enabled", label: "Plattform" }, { key: "internal_test_calls_enabled", label: "Interne Testcalls" }, { key: "customer_calls_enabled", label: "Kundencalls" }].map((item) => <label key={item.key} className="flex min-h-11 items-center gap-3 rounded-lg border border-stone-200 px-3 text-sm font-medium"><input type="checkbox" checked={settings[item.key] === true} readOnly />{item.label}</label>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => action("set_runtime_settings", { globalEnabled: true, internalTestCallsEnabled: true, customerCallsEnabled: false, maxConcurrentCalls: 1 })} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-stone-950 px-3 text-sm font-semibold text-white"><Check className="h-4 w-4" /> Sandbox einschalten</button>
        <button type="button" disabled={busy} onClick={() => action("set_runtime_settings", { globalEnabled: false, internalTestCallsEnabled: false, customerCallsEnabled: false, maxConcurrentCalls: 1 }, "Alle neuen Anrufe global stoppen?")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 px-3 text-sm font-semibold text-rose-800"><CircleStop className="h-4 w-4" /> Global stoppen</button>
        <button type="button" disabled={busy} onClick={() => action("set_runtime_settings", { globalEnabled: true, internalTestCallsEnabled: true, customerCallsEnabled: true, confirmation: "KUNDENANRUFE FREIGEBEN", maxConcurrentCalls: Number(settings.max_concurrent_calls || 1) }, "Kundencalls wirklich freigeben? Dies ersetzt keine Deploy- oder Kampagnenfreigabe.")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-900"><PhoneCall className="h-4 w-4" /> Kundencalls freigeben</button>
      </div>
    </section>

    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-5 py-4"><h3 className="font-semibold text-stone-950">Modelle und Prompts</h3></div>
      <div className="grid gap-2 border-b border-stone-200 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.5fr)_auto]"><input value={newModelId} onChange={(event) => setNewModelId(event.target.value)} placeholder="Neue OpenAI Realtime Modell-ID" className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm" /><input value={newModelVoice} onChange={(event) => setNewModelVoice(event.target.value)} placeholder="Stimme" className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm" /><button type="button" disabled={busy || newModelId.length < 3} onClick={() => action("register_model", { modelId: newModelId, voice: newModelVoice, apiVersion: "v1", transport: "sip" })} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"><Plus className="h-4 w-4" /> Modell registrieren</button></div>
      <div className="divide-y divide-stone-100">
        {(dashboard.models || []).map((model) => <div key={text(model.id)} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><p className="font-semibold text-stone-950">{text(model.model_id)}</p><div className="mt-2 flex flex-wrap gap-2">{badge(model.lifecycle)}{badge(model.eval_status)}{badge(model.voice)}{badge(model.enabled === true ? "enabled" : "disabled")}<span className="text-xs text-stone-500">Score {text(model.eval_score) || "-"} · Prompts {Object.keys((model.evaluated_prompt_manifest as Row) || {}).length || 0}/2</span></div></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => action("set_model_enabled", { modelReleaseId: model.id, enabled: model.enabled !== true }, model.enabled === true ? "Dieses Modell sofort für neue Calls sperren?" : "Dieses Modell wieder als auswählbar freigeben?")} className="min-h-9 rounded-lg border border-stone-200 px-3 text-xs font-semibold">{model.enabled === true ? "Sperren" : "Entsperren"}</button><button type="button" disabled={busy || !["pending", "contract_passed"].includes(text(model.eval_status))} onClick={() => action("approve_model_sandbox", { modelReleaseId: model.id, confirmation: "SANDBOX-MODELL FREIGEBEN" }, "SIP-, Tool- und Sideband-Vertrag dieses Modells als geprüft bestätigen? Dies erlaubt nur interne Allowlist-Calls.")} className="min-h-9 rounded-lg border border-sky-200 px-3 text-xs font-semibold text-sky-900 disabled:opacity-40">Sandbox-Vertrag</button><button type="button" disabled={busy} onClick={() => action("select_candidate", { modelReleaseId: model.id })} className="min-h-9 rounded-lg border border-stone-200 px-3 text-xs font-semibold">Candidate</button><button type="button" disabled={busy} onClick={() => action("promote_model", { modelReleaseId: model.id }, `${text(model.model_id)} zum Produktionsmodell machen?`)} className="min-h-9 rounded-lg bg-stone-950 px-3 text-xs font-semibold text-white">Production</button></div></div>)}
      </div>
      <div className="grid gap-3 border-t border-stone-200 p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <select value={evalModelId} onChange={(event) => setEvalModelId(event.target.value)} className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm"><option value="">Eval-Modell</option>{(dashboard.models || []).map((model) => <option key={text(model.id)} value={text(model.id)}>{text(model.model_id)}</option>)}</select>
          <input type="number" min="1" value={evalScenarioCount} onChange={(event) => setEvalScenarioCount(event.target.value)} placeholder="Szenarien" className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm" />
          <input type="number" min="0" value={evalPassedCount} onChange={(event) => setEvalPassedCount(event.target.value)} placeholder="Bestanden" className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm" />
          <input type="number" min="0" value={evalSafetyFailures} onChange={(event) => setEvalSafetyFailures(event.target.value)} placeholder="Safety-Fehler" className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm" />
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <input value={evalReportRef} onChange={(event) => setEvalReportRef(event.target.value)} placeholder="Report-Referenz, z. B. artifacts/voice-evals/...json" className="min-h-10 rounded-lg border border-stone-200 px-3 text-sm" />
          <button type="button" disabled={busy || !evalModelId || !evalReportRef || Number(evalScenarioCount) < 1} onClick={() => { const scenarios = Number(evalScenarioCount); const passed = Number(evalPassedCount); const safety = Number(evalSafetyFailures); void action("record_evaluation", { modelReleaseId: evalModelId, suiteVersion: "de-neontrip-voice-v1", scenarioCount: scenarios, passedCount: passed, safetyFailureCount: safety, averageScore: scenarios > 0 ? Math.round((passed / scenarios) * 100000) / 1000 : 0, status: passed === scenarios && safety === 0 ? "passed" : "failed", report: { report_reference: evalReportRef, raw_transcript_stored: false } }, "Eval-Zähler und Report-Referenz verbindlich speichern?"); }} className="min-h-10 rounded-lg border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40">Eval speichern</button>
        </div>
        <div className="flex flex-wrap gap-2">{(dashboard.evaluations || []).slice(0, 8).map((entry) => <span key={text(entry.id)} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs">{text(entry.suite_version)} · {text(entry.passed_count)}/{text(entry.scenario_count)} · Safety {text(entry.safety_failure_count)} · {text(entry.status)}</span>)}</div>
      </div>
      <div className="border-t border-stone-200 p-4"><button type="button" disabled={busy} onClick={() => action("rollback_model", {}, "Auf das hinterlegte Rollback-Modell wechseln?")} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-stone-200 px-3 text-xs font-semibold"><RotateCcw className="h-4 w-4" /> Modell-Rollback</button></div>
      <div className="divide-y divide-stone-100 border-t border-stone-200">{(dashboard.prompts || []).map((prompt) => <div key={text(prompt.id)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><span><strong>{text(prompt.prompt_key)}</strong> v{text(prompt.version_number)} {badge(prompt.status)}</span>{prompt.status !== "approved" ? <button type="button" disabled={busy} onClick={() => action("approve_prompt", { promptVersionId: prompt.id }, "Diesen Prompt nach Review freigeben?")} className="min-h-9 rounded-lg border border-stone-200 px-3 text-xs font-semibold">Freigeben</button> : null}</div>)}</div>
    </section>

    <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <h3 className="font-semibold text-stone-950">Test-Allowlist</h3>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><input value={allowPhone} onChange={(event) => setAllowPhone(event.target.value)} placeholder="+49..." className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><input value={allowLabel} onChange={(event) => setAllowLabel(event.target.value)} placeholder="Bezeichnung" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><button type="button" disabled={busy || !allowPhone || operatorName.length < 2} onClick={() => action("add_allowlist", { phone: allowPhone, label: allowLabel })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Hinzufügen</button></div>
      <div className="flex flex-wrap gap-2">{(dashboard.allowlist || []).map((entry) => <span key={text(entry.id)} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs">{text(entry.phone_e164)} · {text(entry.label)}</span>)}</div>
    </section>

    <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <h3 className="font-semibold text-stone-950">Einwilligung erfassen</h3>
      <div className="grid gap-2 md:grid-cols-3"><input value={consentRequest} onChange={(event) => setConsentRequest(event.target.value)} placeholder="Request-ID" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><input value={consentPhone} onChange={(event) => setConsentPhone(event.target.value)} placeholder="+49..." className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><select value={consentPurpose} onChange={(event) => setConsentPurpose(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="lead_qualification">Erstkontakt</option><option value="follow_up">Follow-up</option></select></div>
      <div className="grid gap-2 md:grid-cols-3"><select value={consentSource} onChange={(event) => setConsentSource(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="website_form">Webformular</option><option value="email_confirmation">Eingangsbestätigung</option><option value="signed_document">Signierter Nachweis</option></select><input value={consentFormVersion} onChange={(event) => setConsentFormVersion(event.target.value)} placeholder="Formularversion" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><input type="datetime-local" value={consentGrantedAt} onChange={(event) => setConsentGrantedAt(event.target.value)} aria-label="Zeitpunkt der Einwilligung" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /></div>
      <input value={consentSourceRef} onChange={(event) => setConsentSourceRef(event.target.value)} placeholder="Beleg-ID des Formulars oder der Eingangsbestätigung" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" />
      <textarea value={consentWording} onChange={(event) => setConsentWording(event.target.value)} placeholder="Exakter Wortlaut der Einwilligung" className="min-h-24 rounded-lg border border-stone-200 px-3 py-2 text-sm" />
      <button type="button" disabled={busy || consentWording.length < 20 || !consentRequest || !consentPhone || !consentSourceRef || !consentFormVersion || !consentGrantedAt} onClick={() => action("create_consent", { requestId: consentRequest, phone: consentPhone, purposes: [consentPurpose], consentWording, formVersion: consentFormVersion, source: consentSource, sourceRef: consentSourceRef, grantedAt: new Date(consentGrantedAt).toISOString() }, "Einwilligungsnachweis mit exakt diesem Wortlaut und Zeitpunkt speichern?")} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Einwilligung speichern</button>
      <div className="divide-y divide-stone-100 border-t border-stone-200">{(dashboard.consents || []).map((entry) => <div key={text(entry.id)} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{badge(entry.status)} <strong>{text(entry.request_id)}</strong> · {text(entry.phone_e164)} · {text(entry.form_version)}</span>{entry.status === "granted" ? <button type="button" disabled={busy} onClick={() => action("withdraw_consent", { consentId: entry.id }, "Diese Einwilligung widerrufen und offene Ziele blockieren?")} className="min-h-9 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-800">Widerrufen</button> : null}</div>)}</div>
    </section>

    <section className="grid gap-4 rounded-lg border border-stone-200 bg-white p-5">
      <h3 className="font-semibold text-stone-950">Kampagne und Ziel</h3>
      <div className="grid gap-2 md:grid-cols-[1fr_0.8fr_0.9fr_1fr_auto]"><input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Kampagnenname" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><select value={campaignMode} onChange={(event) => setCampaignMode(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="lead_qualification">Erstkontakt</option><option value="follow_up">Follow-up</option></select><select value={campaignScope} onChange={(event) => setCampaignScope(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="sandbox">Sandbox-Allowlist</option><option value="customer">Kunden-Production</option></select><select value={campaignPrompt} onChange={(event) => setCampaignPrompt(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="">Prompt wählen</option>{approvedPrompts.filter((entry) => entry.mode === campaignMode).map((entry) => <option key={text(entry.id)} value={text(entry.id)}>{text(entry.prompt_key)} v{text(entry.version_number)}</option>)}</select><button type="button" disabled={busy || !campaignName || !campaignPrompt} onClick={() => action("create_campaign", { name: campaignName, mode: campaignMode, promptVersionId: campaignPrompt, modelChannel: campaignScope === "sandbox" ? "candidate" : "production", allowlistOnly: campaignScope === "sandbox" }, campaignScope === "customer" ? "Produktive Kundenkampagne als Entwurf anlegen? Aktivierung und Kundencall-Kill-Switch bleiben separat." : undefined)} className="min-h-11 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Anlegen</button></div>
      <div className="divide-y divide-stone-100 border-y border-stone-200">{(dashboard.campaigns || []).map((entry) => <div key={text(entry.id)} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{badge(entry.status)} <strong>{text(entry.name)}</strong> · {text(entry.mode)} · {entry.allowlist_only === true ? "Allowlist" : "Kunden"}</span><div className="flex gap-2">{entry.status !== "active" && !["completed", "cancelled"].includes(text(entry.status)) ? <button type="button" disabled={busy} onClick={() => action("set_campaign_status", { campaignId: entry.id, status: "active" }, "Kampagne aktivieren? Alle Datenbank-, Allowlist- und Kill-Switch-Gates bleiben wirksam.")} className="min-h-9 rounded-lg border border-emerald-200 px-3 text-xs font-semibold text-emerald-900">Aktivieren</button> : null}{entry.status === "active" ? <button type="button" disabled={busy} onClick={() => action("set_campaign_status", { campaignId: entry.id, status: "paused" }, "Kampagne pausieren?")} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-semibold text-amber-900">Pausieren</button> : null}</div></div>)}</div>
      <div className="grid gap-2 md:grid-cols-4"><select value={targetCampaign} onChange={(event) => setTargetCampaign(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="">Kampagne</option>{(dashboard.campaigns || []).map((entry) => <option key={text(entry.id)} value={text(entry.id)}>{text(entry.name)}</option>)}</select><select value={targetConsent} onChange={(event) => setTargetConsent(event.target.value)} className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm"><option value="">Einwilligung</option>{(dashboard.consents || []).filter((entry) => entry.status === "granted").map((entry) => <option key={text(entry.id)} value={text(entry.id)}>{text(entry.request_id)} · {text(entry.phone_e164)}</option>)}</select><input value={targetRequest} onChange={(event) => setTargetRequest(event.target.value)} placeholder="Request-ID" className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /><input value={targetPhone} onChange={(event) => setTargetPhone(event.target.value)} placeholder="+49..." className="min-h-11 rounded-lg border border-stone-200 px-3 text-sm" /></div>
      <button type="button" disabled={busy || !targetCampaign || !targetConsent || !targetRequest || !targetPhone} onClick={() => action("add_target", { campaignId: targetCampaign, consentId: targetConsent, requestId: targetRequest, phone: targetPhone })} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Call-Ziel anlegen</button>
      <div className="divide-y divide-stone-100 border-t border-stone-200">{(dashboard.targets || []).map((entry) => <div key={text(entry.id)} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span>{badge(entry.status)} <strong>{text(entry.request_id)}</strong> · {text(entry.phone_e164)}</span><span className="text-xs text-stone-500">Versuche {text(entry.attempt_count)}{entry.blocked_reason ? ` · ${text(entry.blocked_reason)}` : ""}</span></div>)}</div>
    </section>

    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4"><h3 className="font-semibold text-stone-950">Live-Status und Versuche</h3></div><div className="divide-y divide-stone-100">{(dashboard.attempts || []).map((attempt) => { const outcome = outcomesByAttempt.get(text(attempt.id)); return <div key={text(attempt.id)} className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2">{badge(attempt.status)}<span className="text-sm font-semibold">Versuch {text(attempt.attempt_number)}</span>{outcome ? badge(outcome.outcome_code) : null}</div><p className="mt-2 text-xs text-stone-500">{text(attempt.id)} · {dateTime(attempt.created_at)} · Modell {text(attempt.model_release_id)} · Prompt {text(attempt.prompt_version_id)}</p>{outcome ? <p className="mt-2 text-sm text-stone-700">{text(outcome.summary_for_human)}</p> : null}</div>{activeAttempts.some((entry) => entry.id === attempt.id) ? <div className="flex gap-2"><button type="button" title="Anruf stoppen" aria-label="Anruf stoppen" disabled={busy} onClick={() => action("stop_attempt", { attemptId: attempt.id }, "Diesen Anruf sofort stoppen?")} className="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 text-rose-800"><CircleStop className="h-4 w-4" /></button><button type="button" title="An Menschen übergeben" aria-label="An Menschen übergeben" disabled={busy} onClick={() => action("handoff_attempt", { attemptId: attempt.id }, "Diesen Anruf jetzt an einen Menschen übergeben?")} className="grid h-9 w-9 place-items-center rounded-lg border border-sky-200 text-sky-800"><ArrowRightLeft className="h-4 w-4" /></button></div> : null}</div>; })}{!(dashboard.attempts || []).length ? <p className="px-5 py-6 text-sm text-stone-500">Noch keine Anrufversuche.</p> : null}</div></section>
  </div>;
}
