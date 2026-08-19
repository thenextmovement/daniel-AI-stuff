"use client";

import { useEffect, useState } from "react";
import { CUSTOMER_SEGMENT_OPTIONS, getCustomerSegmentOption } from "@/lib/ops/customer-segments";

const contextTagOptions = [
  ["gastronomy_hospitality", "Gastronomie / Hospitality"],
  ["film_tv", "Film / TV"],
  ["architecture_interior", "Architektur / Interior"],
  ["creator_influencer", "Creator / Influencer"],
  ["healthcare", "Healthcare"],
  ["real_estate", "Immobilien"],
  ["fitness_wellness", "Fitness / Wellness"],
  ["recruiting_employer_branding", "Recruiting / Employer Branding"],
  ["startup_tech", "Startup / Tech"],
  ["luxury_premium_retail", "Luxury / Premium Retail"],
] as const;

const organizationScaleOptions = [
  ["solo", "Solo"],
  ["micro", "Micro"],
  ["small", "Small"],
  ["medium", "Medium"],
  ["large", "Large"],
  ["enterprise", "Enterprise"],
] as const;

type ReviewContext = {
  currentInputHash: string;
  taxonomyVersion: string;
  classifierVersion: string;
  promptVersion: string;
  qualityGateVersion: string;
  goldEligibility: {
    normalizedCustomerType: "privat" | "gewerblich" | "b2b" | null;
    nt8FirstPartyEligible: boolean;
    nt9FirstPartyEligible: boolean;
    nt8RequiresNullOrganizationScale: true;
    nt5RequiresNonnullOrganizationScale: true;
    nt6RequiredOrganizationScale: "enterprise";
    nonNt8RequiresExternalEvidenceUrl: true;
  };
  latestClassification: {
    inputHash: string;
    inputHashCurrent: boolean;
    status: string;
    proposedSegment: string | null;
    sKategorie: string | null;
    confidence: number | null;
    evidenceGrade: string | null;
    reasoningShort: string | null;
    reasonCodes: string[];
    evidenceJson: Array<Record<string, unknown>>;
    riskFlags: string[];
    contextTags: string[];
    organizationScale: string | null;
    evidenceProvenanceValid: boolean;
    mappingIntegrity: boolean;
    classifiedAt: string;
  } | null;
  currentGoldAdjudication: {
    goldAdjudicationId: string;
    inputHash: string;
    labeledSegment: string;
    labeledSKategorie: string;
    contextTags: string[];
    organizationScale: string | null;
    createdAt: string;
  } | null;
};

type ReviewResponse = { ok?: boolean; context?: ReviewContext; error?: string; issues?: string[] };
type AdjudicationResponse = {
  ok?: boolean;
  result?: { created: boolean; idempotentRetry: boolean; masterSegmentMutated: false };
  error?: string;
  issues?: string[];
};

function responseError(payload: ReviewResponse | AdjudicationResponse | null, fallback: string) {
  if (payload?.issues?.length) return payload.issues.join(" ");
  return payload?.error || fallback;
}

function formatConfidence(value: number | null) {
  return typeof value === "number" ? `${Math.round(value * 100)} %` : "ohne Confidence";
}

function evidenceUrlLines(value: string) {
  return [...new Set(value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))];
}

function isValidEvidenceUrl(value: string) {
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function isCurrentGoldProposal(latest: ReviewContext["latestClassification"]) {
  return latest?.inputHashCurrent === true;
}

export function resolveGoldProposalPrefill(latest: ReviewContext["latestClassification"]) {
  if (!isCurrentGoldProposal(latest)) {
    return { segment: "", contextTags: [] as string[], organizationScale: "", evidenceUrls: "" };
  }
  const proposedSegment = latest?.proposedSegment || "";
  return {
    segment: getCustomerSegmentOption(proposedSegment)?.segment || "",
    contextTags: [...(latest?.contextTags || [])],
    organizationScale: latest?.organizationScale || "",
    evidenceUrls: [
      ...new Set((latest?.evidenceJson || []).flatMap((entry) => (
        typeof entry.url === "string" && isValidEvidenceUrl(entry.url) ? [entry.url] : []
      ))),
    ].sort().join("\n"),
  };
}

export function isGoldUiSubmissionReady(input: {
  context: ReviewContext | null;
  currentGold: ReviewContext["currentGoldAdjudication"];
  selectedOptionReady: boolean;
  evidenceReady: boolean;
  organizationScaleReady: boolean;
  firstPartyEligibilityReady: boolean;
  actorReady: boolean;
  reasonReady: boolean;
  confirmed: boolean;
  saving: boolean;
}) {
  return Boolean(
    input.context
    && !input.currentGold
    && input.selectedOptionReady
    && input.evidenceReady
    && input.organizationScaleReady
    && input.firstPartyEligibilityReady
    && input.actorReady
    && input.reasonReady
    && input.confirmed
    && !input.saving,
  );
}

export function SegmentGoldAdjudicationControl({
  requestId,
  operatorName,
}: {
  requestId: string;
  operatorName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [segment, setSegment] = useState("");
  const [contextTags, setContextTags] = useState<string[]>([]);
  const [organizationScale, setOrganizationScale] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setExpanded(false);
    setContext(null);
    setSegment("");
    setContextTags([]);
    setOrganizationScale("");
    setEvidenceUrls("");
    setReason("");
    setConfirmed(false);
    setError(null);
    setMessage(null);
  }, [requestId]);

  async function loadReview() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/customer-records/segment-gold?requestId=${encodeURIComponent(requestId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.context) {
        setError(responseError(payload, "Gold-Review konnte nicht geladen werden."));
        return;
      }
      const next = payload.context;
      setContext(next);
      const prefill = resolveGoldProposalPrefill(next.latestClassification);
      setSegment(prefill.segment);
      setContextTags(prefill.contextTags);
      setOrganizationScale(prefill.organizationScale);
      setEvidenceUrls(prefill.evidenceUrls);
      setConfirmed(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Gold-Review konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    if (next && !context && !loading) await loadReview();
  }

  function toggleContextTag(tag: string) {
    setContextTags((current) => current.includes(tag)
      ? current.filter((entry) => entry !== tag)
      : [...current, tag].sort());
  }

  async function submitGold() {
    if (!context) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/customer-records/segment-gold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          inputHash: context.currentInputHash,
          segment,
          contextTags,
          organizationScale: organizationScale || null,
          operatorName,
          reason,
          evidenceUrls: evidenceUrlLines(evidenceUrls),
        }),
      });
      const payload = await response.json().catch(() => null) as AdjudicationResponse | null;
      if (!response.ok || !payload?.ok || !payload.result || payload.result.masterSegmentMutated !== false) {
        setError(responseError(payload, "Gold-Adjudication wurde nicht gespeichert."));
        return;
      }
      setMessage(payload.result.created
        ? "Gold wurde unveränderlich gespeichert; das Kunden-Segment blieb unverändert."
        : "Identischer Gold-Write war bereits vorhanden; das Kunden-Segment blieb unverändert.");
      await loadReview();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Gold-Adjudication wurde nicht gespeichert.");
    } finally {
      setSaving(false);
    }
  }

  const currentGold = context?.currentGoldAdjudication || null;
  const latest = context?.latestClassification || null;
  const latestProposalCurrent = isCurrentGoldProposal(latest);
  const selectedOption = getCustomerSegmentOption(segment);
  const actorReady = operatorName.trim().length >= 3 && operatorName.trim().length <= 320;
  const parsedEvidenceUrls = evidenceUrlLines(evidenceUrls);
  const evidenceUrlsValid = parsedEvidenceUrls.every(isValidEvidenceUrl);
  const evidenceUrlCountReady = parsedEvidenceUrls.length <= 12;
  const evidenceReady = Boolean(selectedOption)
    && evidenceUrlsValid
    && evidenceUrlCountReady
    && (selectedOption?.segment === "NT-8" || parsedEvidenceUrls.length > 0);
  const organizationScaleReady = !selectedOption
    ? false
    : selectedOption.segment === "NT-8"
      ? organizationScale === ""
      : selectedOption.segment === "NT-5"
        ? organizationScale !== ""
        : selectedOption.segment === "NT-6"
          ? organizationScale === "enterprise"
          : true;
  const firstPartyEligibilityReady = !selectedOption
    ? false
    : selectedOption.segment === "NT-8"
      ? context?.goldEligibility.nt8FirstPartyEligible === true
      : selectedOption.segment === "NT-9"
        ? context?.goldEligibility.nt9FirstPartyEligible === true
        : true;
  const canSubmit = isGoldUiSubmissionReady({
    context,
    currentGold,
    selectedOptionReady: Boolean(selectedOption),
    evidenceReady,
    organizationScaleReady,
    firstPartyEligibilityReady,
    actorReady,
    reasonReady: reason.trim().length >= 20 && reason.trim().length <= 4000,
    confirmed,
    saving,
  });

  return (
    <div className="mt-2 rounded-xl border border-white/15 bg-white/[0.06] p-3 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-sky-200">Evaluation-Gold</div>
          <div className="mt-1 text-xs text-white/62">Separate, unveränderliche Review-Aktion – ändert niemals das Kunden-Segment.</div>
        </div>
        <button
          type="button"
          onClick={() => void toggleExpanded()}
          className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15"
        >
          {expanded ? "Gold-Review schließen" : "Gold-Review öffnen"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          {loading ? <div className="text-sm text-white/65">Aktuellen Review-Vertrag laden...</div> : null}
          {error ? <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-2 text-sm text-rose-100">{error}</div> : null}
          {message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-2 text-sm text-emerald-100">{message}</div> : null}

          {context ? (
            <>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Aktueller Input-Hash</div>
                  <code className="mt-1 block break-all text-[11px] text-white/80">{context.currentInputHash}</code>
                  <div className="mt-1 text-[11px] text-white/55">DB-Kundentyp: {context.goldEligibility.normalizedCustomerType || "nicht eindeutig"}</div>
                </div>
                <div className={`rounded-lg border p-2.5 ${latest?.inputHashCurrent ? "border-emerald-300/20 bg-emerald-300/8" : "border-amber-300/30 bg-amber-300/10"}`}>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Letzter v3-Vorschlag</div>
                  <div className="mt-1 text-sm font-semibold">
                    {latest ? `${latest.proposedSegment || "kein Segment"}${latest.sKategorie ? ` · ${latest.sKategorie}` : ""} · ${formatConfidence(latest.confidence)}` : "Kein v3-Vorschlag vorhanden"}
                  </div>
                  {latest ? <div className="mt-1 text-xs text-white/60">{latest.status} · {latest.evidenceGrade || "ohne Evidence-Grade"} · {latest.inputHashCurrent ? "Input aktuell" : "Vorschlag ist stale"}</div> : null}
                  {latest?.reasoningShort ? <div className="mt-1 text-xs leading-5 text-white/70">{latest.reasoningShort}</div> : null}
                </div>
              </div>

              {!latestProposalCurrent ? (
                <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
                  {latest
                    ? "Der letzte v3-Vorschlag gehört nicht zum aktuellen Input. Seine Segment-, Kontext-, Größen- und Evidence-Werte wurden nicht vorbefüllt. Nach eigener Prüfung kannst du Gold vollständig manuell eingeben."
                    : "Für den aktuellen Input liegt kein v3-Vorschlag vor. Nach eigener Prüfung kannst du Segment, Kontext, Größe und Evidence vollständig manuell als Gold eingeben."}
                </div>
              ) : null}

              {currentGold ? (
                <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-100">
                  Für diesen exakten Input existiert bereits unveränderliches Gold: {currentGold.labeledSegment} · {currentGold.labeledSKategorie}. Eine abweichende Neuschreibung ist gesperrt.
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-white/10 bg-black/15 p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-xs font-semibold text-white/75">
                      Geprüftes Gold-Segment
                      <select
                        value={segment}
                        onChange={(event) => setSegment(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-lg border border-white/15 bg-[#17171c] px-3 text-sm text-white outline-none focus:border-sky-300"
                      >
                        <option value="">Segment wählen</option>
                        {CUSTOMER_SEGMENT_OPTIONS.map((option) => (
                          <option key={option.segment} value={option.segment}>{option.segment} · {option.label}</option>
                        ))}
                      </select>
                      {selectedOption?.segment === "NT-8" && !context.goldEligibility.nt8FirstPartyEligible ? (
                        <span className="mt-1 block text-[11px] text-amber-200">NT-8 ist gesperrt: Der gelockte DB-Kundentyp ist nicht Privat.</span>
                      ) : null}
                      {selectedOption?.segment === "NT-9" && !context.goldEligibility.nt9FirstPartyEligible ? (
                        <span className="mt-1 block text-[11px] text-amber-200">NT-9 ist gesperrt: Der gelockte DB-Kundentyp ist nicht gewerblich/B2B.</span>
                      ) : null}
                    </label>
                    <label className="text-xs font-semibold text-white/75">
                      Organisationsgröße (optional)
                      <select
                        value={organizationScale}
                        onChange={(event) => setOrganizationScale(event.target.value)}
                        className="mt-1.5 h-10 w-full rounded-lg border border-white/15 bg-[#17171c] px-3 text-sm text-white outline-none focus:border-sky-300"
                      >
                        <option value="">Nicht festgelegt</option>
                        {organizationScaleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      {!organizationScaleReady && selectedOption ? (
                        <span className="mt-1 block text-[11px] text-amber-200">
                          {selectedOption.segment === "NT-8"
                            ? "NT-8 erfordert eine leere Organisationsgröße."
                            : selectedOption.segment === "NT-5"
                              ? "NT-5 erfordert eine geprüfte Organisationsgröße."
                              : "NT-6 erfordert exakt Enterprise."}
                        </span>
                      ) : null}
                    </label>
                  </div>

                  <fieldset>
                    <legend className="text-xs font-semibold text-white/75">Kontext-Tags (optional, Mehrfachauswahl)</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {contextTagOptions.map(([value, label]) => (
                        <label key={value} className={`cursor-pointer rounded-full border px-2.5 py-1.5 text-xs ${contextTags.includes(value) ? "border-sky-300/50 bg-sky-300/15 text-sky-100" : "border-white/12 bg-white/5 text-white/65"}`}>
                          <input
                            type="checkbox"
                            checked={contextTags.includes(value)}
                            onChange={() => toggleContextTag(value)}
                            className="sr-only"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className="block text-xs font-semibold text-white/75">
                    Evidence-URLs (eine URL pro Zeile)
                    <textarea
                      value={evidenceUrls}
                      onChange={(event) => setEvidenceUrls(event.target.value)}
                      rows={3}
                      placeholder="https://unternehmen.de/ueber-uns"
                      className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#17171c] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-sky-300"
                    />
                    <span className={`mt-1 block text-[11px] ${evidenceReady ? "text-emerald-200" : "text-amber-200"}`}>
                      {selectedOption?.segment === "NT-8"
                        ? !evidenceUrlCountReady
                          ? "Maximal 12 Evidence-URLs sind zulässig."
                          : evidenceUrlsValid ? "Für Privatkunde nur bei DB-bestätigter Privat-Auswahl optional; sonst blockiert die DB. Eingetragene URLs müssen gültig und maximal 2048 Zeichen lang sein." : "Mindestens eine URL ist ungültig oder länger als 2048 Zeichen."
                        : !parsedEvidenceUrls.length
                          ? "Für jedes Business-Gold ist mindestens eine gültige Evidence-URL Pflicht."
                          : !evidenceUrlCountReady
                            ? "Maximal 12 Evidence-URLs sind zulässig."
                          : evidenceUrlsValid
                            ? `${parsedEvidenceUrls.length} gültige Evidence-URL${parsedEvidenceUrls.length === 1 ? "" : "s"}.`
                            : "Mindestens eine URL ist ungültig oder länger als 2048 Zeichen."}
                    </span>
                  </label>

                  <label className="block text-xs font-semibold text-white/75">
                    Begründung (mindestens 20 Zeichen)
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={4000}
                      rows={3}
                      className="mt-1.5 w-full rounded-lg border border-white/15 bg-[#17171c] px-3 py-2 text-sm text-white outline-none focus:border-sky-300"
                    />
                    <span className="mt-1 block text-[11px] text-white/45">{reason.trim().length}/4000 (mindestens 20) · Bearbeiter: {actorReady ? operatorName.trim() : "fehlt"}</span>
                  </label>

                  <label className="flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/8 p-2.5 text-xs leading-5 text-amber-50">
                    <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                    Ich habe Anfrage, aktuellen Input und Evidence geprüft. Diese Aktion erzeugt Evaluation-Gold, nicht das operative Kundensegment.
                  </label>

                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => void submitGold()}
                    className="rounded-lg border border-sky-200 bg-sky-100 px-4 py-2.5 text-sm font-semibold text-sky-950 transition hover:bg-white disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/35"
                  >
                    {saving ? "Gold wird gespeichert..." : "Geprüftes Gold unveränderlich speichern"}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
