"use client";

import { Mail, Phone, Search } from "lucide-react";
import { OpsIdeaBox } from "./ops-idea-box";
import { OpsAppSwitcher, type OpsAppKey } from "./ops-app-switcher";

type OpsPageHeaderProps = {
  active: OpsAppKey;
  label: string;
  quickAccessHref?: string;
  onQuickAccess?: () => void;
};

const quickAccessControlClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.07] px-4 text-sm font-medium text-white/[0.78] transition hover:border-white/24 hover:bg-white/[0.11] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

export function OpsPageHeader({ active, label, quickAccessHref = "/ops/customer-records", onQuickAccess }: OpsPageHeaderProps) {
  const quickAccessContent = (
    <>
      <Search className="h-4 w-4" />
      Schnellzugriff
      <span className="hidden rounded-full border border-white/10 bg-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/50 md:inline-flex">
        Cmd/Ctrl+K
      </span>
    </>
  );

  return (
    <header className="overflow-visible rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(250,49,162,0.16),transparent_26%),linear-gradient(135deg,#080807_0%,#151311_58%,#201519_100%)] text-white shadow-[0_22px_72px_rgba(18,14,12,0.24)]">
      <div className="grid gap-4 px-5 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-7 w-auto md:h-8" />
          <div className="text-sm font-medium text-white/[0.48]">{label}</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {onQuickAccess ? (
              <button type="button" onClick={onQuickAccess} className={quickAccessControlClass}>
                {quickAccessContent}
              </button>
            ) : (
              <a href={quickAccessHref} className={quickAccessControlClass}>
                {quickAccessContent}
              </a>
            )}
            <OpsIdeaBox placement="header" />
            <a
              href="tel:+4921154257240"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.07] text-white/[0.66] transition hover:border-white/24 hover:bg-white/[0.11] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:flex"
              aria-label="NEONTRIP anrufen"
            >
              <Phone className="h-4 w-4" />
            </a>
            <a
              href="mailto:support@neontrip.de"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.07] text-white/[0.66] transition hover:border-white/24 hover:bg-white/[0.11] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 sm:flex"
              aria-label="NEONTRIP E-Mail"
            >
              <Mail className="h-4 w-4" />
            </a>
          </div>
        </div>
        <OpsAppSwitcher active={active} tone="dark" />
      </div>
    </header>
  );
}
