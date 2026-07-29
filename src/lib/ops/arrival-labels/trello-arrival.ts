import { ArrivalIntegrationError, fetchWithRetry, requiredEnv } from "./clients";
import {
  ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID,
  ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID,
  normalizeHumanText,
} from "./domain";

const DEFAULT_SIGN_ARRIVED_LIST_ID = "646c788ae63245624b6d6a7a";

type TrelloCard = {
  id?: string;
  name?: string;
  desc?: string;
  url?: string;
  idBoard?: string;
  idList?: string;
  closed?: boolean;
};

type TrelloList = {
  id?: string;
  name?: string;
  idBoard?: string;
  closed?: boolean;
};

export type InspectedTrelloArrivalTarget = {
  cardId: string;
  targetListId: string;
  alreadyAtTarget: boolean;
  authentication: { key: string; token: string };
};

export class TrelloArrivalProjectionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "TrelloArrivalProjectionError";
  }
}

function configuredId(name: string, fallback: string) {
  const value = String(process.env[name] || fallback).trim();
  if (!/^[A-Fa-f0-9]{24}$/.test(value)) {
    throw new TrelloArrivalProjectionError(`${name} ist ungueltig.`, "trello_arrival_configuration_invalid");
  }
  return value;
}

function trelloUrl(path: string, authentication: { key: string; token: string }) {
  const url = new URL(`https://api.trello.com${path}`);
  url.searchParams.set("key", authentication.key);
  url.searchParams.set("token", authentication.token);
  return url;
}

async function readJson<T>(response: Response, code: string) {
  try {
    return await response.json() as T;
  } catch {
    throw new TrelloArrivalProjectionError("Trello lieferte kein gueltiges JSON.", code, true);
  }
}

export function validateTrelloArrivalWorkerId(value: string) {
  const workerId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(workerId)) {
    throw new TrelloArrivalProjectionError("Trello-Arrival-Worker-ID ist ungueltig.", "trello_arrival_worker_invalid");
  }
  return workerId;
}

export function trelloArrivalErrorCode(error: unknown) {
  if (error instanceof TrelloArrivalProjectionError || error instanceof ArrivalIntegrationError) return error.code;
  if (error instanceof Error && error.name === "TimeoutError") return "trello_arrival_timeout";
  return "trello_arrival_unknown";
}

export function isRetryableTrelloArrivalInspectionError(error: unknown) {
  if (error instanceof TrelloArrivalProjectionError || error instanceof ArrivalIntegrationError) return error.retryable;
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function inspectExactTrelloArrivalTarget(input: {
  cardId: string;
  expectedTrackingNumber: string;
}): Promise<InspectedTrelloArrivalTarget> {
  const cardId = input.cardId.trim();
  const expectedTrackingNumber = input.expectedTrackingNumber.replace(/\D/g, "");
  if (!/^[A-Fa-f0-9]{24}$/.test(cardId) || !/^[0-9]{10,40}$/.test(expectedTrackingNumber)) {
    throw new TrelloArrivalProjectionError("Trello-Karte oder DHL-Sendungsnummer ist ungueltig.", "trello_arrival_target_invalid");
  }

  const authentication = { key: requiredEnv("TRELLO_API_KEY"), token: requiredEnv("TRELLO_TOKEN") };
  const boardId = configuredId("ARRIVAL_LABEL_TRELLO_BOARD_ID", ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID);
  const sourceListId = configuredId("ARRIVAL_LABEL_TRELLO_SIGN_SHIPPED_LIST_ID", ARRIVAL_LABEL_SIGN_SHIPPED_LIST_ID);
  const targetListId = configuredId("ARRIVAL_LABEL_TRELLO_SIGN_ARRIVED_LIST_ID", DEFAULT_SIGN_ARRIVED_LIST_ID);
  if (sourceListId === targetListId) {
    throw new TrelloArrivalProjectionError("Trello-Quell- und Zielliste sind identisch.", "trello_arrival_configuration_invalid");
  }

  const cardUrl = trelloUrl(`/1/cards/${encodeURIComponent(cardId)}`, authentication);
  cardUrl.searchParams.set("fields", "id,name,desc,url,idBoard,idList,closed");
  const sourceListUrl = trelloUrl(`/1/lists/${encodeURIComponent(sourceListId)}`, authentication);
  sourceListUrl.searchParams.set("fields", "id,name,idBoard,closed");
  const targetListUrl = trelloUrl(`/1/lists/${encodeURIComponent(targetListId)}`, authentication);
  targetListUrl.searchParams.set("fields", "id,name,idBoard,closed");

  const [cardResponse, sourceListResponse, targetListResponse] = await Promise.all([
    fetchWithRetry(cardUrl.toString(), { headers: { Accept: "application/json" } }, {
      integration: "trello_arrival_card",
      attempts: 3,
      timeoutMs: 15_000,
    }),
    fetchWithRetry(sourceListUrl.toString(), { headers: { Accept: "application/json" } }, {
      integration: "trello_arrival_source_list",
      attempts: 3,
      timeoutMs: 15_000,
    }),
    fetchWithRetry(targetListUrl.toString(), { headers: { Accept: "application/json" } }, {
      integration: "trello_arrival_target_list",
      attempts: 3,
      timeoutMs: 15_000,
    }),
  ]);

  const card = await readJson<TrelloCard>(cardResponse, "trello_arrival_card_invalid_json");
  const sourceList = await readJson<TrelloList>(sourceListResponse, "trello_arrival_source_list_invalid_json");
  const targetList = await readJson<TrelloList>(targetListResponse, "trello_arrival_target_list_invalid_json");
  if (
    card.closed
    || card.id !== cardId
    || card.idBoard !== boardId
    || sourceList.closed
    || sourceList.id !== sourceListId
    || sourceList.idBoard !== boardId
    || normalizeHumanText(sourceList.name) !== "sign shipped neon trip"
    || targetList.closed
    || targetList.id !== targetListId
    || targetList.idBoard !== boardId
    || normalizeHumanText(targetList.name) !== "sign arrived"
  ) {
    throw new TrelloArrivalProjectionError("Trello-Karte oder Listen stimmen nicht mit Quentin ueberein.", "trello_arrival_target_mismatch");
  }

  const cardText = `${card.name || ""}\n${card.desc || ""}`;
  const cardTrackingCandidates = new Set(
    [...cardText.matchAll(/(?:^|\D)((?:\d[\s./-]?){9,39}\d)(?=\D|$)/g)]
      .map((match) => String(match[1] || "").replace(/\D/g, ""))
      .filter((value) => value.length >= 10 && value.length <= 40),
  );
  if (!cardTrackingCandidates.has(expectedTrackingNumber)) {
    throw new TrelloArrivalProjectionError("Die volle DHL-Sendungsnummer fehlt auf der Trello-Karte.", "trello_arrival_tracking_mismatch");
  }
  if (card.idList !== sourceListId && card.idList !== targetListId) {
    throw new TrelloArrivalProjectionError("Die Trello-Karte befindet sich nicht in Sign SHIPPED.", "trello_arrival_source_list_mismatch");
  }

  return {
    cardId,
    targetListId,
    alreadyAtTarget: card.idList === targetListId,
    authentication,
  };
}

export async function moveInspectedTrelloCardToSignArrivedTopOnce(target: InspectedTrelloArrivalTarget) {
  if (target.alreadyAtTarget) return { movedCardId: target.cardId, alreadyAtTarget: true };

  const url = trelloUrl(`/1/cards/${encodeURIComponent(target.cardId)}`, target.authentication);
  const body = new URLSearchParams({ idList: target.targetListId, pos: "top" });
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TrelloArrivalProjectionError(
      "Trello-Move wurde gestartet, das Ergebnis ist aber unbekannt.",
      "trello_arrival_move_uncertain",
    );
  }
  if (!response.ok) {
    throw new TrelloArrivalProjectionError(
      "Trello-Move wurde gestartet, aber nicht eindeutig bestaetigt.",
      "trello_arrival_move_uncertain",
    );
  }
  const moved = await readJson<TrelloCard>(response, "trello_arrival_move_uncertain");
  if (moved.id !== target.cardId || moved.idList !== target.targetListId) {
    throw new TrelloArrivalProjectionError(
      "Trello bestaetigte nicht eindeutig die erwartete Zielliste.",
      "trello_arrival_move_uncertain",
    );
  }
  return { movedCardId: target.cardId, alreadyAtTarget: false };
}
