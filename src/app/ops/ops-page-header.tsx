"use client";

import { useEffect } from "react";
import { Mail, Phone, Search } from "lucide-react";
import { OpsAppSwitcher, type OpsAppKey } from "./ops-app-switcher";

type OpsPageHeaderProps = {
  active: OpsAppKey;
  label: string;
  quickAccessHref?: string;
  onQuickAccess?: () => void;
};

const quickAccessControlClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/78 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 md:w-auto md:justify-start";

export function OpsPageHeader({
  active,
  label,
  quickAccessHref = "/ops/customer-records",
  onQuickAccess,
}: OpsPageHeaderProps) {
  useEffect(() => {
    if (onQuickAccess) return;

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        window.location.assign(quickAccessHref);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onQuickAccess, quickAccessHref]);

  const quickAccessContent = (
    <>
      <Search className="h-4 w-4" />
      Schnellzugriff
      <span className="hidden rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/55 md:inline-flex">
        Cmd/Ctrl+K
      </span>
    </>
  );

  return (
    <header className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(250,49,162,0.22),transparent_26%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_24%),linear-gradient(135deg,#060606_0%,#111111_58%,#171717_100%)] text-white shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
      <div className="grid gap-4 px-5 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <img src="/assets/logo_weiss_neontrip.png" alt="NEONTRIP" className="h-7 w-auto md:h-8" />
          <div className="text-sm text-white/55">{label}</div>
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
            <a
              href="tel:+4921154257240"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 sm:flex"
              aria-label="NEONTRIP anrufen"
            >
              <Phone className="h-4 w-4" />
            </a>
            <a
              href="mailto:support@neontrip.de"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition hover:border-white/30 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 sm:flex"
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
