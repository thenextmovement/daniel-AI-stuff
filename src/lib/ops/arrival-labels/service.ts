import { Temporal } from "@js-temporal/polyfill";
import { randomUUID } from "node:crypto";
import type { ArrivalDataClients } from "./clients";
import { createRuntimeClients, customerNameHintsFromCard } from "./clients";
import { generateArrivalDeliveryNotePdf } from "./delivery-note";
import {
  ARRIVAL_LABEL_TIMEZONE,
  arrivalsFromDhlMessages,
  arrivalsFromTrelloSignShipped,
  decideArrivalCase,
  mergeDhlArrivals,
  type ArrivalCaseDecision,
  type ArrivalRunMode,
  type DhlArrival,
  type ProductConfig,
  type TrelloSignShippedTriggerSettings,
} from "./domain";
import {
  createDatabaseExistingLabelClient,
  enqueueArrivalBrowserPurchase,
  enqueueArrivalPrintJob,
  enqueueArrivalReviewNotification,
  finishArrivalRun,
  insertArrivalBrowserArtifact,
  loadArrivalArtifact,
  loadActiveProductConfig,
  loadTrelloSignShippedTriggerSettings,
  markArrivalDeliveryNoteQaApproved,
  recordArrivalEvent,
  startArrivalRun,
  upsertArrivalCase,
  uploadPrivateArrivalArtifact,
} from "./repository";
import { renderPdfPagesToPng } from "./pdf";
import { buildArrivalReviewNotification, type ArrivalReviewNotification } from "./review-notifications";

export type ArrivalRunResult = {
  correlationId: string;
  runId: string | null;
  mode: ArrivalRunMode;
  localDate: string;
  timezone: typeof ARRIVAL_LABEL_TIMEZONE;
  configVersion: string | null;
  cases: ArrivalCaseDecision[];
  reviewNotifications: ArrivalReviewNotification[];
  summary: {
    found: number;
    outlookTriggered: number;
    trelloSignShippedTriggered: number;
    labelPlanned: number;
    existingLabel: number;
    manualReview: number;
    specialCase: number;
    reviewNotifications: number;
  };
};

export type RunArrivalLabelsOptions = {
  localDate?: string;
  mode?: ArrivalRunMode;
  triggerType?: "manual_cli" | "manual_api" | "n8n_email" | "n8n_schedule" | "local_schedule" | "fixture_test";
  persist?: boolean;
  correlationId?: string;
  clients?: ArrivalDataClients;
  productConfig?: ProductConfig | null;
  trelloTriggerSettings?: TrelloSignShippedTriggerSettings | null;
};

export function todayInBerlin(now: Temporal.Instant = Temporal.Now.instant()) {
  return now.toZonedDateTimeISO(ARRIVAL_LABEL_TIMEZONE).toPlainDate().toString();
}

function validateLocalDate(value: string) {
  const parsed = Temporal.PlainDate.from(value);
  if (parsed.toString() !== value) throw new Error("Datum muss im Format YYYY-MM-DD vorliegen.");
  return value;
}

function summarize(
  cases: ArrivalCaseDecision[],
  arrivals: DhlArrival[],
  reviewNotifications: ArrivalReviewNotification[],
): ArrivalRunResult["summary"] {
  const reviewStatuses = new Set(["manual_review", "missing_data", "ambiguous_match", "conflicting_instructions"]);
  return {
    found: cases.length,
    outlookTriggered: arrivals.filter((entry) => entry.sourceKinds.includes("outlook_dhl")).length,
    trelloSignShippedTriggered: arrivals.filter((entry) => entry.sourceKinds.includes("trello_sign_shipped")).length,
    labelPlanned: cases.filter((entry) => entry.status === "label_planned").length,
    existingLabel: cases.filter((entry) => entry.status === "existing_label").length,
    manualReview: cases.filter((entry) => reviewStatuses.has(entry.status)).length,
    specialCase: cases.filter((entry) => entry.status === "special_case").length,
    reviewNotifications: reviewNotifications.length,
  };
}

function assertWriteGate(mode: ArrivalRunMode, productConfig: ProductConfig | null) {
  if (mode !== "execute") return;
  if (String(process.env.ARRIVAL_LABEL_WRITES_ENABLED || "").toLowerCase() !== "true") {
    throw new Error("Produktive Labelerstellung ist deaktiviert (ARRIVAL_LABEL_WRITES_ENABLED ist nicht true).");
  }
  if (!productConfig?.enabled) throw new Error("Keine freigegebene DPD-Produktkonfiguration aktiv.");
}

async function ensureEuDeliveryNote(input: {
  caseId: string;
  decision: ArrivalCaseDecision;
  localDate: string;
  productConfig: ProductConfig;
}) {
  const printerKey = input.productConfig.deliveryNotePrinterKey;
  const storageBucket = input.productConfig.storageBucket;
  if (!printerKey || !storageBucket || String(input.productConfig.deliveryNotePrintMedia || "").toUpperCase() !== "A4") {
    throw new Error("Freigegebene A4-Lieferschein-Konfiguration fehlt.");
  }
  let artifact = await loadArrivalArtifact({ caseId: input.caseId, artifactKind: "delivery_note_pdf" });
  if (!artifact) {
    const generated = await generateArrivalDeliveryNotePdf({ decision: input.decision, localDate: input.localDate });
    const renderedPages = await renderPdfPagesToPng(generated.pdf, 2, 20);
    if (renderedPages.length !== generated.qa.pageCount) throw new Error("Lieferschein-Render-QA ist unvollstaendig.");
    const storageKey = `cases/${input.caseId}/delivery-notes/${generated.qa.sha256}/delivery-note.pdf`;
    await uploadPrivateArrivalArtifact({
      bucket: storageBucket,
      storageKey,
      contentType: "application/pdf",
      bytes: generated.pdf,
      sha256: generated.qa.sha256,
    });
    artifact = await insertArrivalBrowserArtifact({
      case_id: input.caseId,
      artifact_kind: "delivery_note_pdf",
      storage_bucket: storageBucket,
      storage_key: storageKey,
      sha256: generated.qa.sha256,
      content_type: "application/pdf",
      byte_size: generated.pdf.byteLength,
      page_width_points: generated.qa.pageWidthPoints,
      page_height_points: generated.qa.pageHeightPoints,
      qa_result: { ...generated.qa, renderedPageCount: renderedPages.length },
    });
  }
  if (artifact.content_type !== "application/pdf" || artifact.qa_result?.ok !== true) {
    throw new Error("Vorhandener Lieferschein hat keinen gueltigen QA-Nachweis.");
  }
  await markArrivalDeliveryNoteQaApproved({ caseId: input.caseId, artifactId: artifact.id });
  return enqueueArrivalPrintJob({
    caseId: input.caseId,
    artifactId: artifact.id,
    printerKey,
    idempotencyKey: `arrival-delivery-note-print:${input.caseId}:${artifact.sha256}`,
  });
}

export async function runArrivalLabels(options: RunArrivalLabelsOptions = {}): Promise<ArrivalRunResult> {
  const mode = options.mode || "dry_run";
  const localDate = validateLocalDate(options.localDate || todayInBerlin());
  const triggerType = options.triggerType || "manual_cli";
  const persist = options.persist === true;
  if (mode === "execute" && !persist) throw new Error("Execute-Modus erfordert ein persistiertes Audit.");
  const runtimeClients = options.clients || createRuntimeClients();
  if (!options.clients) runtimeClients.existingLabels = createDatabaseExistingLabelClient();
  const productConfig = options.productConfig === undefined
    ? await loadActiveProductConfig()
    : options.productConfig;
  const trelloTriggerSettings = options.trelloTriggerSettings === undefined
    ? (options.clients ? null : await loadTrelloSignShippedTriggerSettings())
    : options.trelloTriggerSettings;

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
    const arrivals = mergeDhlArrivals(
      arrivalsFromDhlMessages(messages, localDate),
      arrivalsFromTrelloSignShipped(cards, localDate, trelloTriggerSettings),
    );
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
    const reviewNotifications = cases
      .map(buildArrivalReviewNotification)
      .filter((notification): notification is ArrivalReviewNotification => Boolean(notification));
    const summary = summarize(cases, arrivals, reviewNotifications);

    if (run) {
      for (let index = 0; index < cases.length; index += 1) {
        const stored = await upsertArrivalCase({ runId: run.id, arrival: arrivals[index], decision: cases[index] });
        const trelloTrigger = arrivals[index].trelloTrigger;
        for (const cardId of trelloTrigger?.cardIds || []) {
          await recordArrivalEvent({
            runId: run.id,
            caseId: stored.id,
            eventKey: `${cases[index].idempotencyKey}:source:trello_sign_shipped:${cardId}`,
            eventType: "trello_sign_shipped_trigger_accepted",
            payload: {
              trackingNumber: arrivals[index].trackingNumber,
              cardId,
              boardId: trelloTrigger?.boardId,
              listId: trelloTrigger?.listId,
              latestActivityAt: trelloTrigger?.latestActivityAt,
              enabledAfter: trelloTrigger?.enabledAfter,
              titlePatternVersion: trelloTrigger?.titlePatternVersion,
            },
          });
        }
        if (mode === "execute" && cases[index].status === "label_planned") {
          if (!productConfig) throw new Error("Aktive DPD-Produktkonfiguration fehlt.");
          if (cases[index].deliveryNoteRequired) {
            if (stored.delivery_note_status === "printed") await enqueueArrivalBrowserPurchase(stored.id);
            else if (["planned", "qa_approved"].includes(stored.delivery_note_status)) {
              await ensureEuDeliveryNote({ caseId: stored.id, decision: cases[index], localDate, productConfig });
            }
          } else {
            await enqueueArrivalBrowserPurchase(stored.id);
          }
        }
        const notification = buildArrivalReviewNotification(cases[index]);
        if (notification) await enqueueArrivalReviewNotification({ caseId: stored.id, notification });
        await recordArrivalEvent({
          runId: run.id,
          caseId: stored.id,
          eventKey: `${cases[index].idempotencyKey}:decision:${cases[index].status}`,
          eventType: "case_decided",
          severity: cases[index].manualReviewReason ? "warning" : "info",
          payload: {
            status: cases[index].status,
            shippingClass: cases[index].shippingClass,
            destinationCountryCode: cases[index].destinationCountryCode,
            destinationClass: cases[index].destinationClass,
            deliveryNoteRequired: cases[index].deliveryNoteRequired,
            deliveryNoteStatus: cases[index].deliveryNoteStatus,
            arrivalSources: arrivals[index].sourceKinds,
            reasons: cases[index].reasons,
          },
        });
      }
      await finishArrivalRun({
        runId: run.id,
        status: summary.reviewNotifications > 0 ? "completed_with_review" : "completed",
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
      reviewNotifications,
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
