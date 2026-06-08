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
    <header className="overflow-visible rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(250,49,162,0.16),transparent_26%),linear-gradient(135deg,#080807_0%,#151311_58%,#201519_100%)] text-white shadow-[0_22px_72px_rgba(18,14,12,0.24)]">
      <div className="grid gap-4 px-5 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-7 w-auto md:h-8" />
          <div className="text-sm font-medium text-white/[0.48]">{label}</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <OpsIdeaBox placement="header" />
          </div>
        </div>
        <OpsAppSwitcher active={active} tone="dark" />
      </div>
    </header>
  );
}
