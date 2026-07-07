import { ArrowUpRight, FileText, SearchCheck } from "lucide-react";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass } from "../ops-design";

const OFFERS_ADMIN_URL = "https://angebote.neontrip.de/admin/offers";

export const metadata = {
  title: "Angebote - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function OpsOffersPage() {
  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-5 sm:px-6 lg:px-8`}>
        <OpsPageHeader active="offers" label="Angebote" />

        <div className="mt-5 grid gap-5">
          <OpsPageIntro
            eyebrow="Angebote"
            title="Angebots-App öffnen"
            description="Der Angebotsbereich liegt in der separaten Angebots-App. Diese Ops-Zwischenseite hält das interne Menü sichtbar, damit Company Brain, Kundenakte und Folgeprozesse erreichbar bleiben."
          >
            <a
              href={OFFERS_ADMIN_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.65rem] bg-white px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-stone-100"
            >
              Angebots-App öffnen
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </OpsPageIntro>

          <section className="grid gap-4 md:grid-cols-2">
            <form
              action="/ops/company-brain"
              method="get"
              className="rounded-[18px] border border-stone-200 bg-white p-5 text-stone-950 shadow-[0_12px_34px_rgba(20,16,12,0.06)]"
            >
              <SearchCheck className="h-5 w-5 text-stone-500" />
              <h2 className="mt-4 text-base font-semibold">Company Brain</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Trello-Link, Angebotsnummer, Request-ID oder E-Mail direkt prüfen.</p>
              <input type="hidden" name="question" value="Trello-Karte gezogen, aber Angebot nicht raus: warum?" />
              <input type="hidden" name="problemType" value="offer_not_sent" />
              <input type="hidden" name="auto" value="1" />
              <label className="mt-4 grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Fallprüfung</span>
                <input
                  name="query"
                  className="h-11 rounded-[0.65rem] border border-stone-300 px-3 text-sm outline-none focus:border-stone-950"
                  placeholder="Trello-Link, AN-14427 oder Request-ID"
                />
              </label>
              <button
                type="submit"
                className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-[0.65rem] bg-stone-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Fall prüfen
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </form>

            <a
              href={OFFERS_ADMIN_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-[18px] border border-stone-200 bg-white p-5 text-stone-950 shadow-[0_12px_34px_rgba(20,16,12,0.06)] transition hover:border-stone-300"
            >
              <FileText className="h-5 w-5 text-stone-500" />
              <h2 className="mt-4 text-base font-semibold">Angebote verwalten</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Entwürfe, gesendete Angebote und Angebotsverwaltung in der Angebots-App öffnen.</p>
            </a>
          </section>
        </div>
      </div>
    </main>
  );
}
