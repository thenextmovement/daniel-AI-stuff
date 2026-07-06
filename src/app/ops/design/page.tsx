import { ArrowUpRight, FileSearch, Images, SearchCheck } from "lucide-react";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass } from "../ops-design";

const OFFERS_ADMIN_URL = "https://angebote.neontrip.de/admin/offers";

export const metadata = {
  title: "Design - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function OpsDesignPage() {
  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-5 sm:px-6 lg:px-8`}>
        <OpsPageHeader active="design" label="Design" />

        <div className="mt-5 grid gap-5">
          <OpsPageIntro
            eyebrow="Design"
            title="Design, Mockups und Freigaben prüfen"
            description="Zentraler Einstieg für Designlagen, Trello-Medien, KI-Mockups und Angebotsvisualisierungen. Trello bleibt Projektion; geprüft wird immer gegen Kundenakte und Angebot."
          >
            <a
              href="/ops/company-brain"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.65rem] bg-white px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-stone-100"
            >
              Fall prüfen
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </OpsPageIntro>

          <section className="grid gap-4 md:grid-cols-3">
            <a
              href="/ops/company-brain"
              className="rounded-[18px] border border-stone-200 bg-white p-5 text-stone-950 shadow-[0_12px_34px_rgba(20,16,12,0.06)] transition hover:border-stone-300"
            >
              <SearchCheck className="h-5 w-5 text-stone-500" />
              <h2 className="mt-4 text-base font-semibold">Designlage prüfen</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Kundenakte, Trello, Angebot und Medienbelege für einen Fall zusammenführen.</p>
            </a>

            <a
              href="/ops/customer-records"
              className="rounded-[18px] border border-stone-200 bg-white p-5 text-stone-950 shadow-[0_12px_34px_rgba(20,16,12,0.06)] transition hover:border-stone-300"
            >
              <Images className="h-5 w-5 text-stone-500" />
              <h2 className="mt-4 text-base font-semibold">Kundenmedien</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Designbilder, Referenzen und verknüpfte Trello-Karten in der Kundenakte anzeigen.</p>
            </a>

            <a
              href={OFFERS_ADMIN_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-[18px] border border-stone-200 bg-white p-5 text-stone-950 shadow-[0_12px_34px_rgba(20,16,12,0.06)] transition hover:border-stone-300"
            >
              <FileSearch className="h-5 w-5 text-stone-500" />
              <h2 className="mt-4 text-base font-semibold">Angebotsvisualisierung</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Öffnet die Angebots-App, um Mockups und Produktzuordnung im Angebot zu prüfen.</p>
            </a>
          </section>
        </div>
      </div>
    </main>
  );
}
