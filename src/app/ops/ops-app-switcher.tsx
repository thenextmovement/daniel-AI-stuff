"use client";

import { BadgeEuro, BarChart3, BookOpenCheck, BrainCircuit, Building2, Calculator, ClipboardList, Factory, FileText, Headphones, MailCheck, Palette, PhoneCall, PlaneLanding, ReceiptText, Truck, type LucideIcon, UsersRound } from "lucide-react";

export type OpsAppKey =
  | "records"
  | "voiceCopilot"
  | "priceReview"
  | "calls"
  | "tasks"
  | "companyBrain"
  | "companyKnowledge"
  | "design"
  | "offers"
  | "billing"
  | "dunning"
  | "supplierSales"
  | "euSupplierQuotes"
  | "shipping"
  | "inboundShipping"
  | "management"
  | "emailAgent";

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
    key: "voiceCopilot",
    label: "Voice Copilot",
    helper: "Live-Hilfe & Wissen",
    href: "/ops/voice-copilot",
    Icon: Headphones,
  },
  {
    key: "priceReview",
    label: "Schildgrößen & Preise",
    helper: "Größe und Preis prüfen",
    href: "/ops/customer-records/price-review",
    Icon: Calculator,
  },
  {
    key: "calls",
    label: "Anrufe",
    helper: "Callliste & Rückrufe",
    href: "/ops/customer-records/calls",
    Icon: PhoneCall,
  },
  {
    key: "tasks",
    label: "Aufgaben",
    helper: "To-dos & Übergaben",
    href: "/ops/tasks",
    Icon: ClipboardList,
  },
  {
    key: "companyBrain",
    label: "Company Brain",
    helper: "Fälle & Belege",
    href: "/ops/company-brain",
    Icon: BrainCircuit,
  },
  {
    key: "companyKnowledge",
    label: "Wissen",
    helper: "Regeln & Entscheidungen",
    href: "/ops/company-brain/governance",
    Icon: BookOpenCheck,
  },
  {
    key: "emailAgent",
    label: "E-Mail Agent",
    helper: "Entwürfe & Lernfreigabe",
    href: "/ops/email-agent",
    Icon: MailCheck,
  },
  {
    key: "design",
    label: "Design",
    helper: "Mockups & Freigaben",
    href: "/ops/design",
    Icon: Palette,
  },
  {
    key: "offers",
    label: "Angebote",
    helper: "Erstellen & senden",
    href: "/ops/offers",
    Icon: FileText,
  },
  {
    key: "billing",
    label: "Rechnungen",
    helper: "Pro-forma & Belege",
    href: "/ops/rechnungen",
    Icon: ReceiptText,
  },
  {
    key: "dunning",
    label: "Mahnwesen",
    helper: "Forderungen & Mahnstufen",
    href: "/ops/mahnwesen",
    Icon: BadgeEuro,
  },
  {
    key: "supplierSales",
    label: "Sales-Vergabe",
    helper: "Supplier & Deadlines",
    href: "/ops/sales-vergabe",
    Icon: Factory,
  },
  {
    key: "euSupplierQuotes",
    label: "EU Supplier 3D Schilder",
    helper: "Anfragen & Angebote",
    href: "/ops/eu-supplier-3d-signs",
    Icon: Building2,
  },
  {
    key: "shipping",
    label: "Versand",
    helper: "Pakete zum Kunden",
    href: "/ops/customer-records/shipping",
    Icon: Truck,
  },
  {
    key: "inboundShipping",
    label: "Wareneingang",
    helper: "Lieferungen rein",
    href: "/ops/customer-records/inbound-shipping",
    Icon: PlaneLanding,
  },
  {
    key: "management",
    label: "Management",
    helper: "Umsatz, Kosten, Risiken",
    href: "/ops/management",
    Icon: BarChart3,
  },
];

export function OpsAppSwitcher({ active, tone = "dark" }: OpsAppSwitcherProps) {
  const dark = tone === "dark";

  function appLinkClass(isActive: boolean) {
    const base = "grid min-h-[3.25rem] min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 rounded-[0.75rem] px-2.5 py-2 text-left text-sm font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-2";

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
      <nav
        aria-label="Ops-Bereiche"
        className={`grid min-w-0 w-full max-w-full grid-cols-2 gap-1.5 rounded-[1rem] border p-1 sm:grid-cols-[repeat(auto-fit,minmax(11.75rem,1fr))] ${
          dark ? "border-white/12 bg-white/[0.045]" : "border-black/10 bg-black/[0.03]"
        }`}
      >
        {OPS_APPS.map(({ key, label, helper, href, Icon }) => {
          const isActive = key === active;
          return (
            <a key={key} href={href} aria-current={isActive ? "page" : undefined} className={appLinkClass(isActive)}>
              <Icon className="h-4 w-4 shrink-0" />
              <span data-ops-app-label={label} className="min-w-0 whitespace-normal break-words">{label}</span>
              <span className={`${helperClass(isActive)} hidden lg:block`}>{helper}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
