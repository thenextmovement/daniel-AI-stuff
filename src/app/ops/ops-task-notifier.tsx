"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Clock3, ExternalLink, RefreshCcw, X } from "lucide-react";
import type { OpsInternalTask } from "@/lib/ops/internal-tasks";

type TasksApiResponse = {
  ok: boolean;
  tasks?: OpsInternalTask[];
  error?: string;
  issues?: string[];
};

const OPERATOR_STORAGE_KEY = "neontrip-ops-operator";
const DISMISSED_STORAGE_KEY = "neontrip-ops-task-notifier-dismissed";
const IDEA_BOX_EVENT = "neontrip:ops-idea-box";
const POLL_INTERVAL_MS = 60_000;
const DUE_SOON_MS = 90 * 60_000;

function normalizeLabel(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isActiveTask(task: OpsInternalTask) {
  return task.status !== "done" && task.status !== "archived";
}

function dueTime(task: OpsInternalTask) {
  if (!task.dueAt) return null;
  const time = new Date(task.dueAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function isOverdue(task: OpsInternalTask, now = Date.now()) {
  const time = dueTime(task);
  return time !== null && time < now;
}

function isDueSoon(task: OpsInternalTask, now = Date.now()) {
  const time = dueTime(task);
  return time !== null && time >= now && time <= now + DUE_SOON_MS;
}

function isAssignedToOperator(task: OpsInternalTask, operatorName: string) {
  const assignee = normalizeLabel(task.assigneeLabel);
  const operator = normalizeLabel(operatorName);
  if (!assignee) return false;
  if (!operator) return true;
  return assignee.includes(operator) || operator.includes(assignee);
}

function shouldNotify(task: OpsInternalTask, operatorName: string, now = Date.now()) {
  if (!isActiveTask(task)) return false;
  const assignedToMe = isAssignedToOperator(task, operatorName);
  const unassigned = !normalizeLabel(task.assigneeLabel);
  if (!assignedToMe && !unassigned) return false;
  if (isOverdue(task, now) || isDueSoon(task, now)) return true;
  return unassigned && task.priority === "urgent";
}

function sortAttentionTasks(tasks: OpsInternalTask[]) {
  const priorityRank: Record<OpsInternalTask["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return [...tasks].sort((left, right) => {
    const leftOverdue = isOverdue(left);
    const rightOverdue = isOverdue(right);
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
    if (left.priority !== right.priority) return priorityRank[left.priority] - priorityRank[right.priority];
    const leftDue = dueTime(left) ?? Number.POSITIVE_INFINITY;
    const rightDue = dueTime(right) ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function formatDue(value: string | null) {
  if (!value) return "ohne Frist";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ohne Frist";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function notificationKey(tasks: OpsInternalTask[]) {
  return tasks.map((task) => `${task.id}:${task.updatedAt}`).join("|");
}

function loadDismissedKey() {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveDismissedKey(key: string) {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, key);
  } catch {
    // ignore local storage issues
  }
}

function confirmTaskDone(task: OpsInternalTask) {
  if (typeof window === "undefined") return true;
  return window.confirm(`Aufgabe "${task.title}" als erledigt markieren?`);
}

function readOperatorName() {
  try {
    return window.localStorage.getItem(OPERATOR_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function OpsTaskNotifier() {
  const [tasks, setTasks] = useState<OpsInternalTask[]>([]);
  const [operatorName, setOperatorName] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [ideaBoxOpen, setIdeaBoxOpen] = useState(false);
  const latestBrowserNotificationKey = useRef("");

  const attentionTasks = useMemo(() => {
    const now = Date.now();
    return sortAttentionTasks(tasks.filter((task) => shouldNotify(task, operatorName, now)));
  }, [operatorName, tasks]);

  const currentKey = useMemo(() => notificationKey(attentionTasks), [attentionTasks]);
  const overdueCount = useMemo(() => attentionTasks.filter((task) => isOverdue(task)).length, [attentionTasks]);

  async function loadTasks() {
    setLoading(true);
    try {
      const response = await fetch("/api/ops/tasks?limit=80", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as TasksApiResponse | null;
      if (response.status === 401 || response.status === 503) {
        setTasks([]);
        setLastError(null);
        return;
      }
      if (!response.ok || !payload?.ok || !payload.tasks) {
        setLastError(payload?.issues?.join(" ") || payload?.error || "Aufgaben konnten nicht geladen werden.");
        return;
      }
      setTasks(payload.tasks);
      setLastError(null);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Aufgaben konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function markDone(task: OpsInternalTask) {
    try {
      const response = await fetch(`/api/ops/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "done",
          assigneeLabel: task.assigneeLabel || operatorName || null,
          operatorName: operatorName || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; task?: OpsInternalTask; error?: string; issues?: string[] } | null;
      if (!response.ok || !payload?.ok || !payload.task) {
        setLastError(payload?.issues?.join(" ") || payload?.error || "Aufgabe konnte nicht erledigt werden.");
        return;
      }
      setTasks((current) => current.map((entry) => (entry.id === payload.task?.id ? payload.task : entry)));
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Aufgabe konnte nicht erledigt werden.");
    }
  }

  function dismiss() {
    if (currentKey) {
      saveDismissedKey(currentKey);
      setDismissedKey(currentKey);
    }
    setOpen(false);
  }

  function requestBrowserNotifications() {
    if (!("Notification" in window)) return;
    void Notification.requestPermission();
  }

  useEffect(() => {
    setOperatorName(readOperatorName());
    setDismissedKey(loadDismissedKey());
    void loadTasks();

    const interval = window.setInterval(() => {
      setOperatorName(readOperatorName());
      void loadTasks();
    }, POLL_INTERVAL_MS);

    const onFocus = () => {
      setOperatorName(readOperatorName());
      void loadTasks();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    function onIdeaBoxChange(event: Event) {
      setIdeaBoxOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    }

    window.addEventListener(IDEA_BOX_EVENT, onIdeaBoxChange);
    return () => window.removeEventListener(IDEA_BOX_EVENT, onIdeaBoxChange);
  }, []);

  useEffect(() => {
    if (!currentKey || currentKey === dismissedKey) return;

    if ("Notification" in window && Notification.permission === "granted" && currentKey !== latestBrowserNotificationKey.current) {
      latestBrowserNotificationKey.current = currentKey;
      const topTask = attentionTasks[0];
      if (topTask) {
        new Notification(overdueCount ? "NEONTRIP: Aufgabe überfällig" : "NEONTRIP: Aufgabe fällig", {
          body: `${operatorName ? `${operatorName}, ` : ""}${topTask.title}`,
          tag: `ops-task-${topTask.id}`,
        });
      }
    }
  }, [attentionTasks, currentKey, dismissedKey, operatorName, overdueCount]);

  if (ideaBoxOpen) return null;
  if (!attentionTasks.length && !lastError) return null;

  return (
    <div className="fixed bottom-2 left-14 z-[80] max-w-[calc(100vw-4rem)] text-stone-950 sm:bottom-5 sm:left-auto sm:right-5 sm:max-w-[calc(100vw-2.5rem)]">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex h-10 w-10 items-center justify-center gap-2 rounded-full border text-sm font-semibold shadow-2xl transition sm:h-auto sm:w-auto sm:rounded-2xl sm:px-4 sm:py-3 ${
            overdueCount
              ? "border-rose-300 bg-rose-600 text-white shadow-rose-950/25 hover:bg-rose-700"
              : "border-amber-300 bg-amber-100 text-amber-950 shadow-stone-950/15 hover:bg-amber-200"
          }`}
          aria-label={attentionTasks.length ? `${attentionTasks.length} Aufgaben prüfen` : "Aufgaben prüfen"}
        >
          <Bell className="h-4 w-4" />
          <span className="hidden sm:inline">
            {attentionTasks.length ? `${attentionTasks.length} Aufgabe${attentionTasks.length === 1 ? "" : "n"}` : "Aufgaben prüfen"}
          </span>
        </button>
      ) : (
        <aside className="w-[420px] max-w-full overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-2xl shadow-stone-950/20">
          <div className={`${overdueCount ? "bg-rose-600" : "bg-stone-950"} px-5 py-4 text-white`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/65">Fällige Aufgaben</p>
                <h2 className="mt-2 text-lg font-semibold">
                  {operatorName ? `${operatorName}, ` : ""}
                  {overdueCount ? "Aufgaben überfällig" : "Aufgaben fällig"}
                </h2>
                <p className="mt-1 text-xs leading-5 text-white/70">
                  Gezeigt werden fällige Aufgaben für dich und unzugewiesene dringende Aufgaben.
                </p>
              </div>
              <button type="button" onClick={dismiss} className="rounded-full p-2 text-white/75 transition hover:bg-white/10 hover:text-white" aria-label="Hinweis schließen">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-4 py-4">
            {lastError ? (
              <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Fällige Aufgaben konnten gerade nicht aktualisiert werden: {lastError}
              </div>
            ) : null}

            <div className="grid gap-3">
              {attentionTasks.map((task) => (
                <article key={task.id} className={`rounded-2xl border p-4 ${isOverdue(task) ? "border-rose-200 bg-rose-50" : "border-stone-200 bg-stone-50"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 rounded-xl p-2 ${isOverdue(task) ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                      {isOverdue(task) ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-stone-950">{task.title}</h3>
                      <p className={`mt-1 text-xs ${isOverdue(task) ? "font-semibold text-rose-700" : "text-stone-600"}`}>
                        {task.assigneeLabel || "Nicht zugewiesen"} • {formatDue(task.dueAt)}
                      </p>
                      {task.customerName || task.description ? (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-600">{task.customerName || task.description}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.requestId ? (
                      <a
                        href={`/ops/customer-records?query=${encodeURIComponent(task.requestId)}`}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                      >
                        Fall öffnen
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirmTaskDone(task)) return;
                        void markDone(task);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Erledigt
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
            <div className="flex gap-2">
              <a href="/ops/tasks" className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-medium text-white transition hover:bg-stone-800">
                Aufgaben öffnen
              </a>
              <button
                type="button"
                onClick={() => void loadTasks()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950"
              >
                <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Aktualisieren
              </button>
            </div>
            {"Notification" in globalThis && Notification.permission === "default" ? (
              <button type="button" onClick={requestBrowserNotifications} className="text-xs font-medium text-stone-500 transition hover:text-stone-950">
                Browser-Hinweis aktivieren
              </button>
            ) : null}
          </div>
        </aside>
      )}
    </div>
  );
}
