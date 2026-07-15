"use client";

import { useState } from "react";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import type { VoiceCustomerContext } from "@/lib/ops/voice-knowledge";

type CustomerResult = {
  requestId: string;
  displayName: string | null;
  company: string | null;
  requestTitle: string | null;
  requestStatus: string | null;
  offerId: string | null;
};

type CustomerContextPanelProps = {
  selected: VoiceCustomerContext | null;
  disabled?: boolean;
  onSelect: (context: VoiceCustomerContext | null) => void;
};

export function CustomerContextPanel({ selected, disabled, onSelect }: CustomerContextPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchCustomers() {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/voice-copilot/context?query=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Kundensuche fehlgeschlagen.");
      setResults(Array.isArray(payload?.results) ? payload.results : []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Kundensuche fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function selectCustomer(requestId: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/voice-copilot/context?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.context) throw new Error(payload?.error || "Kundenkontext konnte nicht geladen werden.");
      onSelect(payload.context as VoiceCustomerContext);
      setResults([]);
    } catch (contextError) {
      setError(contextError instanceof Error ? contextError.message : "Kundenkontext konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  if (selected) {
    return (
      <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
              <Check className="h-4 w-4 shrink-0" />
              <span className="truncate">{selected.customer.displayName || selected.customer.company || selected.requestId}</span>
            </div>
            <p className="mt-1 break-all text-xs text-emerald-800">Request-ID: {selected.requestId}</p>
          </div>
          <button
            type="button"
            title="Kundenkontext entfernen"
            aria-label="Kundenkontext entfernen"
            disabled={disabled}
            onClick={() => onSelect(null)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-200 bg-white text-emerald-900 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-2 text-xs text-emerald-900 sm:grid-cols-3">
          <div><span className="font-semibold">Anfrage:</span> {selected.request.title || "Ohne Titel"}</div>
          <div><span className="font-semibold">Angebot:</span> {selected.offer?.offerNumber || selected.offer?.label || "nicht verknuepft"}</div>
          <div><span className="font-semibold">Outlook:</span> {selected.outlook.length} Nachrichten</div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void searchCustomers(); }}
          disabled={disabled}
          placeholder="Name, E-Mail, Telefon oder Request-ID"
          aria-label="Kundenkontext suchen"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none focus:border-stone-500"
        />
        <button
          type="button"
          title="Kunden suchen"
          aria-label="Kunden suchen"
          disabled={disabled || loading || query.trim().length < 2}
          onClick={searchCustomers}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-stone-950 text-white disabled:opacity-50"
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {results.length ? (
        <div className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {results.map((result) => (
            <button
              key={result.requestId}
              type="button"
              onClick={() => selectCustomer(result.requestId)}
              className="grid w-full gap-1 px-3 py-3 text-left hover:bg-stone-50"
            >
              <span className="text-sm font-semibold text-stone-950">{result.displayName || result.company || "Unbenannter Kontakt"}</span>
              <span className="break-all text-xs text-stone-500">{result.requestTitle || "Anfrage"} · {result.requestId}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
