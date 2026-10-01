import { ArrowUpRight } from "lucide-react";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, opsPageContainerClass, opsPageShellClass } from "../ops-design";

const SOCIAL_STUDIO_URL = "https://neontrip-social-studio.neontripdach.chatgpt.site";

export const metadata = {
  title: "Social Studio - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export default function OpsSocialStudioPage() {
  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-5 sm:px-6 lg:px-8`}>
        <OpsPageHeader active="socialStudio" label="Social Media" />

        <div className="mt-5 grid gap-5">
          <OpsPageIntro
            eyebrow="Social Studio"
            title="Social-Media-Beiträge vorbereiten"
            description="Fotos auswählen, Texte pro Plattform prüfen und Beiträge freigeben. Entwürfe, geplante Termine und veröffentlichte Beiträge findest du im Social Studio."
          >
            <a
              href={SOCIAL_STUDIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[0.65rem] bg-white px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Social Studio öffnen
              <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">(öffnet in einem neuen Tab)</span>
            </a>
          </OpsPageIntro>

          <section aria-labelledby="social-studio-access" className="rounded-[18px] border border-stone-200 bg-white p-5 text-stone-950 shadow-[0_12px_34px_rgba(20,16,12,0.06)]">
            <h2 id="social-studio-access" className="text-base font-semibold">Zugriff auf das Dashboard</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
              Das Social Studio öffnet in einem neuen Tab. Melde dich dort mit deinem freigegebenen ChatGPT-Konto an. Die Ops-Anmeldung gilt nur für Ops.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
