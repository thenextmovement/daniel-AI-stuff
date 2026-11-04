import { OpsPageHeader } from "../ops-page-header";
import { opsPageContainerClass, opsPageShellClass } from "../ops-design";
export const metadata={title:"Neon Studio - NEONTRIP Ops",robots:{index:false,follow:false}};
export default async function NeonStudioPage({searchParams}:{searchParams:Promise<{project?:string}>}) {
  const project=(await searchParams).project;
  const src="/api/ops/neon-studio"+(project && /^[a-f0-9]{32}$/.test(project)?"?project="+project:"");
  return <main className={opsPageShellClass}>
    <div className={opsPageContainerClass+" px-4 py-5 sm:px-6 lg:px-8"}>
      <OpsPageHeader active="neonStudio" label="Neon Studio" />
      <iframe title="Neon Studio – gespeicherte Anfragen" src={src} className="mt-4 w-full rounded-2xl border border-white/10" style={{height:"calc(100vh - 145px)",minHeight:650}} />
    </div>
  </main>;
}
