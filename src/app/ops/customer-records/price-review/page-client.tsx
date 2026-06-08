"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, ExternalLink, RefreshCw, ShieldCheck, X } from "lucide-react";
import type {
  SupplierPricePredictionReviewDecision,
  SupplierPricePredictionReviewItem,
  SupplierQuoteTrainingItemAnchorReviewDecision,
  SupplierQuoteTrainingItemAnchorReviewItem,
} from "@/lib/ops/supplier-price-review";

type ReviewResponse = {
  ok: boolean;
  items?: SupplierPricePredictionReviewItem[];
  anchorItems?: SupplierQuoteTrainingItemAnchorReviewItem[];
  item?: SupplierPricePredictionReviewItem;
  createdPredictionItems?: SupplierPricePredictionReviewItem[];
  error?: string;
  issues?: string[];
};

type ReviewFilter = "pending" | "reviewed" | "all";
type AnchorCorrectionDraft = {
  sizeLabel?: string;
  widthCm?: string;
  heightCm?: string;
  productionPrice?: string;
  shippingPrice?: string;
};

function formatApiError(payload: ReviewResponse | null) {
  if (!payload) return "Anfrage fehlgeschlagen.";
  if (payload.issues?.length) return `${payload.error || "Fehler"}: ${payload.issues.join(", ")}`;
  return payload.error || "Anfrage fehlgeschlagen.";
}

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCm(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}cm`;
}

function statusLabel(item: SupplierPricePredictionReviewItem) {
  switch (item.decisionStatus) {
    case "approved_for_quote":
      return "Freigegeben";
    case "rejected":
      return "Abgelehnt";
    case "needs_supplier_check":
      return "Supplier Check";
    case "superseded":
      return "Ersetzt";
    default:
      return "Review offen";
  }
}

function statusTone(item: SupplierPricePredictionReviewItem) {
  if (item.decisionStatus === "approved_for_quote") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (item.decisionStatus === "rejected") return "border-rose-200 bg-rose-50 text-rose-800";
  if (item.decisionStatus === "needs_supplier_check") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-black/10 bg-white text-black/60";
}

function sourceTitle(item: SupplierPricePredictionReviewItem) {
  return item.sourceCode || item.sourceLabel || item.requestId || item.trelloCardId || "Unbekannter Code";
}

function groupItems(items: SupplierPricePredictionReviewItem[]) {
  const groups = new Map<string, SupplierPricePredictionReviewItem[]>();
  for (const item of items) {
    const key = sourceTitle(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()].map(([key, entries]) => ({
    key,
    items: entries.sort((left, right) => left.maxSideCm - right.maxSideCm),
  }));
}

function anchorStatusLabel(item: SupplierQuoteTrainingItemAnchorReviewItem) {
  switch (item.reviewStatus) {
    case "approved":
      return "Anker freigegeben";
    case "rejected":
      return "Abgelehnt";
    case "needs_supplier_check":
      return "Supplier Check";
    default:
      return "Anker offen";
  }
}

function anchorStatusTone(item: SupplierQuoteTrainingItemAnchorReviewItem) {
  if (item.reviewStatus === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (item.reviewStatus === "rejected") return "border-rose-200 bg-rose-50 text-rose-800";
  if (item.reviewStatus === "needs_supplier_check") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-black/10 bg-white text-black/60";
}

function anchorTitle(item: SupplierQuoteTrainingItemAnchorReviewItem) {
  return item.trelloCardName || item.designLabel || item.sourceKey || item.trelloCardId || "Unbekannter Anker";
}

function AnchorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-[0.14em] text-black/40">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
      />
    </label>
  );
}

function AnchorReviewCard({
  item,
  note,
  corrections,
  running,
  onNoteChange,
  onCorrectionChange,
  onReview,
}: {
  item: SupplierQuoteTrainingItemAnchorReviewItem;
  note: string;
  corrections: AnchorCorrectionDraft;
  running: boolean;
  onNoteChange: (value: string) => void;
  onCorrectionChange: (key: keyof AnchorCorrectionDraft, value: string) => void;
  onReview: (decision: SupplierQuoteTrainingItemAnchorReviewDecision) => void;
}) {
  const overCustomerAutoLimit = item.maxSideCm > 200;
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-black">{anchorTitle(item)}</div>
          <div className="mt-1 text-xs text-black/50">
            {item.trelloBoardName || "Board unbekannt"} · {item.trelloListName || "Liste unbekannt"} · {item.attachmentName || "image"}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${anchorStatusTone(item)}`}>
          {anchorStatusLabel(item)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Erkannt</div>
          <div className="mt-1 font-medium text-black">
            {formatCm(item.widthCm)} x {formatCm(item.heightCm)}
          </div>
          <div className="mt-1 text-xs text-black/45">{item.sizeLabel || "ohne Label"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Production</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.productionPrice, item.currency)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Shipping</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.shippingPrice, item.currency)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-black/55">
          {item.detectedModelFamily || item.productModelFamily || "Modell offen"}
        </span>
        <span className={`rounded-full border px-2.5 py-1 ${overCustomerAutoLimit ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {overCustomerAutoLimit ? ">200cm nur Anfrage" : "bis 200cm Auto-Review"}
        </span>
        {item.trelloCardUrl ? (
          <a
            href={item.trelloCardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-1 text-black/55 transition hover:border-[#fa31a2] hover:text-black"
          >
            Trello
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <AnchorInput
          label="Size"
          value={corrections.sizeLabel ?? item.sizeLabel ?? ""}
          onChange={(value) => onCorrectionChange("sizeLabel", value)}
        />
        <AnchorInput
          label="Breite"
          value={corrections.widthCm ?? String(item.widthCm)}
          onChange={(value) => onCorrectionChange("widthCm", value)}
        />
        <AnchorInput
          label="Hoehe"
          value={corrections.heightCm ?? String(item.heightCm)}
          onChange={(value) => onCorrectionChange("heightCm", value)}
        />
        <AnchorInput
          label="Production"
          value={corrections.productionPrice ?? String(item.productionPrice)}
          onChange={(value) => onCorrectionChange("productionPrice", value)}
        />
        <AnchorInput
          label="Shipping"
          value={corrections.shippingPrice ?? String(item.shippingPrice)}
          onChange={(value) => onCorrectionChange("shippingPrice", value)}
        />
      </div>

      <textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Review-Notiz"
        rows={2}
        className="mt-4 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("approve")}
          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          Anker freigeben
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("supplier_check")}
          className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          Supplier Check
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("reject")}
          className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Ablehnen
        </button>
      </div>
    </div>
  );
}

function ReviewItemCard({
  item,
  note,
  running,
  onNoteChange,
  onReview,
}: {
  item: SupplierPricePredictionReviewItem;
  note: string;
  running: boolean;
  onNoteChange: (value: string) => void;
  onReview: (decision: SupplierPricePredictionReviewDecision) => void;
}) {
  const autoEligible = item.customerAutoQuoteEligible;
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-black">
            {formatCm(item.widthCm)} x {formatCm(item.heightCm)}
          </div>
          <div className="mt-1 text-xs text-black/50">
            Max {formatCm(item.maxSideCm)} · {item.modelKey || "Modell"} {item.modelVersion || ""}
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${statusTone(item)}`}>
          {statusLabel(item)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Production</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.predictedProductionPrice, item.currency)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Shipping</div>
          <div className="mt-1 font-medium text-black">{formatMoney(item.predictedShippingPrice, item.currency)}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-black/40">Supplier Total</div>
          <div className="mt-1 font-semibold text-black">{formatMoney(item.predictedTotalSupplierCost, item.currency)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 text-black/55">
          Anchor {item.anchorWidthCm && item.anchorHeightCm ? `${formatCm(item.anchorWidthCm)} x ${formatCm(item.anchorHeightCm)}` : "unbekannt"}
        </span>
        <span className={`rounded-full border px-2.5 py-1 ${autoEligible ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {autoEligible ? "bis 200cm Auto-Review" : ">200cm Anfrage"}
        </span>
        {item.requestId ? (
          <span className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-black/50">
            {item.requestId}
          </span>
        ) : null}
      </div>

      <textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Review-Notiz"
        rows={2}
        className="mt-4 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-[#fa31a2]"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {autoEligible ? (
          <button
            type="button"
            disabled={running}
            onClick={() => onReview("approve")}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Freigeben
          </button>
        ) : null}
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("supplier_check")}
          className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CircleAlert className="h-3.5 w-3.5" />
          Supplier Check
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => onReview("reject")}
          className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Ablehnen
        </button>
      </div>
    </div>
  );
}

export function SupplierPriceReviewClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-customer-records-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [items, setItems] = useState<SupplierPricePredictionReviewItem[]>([]);
  const [anchorItems, setAnchorItems] = useState<SupplierQuoteTrainingItemAnchorReviewItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [anchorCorrections, setAnchorCorrections] = useState<Record<string, AnchorCorrectionDraft>>({});
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canLoad = !opsEnabled || hasSession || localMode;
  const groups = useMemo(() => groupItems(items), [items]);

  const loadItems = useCallback(async (nextFilter: ReviewFilter = filter) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/customer-records/price-predictions?status=${nextFilter}`);
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (response.status === 401) {
        setHasSession(false);
        setError("Zugang abgelaufen. Bitte erneut entsperren.");
        setItems([]);
        setAnchorItems([]);
        setLoading(false);
        return;
      }
      if (!response.ok || !payload?.ok) {
        setError(formatApiError(payload));
        setItems([]);
        setAnchorItems([]);
        setLoading(false);
        return;
      }
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setLoading(false);
    } catch {
      setError("Preisvorschlaege konnten nicht geladen werden.");
      setItems([]);
      setAnchorItems([]);
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    try {
      setOperatorName(window.localStorage.getItem(operatorNameKey) || "");
    } catch {
      // ignore local storage
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(operatorNameKey, operatorName);
    } catch {
      // ignore local storage
    }
  }, [operatorName]);

  useEffect(() => {
    if (canLoad) void loadItems(filter);
  }, [canLoad, filter, loadItems]);

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
    if (!response.ok) {
      setError(formatApiError(payload));
      return;
    }
    setHasSession(true);
    setToken("");
    setMessage("Zugang aktiv.");
  }

  async function reviewItem(item: SupplierPricePredictionReviewItem, decision: SupplierPricePredictionReviewDecision) {
    setRunningId(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          predictionId: item.id,
          decision,
          note: notes[item.id] || null,
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(formatApiError(payload));
        setRunningId(null);
        return;
      }
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setNotes((current) => ({ ...current, [item.id]: "" }));
      setMessage("Preisvorschlag aktualisiert.");
      setRunningId(null);
    } catch {
      setError("Preisvorschlag konnte nicht aktualisiert werden.");
      setRunningId(null);
    }
  }

  async function reviewAnchor(
    item: SupplierQuoteTrainingItemAnchorReviewItem,
    decision: SupplierQuoteTrainingItemAnchorReviewDecision,
  ) {
    setRunningId(`anchor:${item.id}`);
    setError(null);
    setMessage(null);
    try {
      const corrections = anchorCorrections[item.id] || {};
      const response = await fetch("/api/ops/customer-records/price-predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review_training_item_anchor",
          trainingItemAnchor: {
            trainingItemId: item.id,
            decision,
            note: notes[item.id] || null,
            corrections,
            stepCm: 20,
            maxLongSideCm: 300,
          },
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ReviewResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(formatApiError(payload));
        setRunningId(null);
        return;
      }
      setItems(payload.items || []);
      setAnchorItems(payload.anchorItems || []);
      setNotes((current) => ({ ...current, [item.id]: "" }));
      setAnchorCorrections((current) => ({ ...current, [item.id]: {} }));
      const createdCount = payload.createdPredictionItems?.length || 0;
      setMessage(
        decision === "approve"
          ? `Anker freigegeben. ${createdCount} Preisvorschlaege erzeugt.`
          : "Anker aktualisiert.",
      );
      setRunningId(null);
    } catch {
      setError("Anker konnte nicht aktualisiert werden.");
      setRunningId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#fffdf9] px-4 py-5 text-black md:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
        <header className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,#050505_0%,#111111_58%,#18181b_100%)] px-5 py-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-white/45">Customer Ops</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Preisprüfung</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
                Modellvorschläge bleiben hier im Review, bis ein Mensch sie freigibt oder zum Supplier Check schickt.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="/ops/customer-records"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/76 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
              >
                Customer Ops
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => void loadItems()}
                disabled={!canLoad || loading}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/76 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Aktualisieren
              </button>
            </div>
          </div>
        </header>

        {opsEnabled && !hasSession && !localMode ? (
          <section className="rounded-lg border border-black/10 bg-white p-5">
            <div className="text-sm font-semibold text-black">Ops-Zugang</div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Ops Token"
                className="min-w-0 flex-1 rounded-lg border border-black/10 px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
              />
              <button
                type="button"
                onClick={() => void login()}
                className="rounded-full border border-black bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-black/85"
              >
                Entsperren
              </button>
            </div>
          </section>
        ) : null}

        {canLoad ? (
          <section className="rounded-lg border border-black/10 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-black">Review Queue</div>
                <div className="mt-1 text-sm text-black/55">
                  {loading ? "Lade Vorschläge..." : `${anchorItems.length} Anker · ${items.length} Preisvorschläge`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={operatorName}
                  onChange={(event) => setOperatorName(event.target.value)}
                  placeholder="Reviewer"
                  className="w-40 rounded-full border border-black/10 px-3 py-2 text-sm outline-none transition focus:border-[#fa31a2]"
                />
                {(["pending", "reviewed", "all"] as const).map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setFilter(entry)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      filter === entry
                        ? "border-black bg-black text-white"
                        : "border-black/10 bg-white text-black/60 hover:border-[#fa31a2] hover:text-black"
                    }`}
                  >
                    {entry === "pending" ? "Offen" : entry === "reviewed" ? "Reviewed" : "Alle"}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
        ) : null}

        {canLoad ? (
          <section className="grid gap-4">
            {!loading && anchorItems.length ? (
              <div className="rounded-lg border border-black/10 bg-[linear-gradient(135deg,#ffffff_0%,#fffafc_50%,#fbfdff_100%)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-black">
                      <ShieldCheck className="h-4 w-4 text-[#fa31a2]" />
                      Ankerprüfung
                    </div>
                    <div className="mt-1 text-sm text-black/55">
                      OCR-/Supplier-Zeilen erst korrigieren und freigeben, danach entstehen Shadow-Preisvorschläge.
                    </div>
                  </div>
                  <div className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-amber-800">
                    Human Gate
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  {anchorItems.map((item) => (
                    <AnchorReviewCard
                      key={item.id}
                      item={item}
                      note={notes[item.id] || ""}
                      corrections={anchorCorrections[item.id] || {}}
                      running={runningId === `anchor:${item.id}`}
                      onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
                      onCorrectionChange={(key, value) =>
                        setAnchorCorrections((current) => ({
                          ...current,
                          [item.id]: {
                            ...(current[item.id] || {}),
                            [key]: value,
                          },
                        }))
                      }
                      onReview={(decision) => void reviewAnchor(item, decision)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {!loading && !groups.length ? (
              <div className="rounded-lg border border-dashed border-black/10 bg-white/70 px-5 py-8 text-center text-sm text-black/50">
                Keine Preisvorschläge in dieser Ansicht.
              </div>
            ) : null}
            {groups.map((group) => (
              <div key={group.key} className="rounded-lg border border-black/10 bg-[linear-gradient(135deg,#ffffff_0%,#fbfdff_52%,#fffdf9_100%)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-black">
                      <ShieldCheck className="h-4 w-4 text-[#fa31a2]" />
                      {group.key}
                    </div>
                    <div className="mt-1 text-sm text-black/55">
                      {group.items.length} Größenvorschläge · kleinste erkannte Größe zuerst prüfen
                    </div>
                  </div>
                  <div className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-black/50">
                    Shadow
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {group.items.map((item) => (
                    <ReviewItemCard
                      key={item.id}
                      item={item}
                      note={notes[item.id] || ""}
                      running={runningId === item.id}
                      onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
                      onReview={(decision) => void reviewItem(item, decision)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
