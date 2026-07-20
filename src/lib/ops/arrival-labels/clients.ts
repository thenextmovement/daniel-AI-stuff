import { Temporal } from "@js-temporal/polyfill";
import type {
  DhlMailEvidence,
  ExistingDpdEvidence,
  ShopifyOrderEvidence,
  TrelloCardEvidence,
} from "./domain";
import { ARRIVAL_LABEL_TIMEZONE, normalizeHumanText, orderNameFromTrelloCard } from "./domain";

type JsonRecord = Record<string, unknown>;

export type ArrivalDataClients = {
  outlook: { listMessagesForLocalDate(localDate: string): Promise<DhlMailEvidence[]> };
  trello: { listQuentinCards(): Promise<TrelloCardEvidence[]> };
  shopify: { listRecentOrders(localDate: string, cards?: TrelloCardEvidence[]): Promise<ShopifyOrderEvidence[]> };
  existingLabels: { findForOrders(orderIds: string[]): Promise<Map<string, ExistingDpdEvidence[]>> };
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

function requiredEnv(name: string) {
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

async function fetchWithRetry(url: string, init: RequestInit, options?: { attempts?: number; timeoutMs?: number }) {
  const attempts = Math.min(Math.max(options?.attempts || 3, 1), 4);
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
        throw new ArrivalIntegrationError(`Externe API antwortete mit HTTP ${response.status}.`, "external_http_error", [429, 502, 503, 504].includes(response.status));
      }
    } catch (error) {
      lastError = error;
      if (error instanceof ArrivalIntegrationError && !error.retryable) throw error;
      if (attempt === attempts - 1) break;
    }
    await delay(250 * (2 ** attempt));
  }
  if (lastError instanceof Error) throw lastError;
  throw new ArrivalIntegrationError("Externe API konnte nicht erreicht werden.", "external_transport_error", true);
}

export function berlinDayBounds(localDate: string) {
  const date = Temporal.PlainDate.from(localDate);
  const start = date.toZonedDateTime({ timeZone: ARRIVAL_LABEL_TIMEZONE, plainTime: Temporal.PlainTime.from("00:00") });
  const end = date.add({ days: 1 }).toZonedDateTime({ timeZone: ARRIVAL_LABEL_TIMEZONE, plainTime: Temporal.PlainTime.from("00:00") });
  return { startUtc: start.toInstant().toString(), endUtc: end.toInstant().toString() };
}

async function microsoftGraphToken() {
  const tenantId = requiredEnv("MICROSOFT_GRAPH_TENANT_ID");
  const clientId = requiredEnv("MICROSOFT_GRAPH_CLIENT_ID");
  const clientSecret = requiredEnv("MICROSOFT_GRAPH_CLIENT_SECRET");
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
  });
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new ArrivalIntegrationError("Microsoft Graph lieferte kein Access Token.", "graph_token_missing");
  return payload.access_token;
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

      const messages: DhlMailEvidence[] = [];
      let nextUrl: string | null = initial.toString();
      for (let page = 0; nextUrl && page < 5; page += 1) {
        const response = await fetchWithRetry(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json() as {
          value?: Array<{
            id?: string;
            subject?: string;
            body?: { content?: string; contentType?: string };
            receivedDateTime?: string;
            from?: { emailAddress?: { address?: string; name?: string } };
          }>;
          "@odata.nextLink"?: string;
        };
        for (const message of payload.value || []) {
          const senderAddress = String(message.from?.emailAddress?.address || "");
          const senderName = String(message.from?.emailAddress?.name || "");
          const rawBody = String(message.body?.content || "");
          const bodyText = message.body?.contentType?.toLowerCase() === "html"
            ? rawBody.replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
            : rawBody;
          const searchable = `${senderAddress} ${senderName} ${message.subject || ""} ${bodyText}`;
          if (!/dhl/i.test(searchable)) continue;
          const allowedDomains = String(process.env.DHL_EXPRESS_SENDER_DOMAINS || "dhl.com,dpdhl.com,dhl.de")
            .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
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
        nextUrl = payload["@odata.nextLink"] || null;
      }
      return messages;
    },
  };
}

export function createTrelloClient(): ArrivalDataClients["trello"] {
  return {
    async listQuentinCards() {
      const apiKey = requiredEnv("TRELLO_API_KEY");
      const token = requiredEnv("TRELLO_TOKEN");
      const boardId = String(process.env.ARRIVAL_LABEL_TRELLO_BOARD_ID || "62bae9b97705e7419ed64593").trim();
      if (!/^[a-f0-9]{24}$/i.test(boardId)) throw new ArrivalIntegrationError("Quentin Trello Board-ID ist ungueltig.", "trello_board_invalid");
      const url = new URL(`https://api.trello.com/1/boards/${boardId}/cards`);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("token", token);
      url.searchParams.set("fields", "id,name,url,desc,idList,closed");
      url.searchParams.set("filter", "open");
      const response = await fetchWithRetry(url.toString(), { headers: { Accept: "application/json" } });
      const cards = await response.json() as Array<{ id?: string; name?: string; url?: string; desc?: string; idList?: string; closed?: boolean }>;
      return cards
        .filter((card) => !card.closed && card.id && card.name && card.url)
        .map((card) => ({
          id: card.id as string,
          name: card.name as string,
          url: card.url as string,
          description: card.desc || null,
          listId: card.idList || null,
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
  query ArrivalLabelOrders($first: Int!, $query: String!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
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
    }
  }
`;

export function createShopifyClient(): ArrivalDataClients["shopify"] {
  return {
    async listRecentOrders(localDate, cards = []) {
      const config = shopifyConfig();
      const execute = async (query: string) => {
        const response = await fetchWithRetry(`https://${config.domain}/admin/api/${config.version}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": config.token },
          body: JSON.stringify({ query: ARRIVAL_ORDERS_QUERY, variables: { first: 250, query } }),
        });
        const payload = await response.json() as JsonRecord;
        const errors = Array.isArray(payload.errors) ? payload.errors : [];
        if (errors.length) throw new ArrivalIntegrationError("Shopify GraphQL lieferte Fehler.", "shopify_graphql_error");
        const data = payload.data as JsonRecord | undefined;
        const nodes = (data?.orders as JsonRecord | undefined)?.nodes;
        return Array.isArray(nodes) ? nodes : [];
      };

      const explicitNames = [...new Set(cards.map((card) => orderNameFromTrelloCard(card.name)).filter((value): value is string => Boolean(value)))]
        .map((value) => value.replace(/^#/, ""));
      const queries = [`created_at:>=${Temporal.PlainDate.from(localDate).subtract({ days: 120 }).toString()}`];
      for (let index = 0; index < explicitNames.length; index += 25) {
        queries.push(explicitNames.slice(index, index + 25).map((value) => `name:${value}`).join(" OR "));
      }
      const rawOrders = (await Promise.all(queries.map(execute))).flat();
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
  return {
    id,
    name,
    adminUrl: `https://${shopDomain}/admin/orders/${numericId}`,
    customerName: customer ? String(customer.displayName || "").trim() || null : null,
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
