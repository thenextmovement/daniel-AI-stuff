import { Temporal } from "@js-temporal/polyfill";
import type {
  DhlMailEvidence,
  ExistingDpdEvidence,
  ShopifyFinancialStatus,
  ShopifyOrderEvidence,
  TrelloCardEvidence,
} from "./domain";
import {
  ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID,
  ARRIVAL_LABEL_TIMEZONE,
  normalizeHumanText,
  orderNameFromTrelloCard,
} from "./domain";

type JsonRecord = Record<string, unknown>;
type OutlookGraphMessage = {
  id?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
};
type OutlookGraphPage = { value?: OutlookGraphMessage[]; "@odata.nextLink"?: string };

export const ARRIVAL_LABEL_OUTLOOK_MAX_PAGES = 50;
export const ARRIVAL_LABEL_SHOPIFY_MAX_PAGES = 20;

export type ExistingArrivalCaseEvidence = {
  caseId: string;
  idempotencyKey: string;
  trackingNumber: string;
  status: string;
  existingDpdTracking: string | null;
  shopifyOrderId: string | null;
  shopifyOrderName: string | null;
};

export type ArrivalDataClients = {
  outlook: { listMessagesForLocalDate(localDate: string): Promise<DhlMailEvidence[]> };
  trello: { listQuentinCards(): Promise<TrelloCardEvidence[]> };
  shopify: { listRecentOrders(localDate: string, cards?: TrelloCardEvidence[]): Promise<ShopifyOrderEvidence[]> };
  existingLabels: {
    findForOrders(orderIds: string[]): Promise<Map<string, ExistingDpdEvidence[]>>;
    findHandledCasesForIncomingTrackings?(
      trackingNumbers: string[],
    ): Promise<Map<string, ExistingArrivalCaseEvidence>>;
  };
};

export class ArrivalIntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ArrivalIntegrationError";
  }
}

export function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new ArrivalIntegrationError(`${name} ist nicht konfiguriert.`, "configuration_missing");
  return value;
}

function cleanBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) throw new ArrivalIntegrationError("Externe API-Basis-URL muss HTTPS verwenden.", "insecure_api_url");
  return normalized;
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: { attempts?: number; timeoutMs?: number; integration?: string },
) {
  const attempts = Math.min(Math.max(options?.attempts || 3, 1), 4);
  const integration = String(options?.integration || "external_api").replace(/[^a-z0-9_-]/gi, "_");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(options?.timeoutMs || 15_000),
      });
      if (response.ok) return response;
      if (![429, 502, 503, 504].includes(response.status) || attempt === attempts - 1) {
        throw new ArrivalIntegrationError(
          `${integration}: Externe API antwortete mit HTTP ${response.status}.`,
          `${integration}_http_error`,
          [429, 502, 503, 504].includes(response.status),
        );
      }
    } catch (error) {
      lastError = error;
      if (error instanceof ArrivalIntegrationError && !error.retryable) throw error;
      if (attempt === attempts - 1) break;
    }
    await delay(250 * (2 ** attempt));
  }
  if (lastError instanceof Error) throw lastError;
  throw new ArrivalIntegrationError(
    `${integration}: Externe API konnte nicht erreicht werden.`,
    `${integration}_transport_error`,
    true,
  );
}

export function berlinDayBounds(localDate: string) {
  const date = Temporal.PlainDate.from(localDate);
  const start = date.toZonedDateTime({ timeZone: ARRIVAL_LABEL_TIMEZONE, plainTime: Temporal.PlainTime.from("00:00") });
  const end = date.add({ days: 1 }).toZonedDateTime({ timeZone: ARRIVAL_LABEL_TIMEZONE, plainTime: Temporal.PlainTime.from("00:00") });
  return { startUtc: start.toInstant().toString(), endUtc: end.toInstant().toString() };
}

export async function microsoftGraphToken() {
  const tenantId = requiredEnv("MICROSOFT_GRAPH_TENANT_ID");
  const clientId = String(process.env.MICROSOFT_GRAPH_CLIENT_ID_NEXT || "").trim()
    || requiredEnv("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret = String(process.env.MICROSOFT_GRAPH_CLIENT_SECRET_NEXT || "").trim()
    || requiredEnv("MICROSOFT_GRAPH_CLIENT_SECRET");
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetchWithRetry(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }, { integration: "microsoft_graph_token" });
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new ArrivalIntegrationError("Microsoft Graph lieferte kein Access Token.", "graph_token_missing");
  return payload.access_token;
}

function validatedGraphInboxMessagesUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArrivalIntegrationError("Microsoft Graph lieferte einen ungueltigen Seitenlink.", "graph_outlook_next_link_invalid");
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "graph.microsoft.com"
    || !/^\/v1[.]0\/users\/[^/]+\/mailFolders\/inbox\/messages$/i.test(url.pathname)
  ) {
    throw new ArrivalIntegrationError("Microsoft Graph lieferte einen nicht freigegebenen Seitenlink.", "graph_outlook_next_link_invalid");
  }
  return url.toString();
}

export async function collectDhlOutlookMessages(
  initialUrl: string,
  token: string,
  options: {
    allowedDomains: string[];
    maxPages?: number;
    fetchPage?: (url: string, init: RequestInit) => Promise<Response>;
  },
) {
  const allowedDomains = options.allowedDomains.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (allowedDomains.length === 0) {
    throw new ArrivalIntegrationError("Keine DHL-Express-Absenderdomain freigegeben.", "graph_outlook_sender_domains_missing");
  }
  const maxPages = options.maxPages || ARRIVAL_LABEL_OUTLOOK_MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new ArrivalIntegrationError("Outlook-Seitenlimit ist ungueltig.", "graph_outlook_page_limit_invalid");
  }
  const fetchPage = options.fetchPage || ((url: string, init: RequestInit) => fetchWithRetry(
    url,
    init,
    { integration: "microsoft_graph_outlook" },
  ));
  const messages: DhlMailEvidence[] = [];
  let nextUrl: string | null = validatedGraphInboxMessagesUrl(initialUrl);
  let page = 0;
  while (nextUrl) {
    if (page >= maxPages) {
      throw new ArrivalIntegrationError(
        `Outlook-Zeitfenster ueberschreitet das Sicherheitslimit von ${maxPages * 100} Nachrichten.`,
        "graph_outlook_page_limit_exceeded",
      );
    }
    const response = await fetchPage(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json() as OutlookGraphPage;
    for (const message of payload.value || []) {
      const senderAddress = String(message.from?.emailAddress?.address || "");
      const senderName = String(message.from?.emailAddress?.name || "");
      const rawBody = String(message.body?.content || "");
      const bodyText = message.body?.contentType?.toLowerCase() === "html"
        ? rawBody.replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
        : rawBody;
      const searchable = `${senderAddress} ${senderName} ${message.subject || ""} ${bodyText}`;
      if (!/dhl/i.test(searchable)) continue;
      const senderDomain = senderAddress.split("@").pop()?.toLowerCase() || "";
      if (!allowedDomains.some((domain) => senderDomain === domain || senderDomain.endsWith(`.${domain}`))) continue;
      if (!message.id || !message.receivedDateTime) continue;
      messages.push({
        messageId: message.id,
        receivedAt: message.receivedDateTime,
        senderAddress: `${senderName} <${senderAddress}>`,
        subject: String(message.subject || ""),
        bodyText: bodyText.replace(/\s+/g, " ").trim(),
      });
    }
    page += 1;
    nextUrl = payload["@odata.nextLink"] ? validatedGraphInboxMessagesUrl(payload["@odata.nextLink"]) : null;
  }
  return messages;
}

export function createOutlookClient(): ArrivalDataClients["outlook"] {
  return {
    async listMessagesForLocalDate(localDate) {
      const mailbox = requiredEnv("MICROSOFT_GRAPH_MAILBOX");
      const token = await microsoftGraphToken();
      const bounds = berlinDayBounds(localDate);
      const lookback = berlinDayBounds(Temporal.PlainDate.from(localDate).subtract({ days: 2 }).toString());
      const filter = `receivedDateTime ge ${lookback.startUtc} and receivedDateTime lt ${bounds.endUtc}`;
      const initial = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`);
      initial.searchParams.set("$select", "id,subject,body,receivedDateTime,from");
      initial.searchParams.set("$filter", filter);
      initial.searchParams.set("$orderby", "receivedDateTime desc");
      initial.searchParams.set("$top", "100");
      const allowedDomains = String(process.env.DHL_EXPRESS_SENDER_DOMAINS || "dhl.com,dpdhl.com,dhl.de").split(",");
      return collectDhlOutlookMessages(initial.toString(), token, { allowedDomains });
    },
  };
}

export function createTrelloClient(): ArrivalDataClients["trello"] {
  return {
    async listQuentinCards() {
      const apiKey = requiredEnv("TRELLO_API_KEY");
      const token = requiredEnv("TRELLO_TOKEN");
      const boardId = String(process.env.ARRIVAL_LABEL_TRELLO_BOARD_ID || ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID).trim();
      if (!/^[a-f0-9]{24}$/i.test(boardId)) throw new ArrivalIntegrationError("Quentin Trello Board-ID ist ungueltig.", "trello_board_invalid");
      const cardsUrl = new URL(`https://api.trello.com/1/boards/${boardId}/cards`);
      cardsUrl.searchParams.set("key", apiKey);
      cardsUrl.searchParams.set("token", token);
      cardsUrl.searchParams.set("fields", "id,name,url,desc,idBoard,idList,closed,dateLastActivity");
      cardsUrl.searchParams.set("filter", "open");
      const listsUrl = new URL(`https://api.trello.com/1/boards/${boardId}/lists`);
      listsUrl.searchParams.set("key", apiKey);
      listsUrl.searchParams.set("token", token);
      listsUrl.searchParams.set("fields", "id,name");
      listsUrl.searchParams.set("filter", "all");
      const [cardsResponse, listsResponse] = await Promise.all([
        fetchWithRetry(cardsUrl.toString(), { headers: { Accept: "application/json" } }, { integration: "trello_cards" }),
        fetchWithRetry(listsUrl.toString(), { headers: { Accept: "application/json" } }, { integration: "trello_lists" }),
      ]);
      const cards = await cardsResponse.json() as Array<{
        id?: string;
        name?: string;
        url?: string;
        desc?: string;
        idBoard?: string;
        idList?: string;
        closed?: boolean;
        dateLastActivity?: string;
      }>;
      const lists = await listsResponse.json() as Array<{ id?: string; name?: string }>;
      const listNames = new Map(lists.filter((list) => list.id && list.name).map((list) => [list.id as string, list.name as string]));
      return cards
        .filter((card) => !card.closed && card.id && card.name && card.url)
        .map((card) => ({
          id: card.id as string,
          name: card.name as string,
          url: card.url as string,
          description: card.desc || null,
          boardId: card.idBoard || null,
          listId: card.idList || null,
          listName: card.idList ? listNames.get(card.idList) || null : null,
          dateLastActivity: card.dateLastActivity || null,
        }));
    },
  };
}

function shopifyConfig() {
  const domain = requiredEnv("SHOPIFY_SHOP_DOMAIN").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const token = requiredEnv("SHOPIFY_ADMIN_API_ACCESS_TOKEN");
  const version = requiredEnv("SHOPIFY_ADMIN_API_VERSION");
  if (!/^[a-z0-9-]+[.]myshopify[.]com$/i.test(domain)) throw new ArrivalIntegrationError("Shopify Shop-Domain ist ungueltig.", "shopify_domain_invalid");
  if (!/^\d{4}-\d{2}$/.test(version)) throw new ArrivalIntegrationError("Shopify API-Version ist ungueltig.", "shopify_version_invalid");
  return { domain, token, version };
}

const ARRIVAL_ORDERS_QUERY = `
  query ArrivalLabelOrders($first: Int!, $query: String!, $after: String) {
    orders(first: $first, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        displayFinancialStatus
        note
        tags
        customAttributes { key value }
        customer { displayName }
        shippingAddress {
          name
          company
          address1
          address2
          zip
          city
          provinceCode
          country
          countryCodeV2
        }
        lineItems(first: 100) { nodes { title quantity } }
        shippingLines(first: 20) { nodes { title code } }
        fulfillments(first: 20) {
          id
          status
          trackingInfo(first: 20) { company number url }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export type ShopifyOrdersPage = {
  nodes: JsonRecord[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

export async function collectShopifyOrderNodes(
  query: string,
  fetchPage: (query: string, after: string | null) => Promise<ShopifyOrdersPage>,
  maxPages = ARRIVAL_LABEL_SHOPIFY_MAX_PAGES,
) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 40) {
    throw new ArrivalIntegrationError("Shopify-Seitenlimit ist ungueltig.", "shopify_page_limit_invalid");
  }
  const nodes: JsonRecord[] = [];
  const seenCursors = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(query, after);
    nodes.push(...result.nodes);
    if (!result.pageInfo.hasNextPage) return nodes;
    const cursor = result.pageInfo.endCursor;
    if (!cursor || seenCursors.has(cursor)) {
      throw new ArrivalIntegrationError("Shopify lieferte einen ungueltigen Seitenzeiger.", "shopify_cursor_invalid");
    }
    seenCursors.add(cursor);
    after = cursor;
  }
  throw new ArrivalIntegrationError(
    `Shopify-Suchfenster ueberschreitet das Sicherheitslimit von ${maxPages * 250} Bestellungen.`,
    "shopify_page_limit_exceeded",
  );
}

export function createShopifyClient(): ArrivalDataClients["shopify"] {
  return {
    async listRecentOrders(localDate, cards = []) {
      const config = shopifyConfig();
      const executePage = async (query: string, after: string | null): Promise<ShopifyOrdersPage> => {
        const response = await fetchWithRetry(`https://${config.domain}/admin/api/${config.version}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": config.token },
          body: JSON.stringify({ query: ARRIVAL_ORDERS_QUERY, variables: { first: 250, query, after } }),
        }, { integration: "shopify_admin_graphql" });
        const payload = await response.json() as JsonRecord;
        const errors = Array.isArray(payload.errors) ? payload.errors : [];
        if (errors.length) throw new ArrivalIntegrationError("Shopify GraphQL lieferte Fehler.", "shopify_graphql_error");
        const data = payload.data as JsonRecord | undefined;
        const orders = data?.orders as JsonRecord | undefined;
        const nodes = orders?.nodes;
        const pageInfo = orders?.pageInfo as JsonRecord | undefined;
        return {
          nodes: Array.isArray(nodes) ? nodes as JsonRecord[] : [],
          pageInfo: {
            hasNextPage: pageInfo?.hasNextPage === true,
            endCursor: typeof pageInfo?.endCursor === "string" ? pageInfo.endCursor : null,
          },
        };
      };

      const explicitNames = [...new Set(cards.map((card) => orderNameFromTrelloCard(card.name)).filter((value): value is string => Boolean(value)))]
        .map((value) => value.replace(/^#/, ""));
      const queries = [`created_at:>=${Temporal.PlainDate.from(localDate).subtract({ days: 120 }).toString()}`];
      for (let index = 0; index < explicitNames.length; index += 25) {
        queries.push(explicitNames.slice(index, index + 25).map((value) => `name:${value}`).join(" OR "));
      }
      const rawOrders = (await Promise.all(queries.map((query) => collectShopifyOrderNodes(query, executePage)))).flat();
      const mapped = rawOrders.map((raw) => mapShopifyOrder(raw as JsonRecord, config.domain)).filter((order): order is ShopifyOrderEvidence => Boolean(order));
      return [...new Map(mapped.map((order) => [order.id, order])).values()];
    },
  };
}

function mapShopifyOrder(raw: JsonRecord, shopDomain: string): ShopifyOrderEvidence | null {
  const id = String(raw.id || "");
  const name = String(raw.name || "");
  const numericId = id.match(/^gid:\/\/shopify\/Order\/(\d+)$/)?.[1];
  if (!id || !name || !numericId) return null;
  const customer = raw.customer as JsonRecord | null | undefined;
  const shippingAddress = raw.shippingAddress as JsonRecord | null | undefined;
  const lineItems = ((raw.lineItems as JsonRecord | undefined)?.nodes || []) as JsonRecord[];
  const shippingLines = ((raw.shippingLines as JsonRecord | undefined)?.nodes || []) as JsonRecord[];
  const fulfillments = Array.isArray(raw.fulfillments) ? raw.fulfillments as JsonRecord[] : [];
  const financialStatus = normalizeFinancialStatus(raw.displayFinancialStatus);
  return {
    id,
    name,
    adminUrl: `https://${shopDomain}/admin/orders/${numericId}`,
    customerName: customer ? String(customer.displayName || "").trim() || null : null,
    financialStatus,
    note: String(raw.note || "").trim() || null,
    shippingAddress: shippingAddress ? {
      name: String(shippingAddress.name || "").trim() || null,
      company: String(shippingAddress.company || "").trim() || null,
      address1: String(shippingAddress.address1 || "").trim() || null,
      address2: String(shippingAddress.address2 || "").trim() || null,
      zip: String(shippingAddress.zip || "").trim() || null,
      city: String(shippingAddress.city || "").trim() || null,
      provinceCode: String(shippingAddress.provinceCode || "").trim() || null,
      country: String(shippingAddress.country || "").trim() || null,
      countryCodeV2: String(shippingAddress.countryCodeV2 || "").trim().toUpperCase() || null,
    } : null,
    customAttributes: Array.isArray(raw.customAttributes)
      ? (raw.customAttributes as JsonRecord[]).map((attribute) => ({
        key: String(attribute.key || "").trim(),
        value: String(attribute.value || "").trim(),
      }))
      : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    lineItems: lineItems.map((item) => ({ title: String(item.title || ""), quantity: Number(item.quantity || 0) })),
    shippingLines: shippingLines.map((line) => ({ title: String(line.title || ""), code: String(line.code || "").trim() || null })),
    fulfillments: fulfillments.flatMap((fulfillment) => {
      const trackingInfo = Array.isArray(fulfillment.trackingInfo) ? fulfillment.trackingInfo as JsonRecord[] : [];
      if (!trackingInfo.length) {
        return [{
          id: String(fulfillment.id || ""),
          status: String(fulfillment.status || "").trim() || null,
          trackingCompany: null,
          trackingNumber: null,
          trackingUrl: null,
        }];
      }
      return trackingInfo.map((tracking) => ({
        id: String(fulfillment.id || ""),
        status: String(fulfillment.status || "").trim() || null,
        trackingCompany: String(tracking.company || "").trim() || null,
        trackingNumber: String(tracking.number || "").replace(/\s+/g, "") || null,
        trackingUrl: String(tracking.url || "").trim() || null,
      }));
    }),
  };
}

function normalizeFinancialStatus(value: unknown): ShopifyFinancialStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if ([
    "paid",
    "pending",
    "authorized",
    "partially_paid",
    "partially_refunded",
    "refunded",
    "voided",
    "expired",
  ].includes(normalized)) return normalized as ShopifyFinancialStatus;
  return "unknown";
}

export function customerNameHintsFromCard(card: TrelloCardEvidence) {
  const generic = /^(?:card\s+\d+|led\s+flex|\d+\s+designs?|check\s+info|3d|nonlit|letters?|signs?)$/i;
  const hints = card.name
    .replace(/#NEONT\d+/gi, " ")
    .replace(new RegExp(card.id, "gi"), " ")
    .split("|")
    .map((part) => part.replace(/\b\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?\s*cm\b/gi, " ").trim())
    .map((part) => part.replace(/\b(check\s+info|\d+\s+designs?|led\s+flex)\b/gi, " ").trim())
    .filter((part) => /[a-zA-ZÀ-ž]{3}/.test(part) && !generic.test(part))
    .filter((part) => !/\b(rgb|red|blue|green|white|orange|yellow|gold|acrylic|outdoor|table|cut|shape|uv|print)\b/i.test(part));
  return [...new Set(hints.map((hint) => hint.replace(/\s+/g, " ").trim()).filter((hint) => normalizeHumanText(hint).length >= 4))];
}

export function createNoopExistingLabelClient(): ArrivalDataClients["existingLabels"] {
  return { async findForOrders() { return new Map(); } };
}

export function createRuntimeClients(): ArrivalDataClients {
  return {
    outlook: createOutlookClient(),
    trello: createTrelloClient(),
    shopify: createShopifyClient(),
    existingLabels: createNoopExistingLabelClient(),
  };
}
