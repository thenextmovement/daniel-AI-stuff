export type OpsOfferLock = {
  editable: boolean;
  lockLevel: "none" | "soft" | "hard";
  lockReason: string | null;
  requiresRevisionReason: boolean;
};

export type OpsOfferItem = {
  id: string;
  section: string | null;
  title: string;
  description: string | null;
  quantity: number;
  unitPriceNet: number;
  listPriceNet: number | null;
  discountLabel: string | null;
  selectable: boolean;
  selectedByDefault: boolean;
  selectedFinal: boolean;
  quantityEditable: boolean;
  minQuantity: number | null;
  maxQuantity: number | null;
  sortOrder: number;
};

export type OpsOfferImage = {
  id: string;
  title: string | null;
  enabled: boolean;
  sortOrder: number;
  kind: string;
  importStatus: string;
  trelloAttachmentId: string | null;
  linkedItemTitle: string | null;
};

export type OpsOfferSnapshot = {
  offerId: string;
  offerNumber: string;
  documentReference: string;
  trelloCardId: string | null;
  publicUrl: string;
  status: string;
  updatedAt: string;
  viewedAt: string | null;
  acceptedAt: string | null;
  acceptance: { id: string; signedAt: string } | null;
  lock: OpsOfferLock;
  offer: {
    customerCompany: string | null;
    customerFirstName: string | null;
    customerLastName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    validUntil: string | null;
    productionTime: string | null;
    notes: string | null;
    discountText: string | null;
    projectTitle: string | null;
    currency: string;
    vatRate: number;
  };
  items: OpsOfferItem[];
  images: OpsOfferImage[];
  totals: Record<string, unknown>;
};

export type OpsOfferSearchMatchType = "exact" | "contact" | "fuzzy";

export type OpsOfferSearchResult = {
  offerId: string;
  offerNumber: string | null;
  documentReference: string;
  trelloCardId: string | null;
  publicUrl: string;
  status: string;
  updatedAt: string;
  customerCompany: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerEmail: string | null;
  lock: OpsOfferLock;
  matchType: OpsOfferSearchMatchType;
  matchReasons: string[];
};

export type OpsOfferSearchPayload = {
  query: string;
  results: OpsOfferSearchResult[];
};

export type OpsOfferPatchInput = {
  expectedUpdatedAt: string;
  actor: string;
  reason?: string;
  revisionReason?: string;
  offer?: {
    validUntil?: string | null;
    productionTime?: string | null;
    notes?: string | null;
    discountText?: string | null;
    projectTitle?: string | null;
  };
  items?: Array<Partial<Omit<OpsOfferItem, "section" | "selectedFinal">> & { id: string }>;
  images?: Array<Partial<Pick<OpsOfferImage, "title" | "enabled" | "sortOrder">> & { id: string }>;
};

export type OpsOfferPatchResult = {
  offer: OpsOfferSnapshot;
  dryRun?: boolean;
  diff?: {
    changedKeys: string[];
    before?: unknown;
    after?: unknown;
  };
};

export type OpsOfferSendInput = {
  recipientEmail: string;
  cc: string[];
  subject: string;
  message: string;
  actor: string;
  reason: string;
  idempotencyKey: string;
};

export type OpsOfferSendResult = {
  sent: boolean;
  duplicate: boolean;
  eventId: string;
};

export class OpsOfferApiError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code = "offer_api_error",
    public issues?: string[],
  ) {
    super(message);
  }
}

function getOffersBaseUrl() {
  const baseUrl = String(process.env.NEONTRIP_OFFERS_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) throw new OpsOfferApiError("NEONTRIP_OFFERS_BASE_URL fehlt.", 503, "offers_not_configured");
  return baseUrl;
}

function getOffersApiKey() {
  const apiKey = String(process.env.NEONTRIP_OFFERS_INTERNAL_API_KEY || "").trim();
  if (!apiKey) throw new OpsOfferApiError("NEONTRIP_OFFERS_INTERNAL_API_KEY fehlt.", 503, "offers_not_configured");
  return apiKey;
}

async function parseOfferResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    offer?: OpsOfferSnapshot;
    error?: string;
    message?: string;
    code?: string;
    issues?: string[];
    sent?: boolean;
    duplicate?: boolean;
    eventId?: string;
    diff?: OpsOfferPatchResult["diff"];
    dryRun?: boolean;
  } | null;

  if (!response.ok) {
    throw new OpsOfferApiError(
      payload?.error || payload?.message || `Offers API antwortete mit ${response.status}.`,
      response.status,
      payload?.code || "offer_api_error",
      payload?.issues,
    );
  }
  return payload || {};
}

async function offerFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${getOffersBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${getOffersApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  return parseOfferResponse(response);
}

export async function getOfferByTrelloCardId(trelloCardId: string) {
  const payload = await offerFetch(`/api/internal/offers/by-trello/${encodeURIComponent(trelloCardId)}`, {
    method: "GET",
  });
  if (!payload.offer) throw new OpsOfferApiError("Angebot nicht gefunden.", 404, "offer_not_found");
  return payload.offer;
}

export async function getOfferById(offerId: string) {
  const payload = await offerFetch(`/api/internal/offers/${encodeURIComponent(offerId)}`, {
    method: "GET",
  });
  if (!payload.offer) throw new OpsOfferApiError("Angebot nicht gefunden.", 404, "offer_not_found");
  return payload.offer;
}

export async function searchOffers(query: string, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const payload = await offerFetch(`/api/internal/offers/search?${params.toString()}`, {
    method: "GET",
  });
  const results = Array.isArray((payload as { results?: unknown }).results)
    ? ((payload as { results: OpsOfferSearchResult[] }).results)
    : [];
  return {
    query: String((payload as { query?: string }).query || query),
    results,
  } satisfies OpsOfferSearchPayload;
}

export async function patchOfferByTrelloCardId(trelloCardId: string, input: OpsOfferPatchInput, dryRun = false) {
  const payload = await offerFetch(`/api/internal/offers/by-trello/${encodeURIComponent(trelloCardId)}${dryRun ? "?dryRun=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!payload.offer) throw new OpsOfferApiError("Angebot konnte nicht aktualisiert werden.", 502, "offer_update_failed");
  return {
    offer: payload.offer,
    dryRun: payload.dryRun,
    diff: payload.diff,
  } satisfies OpsOfferPatchResult;
}

export async function patchOfferById(offerId: string, input: OpsOfferPatchInput, dryRun = false) {
  const payload = await offerFetch(`/api/internal/offers/${encodeURIComponent(offerId)}${dryRun ? "?dryRun=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  if (!payload.offer) throw new OpsOfferApiError("Angebot konnte nicht aktualisiert werden.", 502, "offer_update_failed");
  return {
    offer: payload.offer,
    dryRun: payload.dryRun,
    diff: payload.diff,
  } satisfies OpsOfferPatchResult;
}

export async function sendOfferUpdateMail(offerId: string, input: OpsOfferSendInput) {
  const payload = await offerFetch(`/api/internal/offers/${encodeURIComponent(offerId)}/send`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!payload.sent || !payload.eventId) throw new OpsOfferApiError("Angebotsmail wurde nicht versendet.", 502, "offer_send_failed");
  return {
    sent: payload.sent,
    duplicate: Boolean(payload.duplicate),
    eventId: payload.eventId,
  } satisfies OpsOfferSendResult;
}
