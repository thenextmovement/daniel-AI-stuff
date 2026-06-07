"use client";

import { OpsIdeaBox } from "./ops-idea-box";
import { OpsAppSwitcher, type OpsAppKey } from "./ops-app-switcher";

type OpsPageHeaderProps = {
  active: OpsAppKey;
  label: string;
  quickAccessHref?: string;
  onQuickAccess?: () => void;
};

export function OpsPageHeader({ active, label }: OpsPageHeaderProps) {
  return (
    <header className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(250,49,162,0.22),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_24%),linear-gradient(135deg,#060606_0%,#111111_58%,#171717_100%)] text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="grid gap-4 px-5 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-7 w-auto md:h-8" />
          <div className="text-sm text-white/55">{label}</div>
        </div>
        <OpsAppSwitcher active={active} tone="dark" />
      </div>
      <div className="border-t border-white/10 bg-stone-50 px-5 py-3 text-stone-950 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Ops-Idee</p>
            <p className="mt-1 text-sm font-medium text-stone-900">Was soll anders?</p>
          </div>
          <div className="w-full md:max-w-[34rem]">
            <OpsIdeaBox placement="header" />
          </div>
        </div>
      </div>
    </header>
  );
}
