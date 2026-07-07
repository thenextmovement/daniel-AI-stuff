"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckSquare,
  Copy,
  Eye,
  ExternalLink,
  ImagePlus,
  Link2,
  Palette,
  RefreshCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass, OpsStatCard } from "../ops-design";
import type { OpsOfferSnapshot } from "@/lib/ops/offers";
import type {
  DesignAssetSummary,
  DesignAttachment,
  DesignJobDraft,
  DesignJobSummary,
  DesignRemovalPlan,
  DesignWorkspace,
} from "@/lib/ops/design";

type DesignApiResponse = {
  ok: boolean;
  workspace?: DesignWorkspace;
  job?: DesignJobDraft;
  jobs?: DesignJobSummary[];
  removalPlan?: DesignRemovalPlan;
  offer?: OpsOfferSnapshot;
  result?: {
    status?: string;
    asset?: DesignAssetSummary;
    job?: DesignJobSummary;
    trelloAttachmentId?: string;
    removalPlan?: DesignRemovalPlan;
    deleted?: number;
    failed?: Array<{ attachmentId: string; error: string }>;
    dryRun?: boolean;
  };
  error?: string;
  issues?: string[];
};

function formatApiError(payload: DesignApiResponse | null) {
  if (!payload) return "Anfrage fehlgeschlagen.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Anfrage fehlgeschlagen.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "ohne Datum";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "ohne Wert";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function createClientActionId() {
  return window.crypto?.randomUUID?.() || `design-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function kindLabel(kind: DesignAttachment["kind"]) {
  if (kind === "mockup") return "Mockup";
  if (kind === "reference") return "Referenz";
  if (kind === "image") return "Bild";
  if (kind === "video") return "Video";
  return "Sonstiges";
}

function kindTone(kind: DesignAttachment["kind"]) {
  if (kind === "mockup") return "border-[#f2bddb] bg-[#fff1f8] text-[#a01862]";
  if (kind === "reference") return "border-[#b7d8ea] bg-[#eef8fd] text-[#175473]";
  if (kind === "image") return "border-[#badbc6] bg-[#f1fbf5] text-[#14532d]";
  if (kind === "video") return "border-[#c8c0f4] bg-[#f5f2ff] text-[#4c1d95]";
  return "border-[#ded8d0] bg-[#fffdf9] text-[#62584d]";
}

const DESIGN_CONSTRAINT_START = "[[NEONTRIP_DESIGN_STUDIO_CONSTRAINT]]";
const DESIGN_CONSTRAINT_END = "[[/NEONTRIP_DESIGN_STUDIO_CONSTRAINT]]";
const LIGHT_COLOR_PRESETS = {
  original: { label: "Original", value: null, swatch: "linear-gradient(135deg,#f8fafc,#d6d3d1)" },
  warm_white: { label: "Warmweiß", value: "warmweiß", swatch: "#ffe7a3" },
  cool_white: { label: "Kaltweiß", value: "kaltweiß", swatch: "#dbeafe" },
  red: { label: "Rot", value: "rot", swatch: "#ef4444" },
  pink: { label: "Pink", value: "pink / magenta", swatch: "#ec4899" },
  blue: { label: "Blau", value: "blau", swatch: "#3b82f6" },
  green: { label: "Grün", value: "grün", swatch: "#22c55e" },
  amber: { label: "Orange", value: "orange", swatch: "#f97316" },
  rgb: { label: "RGB", value: "RGB-Farbverlauf", swatch: "linear-gradient(135deg,#ef4444,#22c55e,#3b82f6)" },
  custom: { label: "Eigene", value: null, swatch: "linear-gradient(135deg,#111827,#f8fafc)" },
} as const;
const MOCKUP_PRESETS = {
  original: null,
  wall: {
    label: "Wand",
    lines: [
      "Preset: Wandmockup",
      "Nutze den bestehenden Kartenprompt als Basis, visualisiere das Produkt aber ausschließlich als hochwertiges Wandmockup.",
      "Das Schild ist realistisch an einer passenden Innenwand montiert, mit sauberer Perspektive, natürlichem Licht und realistischer LED-Wirkung.",
      "Keine Tischaufstellung, kein Standfuß, keine Fassade, kein Schaufenster.",
    ],
  },
  tabletop: {
    label: "Tischgerät",
    lines: [
      "Preset: Tischgerät / Standgerät",
      "Nutze den bestehenden Kartenprompt als Basis, visualisiere das Produkt aber ausschließlich als freistehendes Tischgerät.",
      "Das Schild steht auf einem Tisch, Tresen, Sideboard oder Schreibtisch und ist nicht an Wand, Fenster, Fassade oder Schaufenster montiert.",
      "Zeige eine glaubwürdige Tischaufstellung mit stabilem Standfuß, Sockel oder freistehendem Acrylaufsteller.",
      "Keine Wandmontage, keine Wandhalterung, keine Außenfassade, keine große Rauminstallation.",
    ],
  },
  counter: {
    label: "Tresen",
    lines: [
      "Preset: Tresenmockup",
      "Nutze den bestehenden Kartenprompt als Basis, visualisiere das Produkt aber ausschließlich auf einem Empfangstresen, Verkaufstresen oder Bartresen.",
      "Das Schild steht nah am Betrachter auf der Tresenfläche, wirkt hochwertig und bleibt klar lesbar.",
      "Keine Wandmontage, keine Außenfassade, keine Fensterbeklebung.",
    ],
  },
  window: {
    label: "Schaufenster",
    lines: [
      "Preset: Schaufenster",
      "Nutze den bestehenden Kartenprompt als Basis, visualisiere das Produkt ausschließlich als hochwertiges Schaufenster- oder Glasfront-Mockup.",
      "Das Schild wirkt realistisch im Ladenfenster oder direkt hinter Glas, mit kontrollierten Reflexionen und klar lesbarer Schrift.",
      "Keine Tischaufstellung, keine Innenwandmontage, keine Außenfassade ohne Glasbezug.",
    ],
  },
  outdoor: {
    label: "Outdoor",
    lines: [
      "Preset: Outdoor / Fassade",
      "Nutze den bestehenden Kartenprompt als Basis, visualisiere das Produkt ausschließlich in einem realistischen Außenbereich oder an einer hochwertigen Fassade.",
      "Achte auf wetterfest wirkende Montage, glaubwürdige Tages- oder Abendlichtsituation und klare Lesbarkeit.",
      "Keine Tischaufstellung, kein Innenraum, kein reines Produktfreisteller-Bild.",
    ],
  },
} as const;
type LightColorPresetKey = keyof typeof LIGHT_COLOR_PRESETS;
type MockupPresetKey = keyof typeof MOCKUP_PRESETS;

function mockupPresetLabel(presetKey: MockupPresetKey) {
  if (presetKey === "original") return "Original";
  return MOCKUP_PRESETS[presetKey].label;
}

function removeDesignConstraint(prompt: string) {
  const escapedStart = DESIGN_CONSTRAINT_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = DESIGN_CONSTRAINT_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return prompt.replace(new RegExp(`\\n*${escapedStart}[\\s\\S]*?${escapedEnd}\\n*`, "g"), "\n").trim();
}

function promptWithMockupConstraint(prompt: string, presetKey: Exclude<MockupPresetKey, "original">) {
  const base = removeDesignConstraint(prompt);
  const preset = MOCKUP_PRESETS[presetKey];
  const constraint = [DESIGN_CONSTRAINT_START, ...preset.lines, DESIGN_CONSTRAINT_END].join("\n");
  return [base, constraint].filter(Boolean).join("\n\n");
}

function selectedLightColor(presetKey: LightColorPresetKey, customLightColor: string) {
  if (presetKey === "original") return null;
  if (presetKey === "custom") return customLightColor.trim() || null;
  return LIGHT_COLOR_PRESETS[presetKey].value;
}

function promptWithStudioConstraints(prompt: string, presetKey: MockupPresetKey, lightColorKey: LightColorPresetKey, customLightColor: string) {
  const base = removeDesignConstraint(prompt);
  const lightColor = selectedLightColor(lightColorKey, customLightColor);
  if (presetKey !== "original" && !lightColor) return promptWithMockupConstraint(base, presetKey);
  const lines: string[] = [];
  if (presetKey !== "original") lines.push(...MOCKUP_PRESETS[presetKey].lines);
  if (lightColor) {
    lines.push(
      "Leuchtfarbe ändern:",
      `Ändere ausschließlich die sichtbare Leuchtfarbe des Schildes zu ${lightColor}.`,
      "Text, Logo-/Schriftanmutung, Form, Größe, Material, Perspektive, Hintergrund und Montageart unverändert lassen.",
      "Keine neuen Wörter, Logos, Designelemente, Preisangaben oder Lieferzusagen hinzufügen.",
    );
  }
  if (!lines.length) return base;
  const constraint = [DESIGN_CONSTRAINT_START, ...lines, DESIGN_CONSTRAINT_END].join("\n");
  return [base, constraint].filter(Boolean).join("\n\n");
}

export function DesignOpsClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const [hasSession] = useState(initialHasSession);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<DesignWorkspace | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptPreset, setPromptPreset] = useState<MockupPresetKey>("original");
  const [lightColorPreset, setLightColorPreset] = useState<LightColorPresetKey>("original");
  const [customLightColor, setCustomLightColor] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [offer, setOffer] = useState<OpsOfferSnapshot | null>(null);
  const [selectedOfferImageId, setSelectedOfferImageId] = useState("");
  const [selectedOfferItemId, setSelectedOfferItemId] = useState("");
  const [selectedReferenceAttachmentId, setSelectedReferenceAttachmentId] = useState("");
  const [selectedReferenceAssetId, setSelectedReferenceAssetId] = useState("");
  const [job, setJob] = useState<DesignJobDraft | null>(null);
  const [jobs, setJobs] = useState<DesignJobSummary[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [removalPlan, setRemovalPlan] = useState<DesignRemovalPlan | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState("");
  const [loading, setLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generatedAssets = useMemo(
    () => jobs.flatMap((item) => item.assets || []).filter((asset) => asset.publicUrl),
    [jobs],
  );
  const selectedAsset = generatedAssets.find((asset) => asset.id === selectedAssetId) || generatedAssets[0] || null;

  const loadRecentJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const response = await fetch("/api/ops/design/jobs?limit=18");
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (response.ok && payload?.ok && payload.jobs) {
        setJobs(payload.jobs);
        const nextAsset = payload.jobs.flatMap((item) => item.assets || []).find((asset) => asset.publicUrl);
        if (nextAsset && !selectedAssetId) setSelectedAssetId(nextAsset.id);
      }
    } catch {
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, [selectedAssetId]);

  useEffect(() => {
    try {
      setOperatorName(window.localStorage.getItem("neontrip-design-operator") || "");
    } catch {
      setOperatorName("");
    }
  }, []);

  useEffect(() => {
    void loadRecentJobs();
  }, [loadRecentJobs]);

  useEffect(() => {
    setPromptDraft(workspace?.promptPreview.prompt || "");
    setPromptPreset("original");
    setLightColorPreset("original");
    setCustomLightColor("");
    const nextOfferId = workspace?.offerCandidates.find((candidate) => !candidate.locked)?.id || "";
    setSelectedOfferId(nextOfferId);
    setOffer(null);
    setSelectedOfferImageId("");
    setSelectedOfferItemId("");
    const defaultReference =
      workspace?.primaryCard?.attachments.find((attachment) => attachment.kind === "mockup") ||
      workspace?.primaryCard?.attachments.find((attachment) => attachment.kind === "reference" || attachment.kind === "image") ||
      null;
    setSelectedReferenceAttachmentId(defaultReference?.id || "");
    setSelectedReferenceAssetId("");
    setSelectedAttachmentIds([]);
    setRemovalPlan(null);
    setJob(null);
  }, [workspace]);

  const selectedReferenceAttachment = useMemo(
    () => selectedReferenceAssetId ? null : workspace?.cards.flatMap((card) => card.attachments).find((attachment) => attachment.id === selectedReferenceAttachmentId) || null,
    [workspace, selectedReferenceAssetId, selectedReferenceAttachmentId],
  );
  const selectedReferenceAsset = useMemo(
    () => generatedAssets.find((asset) => asset.id === selectedReferenceAssetId) || null,
    [generatedAssets, selectedReferenceAssetId],
  );

  function applyPromptControls(nextPreset: MockupPresetKey, nextLightColorPreset: LightColorPresetKey, nextCustomLightColor = customLightColor) {
    if (!workspace) return;
    setPromptPreset(nextPreset);
    setLightColorPreset(nextLightColorPreset);
    setJob(null);
    const basePrompt = removeDesignConstraint(promptDraft || workspace.promptPreview.prompt || "");
    setPromptDraft(promptWithStudioConstraints(basePrompt, nextPreset, nextLightColorPreset, nextCustomLightColor));
  }

  function applyPromptPreset(nextPreset: MockupPresetKey) {
    applyPromptControls(nextPreset, lightColorPreset);
  }

  function applyLightColorPreset(nextPreset: LightColorPresetKey) {
    applyPromptControls(promptPreset, nextPreset);
  }

  function updateCustomLightColor(nextColor: string) {
    setCustomLightColor(nextColor);
    if (lightColorPreset === "custom") applyPromptControls(promptPreset, "custom", nextColor);
  }

  async function searchDesignWorkspace(nextQuery = query) {
    const normalized = nextQuery.trim();
    if (!normalized) {
      setError("Bitte Trello-Link, Card-ID, Request-ID, Offer-Nummer oder Kundendaten eingeben.");
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/design?query=${encodeURIComponent(normalized)}`);
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.workspace) throw new Error(formatApiError(payload));
      setWorkspace(payload.workspace);
    } catch (searchError) {
      setWorkspace(null);
      setError(searchError instanceof Error ? searchError.message : "Design-Kontext konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function savePromptDraft() {
    if (!workspace) return;
    if (promptDraft.trim().length < 40) {
      setError("Prompt ist zu kurz.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (operatorName.trim()) window.localStorage.setItem("neontrip-design-operator", operatorName.trim());
      const response = await fetch("/api/ops/design/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: createClientActionId(),
          query: workspace.query,
          promptTitle: workspace.promptPreview.title,
          promptText: promptDraft,
          operatorName,
          offerId: selectedOfferId || null,
          referenceAttachmentIds: selectedReferenceAssetId ? [] : selectedReferenceAttachmentId ? [selectedReferenceAttachmentId] : [],
          referenceAssetId: selectedReferenceAssetId || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.job) throw new Error(formatApiError(payload));
      setJob(payload.job);
      setMessage(`Draft gespeichert: ${payload.job.id.slice(0, 8)} · Prompt v${payload.job.promptVersion.versionNumber}`);
      void loadRecentJobs();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Design-Draft konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function queueSavedDraft() {
    if (!job) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/design/jobs/${encodeURIComponent(job.id)}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorName, offerId: selectedOfferId || null }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.job) throw new Error(formatApiError(payload));
      setJob(payload.job);
      setMessage("Job freigegeben. Der Worker kann ihn jetzt abholen.");
      void loadRecentJobs();
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "Design-Job konnte nicht freigegeben werden.");
    } finally {
      setBusy(false);
    }
  }

  async function generateSavedDraft() {
    if (!job) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/design/jobs/${encodeURIComponent(job.id)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: createClientActionId(), operatorName }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.result) throw new Error(formatApiError(payload));
      if (payload.result.asset?.id) {
        setSelectedAssetId(payload.result.asset.id);
        setSelectedReferenceAssetId(payload.result.asset.id);
        setSelectedReferenceAttachmentId("");
      }
      setMessage(`Mockup generiert${payload.result.asset?.name ? `: ${payload.result.asset.name}` : "."}`);
      void loadRecentJobs();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Mockup konnte nicht generiert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function loadOffer(offerId = selectedOfferId) {
    if (!offerId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/design/offers/${encodeURIComponent(offerId)}`);
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.offer) throw new Error(formatApiError(payload));
      setOffer(payload.offer);
      setSelectedOfferImageId(payload.offer.images.find((image) => image.enabled)?.id || payload.offer.images[0]?.id || "");
      setSelectedOfferItemId(payload.offer.items.find((item) => item.selectedByDefault)?.id || payload.offer.items[0]?.id || "");
    } catch (offerError) {
      setOffer(null);
      setError(offerError instanceof Error ? offerError.message : "Angebot konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }

  async function linkOffer(dryRun: boolean) {
    if (!selectedAsset || !selectedOfferId) {
      setError("Bitte generiertes Asset und Angebot auswählen.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/design/offer-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: selectedAsset.id,
          offerId: selectedOfferId,
          offerImageId: selectedOfferImageId || null,
          offerItemId: selectedOfferItemId || null,
          expectedUpdatedAt: offer?.updatedAt || null,
          operatorName,
          dryRun,
        }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      setMessage(dryRun ? "Offer-Link geprüft. Du kannst ihn jetzt übernehmen." : "Design-Asset wurde mit Angebot und CRM-Bildkontext verknüpft.");
      void loadRecentJobs();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Offer-Link konnte nicht erstellt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function prepareRemovalPlan() {
    if (!workspace || !selectedAttachmentIds.length) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/design/removal-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: createClientActionId(),
          query: workspace.query,
          attachmentIds: selectedAttachmentIds,
          operatorName,
          reason: "ops_design_bulk_cleanup",
        }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.removalPlan) throw new Error(formatApiError(payload));
      setRemovalPlan(payload.removalPlan);
      setMessage(`Removal-Plan vorbereitet: ${payload.removalPlan.selectedAttachmentCount} Anhaenge. Noch nichts gelöscht.`);
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Removal-Plan konnte nicht vorbereitet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function applyRemovalPlan() {
    if (!removalPlan) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/design/removal-plans/${encodeURIComponent(removalPlan.id)}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmText: confirmRemoval, operatorName }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.result) throw new Error(formatApiError(payload));
      setRemovalPlan(payload.result.removalPlan || removalPlan);
      setMessage(`Trello-Bulk abgeschlossen: ${payload.result.deleted || 0} gelöscht, ${payload.result.failed?.length || 0} Fehler.`);
      setSelectedAttachmentIds([]);
      if (workspace) void searchDesignWorkspace(workspace.query);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Removal konnte nicht angewendet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function attachToTrello(jobId: string, assetId: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/design/jobs/${encodeURIComponent(jobId)}/trello`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, operatorName }),
      });
      const payload = (await response.json().catch(() => null)) as DesignApiResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      setMessage(`Asset an Trello angehängt: ${payload.result?.trelloAttachmentId || "ok"}`);
      void loadRecentJobs();
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : "Asset konnte nicht an Trello angehängt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!promptDraft) return;
    await navigator.clipboard.writeText(promptDraft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function toggleAttachmentSelection(attachmentId: string) {
    setSelectedAttachmentIds((current) =>
      current.includes(attachmentId) ? current.filter((id) => id !== attachmentId) : [...current, attachmentId],
    );
  }

  if (!opsEnabled) {
    return (
      <main className={opsPageShellClass}>
        <div className={`${opsPageContainerClass} px-4 py-6`}>
          <div className="rounded-[18px] border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            Ops ist nicht konfiguriert. OPS_PORTAL_TOKEN oder Cloudflare Access fehlt.
          </div>
        </div>
      </main>
    );
  }

  if (!hasSession && !localMode) {
    return (
      <main className={opsPageShellClass}>
        <div className={`${opsPageContainerClass} px-4 py-6`}>
          <div className="rounded-[18px] border border-stone-200 bg-white p-5">
            <p className="text-sm font-semibold text-stone-500">Design Ops</p>
            <h1 className="mt-2 text-2xl font-bold">Login erforderlich</h1>
            <a href="/ops-login?next=%2Fops%2Fdesign" className="mt-4 inline-flex rounded-lg bg-stone-950 px-4 py-2 text-sm font-semibold text-white">
              Ops Login öffnen
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-5 sm:px-6 lg:px-8`}>
        <OpsPageHeader active="design" label="Design" />

        <div className="mt-5 grid gap-5">
          <OpsPageIntro
            eyebrow="Design"
            title="Mockups, Trello-Medien und Angebotsdesign steuern"
            description="Arbeitsbereich für manuelle KI-Mockups, Prompt-Review, Bulk-Cleanup auf Trello und sichere Offer-Zuordnung. Postgres bleibt die Quelle; Trello ist Projektion."
          >
            <a href="/ops/company-brain" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.65rem] bg-white px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-stone-100">
              Fall prüfen
              <ExternalLink className="h-4 w-4" />
            </a>
          </OpsPageIntro>

          <section className="rounded-[18px] border border-[#ded8d0] bg-white p-4 shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_9rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void searchDesignWorkspace();
                  }}
                  placeholder="Trello-Link, Card-ID, Request-ID, Offer-Nummer oder Kunde"
                  className="h-11 w-full rounded-[0.65rem] border border-[#ded8d0] bg-[#fffdf9] pl-10 pr-3 text-sm outline-none focus:border-stone-950"
                />
              </div>
              <input
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                placeholder="Operator"
                className="h-11 rounded-[0.65rem] border border-[#ded8d0] bg-[#fffdf9] px-3 text-sm outline-none focus:border-stone-950"
              />
              <button
                type="button"
                onClick={() => void searchDesignWorkspace()}
                disabled={loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[0.65rem] bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Laden
              </button>
            </div>
          </section>

          {error ? <div className="rounded-[14px] border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800">{error}</div> : null}
          {message ? <div className="rounded-[14px] border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{message}</div> : null}

          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="space-y-5">
              {!workspace ? (
                <div className="rounded-[18px] border border-dashed border-[#d8d0c4] bg-white p-8 text-center">
                  <Palette className="mx-auto h-9 w-9 text-stone-400" />
                  <h2 className="mt-3 text-lg font-semibold">Design-Kontext laden</h2>
                  <p className="mt-2 text-sm text-stone-600">Suche nach Karte oder Fall. Es werden erst Daten verändert, wenn du explizit speicherst, freigibst oder bestätigst.</p>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-4">
                    <OpsStatCard label="Karten" value={workspace.cards.length} />
                    <OpsStatCard label="Anhänge" value={workspace.stats.totalAttachments} />
                    <OpsStatCard label="Mockups" value={workspace.stats.mockups} tone={workspace.stats.mockups ? "success" : "warning"} />
                    <OpsStatCard label="Angebote" value={workspace.stats.offers} />
                  </div>

                  <div className="rounded-[18px] border border-[#ded8d0] bg-white p-5 shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold">Fallkontext</h2>
                        <p className="mt-1 text-sm text-stone-600">
                          {workspace.record?.displayName || workspace.record?.company || workspace.record?.email || "Kein Customer Record gefunden"}
                        </p>
                      </div>
                      {workspace.primaryCard?.cardUrl ? (
                        <a href={workspace.primaryCard.cardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-950">
                          <ExternalLink className="h-4 w-4" />
                          Trello öffnen
                        </a>
                      ) : null}
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                      <div><dt className="font-semibold text-stone-500">Request</dt><dd>{workspace.record?.requestId || "-"}</dd></div>
                      <div><dt className="font-semibold text-stone-500">Projekt</dt><dd>{workspace.record?.request?.title || workspace.primaryCard?.cardName || "-"}</dd></div>
                      <div><dt className="font-semibold text-stone-500">Kategorie</dt><dd>{workspace.record?.request?.sKategorie || workspace.record?.request?.segmentLabel || "-"}</dd></div>
                      <div><dt className="font-semibold text-stone-500">Größe</dt><dd>{workspace.record?.request?.size || "-"}</dd></div>
                      <div><dt className="font-semibold text-stone-500">Farben</dt><dd>{workspace.record?.request?.colors?.join(", ") || "-"}</dd></div>
                      <div><dt className="font-semibold text-stone-500">Anwendung</dt><dd>{workspace.record?.request?.application || "-"}</dd></div>
                    </dl>
                  </div>

                  <div className="rounded-[18px] border border-[#ded8d0] bg-white p-5 shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold">Trello Assets</h2>
                        <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Backup vor Delete
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void prepareRemovalPlan()}
                        disabled={busy || !selectedAttachmentIds.length}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.65rem] border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-800 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Removal vorbereiten
                      </button>
                    </div>

                    <div className="mt-4 space-y-4">
                      {workspace.cards.map((card) => (
                        <div key={card.cardId} className="rounded-[14px] border border-[#ded8d0] bg-[#fffdf9] p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold">{card.cardName || card.cardId}</div>
                              <div className="text-xs text-stone-500">{card.attachments.length} Anhänge · {card.listName || `Liste ${card.listId || "-"}`}</div>
                              {card.promptBlocks.hasMarkers ? (
                                <div className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                                  Prompt Marker
                                </div>
                              ) : null}
                            </div>
                            {card.cardUrl ? (
                              <a href={card.cardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-stone-700">
                                <Link2 className="h-3.5 w-3.5" />
                                Karte
                              </a>
                            ) : null}
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {card.attachments.map((asset) => (
                              <div key={asset.id} className="overflow-hidden rounded-[14px] border border-[#ded8d0] bg-white">
                                <div className="grid grid-cols-2 border-b border-[#ece6dc] bg-[#fffdf9] text-xs font-semibold text-stone-700">
                                  <button
                                    type="button"
                                    onClick={() => toggleAttachmentSelection(asset.id)}
                                    className="flex items-center justify-between gap-2 border-r border-[#ece6dc] px-3 py-2 text-left"
                                  >
                                    <span>Bulk</span>
                                    {selectedAttachmentIds.includes(asset.id) ? <CheckSquare className="h-4 w-4 text-rose-700" /> : <Square className="h-4 w-4 text-stone-400" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedReferenceAttachmentId(asset.id)}
                                    disabled={!["mockup", "reference", "image"].includes(asset.kind)}
                                    className={`flex items-center justify-between gap-2 px-3 py-2 text-left disabled:opacity-40 ${selectedReferenceAttachmentId === asset.id ? "bg-stone-950 text-white" : ""}`}
                                  >
                                    <span>Vorlage</span>
                                    <Eye className="h-4 w-4" />
                                  </button>
                                </div>
                                {asset.proxyUrl && asset.kind !== "video" ? (
                                  <img src={asset.proxyUrl} alt={asset.name} className="aspect-[4/3] w-full object-cover" />
                                ) : (
                                  <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 text-sm font-semibold text-stone-500">{kindLabel(asset.kind)}</div>
                                )}
                                <div className="space-y-2 p-3">
                                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${kindTone(asset.kind)}`}>{kindLabel(asset.kind)}</span>
                                  <div className="break-words text-sm font-semibold">{asset.name}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {removalPlan ? (
                      <div className="mt-4 rounded-[14px] border border-rose-200 bg-rose-50 p-4">
                        <div className="text-sm font-semibold text-rose-900">Removal-Plan: {removalPlan.selectedAttachmentCount} Anhänge · {removalPlan.status}</div>
                        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                          <input
                            value={confirmRemoval}
                            onChange={(event) => setConfirmRemoval(event.target.value)}
                            placeholder="ENTFERNEN"
                            className="h-10 rounded-[0.65rem] border border-rose-200 bg-white px-3 text-sm outline-none"
                          />
                          <button
                            type="button"
                            disabled={busy || removalPlan.status !== "prepared" || confirmRemoval !== "ENTFERNEN"}
                            onClick={() => void applyRemovalPlan()}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.65rem] bg-rose-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                            Jetzt löschen
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              )}

              <div className="rounded-[18px] border border-[#ded8d0] bg-white p-5 shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">Design Jobs</h2>
                  <button type="button" onClick={() => void loadRecentJobs()} disabled={jobsLoading} className="inline-flex h-9 items-center gap-2 rounded-[0.65rem] border border-[#ded8d0] px-3 text-xs font-semibold disabled:opacity-50">
                    <RefreshCcw className={`h-4 w-4 ${jobsLoading ? "animate-spin" : ""}`} />
                    Aktualisieren
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  {jobs.length ? jobs.map((item) => (
                    <div key={item.id} className="rounded-[14px] border border-[#ded8d0] bg-[#fffdf9] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">{item.requestId || item.sourceQuery || item.id.slice(0, 8)}</div>
                          <div className="mt-1 text-xs text-stone-500">{item.offerId ? `Offer ${item.offerId.slice(0, 8)}` : "ohne Offer"} · {formatDate(item.updatedAt)}</div>
                        </div>
                        <span className="rounded-full bg-stone-950 px-2 py-1 text-xs font-semibold text-white">{item.status}</span>
                      </div>
                      {item.assets?.length ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {item.assets.map((asset) => (
                            <div key={asset.id} className="rounded-[12px] border border-[#ded8d0] bg-white p-3">
                              {asset.publicUrl ? <img src={asset.publicUrl} alt={asset.name || "Design Asset"} className="aspect-[4/3] w-full rounded-[10px] object-cover" /> : null}
                              <div className="mt-2 text-sm font-semibold">{asset.name || asset.id.slice(0, 8)}</div>
                              <div className="mt-1 text-xs text-stone-500">{asset.status} · {asset.trelloAttachmentId ? "Trello ok" : "nicht angehängt"}</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button type="button" onClick={() => setSelectedAssetId(asset.id)} className="rounded-full border border-[#ded8d0] px-3 py-1.5 text-xs font-semibold text-stone-700">
                                  Für Offer wählen
                                </button>
                                {asset.publicUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedReferenceAssetId(asset.id);
                                      setSelectedReferenceAttachmentId("");
                                    }}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedReferenceAssetId === asset.id ? "border-stone-950 bg-stone-950 text-white" : "border-[#ded8d0] text-stone-700"}`}
                                  >
                                    Als Vorlage
                                  </button>
                                ) : null}
                                {asset.publicUrl && !asset.trelloAttachmentId ? (
                                  <button type="button" disabled={busy} onClick={() => void attachToTrello(item.id, asset.id)} className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                                    <UploadCloud className="h-3.5 w-3.5" />
                                    An Trello
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-[12px] border border-dashed border-[#ded8d0] p-3 text-sm text-stone-500">Noch kein generiertes Asset für diesen Job.</div>
                      )}
                    </div>
                  )) : (
                    <div className="rounded-[14px] border border-dashed border-[#ded8d0] p-4 text-sm text-stone-500">Noch keine Design-Jobs gefunden.</div>
                  )}
                </div>
              </div>
            </div>

            <aside className="space-y-5">
              <div className="rounded-[18px] border border-[#ded8d0] bg-white p-5 shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Prompt</h2>
                    {workspace ? (
                      <div className="mt-1 inline-flex rounded-full border border-[#ded8d0] bg-[#fffdf9] px-2.5 py-1 text-xs font-semibold text-stone-700">
                        {workspace.promptPreview.sourceLabel}
                      </div>
                    ) : null}
                    {workspace?.primaryCard ? (
                      <div className="mt-2 text-xs text-stone-500">
                        Quelle: {workspace.primaryCard.cardName || workspace.primaryCard.cardId} · {workspace.primaryCard.listName || "Liste unbekannt"}
                      </div>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => void copyPrompt()} disabled={!promptDraft} className="inline-flex items-center gap-2 rounded-[0.65rem] border border-[#ded8d0] px-3 py-2 text-xs font-semibold disabled:opacity-50">
                    <Copy className="h-4 w-4" />
                    {copied ? "Kopiert" : "Kopieren"}
                  </button>
                </div>
                {workspace?.promptPreview.warnings.length ? (
                  <div className="mt-3 space-y-2">
                    {workspace.promptPreview.warnings.map((warning) => (
                      <div key={warning} className="flex gap-2 rounded-[12px] border border-amber-200 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {workspace?.promptPreview.videoPrompt ? (
                  <details className="mt-3 rounded-[12px] border border-[#ded8d0] bg-[#fffdf9] p-3 text-xs text-stone-700">
                    <summary className="cursor-pointer font-semibold text-stone-900">Video-Prompt aus Trello</summary>
                    <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap font-mono leading-5">
                      {workspace.promptPreview.videoPrompt}
                    </pre>
                  </details>
                ) : null}
                {workspace ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-[12px] border border-[#ded8d0] bg-[#fffdf9] p-3">
                      <div className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-stone-500">Ausgangsbild</div>
                      {selectedReferenceAsset ? (
                        <div className="mt-2 flex items-center gap-3">
                          {selectedReferenceAsset.publicUrl ? (
                            <img src={selectedReferenceAsset.publicUrl} alt={selectedReferenceAsset.name || "Generiertes Design Asset"} className="h-12 w-16 rounded-[8px] object-cover" />
                          ) : null}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-stone-900">{selectedReferenceAsset.name || selectedReferenceAsset.id.slice(0, 8)}</div>
                            <div className="mt-0.5 text-xs text-stone-500">Generiertes KI-Mockup wird als Image-Edit-Vorlage genutzt.</div>
                          </div>
                        </div>
                      ) : selectedReferenceAttachment ? (
                        <div className="mt-2 flex items-center gap-3">
                          {selectedReferenceAttachment.proxyUrl ? (
                            <img src={selectedReferenceAttachment.proxyUrl} alt={selectedReferenceAttachment.name} className="h-12 w-16 rounded-[8px] object-cover" />
                          ) : null}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-stone-900">{selectedReferenceAttachment.name}</div>
                            <div className="mt-0.5 text-xs text-stone-500">Wird als Vorlage für Image-Edit genutzt.</div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-stone-600">Keine Vorlage gewählt. Ohne Vorlage wird neu generiert.</div>
                      )}
                    </div>

                    <div>
                      <div className="mb-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-stone-500">Mockup-Art</div>
                      <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-[#ded8d0] bg-[#fffdf9] p-1 sm:grid-cols-3">
                        {(Object.keys(MOCKUP_PRESETS) as MockupPresetKey[]).map((presetKey) => (
                          <button
                            key={presetKey}
                            type="button"
                            onClick={() => applyPromptPreset(presetKey)}
                            disabled={!workspace.promptPreview.prompt}
                            className={`h-9 rounded-[0.55rem] px-3 text-xs font-semibold disabled:opacity-40 ${promptPreset === presetKey ? "bg-stone-950 text-white" : "text-stone-700 hover:bg-white"}`}
                          >
                            {mockupPresetLabel(presetKey)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-stone-500">Leuchtfarbe</div>
                      <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-[#ded8d0] bg-[#fffdf9] p-1 sm:grid-cols-3">
                        {(Object.keys(LIGHT_COLOR_PRESETS) as LightColorPresetKey[]).map((presetKey) => (
                          <button
                            key={presetKey}
                            type="button"
                            onClick={() => applyLightColorPreset(presetKey)}
                            disabled={!workspace.promptPreview.prompt}
                            className={`flex h-9 items-center justify-center gap-2 rounded-[0.55rem] px-2 text-xs font-semibold disabled:opacity-40 ${lightColorPreset === presetKey ? "bg-stone-950 text-white" : "text-stone-700 hover:bg-white"}`}
                          >
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
                              style={{ background: LIGHT_COLOR_PRESETS[presetKey].swatch }}
                              aria-hidden="true"
                            />
                            <span className="truncate">{LIGHT_COLOR_PRESETS[presetKey].label}</span>
                          </button>
                        ))}
                      </div>
                      {lightColorPreset === "custom" ? (
                        <input
                          value={customLightColor}
                          onChange={(event) => updateCustomLightColor(event.target.value)}
                          placeholder="z. B. Lavendel, Eisblau, Neon-Gelb"
                          className="mt-2 h-10 w-full rounded-[0.65rem] border border-[#ded8d0] bg-white px-3 text-sm outline-none focus:border-stone-950"
                        />
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <textarea
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  placeholder="Prompt wird nach Suche geladen."
                  className="mt-4 min-h-[25rem] w-full resize-y rounded-[14px] border border-[#ded8d0] bg-[#fffdf9] p-3 font-mono text-xs leading-5 outline-none focus:border-stone-950"
                />
                <div className="mt-3 grid gap-2">
                  <button type="button" onClick={() => void savePromptDraft()} disabled={busy || !workspace} className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.65rem] bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
                    <Save className="h-4 w-4" />
                    Draft speichern
                  </button>
                  <button type="button" onClick={() => void queueSavedDraft()} disabled={busy || !job} className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.65rem] border border-[#ded8d0] bg-white px-4 text-sm font-semibold text-stone-950 disabled:opacity-50">
                    <Send className="h-4 w-4" />
                    Generierung freigeben
                  </button>
                  <button type="button" onClick={() => void generateSavedDraft()} disabled={busy || !job} className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.65rem] border border-[#ded8d0] bg-[#fffdf9] px-4 text-sm font-semibold text-stone-950 disabled:opacity-50">
                    <ImagePlus className="h-4 w-4" />
                    Jetzt generieren
                  </button>
                </div>
                {job ? (
                  <div className="mt-3 rounded-[12px] border border-[#ded8d0] bg-[#fffdf9] p-3 text-xs text-stone-600">
                    <div className="font-semibold text-stone-900">Job {job.id.slice(0, 8)} · {job.status}</div>
                    <div className="mt-1">Prompt v{job.promptVersion.versionNumber} · {job.promptVersion.promptHash.slice(0, 10)}</div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[18px] border border-[#ded8d0] bg-white p-5 shadow-[0_10px_30px_rgba(20,16,12,0.05)]">
                <h2 className="text-lg font-semibold">Offer Integration</h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">Zuordnung ist review-pflichtig. Bestehende Offer-Bilder werden nur nach Prüfung eines vorhandenen Bildslots aktualisiert.</p>

                <div className="mt-4 space-y-3">
                  {workspace?.offerCandidates.length ? (
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Angebot</span>
                      <select value={selectedOfferId} onChange={(event) => setSelectedOfferId(event.target.value)} className="mt-2 h-10 w-full rounded-[0.65rem] border border-[#ded8d0] bg-white px-3 text-sm outline-none">
                        <option value="">Noch nicht zuordnen</option>
                        {workspace.offerCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id} disabled={candidate.locked}>
                            {candidate.label} · {candidate.status || "ohne Status"}{candidate.locked ? " · gesperrt" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="rounded-[12px] border border-dashed border-[#ded8d0] p-3 text-sm text-stone-500">Kein bestehendes Angebot im Kontext gefunden.</div>
                  )}

                  <button type="button" disabled={busy || !selectedOfferId} onClick={() => void loadOffer()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[0.65rem] border border-[#ded8d0] bg-white px-4 text-sm font-semibold text-stone-950 disabled:opacity-50">
                    <RefreshCcw className="h-4 w-4" />
                    Offer-Details laden
                  </button>

                  {offer ? (
                    <div className="space-y-3 rounded-[14px] border border-[#ded8d0] bg-[#fffdf9] p-3">
                      <div className="text-sm font-semibold">{offer.offerNumber} · {offer.status}</div>
                      <div className="text-xs text-stone-500">{offer.lock.editable ? "editierbar" : "gesperrt"} · aktualisiert {formatDate(offer.updatedAt)}</div>
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Produkt / Preisanker</span>
                        <select value={selectedOfferItemId} onChange={(event) => setSelectedOfferItemId(event.target.value)} className="mt-2 h-10 w-full rounded-[0.65rem] border border-[#ded8d0] bg-white px-3 text-sm outline-none">
                          <option value="">Nur Design-Link</option>
                          {offer.items.map((item) => (
                            <option key={item.id} value={item.id}>{item.title} · {formatMoney(item.unitPriceNet)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Bestehender Bildslot</span>
                        <select value={selectedOfferImageId} onChange={(event) => setSelectedOfferImageId(event.target.value)} className="mt-2 h-10 w-full rounded-[0.65rem] border border-[#ded8d0] bg-white px-3 text-sm outline-none">
                          <option value="">Nur Review-Link speichern</option>
                          {offer.images.map((image) => (
                            <option key={image.id} value={image.id}>{image.title || image.linkedItemTitle || image.kind} · {image.enabled ? "aktiv" : "inaktiv"}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}

                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Generiertes Asset</span>
                    <select value={selectedAssetId} onChange={(event) => setSelectedAssetId(event.target.value)} className="mt-2 h-10 w-full rounded-[0.65rem] border border-[#ded8d0] bg-white px-3 text-sm outline-none">
                      <option value="">Asset wählen</option>
                      {generatedAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.name || asset.id.slice(0, 8)} · {asset.status}</option>
                      ))}
                    </select>
                  </label>
                  {selectedAsset?.publicUrl ? <img src={selectedAsset.publicUrl} alt={selectedAsset.name || "Design Asset"} className="aspect-[4/3] w-full rounded-[14px] object-cover" /> : null}
                  <div className="grid gap-2">
                    <button type="button" disabled={busy || !selectedAsset || !selectedOfferId} onClick={() => void linkOffer(true)} className="h-10 rounded-[0.65rem] border border-[#ded8d0] bg-white px-4 text-sm font-semibold text-stone-950 disabled:opacity-50">
                      Link prüfen
                    </button>
                    <button type="button" disabled={busy || !selectedAsset || !selectedOfferId} onClick={() => void linkOffer(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.65rem] bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">
                      <ImagePlus className="h-4 w-4" />
                      In Angebot übernehmen
                    </button>
                  </div>
                </div>
              </div>
            </aside>
          </section>
        </div>
      </div>
    </main>
  );
}
