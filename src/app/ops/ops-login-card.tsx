"use client";

import { ArrowRight, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

type OpsLoginCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  operatorName: string;
  password: string;
  error?: string | null;
  buttonLabel?: string;
  onOperatorNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};

export function OpsLoginCard({
  title,
  eyebrow = "NEONTRIP Ops",
  description = "Melde dich mit deinem internen Zugang an. Die Sitzung wird als sicherer Cookie gespeichert.",
  operatorName,
  password,
  error,
  buttonLabel = "Anmelden",
  onOperatorNameChange,
  onPasswordChange,
  onSubmit,
}: OpsLoginCardProps) {
  return (
    <div className="min-h-screen bg-[#f7f4ef] px-6 py-10 text-stone-950">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border border-black/10 bg-white shadow-2xl shadow-stone-900/10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="hidden bg-stone-950 p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-stone-200">
                <ShieldCheck className="h-4 w-4" />
                Interner Bereich
              </div>
              <h1 className="mt-8 text-4xl font-semibold tracking-tight">NEONTRIP Kommandozentrale</h1>
              <p className="mt-5 max-w-sm text-sm leading-7 text-stone-300">
                Customer Records, Calls und Aufgaben bleiben geschützt. Änderungen werden serverseitig geprüft und protokolliert.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-stone-300">
              Zugriff nur für interne Nutzung. Teile Zugangsdaten nicht außerhalb des Teams.
            </div>
          </div>

          <form
            className="p-7 sm:p-10"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmit();
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">{eyebrow}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-stone-600">{description}</p>

            <div className="mt-8 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-stone-800">Name</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={operatorName}
                    onChange={(event) => onOperatorNameChange(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-stone-300 bg-white pl-11 pr-4 text-sm outline-none transition placeholder:text-stone-400 focus:border-stone-950"
                    placeholder="Dein Name"
                    autoComplete="username"
                  />
                </span>
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-medium text-stone-800">Passwort</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-stone-300 bg-white pl-11 pr-4 text-sm outline-none transition placeholder:text-stone-400 focus:border-stone-950"
                    placeholder="Internes Passwort"
                    type="password"
                    autoComplete="current-password"
                  />
                </span>
              </label>
            </div>

            {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

            <button
              type="submit"
              className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-medium text-white transition hover:bg-stone-800"
            >
              {buttonLabel}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
