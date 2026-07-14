"use client";

import { useState } from "react";
import { BadgeCheck, Database, ListChecks, Menu, Phone, Truck, X } from "lucide-react";

export type OpsModuleKey = "records" | "calls" | "tasks" | "price-review" | "shipping";

type OpsModuleNavProps = {
  active: OpsModuleKey;
  variant?: "dark" | "light";
  className?: string;
};

const modules: Array<{
  key: OpsModuleKey;
  label: string;
  href: string;
  icon: typeof Database;
}> = [
  { key: "records", label: "Customer Records", href: "/ops/customer-records", icon: Database },
  { key: "calls", label: "Calls", href: "/ops/customer-records/calls", icon: Phone },
  { key: "tasks", label: "Aufgaben", href: "/ops/customer-records/tasks", icon: ListChecks },
  { key: "price-review", label: "Preisprüfung", href: "/ops/customer-records/price-review", icon: BadgeCheck },
  { key: "shipping", label: "Shipping", href: "/ops/customer-records/shipping", icon: Truck },
];

function navLinkClass(active: boolean, variant: "dark" | "light") {
  if (variant === "light") {
    return [
      "inline-flex min-h-10 items-center gap-2 rounded-[0.5rem] border px-3 py-2 text-sm font-medium transition",
      active
        ? "border-stone-950 bg-stone-950 text-white"
        : "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50 hover:text-stone-950",
    ].join(" ");
  }

  return [
    "inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition",
    active
      ? "border-white bg-white text-black"
      : "border-white/15 bg-white/5 text-white/76 hover:border-white/30 hover:bg-white/10 hover:text-white",
  ].join(" ");
}

function mobilePanelClass(variant: "dark" | "light") {
  return variant === "light"
    ? "border-stone-200 bg-white text-stone-950 shadow-xl shadow-stone-950/10"
    : "border-white/15 bg-[#111111] text-white shadow-2xl shadow-black/30";
}

export function OpsModuleNav({ active, variant = "dark", className = "" }: OpsModuleNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = `ops-module-nav-${variant}-${active}`;
  const isDark = variant === "dark";

  return (
    <div className={`relative min-w-0 ${className}`}>
      <nav className="hidden min-w-0 flex-wrap items-center gap-2 md:flex" aria-label="Ops Module">
        {modules.map((item) => {
          const Icon = item.icon;
          return (
            <a key={item.key} href={item.href} className={navLinkClass(item.key === active, variant)}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </a>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={navLinkClass(false, variant).replace("hidden ", "") + " md:hidden"}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {open ? <X className="h-4 w-4 shrink-0" /> : <Menu className="h-4 w-4 shrink-0" />}
        <span>Module</span>
      </button>

      {open ? (
        <nav
          id={panelId}
          className={`absolute right-0 z-50 mt-2 w-[calc(100vw-2rem)] max-w-[20rem] rounded-2xl border p-2 md:hidden ${mobilePanelClass(variant)}`}
          aria-label="Ops Module"
        >
          {modules.map((item) => {
            const Icon = item.icon;
            const isActive = item.key === active;
            return (
              <a
                key={item.key}
                href={item.href}
                className={[
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive
                    ? isDark
                      ? "bg-white text-black"
                      : "bg-stone-950 text-white"
                    : isDark
                      ? "text-white/76 hover:bg-white/10 hover:text-white"
                      : "text-stone-700 hover:bg-stone-100 hover:text-stone-950",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
