"use client";

import { useId, useState } from "react";
import { BarChart3, Calculator, ClipboardList, Factory, FileText, Menu, PhoneCall, PlaneLanding, Truck, type LucideIcon, UsersRound, X } from "lucide-react";

export type OpsAppKey =
  | "records"
  | "priceReview"
  | "calls"
  | "tasks"
  | "offers"
  | "supplierSales"
  | "shipping"
  | "inboundShipping"
  | "management";

type OpsAppSwitcherProps = {
  active: OpsAppKey;
  tone?: "dark" | "light";
};

const OPS_APPS: Array<{
  key: OpsAppKey;
  label: string;
  helper: string;
  href: string;
  Icon: LucideIcon;
}> = [
  {
    key: "records",
    label: "Kundenakte",
    helper: "Suche & Fallarbeit",
    href: "/ops/customer-records",
    Icon: UsersRound,
  },
  {
    key: "priceReview",
    label: "Schildpreise",
    helper: "Kalkulator & Prüfung",
    href: "/ops/customer-records/price-review",
    Icon: Calculator,
  },
  {
    key: "management",
    label: "Management",
    helper: "KPIs & Kosten",
    href: "/ops/management",
    Icon: BarChart3,
  },
  {
    key: "calls",
    label: "Anrufe",
    helper: "Rückrufe & Callliste",
    href: "/ops/customer-records/calls",
    Icon: PhoneCall,
  },
  {
    key: "tasks",
    label: "Teamaufgaben",
    helper: "To-dos & Übergaben",
    href: "/ops/tasks",
    Icon: ClipboardList,
  },
  {
    key: "offers",
    label: "Angebote",
    helper: "Editor & Admin",
    href: "https://angebote.neontrip.de/admin/offers",
    Icon: FileText,
  },
  {
    key: "supplierSales",
    label: "Sales-Vergabe",
    helper: "Supplier & Deadlines",
    href: "/ops/sales-vergabe",
    Icon: Factory,
  },
  {
    key: "shipping",
    label: "Paketversand",
    helper: "Kundenpakete raus",
    href: "/ops/customer-records/shipping",
    Icon: Truck,
  },
  {
    key: "inboundShipping",
    label: "Wareneingang",
    helper: "China-Sendungen rein",
    href: "/ops/customer-records/inbound-shipping",
    Icon: PlaneLanding,
  },
];

export function OpsAppSwitcher({ active, tone = "dark" }: OpsAppSwitcherProps) {
  const dark = tone === "dark";
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuId = useId();
  const activeApp = OPS_APPS.find((app) => app.key === active) || OPS_APPS[0];

  function appLinkClass(isActive: boolean, mode: "desktop" | "mobile") {
    const base =
      mode === "desktop"
        ? "grid min-h-[3.25rem] min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 rounded-[0.75rem] px-2.5 py-2 text-left text-sm font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2"
        : "grid min-h-[3rem] grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 rounded-[0.85rem] px-3 py-2 text-left text-sm font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2";

    const toneClass = dark
      ? isActive
        ? "bg-[#f7f2ea] text-[#171412] shadow-[0_10px_28px_rgba(0,0,0,0.18)] focus-visible:ring-white/60"
        : "text-white/[0.68] hover:bg-white/[0.09] hover:text-white focus-visible:ring-white/45"
      : isActive
        ? "bg-stone-950 text-white focus-visible:ring-stone-950/30"
        : "text-stone-600 hover:bg-white hover:text-stone-950 focus-visible:ring-stone-950/25";

    return `${base} ${toneClass}`;
  }

  function helperClass(isActive: boolean) {
    return `col-start-2 min-w-0 truncate text-[11px] font-normal ${
      dark
        ? isActive ? "text-[#635b52]" : "text-white/[0.38]"
        : isActive ? "text-white/60" : "text-stone-400"
    }`;
  }

  return (
    <div className="min-w-0">
      <div
        className={`flex min-w-0 items-center gap-1.5 rounded-[1rem] border p-1 sm:hidden ${
          dark ? "border-white/12 bg-white/[0.045]" : "border-black/10 bg-black/[0.03]"
        }`}
      >
        <a href={activeApp.href} aria-current="page" className={`${appLinkClass(true, "mobile")} min-w-0 flex-1`}>
          <activeApp.Icon className="h-4 w-4" />
          <span className="min-w-0 truncate">{activeApp.label}</span>
        </a>
        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls={menuId}
          onClick={() => setMobileOpen((current) => !current)}
          className={`inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[0.85rem] border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 ${
            dark
              ? "border-white/10 bg-white/[0.07] text-white/78 hover:bg-white/[0.1] focus-visible:ring-white/45"
              : "border-black/10 bg-white text-stone-700 hover:border-stone-300 hover:text-stone-950 focus-visible:ring-stone-950/25"
          }`}
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          <span>Bereiche</span>
        </button>
      </div>

      {mobileOpen ? (
        <nav
          id={menuId}
          aria-label="Ops-Bereiche"
          className={`mt-2 grid gap-1.5 rounded-[1rem] border p-1 sm:hidden ${
            dark ? "border-white/12 bg-[#171412]" : "border-black/10 bg-white"
          }`}
        >
          {OPS_APPS.map(({ key, label, helper, href, Icon }) => {
            const isActive = key === active;
            return (
              <a key={key} href={href} aria-current={isActive ? "page" : undefined} className={appLinkClass(isActive, "mobile")}>
                <Icon className="h-4 w-4" />
                <span className="min-w-0 truncate">{label}</span>
                <span className={helperClass(isActive)}>{helper}</span>
              </a>
            );
          })}
        </nav>
      ) : null}

      <nav
        aria-label="Ops-Bereiche"
        className={`hidden min-w-0 w-full max-w-full gap-1.5 rounded-[1rem] border p-1 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] ${
          dark ? "border-white/12 bg-white/[0.045]" : "border-black/10 bg-black/[0.03]"
        }`}
      >
        {OPS_APPS.map(({ key, label, helper, href, Icon }) => {
          const isActive = key === active;
          return (
            <a key={key} href={href} aria-current={isActive ? "page" : undefined} className={appLinkClass(isActive, "desktop")}>
              <Icon className="h-4 w-4" />
              <span className="min-w-0 truncate">{label}</span>
              <span className={`${helperClass(isActive)} hidden lg:block`}>{helper}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
