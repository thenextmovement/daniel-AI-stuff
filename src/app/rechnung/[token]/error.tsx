"use client";

import { RotateCcw, ShieldAlert } from "lucide-react";

export default function BillingPortalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f4ee] p-6 text-[#171412]">
      <div className="w-full max-w-md rounded-[24px] border border-stone-200 bg-white p-8 text-center shadow-[0_18px_55px_rgba(20,16,12,0.08)]">
        <ShieldAlert className="mx-auto h-8 w-8 text-[#b91c73]" />
        <h1 className="mt-4 text-xl font-semibold">Portal konnte nicht geladen werden</h1>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          Bitte versuchen Sie es erneut. Ihre Rechnungsdaten bleiben unverändert.
        </p>
        <button type="button" onClick={reset} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-[#b91c73]">
          <RotateCcw className="h-4 w-4" />
          Erneut laden
        </button>
      </div>
    </main>
  );
}
