"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, LockKeyhole, RefreshCcw, Search } from "lucide-react";
import type { OpsOfferSearchResult } from "@/lib/ops/offers";
import { OpsAppSwitcher } from "../ops-app-switcher";
import { OpsLoginCard } from "../ops-login-card";

type OfferSearchResponse = {
  ok: boolean;
  query?: string;
  results?: OpsOfferSearchResult[];
  error?: string;
  issues?: string[];
};

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function customerLabel(result: OpsOfferSearchResult) {
  return (
    result.customerCompany ||
    [result.customerFirstName, result.customerLastName].filter(Boolean).join(" ") ||
    result.customerEmail ||
    "Kein Kunde hinterlegt"
  );
}

function lockLabel(result: OpsOfferSearchResult) {
  if (result.lock.lockLevel === "hard") return "Gesperrt";
  if (result.lock.lockLevel === "soft") return "Grund nötig";
  return "Bearbeitbar";
}

function lockClass(result: OpsOfferSearchResult) {
  if (result.lock.lockLevel === "hard") return "border-amber-200 bg-amber-50 text-amber-800";
  if (result.lock.lockLevel === "soft") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Keine Angabe";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Keine Angabe";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function OpsOffersClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-offers-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [query, setQuery] = useState("");
  const [directOfferId, setDirectOfferId] = useState("");
  const [results, setResults] = useState<OpsOfferSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(operatorNameKey, operatorName);
  }, [operatorName]);

  const directAdminHref = useMemo(() => {
    const trimmed = directOfferId.trim();
    if (!trimmed) return null;
    return `/api/ops/customer-records/offers/${encodeURIComponent(trimmed)}/admin`;
  }, [directOfferId]);

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError("Ops-Login fehlgeschlagen.");
      return;
    }
    setHasSession(true);
    setToken("");
  }

  async function searchOffers(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setError("Bitte mindestens 3 Zeichen für die Angebotssuche eingeben.");
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/customer-records/offers/search?q=${encodeURIComponent(trimmed)}&limit=12`, {
        method: "GET",
      });
      const payload = (await response.json().catch(() => null)) as OfferSearchResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));
      const nextResults = payload.results || [];
      setResults(nextResults);
      setMessage(nextResults.length ? `${nextResults.length} Angebot${nextResults.length === 1 ? "" : "e"} gefunden.` : "Keine Angebote gefunden.");
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "Angebotssuche fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Angebote"
        title="Angebote anmelden"
        description="Melde dich für die interne Angebotssoftware an. Angebotssuche, Adminbereich und Kundenlinks bleiben im geschützten Ops-Bereich."
        activeApp="offers"
        operatorName={operatorName}
        password={token}
        error={error}
        buttonLabel="Einloggen"
        onOperatorNameChange={setOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 text-stone-950 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-[0.5rem] bg-stone-950 px-6 py-6 text-white shadow-xl shadow-stone-950/10">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-sm uppercase tracking-[0.3em] text-stone-400">Offer Software</p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight">Angebote</h1>
                <p className="mt-4 text-base leading-7 text-stone-300">
                  Angebot suchen, Kundenlink prüfen und direkt in den Angebots-Adminbereich wechseln.
                </p>
              </div>
            </div>
            <OpsAppSwitcher active="offers" tone="dark" />
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.5rem] bg-stone-950 text-white">
                <Search className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">Angebot suchen</h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Suche nach Angebotsnummer, Offer-ID, E-Mail, Firma, Name oder Trello-Link.
                </p>
              </div>
            </div>
            <form className="mt-5 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchOffers(event)}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 rounded-[0.5rem] border border-stone-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10"
                placeholder="A/N 13977, Offer-ID, kunde@mail.de, Firma..."
              />
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-60"
              >
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Sucht..." : "Suchen"}
              </button>
            </form>
          </div>

          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.5rem] bg-stone-100 text-stone-700">
                <LockKeyhole className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">Admin direkt</h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">Für bekannte Offer-IDs direkt in den Adminbereich.</p>
              </div>
            </div>
            <input
              value={directOfferId}
              onChange={(event) => setDirectOfferId(event.target.value)}
              className="mt-5 w-full rounded-[0.5rem] border border-stone-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10"
              placeholder="Offer-ID"
            />
            <a
              href={directAdminHref || "#"}
              className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[0.5rem] px-4 py-3 text-sm font-medium transition ${
                directAdminHref ? "bg-stone-950 text-white hover:bg-stone-800" : "pointer-events-none bg-stone-200 text-stone-500"
              }`}
            >
              Admin öffnen
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </section>

        {error ? <div className="rounded-[0.5rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</div> : null}
        {message ? <div role="status" className="rounded-[0.5rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">{message}</div> : null}

        <section className="grid gap-3">
          {results.map((result) => (
            <article key={result.offerId} className="rounded-[0.5rem] border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 text-stone-500" />
                    <h2 className="text-lg font-semibold">{result.offerNumber || result.documentReference}</h2>
                    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${lockClass(result)}`}>{lockLabel(result)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {customerLabel(result)}
                    {result.customerEmail ? ` - ${result.customerEmail}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    Status {result.status || "unbekannt"} · Aktualisiert {formatDate(result.updatedAt)}
                    {result.matchReasons.length ? ` · Treffer: ${result.matchReasons.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/ops/customer-records/offers/${encodeURIComponent(result.offerId)}/admin`}
                    className="inline-flex items-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
                  >
                    Admin
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {result.publicUrl ? (
                    <a
                      href={result.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-[0.5rem] border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
                    >
                      Kundenlink
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
