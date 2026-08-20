"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { OpsLoginCard } from "../../ops-login-card";
import { SegmentGoldAdjudicationControl } from "../segment-gold-control";

function sessionError(payload: { error?: string } | null) {
  if (payload?.error === "invalid_credentials") return "Das interne Passwort ist nicht korrekt.";
  if (payload?.error === "access_required") return "Für diesen Bereich ist ein gültiger NEONTRIP-Ops-Zugang erforderlich.";
  return payload?.error || "Anmeldung fehlgeschlagen.";
}

export function SegmentGoldReviewPageClient({
  requestId,
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  requestId: string;
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [operatorName, setOperatorName] = useState("");
  const [requestIdDraft, setRequestIdDraft] = useState(requestId);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestIdError, setRequestIdError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOperatorName(
        window.localStorage.getItem("neontrip-ops-operator")
        || window.localStorage.getItem("neontrip-customer-records-operator")
        || "",
      );
    } catch {
      // Local storage is optional; server-side actor attribution remains mandatory.
    }
  }, []);

  function updateOperatorName(value: string) {
    setOperatorName(value);
    try {
      window.localStorage.setItem("neontrip-ops-operator", value);
      window.localStorage.setItem("neontrip-customer-records-operator", value);
    } catch {
      // The typed value remains available for this review session.
    }
  }

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setError(sessionError(payload));
      return;
    }
    setHasSession(true);
    setToken("");
  }

  function openExactRequest() {
    const normalized = requestIdDraft.trim();
    if (!normalized || normalized.length > 300) {
      setRequestIdError("Bitte eine eindeutige Anfrage-ID mit maximal 300 Zeichen eingeben.");
      return;
    }
    setRequestIdError(null);
    window.location.assign(`/ops/customer-records/gold-review?requestId=${encodeURIComponent(normalized)}`);
  }

  if (opsEnabled && !localMode && !hasSession) {
    return (
      <OpsLoginCard
        eyebrow="Blindes Segment-Gold-Review"
        title="Gold-Review anmelden"
        description="Melde dich für die isolierte NEONTRIP-Prüfansicht an. Vor unveränderlichem Gold werden keine operativen, historischen oder modellbasierten Segmentdaten geladen."
        activeApp="records"
        operatorName={operatorName}
        password={token}
        error={error}
        onOperatorNameChange={updateOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0b0e] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-7 w-auto" />
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-300/25 bg-sky-300/10 px-3 py-1.5 text-xs font-semibold text-sky-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Isolierte Blindansicht
            </div>
          </div>
        </header>

        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Blindes Segment-Gold-Review</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">
              Diese Seite lädt nur kuratierte Anfrage- und Firmenfakten sowie den Gold-Vertrag. Die allgemeine Kundenakte wird hier nicht geladen.
            </p>
          </div>
          <label className="w-full max-w-xs text-xs font-semibold text-white/72">
            Bearbeitername
            <input
              value={operatorName}
              onChange={(event) => updateOperatorName(event.target.value)}
              maxLength={160}
              autoComplete="name"
              className="mt-1.5 h-10 w-full rounded-lg border border-white/15 bg-[#17171c] px-3 text-sm text-white outline-none focus:border-sky-300"
              placeholder="Vor- und Nachname"
            />
          </label>
        </div>

        {!opsEnabled ? (
          <div className="mt-5 rounded-xl border border-rose-300/30 bg-rose-300/10 p-4 text-sm text-rose-100">
            Der NEONTRIP-Ops-Zugang ist nicht konfiguriert. Es werden keine Review-Daten geladen.
          </div>
        ) : !requestId ? (
          <form
            className="mt-5 rounded-xl border border-white/12 bg-white/[0.05] p-4"
            onSubmit={(event) => {
              event.preventDefault();
              openExactRequest();
            }}
          >
            <label className="block text-xs font-semibold text-white/72">
              Exakte Anfrage-ID
              <input
                value={requestIdDraft}
                onChange={(event) => setRequestIdDraft(event.target.value)}
                maxLength={300}
                autoComplete="off"
                className="mt-1.5 h-10 w-full rounded-lg border border-white/15 bg-[#17171c] px-3 text-sm text-white outline-none focus:border-sky-300"
                placeholder="Vom Pilot-Runbook unabhängig übergebene Request-ID"
              />
            </label>
            {requestIdError ? <div className="mt-2 text-xs text-rose-200">{requestIdError}</div> : null}
            <button
              type="submit"
              className="mt-3 rounded-lg border border-sky-200 bg-sky-100 px-4 py-2.5 text-sm font-semibold text-sky-950 transition hover:bg-white"
            >
              Isoliertes Review laden
            </button>
            <p className="mt-3 text-xs leading-5 text-white/45">
              Dies ist keine Suche: Der Server akzeptiert nur eine exakte, eindeutige Request-ID und lädt höchstens einen Request und einen verknüpften Kontakt.
            </p>
          </form>
        ) : (
          <SegmentGoldAdjudicationControl
            requestId={requestId}
            operatorName={operatorName}
            startExpanded
            lockedOpen
          />
        )}
      </div>
    </main>
  );
}
