"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, ListChecks, Pencil, RefreshCcw, Search, ShieldCheck, UserRound } from "lucide-react";
import { OpsModuleNav } from "@/components/ops/OpsModuleNav";
import type {
  CustomerInternalTask,
  CustomerInternalTaskBoard,
  CustomerInternalTaskCategory,
  CustomerInternalTaskPriority,
} from "@/lib/ops/customer-records";

type TasksApiResponse = {
  ok: boolean;
  board?: CustomerInternalTaskBoard;
  task?: CustomerInternalTask;
  error?: string;
  issues?: string[];
};

const categoryOptions: Array<{ value: CustomerInternalTaskCategory; label: string }> = [
  { value: "customer_followup", label: "Kunden-Follow-up" },
  { value: "problem_case", label: "Problemfall klären" },
  { value: "procurement", label: "Produkt nachbestellen" },
  { value: "production", label: "Produktion" },
  { value: "call", label: "Call / Rückruf" },
  { value: "admin", label: "Intern / Admin" },
  { value: "other", label: "Sonstiges" },
];

const priorityOptions: Array<{ value: CustomerInternalTaskPriority; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "Hoch" },
  { value: "urgent", label: "Dringend" },
  { value: "low", label: "Niedrig" },
];

function formatApiError(payload: { error?: string; issues?: string[] } | null) {
  if (!payload) return "Unbekannter Fehler.";
  if (payload.issues?.length) return payload.issues.join(" ");
  return payload.error || "Unbekannter Fehler.";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Ohne Deadline";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function priorityTone(priority: CustomerInternalTaskPriority) {
  switch (priority) {
    case "urgent":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "low":
      return "border-stone-200 bg-stone-50 text-stone-600";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
}

function categoryLabel(category: CustomerInternalTaskCategory) {
  return categoryOptions.find((option) => option.value === category)?.label || "Sonstiges";
}

function priorityLabel(priority: CustomerInternalTaskPriority) {
  return priorityOptions.find((option) => option.value === priority)?.label || "Normal";
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createClientActionId() {
  return window.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CustomerTasksClient({
  initialHasSession,
  opsEnabled,
  localMode,
}: {
  initialHasSession: boolean;
  opsEnabled: boolean;
  localMode: boolean;
}) {
  const operatorNameKey = "neontrip-internal-tasks-operator";
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [token, setToken] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [board, setBoard] = useState<CustomerInternalTaskBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [requestFilter, setRequestFilter] = useState("");
  const [includeDone, setIncludeDone] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [dueAt, setDueAt] = useState(todayDate());
  const [category, setCategory] = useState<CustomerInternalTaskCategory>("customer_followup");
  const [priority, setPriority] = useState<CustomerInternalTaskPriority>("normal");
  const [requestId, setRequestId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAssigneeName, setEditAssigneeName] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editCategory, setEditCategory] = useState<CustomerInternalTaskCategory>("other");
  const [editPriority, setEditPriority] = useState<CustomerInternalTaskPriority>("normal");
  const createActionIdRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(operatorNameKey);
      if (raw) {
        setOperatorName(raw);
        setAssigneeName(raw);
      }
      const params = new URLSearchParams(window.location.search);
      const requestIdFromUrl = params.get("requestId") || "";
      if (requestIdFromUrl) {
        setRequestId(requestIdFromUrl);
        setRequestFilter(requestIdFromUrl);
      }
    } catch {
      // local storage is optional
    }
  }, []);

  useEffect(() => {
    if (operatorName) window.localStorage.setItem(operatorNameKey, operatorName);
  }, [operatorName]);

  useEffect(() => {
    if ((!opsEnabled || hasSession || localMode) && !hasLoaded && !loading) {
      void loadTasks();
    }
  }, [hasLoaded, hasSession, loading, localMode, opsEnabled]);

  const groupedTasks = useMemo(() => {
    const tasks = board?.tasks || [];
    return {
      overdue: tasks.filter((task) => task.status === "open" && task.overdue),
      today: tasks.filter((task) => task.status === "open" && !task.overdue && task.dueAt?.slice(0, 10) === todayDate()),
      open: tasks.filter((task) => task.status === "open" && !task.overdue && task.dueAt?.slice(0, 10) !== todayDate()),
      done: tasks.filter((task) => task.status === "done"),
    };
  }, [board]);

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
    const params = new URLSearchParams();
    const urlRequestId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("requestId") || "" : "";
    const effectiveRequestFilter = requestFilter.trim() || urlRequestId.trim();
    if (assigneeFilter.trim()) params.set("assigneeName", assigneeFilter.trim());
    if (effectiveRequestFilter) params.set("requestId", effectiveRequestFilter);
    if (includeDone) params.set("includeDone", "true");
    const response = await fetch(`/api/ops/customer-records/tasks?${params.toString()}`);
    const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
    if (response.status === 401) {
      setHasSession(false);
      setHasLoaded(true);
      setLoading(false);
      return;
    }
    if (!response.ok || !payload?.ok || !payload.board) {
      setError(formatApiError(payload));
      setHasLoaded(true);
      setLoading(false);
      return;
    }
    setBoard(payload.board);
    setHasLoaded(true);
    setLoading(false);
  }

  async function createTask() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const clientActionId = createActionIdRef.current || createClientActionId();
    createActionIdRef.current = clientActionId;
    const response = await fetch("/api/ops/customer-records/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        clientActionId,
        operatorName,
        task: {
          title,
          description,
          assigneeName,
          dueAt,
          category,
          priority,
          requestId,
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
    if (!response.ok || !payload?.ok || !payload.board) {
      setError(formatApiError(payload));
      createActionIdRef.current = null;
      setSaving(false);
      return;
    }
    setBoard(payload.board);
    setTitle("");
    setDescription("");
    setRequestId("");
    setPriority("normal");
    setCategory("customer_followup");
    setDueAt(todayDate());
    setMessage("Aufgabe erstellt.");
    createActionIdRef.current = null;
    setSaving(false);
  }

  function openEdit(task: CustomerInternalTask) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description || "");
    setEditAssigneeName(task.assigneeName || "");
    setEditDueAt(task.dueAt ? task.dueAt.slice(0, 10) : "");
    setEditCategory(task.category);
    setEditPriority(task.priority);
  }

  async function updateTask() {
    if (!editingTaskId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const response = await fetch("/api/ops/customer-records/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        operatorName,
        update: {
          taskId: editingTaskId,
          title: editTitle,
          description: editDescription,
          assigneeName: editAssigneeName,
          dueAt: editDueAt,
          category: editCategory,
          priority: editPriority,
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
    if (!response.ok || !payload?.ok || !payload.board) {
      setError(formatApiError(payload));
      setSaving(false);
      return;
    }
    setBoard(payload.board);
    setEditingTaskId(null);
    setMessage("Aufgabe aktualisiert.");
    setSaving(false);
  }

  async function setTaskState(task: CustomerInternalTask, action: "complete" | "reopen") {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/ops/customer-records/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, taskId: task.id, operatorName }),
    });
    const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
    if (!response.ok || !payload?.ok || !payload.board) {
      setError(formatApiError(payload));
      return;
    }
    setBoard(payload.board);
    setMessage(action === "complete" ? "Aufgabe erledigt." : "Aufgabe wieder geöffnet.");
  }

  function TaskList({ title: listTitle, tasks }: { title: string; tasks: CustomerInternalTask[] }) {
    if (!tasks.length) return null;
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{listTitle}</h2>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">{tasks.length}</span>
        </div>
        <div className="grid gap-3">
          {tasks.map((task) => (
            <article key={task.id} className="rounded-[0.5rem] border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${priorityTone(task.priority)}`}>
                      {priorityLabel(task.priority)}
                    </span>
                    <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">
                      {categoryLabel(task.category)}
                    </span>
                    {task.overdue ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                        überfällig
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-stone-950">{task.title}</h3>
                  {task.description ? <p className="mt-1 text-sm leading-6 text-stone-600">{task.description}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-500">
                    <span>{task.originLabel}</span>
                    <span>Zuständig: {task.assigneeName || "nicht zugewiesen"}</span>
                    <span>Fällig: {formatDate(task.dueAt)}</span>
                    {task.requestId ? (
                      <a className="font-medium text-stone-800 hover:underline" href={`/ops/customer-records?query=${encodeURIComponent(task.requestId)}`}>
                        Customer Record öffnen
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => openEdit(task)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 px-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
                  >
                    <Pencil className="h-4 w-4" />
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={() => void setTaskState(task, task.status === "done" ? "reopen" : "complete")}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 px-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {task.status === "done" ? "Wieder öffnen" : "Erledigt"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (opsEnabled && !hasSession && !localMode) {
    return (
      <div className="min-h-screen overflow-x-hidden bg-stone-50 px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-xl rounded-[0.5rem] border border-stone-200 bg-white p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.3em] text-stone-400">Interne Aufgaben</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">Ops-Zugang</h1>
          <div className="mt-8 space-y-3">
            <input
              value={token}
	              onChange={(event) => setToken(event.target.value)}
	              className="w-full rounded-[0.5rem] border border-stone-300 px-4 py-3 text-base outline-none transition focus:border-stone-900"
	              aria-label="Ops-Token"
	              placeholder="Ops-Token"
              type="password"
            />
            <button
              onClick={() => void login()}
              className="rounded-[0.5rem] bg-stone-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-800"
            >
              Entsperren
            </button>
          </div>
          {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-50 px-4 py-6 text-stone-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-stone-400">NEONTRIP Ops</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">Interne Aufgaben</h1>
          </div>
          <OpsModuleNav active="tasks" variant="light" />
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <ListChecks className="h-5 w-5 text-stone-500" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.open || 0}</p>
            <p className="text-sm text-stone-500">offen</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <Clock3 className="h-5 w-5 text-amber-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.dueToday || 0}</p>
            <p className="text-sm text-stone-500">heute fällig</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <ShieldCheck className="h-5 w-5 text-rose-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.overdue || 0}</p>
            <p className="text-sm text-stone-500">überfällig</p>
          </div>
          <div className="rounded-[0.5rem] border border-stone-200 bg-white p-4">
            <UserRound className="h-5 w-5 text-emerald-600" />
            <p className="mt-3 text-2xl font-semibold">{board?.counts.urgent || 0}</p>
            <p className="text-sm text-stone-500">dringend</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <aside className="space-y-4 rounded-[0.5rem] border border-stone-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-base font-semibold">Neue Aufgabe</h2>
              <p className="mt-1 text-sm leading-6 text-stone-500">
                Für Kundenfälle, Calls, Produktnachbestellungen oder interne Klärungen.
              </p>
            </div>
            <input
              value={title}
	              onChange={(event) => setTitle(event.target.value)}
	              className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	              aria-label="Aufgabentitel"
	              placeholder="Aufgabentitel"
	            />
            <textarea
              value={description}
	              onChange={(event) => setDescription(event.target.value)}
	              className="min-h-24 w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	              aria-label="Notiz oder Kontext"
	              placeholder="Notiz / Kontext"
	            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <input
                value={assigneeName}
	                onChange={(event) => setAssigneeName(event.target.value)}
	                className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                aria-label="Zuständige Person"
	                placeholder="Zuständig"
	              />
              <input
                value={dueAt}
	                onChange={(event) => setDueAt(event.target.value)}
	                className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                aria-label="Fälligkeitsdatum"
	                type="date"
	              />
              <select
                value={category}
	                onChange={(event) => setCategory(event.target.value as CustomerInternalTaskCategory)}
	                className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                aria-label="Aufgabenkategorie"
	              >
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={priority}
	                onChange={(event) => setPriority(event.target.value as CustomerInternalTaskPriority)}
	                className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                aria-label="Priorität"
	              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <input
              value={requestId}
	              onChange={(event) => setRequestId(event.target.value)}
	              className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	              aria-label="Request-ID optional"
	              placeholder="Request-ID optional"
	            />
            <input
              value={operatorName}
	              onChange={(event) => setOperatorName(event.target.value)}
	              className="w-full rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	              aria-label="Dein Name"
	              placeholder="Dein Name"
            />
            <button
              type="button"
              disabled={saving || !title.trim()}
              onClick={() => void createTask()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              <ListChecks className="h-4 w-4" />
              {saving ? "Speichert..." : "Aufgabe erstellen"}
            </button>
          </aside>

          <div className="space-y-5">
            <div className="flex flex-col gap-3 rounded-[0.5rem] border border-stone-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Search className="h-4 w-4 text-stone-400" />
                <input
                  value={assigneeFilter}
	                  onChange={(event) => setAssigneeFilter(event.target.value)}
	                  className="w-full bg-transparent text-sm outline-none"
	                  aria-label="Nach zuständiger Person filtern"
	                  placeholder="Nach zuständiger Person filtern"
                />
              </div>
              <input
                value={requestFilter}
	                onChange={(event) => setRequestFilter(event.target.value)}
	                className="min-h-10 rounded-[0.5rem] border border-stone-200 px-3 text-sm outline-none focus:border-stone-900 sm:w-56"
	                aria-label="Request-ID filtern"
	                placeholder="Request-ID"
              />
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" checked={includeDone} onChange={(event) => setIncludeDone(event.target.checked)} />
                Erledigte zeigen
              </label>
              <button
                type="button"
                onClick={() => void loadTasks()}
                className="inline-flex items-center justify-center gap-2 rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Laden
              </button>
            </div>

            {error ? <p className="rounded-[0.5rem] border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            {message ? <p className="rounded-[0.5rem] border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}

            {editingTaskId ? (
              <section className="rounded-[0.5rem] border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Aufgabe bearbeiten</h2>
                    <p className="mt-1 text-sm text-stone-500">Zuständigkeit, Deadline, Kategorie und Priorität anpassen.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingTaskId(null)}
                    className="rounded-[0.5rem] border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50"
                  >
                    Abbrechen
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input
                    value={editTitle}
	                    onChange={(event) => setEditTitle(event.target.value)}
	                    className="rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900 md:col-span-2"
	                    aria-label="Aufgabentitel bearbeiten"
	                    placeholder="Aufgabentitel"
                  />
                  <textarea
                    value={editDescription}
	                    onChange={(event) => setEditDescription(event.target.value)}
	                    className="min-h-20 rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900 md:col-span-2"
	                    aria-label="Notiz oder Kontext bearbeiten"
	                    placeholder="Notiz / Kontext"
                  />
                  <input
                    value={editAssigneeName}
	                    onChange={(event) => setEditAssigneeName(event.target.value)}
	                    className="rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                    aria-label="Zuständige Person bearbeiten"
	                    placeholder="Zuständig"
                  />
                  <input
                    value={editDueAt}
	                    onChange={(event) => setEditDueAt(event.target.value)}
	                    className="rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                    aria-label="Fälligkeitsdatum bearbeiten"
	                    type="date"
                  />
                  <select
                    value={editCategory}
	                    onChange={(event) => setEditCategory(event.target.value as CustomerInternalTaskCategory)}
	                    className="rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                    aria-label="Aufgabenkategorie bearbeiten"
	                  >
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select
                    value={editPriority}
	                    onChange={(event) => setEditPriority(event.target.value as CustomerInternalTaskPriority)}
	                    className="rounded-[0.5rem] border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-900"
	                    aria-label="Priorität bearbeiten"
	                  >
                    {priorityOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={saving || !editTitle.trim()}
                  onClick={() => void updateTask()}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-[0.5rem] bg-stone-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  <Pencil className="h-4 w-4" />
                  {saving ? "Speichert..." : "Änderung speichern"}
                </button>
              </section>
            ) : null}

            {loading ? (
              <p className="rounded-[0.5rem] border border-stone-200 bg-white p-6 text-sm text-stone-500">Aufgaben werden geladen...</p>
            ) : board?.tasks.length ? (
              <div className="space-y-8">
                <TaskList title="Überfällig" tasks={groupedTasks.overdue} />
                <TaskList title="Heute" tasks={groupedTasks.today} />
                <TaskList title="Offen" tasks={groupedTasks.open} />
                {includeDone ? <TaskList title="Erledigt" tasks={groupedTasks.done} /> : null}
              </div>
            ) : (
              <p className="rounded-[0.5rem] border border-stone-200 bg-white p-6 text-sm text-stone-500">
                Keine Aufgaben in dieser Ansicht.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
