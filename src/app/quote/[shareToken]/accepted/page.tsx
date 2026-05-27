import { CheckCircle2 } from "lucide-react";
import { notFound } from "next/navigation";
import { getQuoteByShareToken } from "@/lib/quotes/supabase-rest";
import { formatCurrency } from "@/lib/quotes/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ shareToken: string }>;
};

export default async function AcceptedSuccessPage({ params }: Props) {
  const { shareToken } = await params;
  const quote = await getQuoteByShareToken(shareToken);
  if (!quote) notFound();

  return (
    <main className="min-h-screen bg-[#f6f4ef] px-5 py-10 text-neutral-950">
      <section className="mx-auto max-w-2xl rounded-lg border border-black/10 bg-white p-8 text-center shadow-xl shadow-black/5">
        <CheckCircle2 className="mx-auto h-12 w-12 text-[#fa31a2]" />
        <h1 className="mt-5 text-3xl font-semibold">Vielen Dank, Ihr Angebot wurde angenommen.</h1>
        <p className="mt-4 leading-7 text-neutral-600">
          Wir haben Ihre Auswahl, Adressen, Signatur und den Zeitstempel gespeichert. Das
          NEONTRIP Team meldet sich mit den nächsten Schritten.
        </p>
        <dl className="mt-6 rounded-lg bg-neutral-50 p-4 text-left text-sm">
          <div className="flex justify-between gap-4">
            <dt className="font-semibold text-neutral-500">Angebot</dt>
            <dd className="font-semibold">{quote.request_id}</dd>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <dt className="font-semibold text-neutral-500">Status</dt>
            <dd className="font-semibold">{quote.status}</dd>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <dt className="font-semibold text-neutral-500">Gesamtsumme brutto</dt>
            <dd className="font-semibold">
              {formatCurrency(Number(quote.total_gross || 0), quote.currency)}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
