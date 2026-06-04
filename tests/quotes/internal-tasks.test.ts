import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOpsInternalTasks, type OpsInternalTask } from "@/lib/ops/internal-tasks";

function task(overrides: Partial<OpsInternalTask>): OpsInternalTask {
  return {
    id: "task-1",
    title: "Test task",
    description: null,
    status: "open",
    priority: "normal",
    category: "other",
    assigneeLabel: null,
    dueAt: null,
    requestId: null,
    customerName: null,
    customerEmail: null,
    trelloCardId: null,
    sourceApp: "test",
    sourceRef: null,
    createdBy: null,
    updatedBy: null,
    completedBy: null,
    completedAt: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("summarizeOpsInternalTasks counts active urgent overdue and today tasks", () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayDate = new Date();
  todayDate.setHours(23, 59, 0, 0);
  const today = todayDate.toISOString();
  const summary = summarizeOpsInternalTasks([
    task({ id: "overdue", dueAt: yesterday, priority: "urgent" }),
    task({ id: "today", dueAt: today, priority: "high" }),
    task({ id: "done", status: "done", dueAt: yesterday, priority: "urgent" }),
  ]);

  assert.equal(summary.open, 2);
  assert.equal(summary.urgent, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
});
