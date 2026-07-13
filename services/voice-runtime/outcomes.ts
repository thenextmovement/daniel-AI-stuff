import type { StructuredOutcome } from "./types.js";

export function technicalOutcome(code: string, detail: string): StructuredOutcome {
  return {
    terminalStatus: "failed", outcomeCode: "technical_failure",
    summaryForHuman: "Der Telefonieversuch wurde wegen eines technischen Fehlers beendet.",
    customerIntent: null, productInterest: null, objections: [], callbackAt: null,
    humanHandoffRequested: false, humanHandoffCompleted: false,
    customerRequestedStop: false, unsafeOrUnsupportedRequest: false,
    failureCode: code, failureDetail: detail.slice(0, 1000),
  };
}

export function notReachedOutcome(status: string): StructuredOutcome {
  return {
    terminalStatus: status === "canceled" ? "cancelled" : "completed", outcomeCode: "not_reached",
    summaryForHuman: `Kontakt wurde nicht erreicht (${status}).`, customerIntent: null,
    productInterest: null, objections: [], callbackAt: null, humanHandoffRequested: false,
    humanHandoffCompleted: false, customerRequestedStop: false, unsafeOrUnsupportedRequest: false,
    failureCode: null, failureDetail: null,
  };
}

export function noClearOutcome(detail = "Call ended before a structured result was recorded"): StructuredOutcome {
  return {
    terminalStatus: "completed", outcomeCode: "no_clear_outcome",
    summaryForHuman: "Gespraech beendet, ohne dass ein strukturiertes Ergebnis vorlag.",
    customerIntent: null, productInterest: null, objections: [], callbackAt: null,
    humanHandoffRequested: false, humanHandoffCompleted: false,
    customerRequestedStop: false, unsafeOrUnsupportedRequest: false,
    failureCode: "missing_structured_outcome", failureDetail: detail.slice(0, 1000),
  };
}
