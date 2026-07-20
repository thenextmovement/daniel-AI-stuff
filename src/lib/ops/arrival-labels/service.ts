import { Temporal } from "@js-temporal/polyfill";
import { randomUUID } from "node:crypto";
import type { ArrivalDataClients } from "./clients";
import { createRuntimeClients, customerNameHintsFromCard } from "./clients";
import {
  ARRIVAL_LABEL_TIMEZONE,
  arrivalsFromDhlMessages,
  decideArrivalCase,
  type ArrivalCaseDecision,
  type ArrivalRunMode,
  type ProductConfig,
} from "./domain";
import {
  createDatabaseExistingLabelClient,
  finishArrivalRun,
  loadActiveProductConfig,
  recordArrivalEvent,
  startArrivalRun,
  upsertArrivalCase,
} from "./repository";

export type ArrivalRunResult = {
  correlationId: string;
  runId: string | null;
  mode: ArrivalRunMode;
  localDate: string;
  timezone: typeof ARRIVAL_LABEL_TIMEZONE;
  configVersion: string | null;
  cases: ArrivalCaseDecision[];
  summary: {
    found: number;
    labelPlanned: number;
    existingLabel: number;
    manualReview: number;
    specialCase: number;
  };
};

export type RunArrivalLabelsOptions = {
  localDate?: string;
  mode?: ArrivalRunMode;
  triggerType?: "manual_cli" | "manual_api" | "n8n_schedule" | "fixture_test";
  persist?: boolean;
  correlationId?: string;
  clients?: ArrivalDataClients;
  productConfig?: ProductConfig | null;
};

export function todayInBerlin(now: Temporal.Instant = Temporal.Now.instant()) {
  return now.toZonedDateTimeISO(ARRIVAL_LABEL_TIMEZONE).toPlainDate().toString();
}

function validateLocalDate(value: string) {
  const parsed = Temporal.PlainDate.from(value);
  if (parsed.toString() !== value) throw new Error("Datum muss im Format YYYY-MM-DD vorliegen.");
  return value;
}

function summarize(cases: ArrivalCaseDecision[]): ArrivalRunResult["summary"] {
  const reviewStatuses = new Set(["manual_review", "missing_data", "ambiguous_match", "conflicting_instructions"]);
  return {
    found: cases.length,
    labelPlanned: cases.filter((entry) => entry.status === "label_planned").length,
    existingLabel: cases.filter((entry) => entry.status === "existing_label").length,
    manualReview: cases.filter((entry) => reviewStatuses.has(entry.status)).length,
    specialCase: cases.filter((entry) => entry.status === "special_case").length,
  };
}

function assertWriteGate(mode: ArrivalRunMode, productConfig: ProductConfig | null) {
  if (mode !== "execute") return;
  if (String(process.env.ARRIVAL_LABEL_WRITES_ENABLED || "").toLowerCase() !== "true") {
    throw new Error("Produktive Labelerstellung ist deaktiviert (ARRIVAL_LABEL_WRITES_ENABLED ist nicht true).");
  }
  if (!productConfig?.enabled) throw new Error("Keine freigegebene DPD-Produktkonfiguration aktiv.");
  throw new Error("EasyDPD-Write-Adapter ist noch nicht freigegeben; Execute-Modus bleibt fail-closed.");
}

export async function runArrivalLabels(options: RunArrivalLabelsOptions = {}): Promise<ArrivalRunResult> {
  const mode = options.mode || "dry_run";
  const localDate = validateLocalDate(options.localDate || todayInBerlin());
  const triggerType = options.triggerType || "manual_cli";
  const persist = options.persist === true;
  const runtimeClients = options.clients || createRuntimeClients();
  if (!options.clients) runtimeClients.existingLabels = createDatabaseExistingLabelClient();
  const productConfig = options.productConfig === undefined
    ? await loadActiveProductConfig()
    : options.productConfig;

  assertWriteGate(mode, productConfig);

  const provisionalCorrelation = options.correlationId || `arrival-labels:${localDate}:${randomUUID()}`;
  const run = persist
    ? await startArrivalRun({
      correlationId: provisionalCorrelation,
      triggerType,
      mode,
      localDate,
      configVersion: productConfig?.version || null,
    })
    : null;
  const correlationId = run?.correlation_id || provisionalCorrelation;

  try {
    const [messages, cards] = await Promise.all([
      runtimeClients.outlook.listMessagesForLocalDate(localDate),
      runtimeClients.trello.listQuentinCards(),
    ]);
    const orders = await runtimeClients.shopify.listRecentOrders(localDate, cards);
    const arrivals = arrivalsFromDhlMessages(messages, localDate);
    const orderIds = [...new Set(orders.map((order) => order.id))];
    const existingByOrder = await runtimeClients.existingLabels.findForOrders(orderIds);
    const hints = Object.fromEntries(cards.map((card) => [card.id, customerNameHintsFromCard(card)]));
    const cases = arrivals.map((arrival) => {
      const preliminary = decideArrivalCase({
        arrival,
        trelloCards: cards,
        shopifyOrders: orders,
        customerNameHintsByCardId: hints,
        productConfig,
      });
      if (!preliminary.shopifyOrder) return preliminary;
      return decideArrivalCase({
        arrival,
        trelloCards: cards,
        shopifyOrders: orders,
        customerNameHintsByCardId: hints,
        existingDpdEvidence: existingByOrder.get(preliminary.shopifyOrder.id) || [],
        productConfig,
      });
    });
    const summary = summarize(cases);

    if (run) {
      for (let index = 0; index < cases.length; index += 1) {
        const stored = await upsertArrivalCase({ runId: run.id, arrival: arrivals[index], decision: cases[index] });
        await recordArrivalEvent({
          runId: run.id,
          caseId: stored.id,
          eventKey: `${cases[index].idempotencyKey}:decision:${cases[index].status}`,
          eventType: "case_decided",
          severity: cases[index].manualReviewReason ? "warning" : "info",
          payload: {
            status: cases[index].status,
            shippingClass: cases[index].shippingClass,
            reasons: cases[index].reasons,
          },
        });
      }
      await finishArrivalRun({
        runId: run.id,
        status: summary.manualReview > 0 ? "completed_with_review" : "completed",
        summary,
      });
    }

    return {
      correlationId,
      runId: run?.id || null,
      mode,
      localDate,
      timezone: ARRIVAL_LABEL_TIMEZONE,
      configVersion: productConfig?.version || null,
      cases,
      summary,
    };
  } catch (error) {
    if (run) {
      await finishArrivalRun({
        runId: run.id,
        status: "failed",
        summary: {},
        errorCode: error instanceof Error ? error.name : "unknown_error",
        errorMessage: error instanceof Error ? error.message : "Unbekannter Fehler",
      }).catch(() => undefined);
    }
    throw error;
  }
}
