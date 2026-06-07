"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Lightbulb, Send, X } from "lucide-react";

type IdeaKind = "Verbesserung" | "Feature" | "Fehlt" | "Problem";

type TaskCreateResponse = {
  ok?: boolean;
  error?: string;
  issues?: string[];
};

const OPERATOR_STORAGE_KEY = "neontrip-ops-idea-operator";
const kinds: IdeaKind[] = ["Verbesserung", "Feature", "Fehlt", "Problem"];

function formatApiError(payload: TaskCreateResponse | null) {
  if (!payload) return "Vorschlag konnte nicht gespeichert werden.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Vorschlag konnte nicht gespeichert werden.";
}

function compact(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function OpsIdeaBox() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IdeaKind>("Verbesserung");
  const [operatorName, setOperatorName] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setOperatorName(window.localStorage.getItem(OPERATOR_STORAGE_KEY) || window.localStorage.getItem("neontrip-ops-operator") || "");
    } catch {
      // localStorage can be unavailable in hardened browser contexts.
    }
  }, []);

  useEffect(() => {
    if (!operatorName.trim()) return;
    try {
      window.localStorage.setItem(OPERATOR_STORAGE_KEY, operatorName.trim());
    } catch {
      // ignore local storage issues
    }
  }, [operatorName]);

  const canSubmit = useMemo(() => title.trim().length >= 3 && detail.trim().length >= 8 && !saving, [detail, saving, title]);

  async function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const path = window.location.pathname + window.location.search;
    const submissionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `idea-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const response = await fetch("/api/ops/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${kind}: ${compact(title, 180)}`,
          description: compact(detail, 2500),
          status: "open",
          priority: kind === "Problem" ? "high" : "normal",
          category: "other",
          assigneeLabel: "Daniel",
          sourceApp: "ops_idea_box",
          sourceRef: submissionId,
          metadata: {
            kind,
            path,
            pageTitle: document.title,
            submittedAt: new Date().toISOString(),
          },
          operatorName: compact(operatorName, 120) || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TaskCreateResponse | null;
      if (!response.ok || !payload?.ok) throw new Error(formatApiError(payload));

      setMessage("Vorschlag gespeichert.");
      setTitle("");
      setDetail("");
      setKind("Verbesserung");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Vorschlag konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed bottom-5 left-5 z-[70] max-w-[calc(100vw-2.5rem)] text-stone-950">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          className="inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold shadow-2xl shadow-stone-950/15 transition hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-950/20"
        >
          <Lightbulb className="h-4 w-4 text-[#c21876]" />
          Idee
        </button>
      ) : (
        <aside className="w-[420px] max-w-full overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-2xl shadow-stone-950/20">
          <div className="bg-stone-950 px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/60">Mitarbeiter-Vorschlag</p>
                <h2 className="mt-2 text-lg font-semibold">Idee einreichen</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white"
                aria-label="Ideenbox schließen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <form className="grid gap-4 px-5 py-5" onSubmit={(event) => void submitIdea(event)}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {kinds.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setKind(entry)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    kind === entry
                      ? "border-stone-950 bg-stone-950 text-white"
                      : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:text-stone-950"
                  }`}
                >
                  {entry}
                </button>
              ))}
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-800">Name</span>
              <input
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                className="h-11 rounded-xl border border-stone-300 px-4 text-sm outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10"
                placeholder="optional"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-800">Kurzbeschreibung</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-11 rounded-xl border border-stone-300 px-4 text-sm outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10"
                placeholder="z. B. Angebotsbilder schneller finden"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-stone-800">Details</span>
              <textarea
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                className="min-h-28 resize-none rounded-xl border border-stone-300 px-4 py-3 text-sm leading-6 outline-none transition focus:border-stone-950 focus:ring-2 focus:ring-stone-950/10"
                placeholder="Was fehlt, was nervt oder was könnte besser laufen?"
              />
            </label>

            {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {message ? (
              <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                {message}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
            >
              <Send className="h-4 w-4" />
              {saving ? "Speichert..." : "Vorschlag speichern"}
            </button>
          </form>
        </aside>
      )}
    </div>
  );
}
