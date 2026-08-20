"use client";

import { useCallback, useEffect, useState } from "react";
import {
  safeExternalSegmentationEvidenceUrl,
  safeSegmentationModelEvidenceLinks,
} from "@/lib/ops/request-segmentation-evidence-url";

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
  blindReviewFacts: {
    requestId: string;
    contactName: string | null;
    company: string | null;
    email: string | null;
    emailDomain: string | null;
    customerType: "privat" | "gewerblich" | "b2b" | null;
    title: string | null;
    description: string | null;
    application: string | null;
    requestedSize: string | null;
    colors: string[];
    deliveryTime: string | null;
    country: string | null;
  };
  goldLabelOptions: Array<{ code: string; label: string }>;
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
    evidenceLinks: Array<{
      url: string;
      host: string;
      type: string;
      usedFor: string;
      evidenceCode: string;
    }>;
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
  return value.length <= 2048 && Boolean(safeExternalSegmentationEvidenceUrl(value));
}

export function safeModelEvidenceLinks(evidence: Array<Record<string, unknown>>) {
  return safeSegmentationModelEvidenceLinks(evidence);
}

export function isGoldUiSubmissionReady(input: {
  context: object | null;
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
  startExpanded = false,
  lockedOpen = false,
  pilotMode = false,
  pilotVersion,
  onPilotAdvance,
}: {
  requestId: string;
  operatorName: string;
  startExpanded?: boolean;
  lockedOpen?: boolean;
  pilotMode?: boolean;
  pilotVersion: string;
  onPilotAdvance?: () => void;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
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
    setExpanded(startExpanded);
    setContext(null);
    setSegment("");
    setContextTags([]);
    setOrganizationScale("");
    setEvidenceUrls("");
    setReason("");
    setConfirmed(false);
    setError(null);
    setMessage(null);
  }, [requestId, startExpanded]);

  const loadReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mode = pilotMode ? "&mode=pilot-review" : "";
      const response = await fetch(`/api/ops/customer-records/segment-gold?requestId=${encodeURIComponent(requestId)}${mode}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as ReviewResponse | null;
      if (!response.ok || !payload?.ok || !payload.context) {
        if (
          pilotMode
          && response.status === 409
          && (payload?.error === "pilot_candidate_not_current" || payload?.error === "pilot_candidate_already_adjudicated")
        ) {
          onPilotAdvance?.();
          return;
        }
        setError(responseError(payload, "Gold-Review konnte nicht geladen werden."));
        return;
      }
      const next = payload.context;
      setContext(next);
      setSegment("");
      setContextTags([]);
      setOrganizationScale("");
      setEvidenceUrls("");
      setConfirmed(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Gold-Review konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [onPilotAdvance, pilotMode, requestId]);

  useEffect(() => {
    if (startExpanded) void loadReview();
  }, [loadReview, startExpanded]);

  async function toggleExpanded() {
    if (lockedOpen) return;
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
        cache: "no-store",
        body: JSON.stringify({
          requestId,
          inputHash: context.currentInputHash,
          segment,
          contextTags,
          organizationScale: organizationScale || null,
          operatorName,
          reason,
          evidenceUrls: evidenceUrlLines(evidenceUrls),
          ...(pilotMode ? { pilotVersion } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as AdjudicationResponse | null;
      if (!response.ok || !payload?.ok || !payload.result || payload.result.masterSegmentMutated !== false) {
        if (pilotMode && response.status === 409 && payload?.error === "pilot_candidate_not_current") {
          onPilotAdvance?.();
          return;
        }
        setError(responseError(payload, "Gold-Adjudication wurde nicht gespeichert."));
        return;
      }
      setMessage(payload.result.created
        ? "Gold wurde unveränderlich gespeichert; das Kunden-Segment blieb unverändert."
        : "Identischer Gold-Write war bereits vorhanden; das Kunden-Segment blieb unverändert.");
      if (pilotMode) {
        onPilotAdvance?.();
        return;
      }
      await loadReview();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Gold-Adjudication wurde nicht gespeichert.");
    } finally {
      setSaving(false);
    }
  }

  const currentGold = context?.currentGoldAdjudication || null;
  const latest = currentGold && context?.latestClassification?.inputHashCurrent === true
    ? context.latestClassification
    : null;
  const modelEvidenceLinks = latest?.evidenceLinks || [];
  const selectedOption = context?.goldLabelOptions.find((option) => option.code === segment) || null;
  const actorReady = operatorName.trim().length >= 3 && operatorName.trim().length <= 160;
  const parsedEvidenceUrls = evidenceUrlLines(evidenceUrls);
  const evidenceUrlsValid = parsedEvidenceUrls.every(isValidEvidenceUrl);
  const evidenceUrlCountReady = parsedEvidenceUrls.length <= 12;
  const evidenceReady = Boolean(selectedOption)
    && evidenceUrlsValid
    && evidenceUrlCountReady
    && (selectedOption?.code === "NT-8" || parsedEvidenceUrls.length > 0);
  const organizationScaleReady = !selectedOption
    ? false
    : selectedOption.code === "NT-8"
      ? organizationScale === ""
      : selectedOption.code === "NT-5"
        ? organizationScale !== ""
        : selectedOption.code === "NT-6"
          ? organizationScale === "enterprise"
          : true;
  const firstPartyEligibilityReady = !selectedOption
    ? false
    : selectedOption.code === "NT-8"
      ? context?.goldEligibility.nt8FirstPartyEligible === true
      : selectedOption.code === "NT-9"
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
        {!lockedOpen ? (
          <button
            type="button"
            onClick={() => void toggleExpanded()}
            className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/15"
          >
            {expanded ? "Gold-Review schließen" : "Gold-Review öffnen"}
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          {loading ? <div className="text-sm text-white/65">Aktuellen Review-Vertrag laden...</div> : null}
          {error ? <div className="rounded-lg border border-rose-300/30 bg-rose-300/10 p-2 text-sm text-rose-100">{error}</div> : null}
          {message ? <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-2 text-sm text-emerald-100">{message}</div> : null}

          {context ? (
            <>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-200">Kuratiertes, blindes Prüfpaket</div>
                <dl className="mt-3 grid gap-x-5 gap-y-3 text-xs md:grid-cols-2">
                  {[
                    ["Anfrage", context.blindReviewFacts.requestId],
                    ["Kontakt", context.blindReviewFacts.contactName],
                    ["Firma", context.blindReviewFacts.company],
                    ["E-Mail", context.blindReviewFacts.email],
                    ["E-Mail-Domain", context.blindReviewFacts.emailDomain],
                    ["First-Party-Kundentyp", context.blindReviewFacts.customerType],
                    ["Anfragetitel", context.blindReviewFacts.title],
                    ["Anwendung", context.blindReviewFacts.application],
                    ["Wunschgröße", context.blindReviewFacts.requestedSize],
                    ["Farben", context.blindReviewFacts.colors.join(", ") || null],
                    ["Lieferzeit", context.blindReviewFacts.deliveryTime],
                    ["Land", context.blindReviewFacts.country],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] uppercase tracking-[0.13em] text-white/42">{label}</dt>
                      <dd className="mt-1 break-words leading-5 text-white/82">{value || "nicht angegeben"}</dd>
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <dt className="text-[10px] uppercase tracking-[0.13em] text-white/42">Beschreibung / Briefing</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words leading-5 text-white/82">{context.blindReviewFacts.description || "nicht angegeben"}</dd>
                  </div>
                </dl>
                <div className="mt-3 text-[11px] leading-5 text-white/45">
                  Dieses Paket enthält ausschließlich explizit freigegebene Request- und Firmenfelder. Operative oder historische Segmentdaten werden auf dieser Seite nicht geladen.
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/45">Aktueller Input-Hash</div>
                <code className="mt-1 block break-all text-[11px] text-white/80">{context.currentInputHash}</code>
                <div className="mt-1 text-[11px] text-white/55">DB-Kundentyp: {context.goldEligibility.normalizedCustomerType || "nicht eindeutig"}</div>
              </div>

              {currentGold ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-100">
                    <div className="font-semibold">Unveränderliches Gold: {currentGold.labeledSegment} · {currentGold.labeledSKategorie}</div>
                    <div className="mt-1 text-xs leading-5 text-emerald-50/75">
                      Kontext: {currentGold.contextTags.length ? currentGold.contextTags.join(", ") : "keine"} · Organisationsgröße: {currentGold.organizationScale || "nicht festgelegt"}. Eine abweichende Neuschreibung ist gesperrt.
                    </div>
                  </div>

                  <div className="rounded-lg border border-sky-300/25 bg-sky-300/8 p-3">
                    <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-sky-200">Modellvergleich – erst nach Gold sichtbar</div>
                    {latest ? (
                      <div className="mt-2 space-y-2 text-xs text-white/72">
                        <div className="text-sm font-semibold text-white">
                          {latest.proposedSegment || "kein Segment"}{latest.sKategorie ? ` · ${latest.sKategorie}` : ""} · {formatConfidence(latest.confidence)}
                        </div>
                        <div>
                          Status: {latest.status} · Evidence-Grade: {latest.evidenceGrade || "nicht gesetzt"} · {latest.inputHashCurrent ? "Input aktuell" : "Vorschlag ist stale"}
                        </div>
                        {latest.reasoningShort ? <div className="leading-5">Modellbegründung: {latest.reasoningShort}</div> : null}
                        <div>Reason-Codes: {latest.reasonCodes.length ? latest.reasonCodes.join(", ") : "keine"}</div>
                        <div>Risk-Flags: {latest.riskFlags.length ? latest.riskFlags.join(", ") : "keine"}</div>
                        <div>
                          Evidence-Provenance: {latest.evidenceProvenanceValid ? "gültig" : "ungültig"} · Mapping-Integrität: {latest.mappingIntegrity ? "gültig" : "ungültig"}
                        </div>
                        <div>
                          Kontext: {latest.contextTags.length ? latest.contextTags.join(", ") : "keine"} · Organisationsgröße: {latest.organizationScale || "nicht gesetzt"}
                        </div>
                        <div>
                          <div className="font-semibold text-white/80">Externe Modell-Evidence</div>
                          {modelEvidenceLinks.length ? (
                            <ul className="mt-1 space-y-1">
                              {modelEvidenceLinks.map((evidence) => (
                                <li key={evidence.url}>
                                  <a
                                    href={evidence.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    referrerPolicy="no-referrer"
                                    className="break-all text-sky-200 underline decoration-sky-200/40 underline-offset-2 hover:text-white"
                                  >
                                    {evidence.host}
                                  </a>
                                  <span className="text-white/45"> · {evidence.type} · {evidence.usedFor} · {evidence.evidenceCode}</span>
                                </li>
                              ))}
                            </ul>
                          ) : <div className="mt-1 text-white/45">Keine sichere externe HTTP(S)-Evidence verlinkbar.</div>}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-white/65">Für diesen Input ist kein v3-Modellergebnis vorhanden.</div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm leading-5 text-amber-100">
                    Blinde Gold-Bewertung: Modellvorschlag und Modell-Evidence bleiben bis nach dem unveränderlichen Speichern serverseitig ausgeblendet. Segment, Kontext, Größe und Evidence werden nie vorbefüllt.
                  </div>
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
                        {context.goldLabelOptions.map((option) => (
                          <option key={option.code} value={option.code}>{option.code} · {option.label}</option>
                        ))}
                      </select>
                      {selectedOption?.code === "NT-8" && !context.goldEligibility.nt8FirstPartyEligible ? (
                        <span className="mt-1 block text-[11px] text-amber-200">NT-8 ist gesperrt: Der gelockte DB-Kundentyp ist nicht Privat.</span>
                      ) : null}
                      {selectedOption?.code === "NT-9" && !context.goldEligibility.nt9FirstPartyEligible ? (
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
                          {selectedOption.code === "NT-8"
                            ? "NT-8 erfordert eine leere Organisationsgröße."
                            : selectedOption.code === "NT-5"
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
                      {selectedOption?.code === "NT-8"
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
                </>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
