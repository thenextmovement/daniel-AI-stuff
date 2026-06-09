"use client";

import { BadgeCheck, BarChart3, ClipboardList, Factory, FileText, PhoneCall, PlaneLanding, Truck, type LucideIcon, UsersRound } from "lucide-react";

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
    label: "Preisprüfung",
    helper: "Supplierpreise",
    href: "/ops/customer-records/price-review",
    Icon: BadgeCheck,
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

  return (
    <nav
      aria-label="Ops-Bereiche"
      className={`flex w-full max-w-full gap-1.5 overflow-x-auto rounded-[1rem] border p-1 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] sm:overflow-visible ${
        dark ? "border-white/12 bg-white/[0.045]" : "border-black/10 bg-black/[0.03]"
      }`}
    >
      {OPS_APPS.map(({ key, label, helper, href, Icon }) => {
        const isActive = key === active;
        return (
          <a
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`grid min-h-[3.25rem] min-w-[9.25rem] grid-cols-[0.9rem_minmax(0,1fr)] items-center gap-x-1.5 rounded-[0.75rem] px-2 py-2 text-left text-[13px] font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2 sm:order-none sm:min-w-0 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-2 sm:px-2.5 sm:text-sm ${
              isActive ? "order-1" : "order-2"
            } ${
              dark
                ? isActive
                  ? "bg-[#f7f2ea] text-[#171412] shadow-[0_10px_28px_rgba(0,0,0,0.18)] focus-visible:ring-white/60"
                  : "text-white/[0.68] hover:bg-white/[0.09] hover:text-white focus-visible:ring-white/45"
                : isActive
                  ? "bg-stone-950 text-white focus-visible:ring-stone-950/30"
                  : "text-stone-600 hover:bg-white hover:text-stone-950 focus-visible:ring-stone-950/25"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="min-w-0 whitespace-nowrap">{label}</span>
            <span className={`col-start-2 hidden min-w-0 truncate text-[11px] font-normal lg:block ${
              dark
                ? isActive ? "text-[#635b52]" : "text-white/[0.38]"
                : isActive ? "text-white/60" : "text-stone-400"
            }`}>
              {helper}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
