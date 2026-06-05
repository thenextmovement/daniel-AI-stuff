"use client";

import { ClipboardList, PhoneCall, Truck, type LucideIcon, UsersRound } from "lucide-react";

export type OpsAppKey = "records" | "calls" | "tasks" | "shipping";

type OpsAppSwitcherProps = {
  active: OpsAppKey;
  tone?: "dark" | "light";
};

const OPS_APPS: Array<{
  key: OpsAppKey;
  label: string;
  href: string;
  Icon: LucideIcon;
}> = [
  {
    key: "records",
    label: "Customer Records",
    href: "/ops/customer-records",
    Icon: UsersRound,
  },
  {
    key: "calls",
    label: "Call-Zentrale",
    href: "/ops/customer-records/calls",
    Icon: PhoneCall,
  },
  {
    key: "tasks",
    label: "Aufgaben",
    href: "/ops/tasks",
    Icon: ClipboardList,
  },
  {
    key: "shipping",
    label: "Shipping",
    href: "/ops/customer-records/shipping",
    Icon: Truck,
  },
];

export function OpsAppSwitcher({ active, tone = "dark" }: OpsAppSwitcherProps) {
  const dark = tone === "dark";

  return (
    <nav
      aria-label="Ops-Bereiche"
      className={`flex flex-wrap items-center gap-2 rounded-2xl border p-1 ${
        dark ? "border-white/15 bg-white/5" : "border-black/10 bg-black/[0.03]"
      }`}
    >
      {OPS_APPS.map(({ key, label, href, Icon }) => {
        const isActive = key === active;
        return (
          <a
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
              dark
                ? isActive
                  ? "bg-white text-stone-950"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
                : isActive
                  ? "bg-stone-950 text-white"
                  : "text-stone-600 hover:bg-white hover:text-stone-950"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </a>
        );
      })}
    </nav>
  );
}
