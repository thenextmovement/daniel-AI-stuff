import type {
  AcceptQuotePayload,
  CustomerRequestData,
  PublicQuote,
  QuoteImageRecord,
  QuoteItemInput,
  QuoteItemRecord,
  QuoteRecord,
  QuoteSelectionInput,
  QuoteTotals,
} from "./types";

type QueryValue = string | number | boolean | null;

export class SupabaseRestError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SupabaseRestError";
  }
}

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new SupabaseRestError("Supabase Server-Konfiguration fehlt.", 500);
  }
  return { url: url.replace(/\/$/, ""), key };
}

function restUrl(path: string, query?: Record<string, QueryValue>) {
  const { url } = config();
  const endpoint = new URL(`${url}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined) endpoint.searchParams.set(key, String(value));
  }
  return endpoint.toString();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetrySupabaseRequest(init: RequestInit, response?: Response) {
  const method = String(init.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  return !response || response.status === 502 || response.status === 503 || response.status === 504;
}

export async function supabaseRequest<T>(
  path: string,
  init: RequestInit = {},
  query?: Record<string, QueryValue>,
) {
  const { key } = config();
  const url = restUrl(path, query);
  const requestInit: RequestInit = {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  };
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(url, requestInit);
      if (response.ok || !shouldRetrySupabaseRequest(init, response) || attempt === 2) break;
    } catch (error) {
      lastError = error;
      if (!shouldRetrySupabaseRequest(init) || attempt === 2) throw error;
    }
    await delay(180 * (attempt + 1));
  }

  if (!response) throw lastError instanceof Error ? lastError : new SupabaseRestError("Supabase Anfrage fehlgeschlagen.", 500, lastError);

  if (!response.ok) {
    const body = await response.text();
    throw new SupabaseRestError("Supabase Anfrage fehlgeschlagen.", response.status, body);
  }

  if (response.status === 204) return null as T;
  const body = await response.text();
  if (!body.trim()) return null as T;
  return JSON.parse(body) as T;
}

export async function supabaseRpc<T>(functionName: string, args: Record<string, unknown> = {}) {
  return supabaseRequest<T>(`rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

function numericQuote(record: QuoteRecord): QuoteRecord {
  return {
    ...record,
    subtotal_net: record.subtotal_net === null ? null : Number(record.subtotal_net || 0),
    tax_amount: record.tax_amount === null ? null : Number(record.tax_amount || 0),
    total_gross: record.total_gross === null ? null : Number(record.total_gross || 0),
  };
}

function numericItem(record: QuoteItemRecord): QuoteItemRecord {
  return {
    ...record,
    unit_price: Number(record.unit_price),
    quantity: Number(record.quantity),
    tax_rate: Number(record.tax_rate),
  };
}

export async function findCustomerRequest(requestId: string, trelloCardId: string) {
  let resolvedRequestId = requestId;

  try {
    const aliases = await supabaseRequest<Array<{ request_id: string }>>("quote_request_aliases", undefined, {
      select: "request_id",
      or: `(alias.eq.${encodeURIComponent(requestId)},trello_card_id.eq.${encodeURIComponent(trelloCardId)})`,
      order: "created_at.desc",
      limit: 1,
    });
    resolvedRequestId = aliases[0]?.request_id || requestId;
  } catch {
    resolvedRequestId = requestId;
  }

  const rows = await supabaseRequest<CustomerRequestData[]>("master_requests", undefined, {
    select:
      "request_id,customer_id,email,first_name,last_name,company,phone,country,requested_size,requested_color,usage,delivery_preference",
    or: `(request_id.eq.${encodeURIComponent(resolvedRequestId)},trello_card_id.eq.${encodeURIComponent(trelloCardId)})`,
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] || null;
}

export async function findActiveQuoteByRequestId(requestId: string) {
  const rows = await supabaseRequest<QuoteRecord[]>("quotes", undefined, {
    select: "*",
    request_id: `eq.${requestId}`,
    status: "in.(draft,sent,viewed)",
    order: "created_at.desc",
    limit: 1,
  });
  return rows[0] ? numericQuote(rows[0]) : null;
}

export async function voidActiveQuotes(requestId: string) {
  await supabaseRequest("quotes", {
    method: "PATCH",
    body: JSON.stringify({ status: "void" }),
    headers: { Prefer: "return=minimal" },
  }, {
    request_id: `eq.${requestId}`,
    status: "in.(draft,sent,viewed)",
  });
}

export async function insertQuote(input: Omit<QuoteRecord, "id" | "created_at" | "currency" | "status">) {
  const rows = await supabaseRequest<QuoteRecord[]>(
    "quotes",
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        status: "draft",
        currency: "EUR",
      }),
      headers: { Prefer: "return=representation" },
    },
  );
  return numericQuote(rows[0]);
}

export async function insertQuoteItems(quoteId: string, items: QuoteItemInput[]) {
  if (!items.length) return [];
  const rows = await supabaseRequest<QuoteItemRecord[]>("quote_items", {
    method: "POST",
    body: JSON.stringify(items.map(({ id: id, ...item }) => ({ ...item, quoteid: quoteId }))),
    headers: { Prefer: "return=representation" },
  });
  return rows.map(numericItem);
}

export async function insertQuoteImages(
  quoteId: string,
  images: Array<Omit<QuoteImageRecord, "id" | "quote_id">>,
) {
  if (!images.length) return [];
  return supabaseRequest<QuoteImageRecord[]>("quote_images", {
    method: "POST",
    body: JSON.stringify(images.map((image) => ({ ...image, quote_id: quoteId }))),
    headers: { Prefer: "return=representation" },
  });
}

export async function insertQuoteEvent(
  quoteId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
) {
  await supabaseRequest("quote_events", {
    method: "POST",
    body: JSON.stringify({ quote_id: quoteId, event_type: eventType, payload }),
    headers: { Prefer: "return=minimal" },
  });
}

export async function getQuoteByShareToken(shareToken: string): Promise<PublicQuote | null> {
  const quotes = await supabaseRequest<QuoteRecord[]>("quotes", undefined, {
    select: "*",
    share_token: `eq.${shareToken}`,
    limit: 1,
  });
  const quote = quotes[0];
  if (!quote) return null;

  const [items, images] = await Promise.all([
    supabaseRequest<QuoteItemRecord[]>("quote_items", undefined, {
      select: "*",
      quote_id: `eq.${quote.id}`,
      order: "sort_order.asc",
    }),
    supabaseRequest<QuoteImageRecord[]>("quote_images", undefined, {
      select: "*",
      quote_id: `eq.${quote.id}`,
      order: "sort_order.asc",
    }),
  ]);

  return {
    ...numericQuote(quote),
    items: items.map(numericItem),
    images,
  };
}

export async function markQuoteViewed(quote: QuoteRecord, userAgent?: string | null) {
  if (!quote.viewed_at) {
    await supabaseRequest("quotes", {
      method: "PATCH",
      body: JSON.stringify({ viewed_at: new Date().toISOString(), status: quote.status === "draft" ? "viewed" : quote.status }),
      headers: { Prefer: "return=minimal" },
    }, {
      id: `eq.${quote.id}`,
      viewed_at: "is.null",
    });
    await insertQuoteEvent(quote.id, "viewed", { user_agent: userAgent || null });
  }
}

export async function replaceQuoteSelections(quoteId: string, selections: QuoteSelectionInput[]) {
  await supabaseRequest("quote_selections", { method: "DELETE" }, { quote_id: `eq.${quoteId}` });
  await supabaseRequest("quote_selections", {
    method: "POST",
    body: JSON.stringify(selections.map((selection) => ({ ...selection, quote_id: quoteId }))),
    headers: { Prefer: "return=minimal" },
  });
}

export async function saveQuoteAcceptance(input: {
  quote: QuoteRecord;
  payload: AcceptQuotePayload;
  totals: QuoteTotals;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const now = new Date().toISOString();

  await supabaseRequest("quote_acceptances", {
    method: "POST",
    body: JSON.stringify({
      quote_id: input.quote.id,
      delivery_address: input.payload.delivery_address,
      billing_address: input.payload.billing_address,
      signed_name: input.payload.signed_name.trim(),
      signed_at: now,
      signature_style: input.payload.signature_style || "script-css-v1",
      subtotal_net: input.totals.subtotal_net,
      tax_amount: input.totals.tax_amount,
      total_gross: input.totals.total_gross,
      ip_address: input.ipAddress || null,
      user_agent: input.userAgent || null,
    }),
    headers: { Prefer: "return=minimal" },
  });

  await supabaseRequest("quotes", {
    method: "PATCH",
    body: JSON.stringify({
      status: "accepted",
      accepted_at: now,
      subtotal_net: input.totals.subtotal_net,
      tax_amount: input.totals.tax_amount,
      total_gross: input.totals.total_gross,
    }),
    headers: { Prefer: "return=minimal" },
  }, {
    id: `eq.${input.quote.id}`,
    status: "not.in.(accepted,declined,expired,void)",
  });

  await insertQuoteEvent(input.quote.id, "accepted", {
    subtotal_net: input.totals.subtotal_net,
    tax_amount: input.totals.tax_amount,
    total_gross: input.totals.total_gross,
  });
}

export async function uploadImageToSupabaseStorage(input: {
  bucket: string;
  path: string;
  contentType: string;
  body: ArrayBuffer;
}) {
  const { url, key } = config();
  const endpoint = `${url}/storage/v1/object/${input.bucket}/${input.path}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": input.contentType,
      "x-upsert": "true",
    },
    body: input.body,
  });

  if (!response.ok) {
    throw new SupabaseRestError("Bild-Upload fehlgeschlagen.", response.status, await response.text());
  }

  return `${url}/storage/v1/object/public/${input.bucket}/${input.path}`;
}
