import { chromium } from "playwright";

const now = "2026-06-16T12:00:00.000Z";
const futureDue = "2026-06-20T12:00:00.000Z";

function baseUrl() {
  return String(process.env.OPS_TASKS_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function task(overrides = {}) {
  return {
    id: "task-board-1",
    sourceApp: "qa",
    sourceRef: "qa-task-1",
    title: "QA Aufgabe pruefen",
    description: "Status-Buttons testen.",
    category: "admin",
    priority: "normal",
    status: "open",
    assigneeLabel: "Daniel",
    dueAt: futureDue,
    requestId: "REQ-TASK",
    offerId: null,
    customerName: "QA Kunde",
    createdBy: "qa",
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

let currentTasks = [task()];

function tasksPayload() {
  return {
    ok: true,
    tasks: currentTasks,
    summary: {
      open: currentTasks.filter((entry) => entry.status !== "done" && entry.status !== "archived").length,
      urgent: 0,
      overdue: 0,
      dueToday: 0,
    },
  };
}

function dialogHandler(dialogs, action, accept) {
  return async (dialog) => {
    dialogs.push({ action, message: dialog.message() });
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  };
}

async function main() {
  const target = baseUrl();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const posts = [];
  const dialogs = [];
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) consoleErrors.push(`${msg.type()}: ${msg.text()}`);
  });

  await page.route("**/api/ops/tasks?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tasksPayload()) });
  });
  await page.route("**/api/ops/tasks/*", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    posts.push({ method: request.method(), body });
    const taskId = request.url().split("/").pop() || "task-board-1";
    currentTasks = currentTasks.map((entry) =>
      entry.id === taskId
        ? { ...entry, ...body, updatedAt: now, completedAt: body.status === "done" ? now : entry.completedAt }
        : entry,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, task: currentTasks.find((entry) => entry.id === taskId) || task({ id: taskId, ...body }) }),
    });
  });

  await page.goto(`${target}/ops/tasks`, { waitUntil: "networkidle" });
  await page.getByText("QA Aufgabe pruefen").waitFor({ timeout: 10_000 });
  await page.getByLabel("Operator").fill("Daniel");

  const taskCard = page.locator("article").filter({ hasText: "QA Aufgabe pruefen" });
  await taskCard.getByRole("button", { name: "Aufgabe QA Aufgabe pruefen starten" }).click();
  assert(posts.length === 1 && posts[0].body.status === "in_progress", "Starten sendet falschen PATCH");

  await taskCard.getByRole("button", { name: "Aufgabe QA Aufgabe pruefen auf Wartet setzen" }).click();
  assert(posts.length === 2 && posts[1].body.status === "waiting", "Wartet sendet falschen PATCH");

  page.once("dialog", dialogHandler(dialogs, "dismiss-done", false));
  await taskCard.getByRole("button", { name: "Aufgabe QA Aufgabe pruefen als erledigt markieren" }).click();
  assert(posts.length === 2, `Abgebrochenes Erledigt sendet trotzdem PATCH: ${JSON.stringify({ posts, dialogs })}`);

  page.once("dialog", dialogHandler(dialogs, "accept-done", true));
  await taskCard.getByRole("button", { name: "Aufgabe QA Aufgabe pruefen als erledigt markieren" }).click();
  assert(posts.length === 3 && posts[2].body.status === "done", "Bestaetigtes Erledigt sendet falschen PATCH");
  await page.getByText("Aufgabe aktualisiert.").waitFor();

  const mobileLayout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert(mobileLayout.noHorizontalOverflow, `Mobile horizontal overflow: ${mobileLayout.scrollWidth} > ${mobileLayout.clientWidth}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);

  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    baseUrl: target,
    posts: posts.map((entry) => entry.body.status),
    dialogs,
    mobileLayout,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Ops Tasks UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
