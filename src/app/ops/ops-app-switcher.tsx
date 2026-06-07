"use client";

import { ClipboardList, FileText, PhoneCall, PlaneLanding, Truck, type LucideIcon, UsersRound } from "lucide-react";

export type OpsAppKey = "records" | "calls" | "tasks" | "offers" | "shipping" | "inboundShipping";

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
    href: "/ops/offers",
    Icon: FileText,
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
      className={`grid w-full max-w-full grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-1.5 rounded-[1rem] border p-1 ${
        dark ? "border-white/15 bg-white/5" : "border-black/10 bg-black/[0.03]"
      }`}
    >
      {OPS_APPS.map(({ key, label, helper, href, Icon }) => {
        const isActive = key === active;
        return (
          <a
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`grid min-h-[3.25rem] min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 rounded-[0.75rem] px-2.5 py-2 text-left text-sm font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2 ${
              dark
                ? isActive
                  ? "bg-white text-stone-950 focus-visible:ring-white/60"
                  : "text-white/72 hover:bg-white/10 hover:text-white focus-visible:ring-white/45"
                : isActive
                  ? "bg-stone-950 text-white focus-visible:ring-stone-950/30"
                  : "text-stone-600 hover:bg-white hover:text-stone-950 focus-visible:ring-stone-950/25"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="min-w-0 truncate">{label}</span>
            <span className={`col-start-2 hidden min-w-0 truncate text-[11px] font-normal lg:block ${
              dark
                ? isActive ? "text-stone-600" : "text-white/45"
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
