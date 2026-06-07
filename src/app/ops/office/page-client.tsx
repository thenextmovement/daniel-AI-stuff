"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckSquare, Cloud, ExternalLink, Mail, MessageSquare, MonitorSmartphone } from "lucide-react";
import { OpsAppSwitcher } from "../ops-app-switcher";
import { OpsLoginCard } from "../ops-login-card";

const officeTools = [
  {
    label: "Outlook Mail",
    helper: "Postfach und Kundenmails",
    href: "https://outlook.office.com/mail/",
    Icon: Mail,
  },
  {
    label: "Outlook Kalender",
    helper: "Termine und Rückrufe",
    href: "https://outlook.office.com/calendar/",
    Icon: CalendarDays,
  },
  {
    label: "OneDrive",
    helper: "Dateien und Freigaben",
    href: "https://www.office.com/launch/onedrive",
    Icon: Cloud,
  },
  {
    label: "Teams",
    helper: "Interne Kommunikation",
    href: "https://teams.microsoft.com/",
    Icon: MessageSquare,
  },
  {
    label: "Microsoft To Do",
    helper: "Persönliche Aufgaben",
    href: "https://to-do.office.com/tasks/",
    Icon: CheckSquare,
  },
  {
    label: "Microsoft 365",
    helper: "Office-Startseite",
    href: "https://www.office.com/",
    Icon: MonitorSmartphone,
  },
];

export function OpsOfficeClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-office-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(operatorNameKey, operatorName);
  }, [operatorName]);

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError("Ops-Login fehlgeschlagen.");
      return;
    }
    setHasSession(true);
    setToken("");
  }

  if (!opsEnabled) {
    return <div className="min-h-screen bg-stone-100 p-8 text-stone-700">Ops Portal ist nicht konfiguriert.</div>;
  }

  if (!hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Office"
        title="Office-Software anmelden"
        description="Melde dich für die internen Office-Verknüpfungen an. Mail, Kalender, Dateien und Team-Kommunikation bleiben im geschützten Ops-Bereich."
        activeApp="office"
        operatorName={operatorName}
        password={token}
        error={error}
        buttonLabel="Einloggen"
        onOperatorNameChange={setOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 text-stone-950 md:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-[0.5rem] bg-stone-950 px-6 py-6 text-white shadow-xl shadow-stone-950/10">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <p className="text-sm uppercase tracking-[0.3em] text-stone-400">Office</p>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight">Office-Software</h1>
                <p className="mt-4 text-base leading-7 text-stone-300">
                  Zentrale Einstiege für Mail, Kalender, Dateien und Team-Kommunikation.
                </p>
              </div>
            </div>
            <OpsAppSwitcher active="office" tone="dark" />
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {officeTools.map(({ label, helper, href, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="grid min-h-[7rem] grid-cols-[2.75rem_minmax(0,1fr)_1rem] items-center gap-4 rounded-[0.5rem] border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950/20"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-stone-950 text-white">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-stone-950">{label}</span>
                <span className="mt-1 block truncate text-sm text-stone-500">{helper}</span>
              </span>
              <ExternalLink className="h-4 w-4 text-stone-400" />
            </a>
          ))}
        </section>
      </div>
    </main>
  );
}
