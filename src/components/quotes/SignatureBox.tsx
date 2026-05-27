"use client";

import { PenLine } from "lucide-react";

export function SignatureBox({
  customerName,
  signedName,
  onSign,
}: {
  customerName?: string | null;
  signedName: string;
  onSign: (name: string) => void;
}) {
  const name = customerName?.trim() || "Kunde";

  return (
    <button
      type="button"
      onClick={() => onSign(name)}
      className="flex min-h-[128px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-black/20 bg-neutral-50 px-5 py-6 text-center transition hover:border-[#fa31a2] hover:bg-[#fa31a2]/[0.035] focus:outline-none focus:ring-2 focus:ring-[#fa31a2]"
    >
      {signedName ? (
        <>
          <span
            className="text-4xl text-neutral-950"
            style={{
              fontFamily: '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive',
            }}
          >
            {signedName}
          </span>
          <span className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
            Signiert per Klick
          </span>
        </>
      ) : (
        <>
          <PenLine className="h-7 w-7 text-neutral-500" />
          <span className="mt-3 text-sm font-semibold text-neutral-700">Zum Signieren klicken</span>
        </>
      )}
    </button>
  );
}
