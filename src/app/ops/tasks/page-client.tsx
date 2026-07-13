"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  ExternalLink,
  PackagePlus,
  Plus,
  RefreshCcw,
  UserRound,
} from "lucide-react";
import type {
  OpsInternalTask,
  OpsInternalTaskCategory,
  OpsInternalTaskPriority,
  OpsInternalTaskStatus,
} from "@/lib/ops/internal-tasks";
import { OpsLoginCard } from "../ops-login-card";
import { OpsPageHeader } from "../ops-page-header";
import { OpsPageIntro, OpsStatCard, opsPageContainerClass, opsPageShellClass } from "../ops-design";

type TasksApiResponse = {
  ok: boolean;
  tasks?: OpsInternalTask[];
  task?: OpsInternalTask;
  summary?: {
    open: number;
    urgent: number;
    overdue: number;
    dueToday: number;
  };
  error?: string;
  issues?: string[];
};

type TaskDraft = {
  title: string;
  description: string;
  category: OpsInternalTaskCategory;
  priority: OpsInternalTaskPriority;
  assigneeLabel: string;
  dueAt: string;
  requestId: string;
  customerName: string;
};

const categoryOptions: Array<{ value: OpsInternalTaskCategory; label: string }> = [
  { value: "customer", label: "Kundenfall" },
  { value: "call", label: "Call" },
  { value: "problem", label: "Problemfall" },
  { value: "product_restock", label: "Nachbestellen" },
  { value: "offer", label: "Angebot" },
  { value: "admin", label: "Intern" },
  { value: "other", label: "Sonstiges" },
];

const priorityOptions: Array<{ value: OpsInternalTaskPriority; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Wichtig" },
  { value: "urgent", label: "Dringend" },
  { value: "low", label: "Niedrig" },
];

const columns: Array<{ key: "open" | "done"; title: string; helper: string }> = [
  { key: "open", title: "Offen", helper: "Alles, was noch nicht erledigt ist." },
  { key: "done", title: "Erledigt", helper: "Abgeschlossene Aufgaben, wenn die Historie eingeblendet ist." },
];

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatDateTime(value: string | null) {
  if (!value) return "Keine Frist";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Keine Frist";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toInputDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function defaultDueAt() {
  const date = new Date();
  date.setHours(date.getHours() + 4, 0, 0, 0);
  return toInputDateTime(date);
}

function priorityClass(priority: OpsInternalTaskPriority) {
  switch (priority) {
    case "urgent":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "low":
      return "border-stone-200 bg-stone-50 text-stone-600";
    default:
      return "border-sky-200 bg-sky-50 text-sky-800";
  }
}

function categoryLabel(category: OpsInternalTaskCategory) {
  return categoryOptions.find((option) => option.value === category)?.label || "Sonstiges";
}

function isOverdue(task: OpsInternalTask) {
  if (!task.dueAt || task.status === "done" || task.status === "archived") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function sortTasks(tasks: OpsInternalTask[]) {
  const priorityRank: Record<OpsInternalTaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...tasks].sort((left, right) => {
    if (isOverdue(left) !== isOverdue(right)) return isOverdue(left) ? -1 : 1;
    if (left.priority !== right.priority) return priorityRank[left.priority] - priorityRank[right.priority];
    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function columnKeyForTask(task: OpsInternalTask): "open" | "done" | null {
  if (task.status === "archived") return null;
  return task.status === "done" ? "done" : "open";
}

function confirmTaskDone(task: OpsInternalTask) {
  if (typeof window === "undefined") return true;
  return window.confirm(`Aufgabe "${task.title}" als erledigt markieren?`);
}

function TaskCard({
  task,
  operatorName,
  onUpdate,
}: {
  task: OpsInternalTask;
  operatorName: string;
  onUpdate: (taskId: string, patch: Partial<OpsInternalTask> & { status?: OpsInternalTaskStatus }) => Promise<void>;
}) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${priorityClass(task.priority)}`}>
              {priorityOptions.find((option) => option.value === task.priority)?.label || task.priority}
            </span>
            <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-medium text-stone-600">
              {categoryLabel(task.category)}
            </span>
          </div>
          <h3 className="mt-3 text-base font-semibold text-stone-950">{task.title}</h3>
        </div>
        {isOverdue(task) ? <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" /> : null}
      </div>

      {task.description ? <p className="mt-3 whitespace-pre-line text-sm leading-6 text-stone-600">{task.description}</p> : null}

      <div className="mt-4 grid gap-2 text-xs text-stone-500">
        <div className="inline-flex items-center gap-2">
          <UserRound className="h-3.5 w-3.5" />
          {task.assigneeLabel || "Nicht zugewiesen"}
        </div>
        <div className={`inline-flex items-center gap-2 ${isOverdue(task) ? "font-semibold text-rose-700" : ""}`}>
          <Clock3 className="h-3.5 w-3.5" />
          {formatDateTime(task.dueAt)}
        </div>
        {task.customerName || task.requestId ? (
          <div className="inline-flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5" />
            {task.customerName || task.requestId}
          </div>
        ) : null}
      </div>

      {task.requestId ? (
        <a
          href={`/ops/customer-records?query=${encodeURIComponent(task.requestId)}`}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
        >
          Fall öffnen
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {task.status !== "done" ? (
          <button
            type="button"
            onClick={() => {
              if (!confirmTaskDone(task)) return;
              void onUpdate(task.id, { status: "done", assigneeLabel: task.assigneeLabel || operatorName || null });
            }}
            aria-label={`Aufgabe ${task.title} als erledigt markieren`}
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
          >
            Erledigt
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function OpsTasksClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const sharedOperatorNameKey = "neontrip-ops-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [tasks, setTasks] = useState<OpsInternalTask[]>([]);
  const [includeDone, setIncludeDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraft>({
    title: "",
    description: "",
    category: "other",
    priority: "normal",
    assigneeLabel: "",
    dueAt: defaultDueAt(),
    requestId: "",
    customerName: "",
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(sharedOperatorNameKey);
      if (raw) setOperatorName(raw);
    } catch {
      // ignore local storage issues
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(sharedOperatorNameKey, operatorName);
  }, [operatorName]);

  useEffect(() => {
    if (!opsEnabled || hasSession || localMode) void loadTasks();
  }, [hasSession, includeDone, localMode, opsEnabled]);

  const summary = useMemo(() => {
    const visibleOpen = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
    return {
      open: visibleOpen.length,
      urgent: visibleOpen.filter((task) => task.priority === "urgent" || task.priority === "high").length,
      overdue: visibleOpen.filter(isOverdue).length,
      dueToday: visibleOpen.filter((task) => {
        if (!task.dueAt) return false;
        const due = new Date(task.dueAt);
        const now = new Date();
        return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
      }).length,
    };
  }, [tasks]);

  async function login() {
    setError(null);
    const response = await fetch("/api/ops/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; issues?: string[] } | null;
    if (!response.ok) {
      setError(formatApiError(payload));
      return;
    }
    setHasSession(true);
    setToken("");
    setMessage("Zugang aktiv.");
    void loadTasks();
  }

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/tasks?includeDone=${includeDone ? "1" : "0"}&limit=120`);
      const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
      if (response.status === 401) {
        setHasSession(false);
        return;
      }
      if (!response.ok || !payload?.ok || !payload.tasks) {
        setError(formatApiError(payload));
        return;
      }
      setTasks(payload.tasks);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Aufgaben konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/ops/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          priority: draft.priority,
          assigneeLabel: draft.assigneeLabel || null,
          dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
          requestId: draft.requestId || null,
          customerName: draft.customerName || null,
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.tasks) {
        setError(formatApiError(payload));
        return;
      }
      setTasks(payload.tasks);
      setDraft({
        title: "",
        description: "",
        category: "other",
        priority: "normal",
        assigneeLabel: "",
        dueAt: defaultDueAt(),
        requestId: "",
        customerName: "",
      });
      setMessage("Aufgabe gespeichert.");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Aufgabe konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(taskId: string, patch: Partial<OpsInternalTask> & { status?: OpsInternalTaskStatus }) {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/ops/tasks/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: patch.status,
          assigneeLabel: patch.assigneeLabel,
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
      if (!response.ok || !payload?.ok || !payload.task) {
        setError(formatApiError(payload));
        return;
      }
      setTasks((current) => current.map((task) => (task.id === payload.task?.id ? payload.task : task)));
      setMessage("Aufgabe aktualisiert.");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Aufgabe konnte nicht aktualisiert werden.");
    }
  }

  if (opsEnabled && !hasSession && !localMode) {
    return (
      <OpsLoginCard
        eyebrow="Aufgaben"
        title="Aufgaben anmelden"
        description="Interne Aufgaben, Problemfälle und Nachbestellungen bleiben geschützt und werden serverseitig gespeichert."
        activeApp="tasks"
        operatorName={operatorName}
        password={token}
        error={error}
        onOperatorNameChange={setOperatorName}
        onPasswordChange={setToken}
        onSubmit={login}
      />
    );
  }

  const grouped = columns.map((column) => ({
    ...column,
    tasks: sortTasks(tasks.filter((task) => columnKeyForTask(task) === column.key)),
  }));

  return (
    <div className={`${opsPageShellClass} px-4 py-6 md:px-6`}>
      <div className={`${opsPageContainerClass} space-y-6`}>
        <OpsPageHeader active="tasks" label="Aufgaben" />

        <OpsPageIntro
          eyebrow="Team Ops"
          title="Aufgaben steuern. Übergaben sauber schließen."
          description="Interne To-dos, Nacharbeiten und Problemfälle bleiben in klaren Zuständen sichtbar, damit Verantwortliche ohne Kontextverlust weiterarbeiten."
        >
          <input
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
            className="h-12 w-full rounded-2xl border border-white/12 bg-white/10 px-4 text-sm text-white outline-none transition placeholder:text-white/[0.42] focus:border-white/35 sm:w-52"
            placeholder="Operator"
            aria-label="Operator"
          />
          <button
            type="button"
            onClick={() => void loadTasks()}
            disabled={loading}
            className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-medium text-stone-950 transition hover:bg-[#f7f2ea] disabled:opacity-60"
          >
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Lädt..." : "Aktualisieren"}
          </button>
        </OpsPageIntro>

        {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">{error}</div> : null}
        {message ? (
          <div role="status" className="rounded-3xl border border-emerald-300 bg-emerald-50 px-6 py-4 text-sm text-emerald-900">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4" />
              {message}
            </div>
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4">
          <OpsStatCard label="Offen" value={summary.open} detail="Noch nicht gestartete Arbeit." />
          <OpsStatCard label="Wichtig" value={summary.urgent} tone="warning" detail="Priorität hoch oder dringend." />
          <OpsStatCard label="Überfällig" value={summary.overdue} tone="danger" detail="Frist liegt bereits zurück." />
          <OpsStatCard label="Heute" value={summary.dueToday} tone="info" detail="Heute fällig oder geplant." />
        </section>

        <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <form onSubmit={createTask} className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-white">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Neu</p>
                <h2 className="text-xl font-semibold">Aufgabe erfassen</h2>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Titel</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  className="h-11 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                  placeholder="z. B. Netzteil nachbestellen"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Notiz</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-24 rounded-2xl border border-stone-300 px-4 py-3 text-sm outline-none focus:border-stone-950"
                  placeholder="Was muss passieren?"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Kategorie</span>
                  <select
                    value={draft.category}
                    onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as OpsInternalTaskCategory }))}
                    className="h-11 rounded-2xl border border-stone-300 px-3 text-sm outline-none focus:border-stone-950"
                  >
                    {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Priorität</span>
                  <select
                    value={draft.priority}
                    onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as OpsInternalTaskPriority }))}
                    className="h-11 rounded-2xl border border-stone-300 px-3 text-sm outline-none focus:border-stone-950"
                  >
                    {priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Zuständig</span>
                <input
                  value={draft.assigneeLabel}
                  onChange={(event) => setDraft((current) => ({ ...current, assigneeLabel: event.target.value }))}
                  className="h-11 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                  placeholder="Daniel, Rahim, Fabienne..."
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Deadline</span>
                <input
                  value={draft.dueAt}
                  onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
                  type="datetime-local"
                  className="h-11 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Request-ID</span>
                  <input
                    value={draft.requestId}
                    onChange={(event) => setDraft((current) => ({ ...current, requestId: event.target.value }))}
                    className="h-11 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                    placeholder="optional"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Kunde/Fall</span>
                  <input
                    value={draft.customerName}
                    onChange={(event) => setDraft((current) => ({ ...current, customerName: event.target.value }))}
                    className="h-11 rounded-2xl border border-stone-300 px-4 text-sm outline-none focus:border-stone-950"
                    placeholder="optional"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-60"
              >
                <PackagePlus className="h-4 w-4" />
                {saving ? "Speichert..." : "Aufgabe speichern"}
              </button>
            </div>
          </form>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-stone-200 bg-white px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Board</p>
                <h2 className="mt-1 text-xl font-semibold">Aufgaben</h2>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={includeDone}
                  onChange={(event) => setIncludeDone(event.target.checked)}
                  className="h-4 w-4 rounded border-stone-300"
                />
                Erledigte anzeigen
              </label>
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              {grouped.map((column) => (
                <section key={column.key} className="min-w-0 rounded-[2rem] border border-stone-200 bg-stone-100/70 p-3">
                  <div className="px-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">{column.title}</h3>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-stone-600">{column.tasks.length}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-stone-500">{column.helper}</p>
                  </div>
                  <div className="mt-2 grid gap-3">
                    {column.tasks.length ? (
                      column.tasks.map((task) => (
                        <TaskCard key={task.id} task={task} operatorName={operatorName} onUpdate={updateTask} />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/70 px-4 py-8 text-center text-sm text-stone-500">
                        Keine Aufgaben.
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
