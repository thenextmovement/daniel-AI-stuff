import { OpsPageHeader } from "../ops-page-header";
import { opsPageContainerClass, opsPageShellClass } from "../ops-design";
import Studio from "./studio";
import "./studio.css";

export const metadata = {
  title: "Social Studio - NEONTRIP Ops",
  robots: { index: false, follow: false },
};

export default function OpsSocialStudioPage() {
  return (
    <main className={opsPageShellClass}>
      <div className={`${opsPageContainerClass} px-4 py-5 sm:px-6 lg:px-8`}>
        <OpsPageHeader active="socialStudio" label="Social Media" />
        <div className="mt-5"><Studio /></div>
      </div>
    </main>
  );
}
