import { CalendarDays, FileText, Mail, UserRound } from "lucide-react";
import { formatDate } from "@/lib/quotes/format";
import type { PublicQuote } from "@/lib/quotes/types";

export function QuoteHeader({ quote }: { quote: PublicQuote }) {
  return (
    <header className="border-b border-black/10 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 md:px-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <a href="/" className="inline-flex items-center" aria-label="NEONTRIP Startseite">
            <img src="/assets/logo_schwarz_neontrip.png" alt="NEONTRIP" className="h-9 w-auto" />
          </a>
          <p className="mt-8 text-sm font-semibold uppercase tracking-[0.14em] text-[#fa31a2]">
            Ihr individuelles Angebot
          </p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.02] text-neutral-950 md:text-6xl">
            Interaktives Angebot für Ihr Leuchtschild.
          </h1>
        </div>

        <dl className="grid min-w-0 gap-3 rounded-lg border border-black/10 bg-neutral-50 p-4 text-sm sm:grid-cols-2 lg:w-[420px]">
          <div className="flex gap-3">
            <FileText className="mt-0.5 h-4 w-4 text-neutral-500" />
            <div>
              <dt className="font-semibold text-neutral-500">Angebot</dt>
              <dd className="break-all font-semibold text-neutral-950">{quote.request_id}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <CalendarDays className="mt-0.5 h-4 w-4 text-neutral-500" />
            <div>
              <dt className="font-semibold text-neutral-500">Datum</dt>
              <dd className="font-semibold text-neutral-950">{formatDate(quote.created_at)}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <UserRound className="mt-0.5 h-4 w-4 text-neutral-500" />
            <div>
              <dt className="font-semibold text-neutral-500">Kunde</dt>
              <dd className="font-semibold text-neutral-950">
                {quote.company || quote.customer_name || "Kunde"}
              </dd>
            </div>
          </div>
          <div className="flex gap-3">
            <Mail className="mt-0.5 h-4 w-4 text-neutral-500" />
            <div>
              <dt className="font-semibold text-neutral-500">Kontakt</dt>
              <dd className="break-all font-semibold text-neutral-950">
                {quote.customer_email || "nicht hinterlegt"}
              </dd>
            </div>
          </div>
        </dl>
      </div>
    </header>
  );
}
