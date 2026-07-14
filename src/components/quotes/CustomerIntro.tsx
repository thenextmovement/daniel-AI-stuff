import type { PublicQuote } from "@/lib/quotes/types";

export function CustomerIntro({ quote }: { quote: PublicQuote }) {
  const salutation = quote.customer_name ? `Hallo ${quote.customer_name},` : "Hallo,";

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-8 md:px-8">
      <div className="rounded-lg border border-black/10 bg-white p-6 md:p-8">
        <p className="text-lg font-semibold text-neutral-950">{salutation}</p>
        <p className="mt-3 max-w-4xl text-base leading-7 text-neutral-600">
          hier finden Sie Ihr individuelles NEONTRIP-Angebot. Wählen Sie die gewünschten
          Positionen aus. Die Gesamtsumme aktualisiert sich automatisch. Alle Positionspreise
          verstehen sich netto; die Mehrwertsteuer wird ausschließlich unten in der
          Preisübersicht ausgewiesen.
        </p>
      </div>
    </section>
  );
}
