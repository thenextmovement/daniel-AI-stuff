import type { ReactNode } from "react";

type OpsPageIntroProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

type OpsStatTone = "neutral" | "warning" | "danger" | "info" | "success";

type OpsStatCardProps = {
  label: string;
  value: ReactNode;
  tone?: OpsStatTone;
  icon?: ReactNode;
  detail?: string;
};

const statToneClass: Record<OpsStatTone, string> = {
  neutral: "border-[#ded8d0] bg-[#fffdf9] text-[#171412]",
  warning: "border-[#e4c978] bg-[#fff8e5] text-[#6b3b07]",
  danger: "border-[#edc2c9] bg-[#fff1f3] text-[#881337]",
  info: "border-[#bad7e8] bg-[#eef8fd] text-[#174e70]",
  success: "border-[#b8d8c5] bg-[#f0faf4] text-[#14532d]",
};

export const opsPageShellClass = "min-h-screen bg-[#f7f4ee] text-[#171412]";
export const opsPageContainerClass = "mx-auto w-full max-w-7xl";

export function OpsPageIntro({ eyebrow, title, description, children }: OpsPageIntroProps) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-black/10 bg-[radial-gradient(circle_at_0%_0%,rgba(250,49,162,0.14),transparent_24%),linear-gradient(135deg,#100f0e_0%,#181513_56%,#22171a_100%)] px-6 py-6 text-white shadow-[0_18px_60px_rgba(18,14,12,0.18)] md:px-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/[0.45]">{eyebrow}</p>
          <h1 className="mt-2 max-w-4xl text-[2rem] font-semibold leading-[1.04] tracking-tight md:text-[2.55rem]">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/[0.64] md:text-[0.95rem]">{description}</p>
        </div>
        {children ? <div className="flex flex-wrap items-center gap-3">{children}</div> : null}
      </div>
    </section>
  );
}

export function OpsStatCard({ label, value, tone = "neutral", icon, detail }: OpsStatCardProps) {
  return (
    <div className={`rounded-[18px] border px-5 py-4 shadow-[0_10px_30px_rgba(20,16,12,0.05)] ${statToneClass[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-60">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
          {detail ? <p className="mt-2 text-xs leading-5 opacity-65">{detail}</p> : null}
        </div>
        {icon ? <div className="mt-0.5 opacity-70">{icon}</div> : null}
      </div>
    </div>
  );
}
