import { formatCurrency } from "@/lib/quotes/format";
import type { QuoteTotals } from "@/lib/quotes/types";

export function QuoteSummary({
  totals,
  currency,
  taxRate,
}: {
  totals: QuoteTotals;
  currency: string;
  taxRate: number;
}) {
  return (
    <aside className="sticky top-5 rounded-lg border border-black/10 bg-neutral-950 p-5 text-white shadow-2xl shadow-black/10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/45">Preisübersicht</p>
      <div className="mt-6 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4 text-white/70">
          <span>Zwischensumme netto</span>
          <strong className="text-white">{formatCurrency(totals.subtotal_net, currency)}</strong>
        </div>
        <div className="flex items-center justify-between gap-4 text-white/70">
          <span>zzgl. {taxRate}% MwSt.</span>
          <strong className="text-white">{formatCurrency(totals.tax_amount, currency)}</strong>
        </div>
      </div>
      <div className="mt-5 border-t border-white/10 pt-5">
        <span className="text-sm font-semibold text-white/50">Gesamtsumme brutto</span>
        <strong className="mt-2 block text-3xl font-semibold tracking-normal text-white">
          {formatCurrency(totals.total_gross, currency)}
        </strong>
      </div>
      <p className="mt-5 text-xs leading-5 text-white/45">
        Die finale Berechnung erfolgt beim Annehmen serverseitig auf Basis der gespeicherten
        Angebotspositionen.
      </p>
    </aside>
  );
}
