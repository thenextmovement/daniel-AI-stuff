import { supabaseRequest } from "@/lib/quotes/supabase-rest";

type DateLike = string | null | undefined;

export type ManagementRangePreset = "today" | "7d" | "30d" | "month" | "quarter" | "custom";

export type ManagementKpiInput = {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  query?: string | null;
  source?: string | null;
  segment?: string | null;
  country?: string | null;
  customerType?: string | null;
};

export type ManagementKpiCard = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "good" | "watch" | "danger";
};

export type ManagementKpiDataQualityItem = {
  key: string;
  label: string;
  status: "good" | "partial" | "missing" | "risk";
  detail: string;
};

export type ManagementRiskItem = {
  key: string;
  label: string;
  detail: string;
  severity: "watch" | "high" | "urgent";
  href?: string | null;
};

export type ManagementTableRow = {
  key: string;
  label: string;
  count: number;
  value?: number | null;
  detail?: string | null;
};

export type ManagementKpiDashboard = {
  generatedAt: string;
  range: {
    preset: ManagementRangePreset;
    from: string;
    to: string;
    label: string;
  };
  filters: {
    query: string | null;
    source: string | null;
    segment: string | null;
    country: string | null;
    customerType: string | null;
  };
  summary: ManagementKpiCard[];
  sales: {
    newRequests: number;
    quoteCreated: number;
    quoteSent: number;
    quoteViewed: number;
    quoteSigned: number;
    orders: number;
    cancelledOrders: number;
    orderValue: number;
    quoteValue: number;
    pipelineValue: number;
    conversionRate: number | null;
    topSources: ManagementTableRow[];
    topSegments: ManagementTableRow[];
  };
  operations: {
    openSalesTasks: number;
    overdueSalesTasks: number;
    completedCalls: number;
    openShippingIncidents: number;
    openInboundIncidents: number;
    riskFeed: ManagementRiskItem[];
  };
  costs: {
    knownAdSpend: number;
    knownAiSpendUsd: number;
    knownVoiceSpendUsd: number;
    knownInboundProductionSpendUsd: number;
    knownInboundShippingSpendUsd: number;
    knownCostCoverage: "partial";
    missingSources: string[];
  };
  dataQuality: ManagementKpiDataQualityItem[];
};

type MasterRequestRow = {
  id: string;
  request_id: string | null;
  status: string | null;
  deal_status: string | null;
  segment: string | null;
  s_kategorie: string | null;
  customer_type: string | null;
  country: string | null;
  estimated_value: number | string | null;
  final_value: number | string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_page_url: string | null;
  referrer: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MasterQuoteRow = {
  id: string;
  request_id: string | null;
  pandadoc_status: string | null;
  total_value: number | string | null;
  currency: string | null;
  created_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  updated_at: string | null;
};

type CrmQuoteRow = {
  id: string;
  request_id: string | null;
  status: string | null;
  total_gross: number | string | null;
  customer_live_total: number | string | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  shopify_order_id: number | string | null;
  created_at: string | null;
};

type MasterOrderRow = {
  id: string;
  request_id: string | null;
  shopify_order_number: string | null;
  order_value: number | string | null;
  subtotal_price: number | string | null;
  total_tax: number | string | null;
  currency: string | null;
  status: string | null;
  cancelled_at: string | null;
  shopify_created_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SeaCampaignDailyRow = {
  date: string;
  cost_eur: number | string | null;
  conversions: number | string | null;
  conversion_value: number | string | null;
  synced_at: string | null;
};

type GoogleAdsDailySpendRow = {
  date: string;
  spend: number | string | null;
  synced_at: string | null;
};

type AnthropicCostRow = {
  cost_date: string;
  total_cost_usd: number | string | null;
  total_cost_cents: number | string | null;
};

type CostEntryRow = {
  id: string;
  cost_key: string;
  source: string;
  category: "ads" | "ai" | "voice" | "shipping" | "production" | "customs" | "tool" | "manual" | "other";
  subcategory: string | null;
  amount: number | string;
  currency: "EUR" | "USD";
  occurred_on: string;
  confidence: "actual" | "derived" | "estimated";
};

type SalesTaskRow = {
  id: string;
  request_id: string;
  status: string;
  task_type: string;
  priority_tier: string;
  assignee_label: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SalesCallResultRow = {
  id: string;
  request_id: string;
  call_done: string;
  call_outcome: string | null;
  next_step: string;
  operator_id: string | null;
  superseded_at: string | null;
  created_at: string;
};

type ShippingIncidentRow = {
  id: string;
  request_id: string | null;
  incident_type: string;
  severity: "watch" | "high" | "urgent";
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type InboundIncidentRow = {
  id: string;
  shipment_id: string;
  incident_type: string;
  severity: "watch" | "high" | "urgent";
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type KpiRows = {
  requests: MasterRequestRow[];
  quotes: MasterQuoteRow[];
  crmQuotes: CrmQuoteRow[];
  orders: MasterOrderRow[];
  seaCampaignDaily: SeaCampaignDailyRow[];
  googleAdsDailySpend: GoogleAdsDailySpendRow[];
  anthropicCosts: AnthropicCostRow[];
  costEntries: CostEntryRow[];
  salesTasks: SalesTaskRow[];
  salesCallResults: SalesCallResultRow[];
  shippingIncidents: ShippingIncidentRow[];
  inboundIncidents: InboundIncidentRow[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfBerlinDay(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+02:00`);
}

function startOfMonth(now: Date) {
  const dayStart = startOfBerlinDay(now);
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
}

function startOfQuarter(now: Date) {
  const dayStart = startOfBerlinDay(now);
  const quarterMonth = Math.floor(dayStart.getMonth() / 3) * 3;
  return new Date(dayStart.getFullYear(), quarterMonth, 1);
}

function parseDateBoundary(value: string | null | undefined, fallback: Date, endOfDay = false) {
  const text = cleanText(value);
  if (!text) return fallback;
  const parsed = new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59.999+02:00` : text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export function resolveManagementRange(input: ManagementKpiInput = {}, now = new Date()) {
  const preset = (cleanText(input.range) || "30d") as ManagementRangePreset;
  const todayStart = startOfBerlinDay(now);
  let from: Date;
  let to = now;
  let label = "Letzte 30 Tage";

  switch (preset) {
    case "today":
      from = todayStart;
      label = "Heute";
      break;
    case "7d":
      from = new Date(todayStart.getTime() - 6 * DAY_MS);
      label = "Letzte 7 Tage";
      break;
    case "month":
      from = startOfMonth(now);
      label = "Dieser Monat";
      break;
    case "quarter":
      from = startOfQuarter(now);
      label = "Dieses Quartal";
      break;
    case "custom":
      from = parseDateBoundary(input.from, new Date(todayStart.getTime() - 29 * DAY_MS));
      to = parseDateBoundary(input.to, now, true);
      label = "Freier Zeitraum";
      break;
    case "30d":
    default:
      from = new Date(todayStart.getTime() - 29 * DAY_MS);
      label = "Letzte 30 Tage";
      break;
  }

  if (from.getTime() > to.getTime()) {
    const previousFrom = from;
    from = to;
    to = previousFrom;
  }

  return {
    preset: ["today", "7d", "30d", "month", "quarter", "custom"].includes(preset) ? preset : "30d",
    from,
    to,
    label,
  };
}

function dateInRange(value: DateLike, from: Date, to: Date) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime() && time <= to.getTime();
}

function anyDateInRange(values: DateLike[], from: Date, to: Date) {
  return values.some((value) => dateInRange(value, from, to));
}

function matchesNeedle(values: unknown[], needle: string | null) {
  if (!needle) return true;
  return values.some((value) => normalized(value).includes(needle));
}

function filterRequestRows(rows: MasterRequestRow[], input: ManagementKpiInput, from: Date, to: Date) {
  const query = normalized(input.query) || null;
  const source = normalized(input.source) || null;
  const segment = normalized(input.segment) || null;
  const country = normalized(input.country) || null;
  const customerType = normalized(input.customerType) || null;

  return rows.filter((row) => {
    if (!dateInRange(row.created_at, from, to)) return false;
    if (source && ![row.utm_source, row.utm_medium, row.utm_campaign, row.landing_page_url, row.referrer].some((entry) => normalized(entry).includes(source))) return false;
    if (segment && ![row.segment, row.s_kategorie].some((entry) => normalized(entry).includes(segment))) return false;
    if (country && normalized(row.country) !== country) return false;
    if (customerType && normalized(row.customer_type) !== customerType) return false;
    return matchesNeedle([row.request_id, row.status, row.deal_status, row.segment, row.s_kategorie, row.utm_source, row.utm_campaign], query);
  });
}

function requestIdSet(rows: MasterRequestRow[]) {
  return new Set(rows.map((row) => cleanText(row.request_id)).filter((value): value is string => Boolean(value)));
}

function filterRelatedByRequest<T extends { request_id?: string | null }>(rows: T[], requestIds: Set<string>, query: string | null, extraValues: (row: T) => unknown[] = () => []) {
  if (!requestIds.size && !query) return rows;
  return rows.filter((row) => {
    const requestId = cleanText(row.request_id);
    if (requestId && requestIds.has(requestId)) return true;
    return matchesNeedle([requestId, ...extraValues(row)], query);
  });
}

function sum<T>(rows: T[], pick: (row: T) => unknown) {
  return rows.reduce((total, row) => total + asNumber(pick(row)), 0);
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function money(value: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function countBy<T>(rows: T[], keyOf: (row: T) => string | null | undefined, valueOf?: (row: T) => number) {
  const map = new Map<string, { count: number; value: number }>();
  for (const row of rows) {
    const key = cleanText(keyOf(row)) || "Unbekannt";
    const current = map.get(key) || { count: 0, value: 0 };
    current.count += 1;
    current.value += valueOf ? valueOf(row) : 0;
    map.set(key, current);
  }
  return [...map.entries()]
    .map(([key, entry]) => ({ key, label: key, count: entry.count, value: entry.value || null }))
    .sort((left, right) => right.count - left.count || (right.value || 0) - (left.value || 0))
    .slice(0, 8);
}

function latestDate<T>(rows: T[], pick: (row: T) => DateLike) {
  let latest: string | null = null;
  for (const row of rows) {
    const value = pick(row);
    if (!value) continue;
    if (!latest || new Date(value).getTime() > new Date(latest).getTime()) latest = value;
  }
  return latest;
}

function staleDays(date: string | null, now: Date) {
  if (!date) return null;
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / DAY_MS);
}

function statusQuality(status: ManagementKpiDataQualityItem["status"], label: string, detail: string, key: string): ManagementKpiDataQualityItem {
  return { key, label, status, detail };
}

function dateAndFilter(column: string, from: string, to: string) {
  return `(${column}.gte.${from},${column}.lte.${to})`;
}

export function buildManagementKpiDashboardFromRows(rows: KpiRows, input: ManagementKpiInput = {}, now = new Date()): ManagementKpiDashboard {
  const range = resolveManagementRange(input, now);
  const query = normalized(input.query) || null;
  const filteredRequests = filterRequestRows(rows.requests, input, range.from, range.to);
  const requestIds = requestIdSet(filteredRequests);

  const relatedQuotes = filterRelatedByRequest(rows.quotes, requestIds, query, (row) => [row.pandadoc_status]);
  const quotesInRange = relatedQuotes.filter((row) => anyDateInRange([row.created_at, row.sent_at, row.viewed_at, row.signed_at], range.from, range.to));
  const relatedCrmQuotes = filterRelatedByRequest(rows.crmQuotes, requestIds, query, (row) => [row.status]);
  const crmQuotesInRange = relatedCrmQuotes.filter((row) => anyDateInRange([row.created_at, row.sent_at, row.viewed_at, row.accepted_at], range.from, range.to));
  const relatedOrders = filterRelatedByRequest(rows.orders, requestIds, query, (row) => [row.shopify_order_number, row.status]);
  const ordersInRange = relatedOrders.filter((row) => dateInRange(row.shopify_created_at || row.created_at, range.from, range.to));
  const relatedTasks = filterRelatedByRequest(rows.salesTasks, requestIds, query, (row) => [row.status, row.task_type, row.assignee_label]);
  const tasksInRange = relatedTasks.filter((row) => anyDateInRange([row.created_at, row.updated_at, row.completed_at, row.due_at], range.from, range.to));
  const relatedCalls = filterRelatedByRequest(rows.salesCallResults, requestIds, query, (row) => [row.call_outcome, row.next_step, row.operator_id]);
  const callsInRange = relatedCalls.filter((row) => dateInRange(row.created_at, range.from, range.to) && !row.superseded_at);
  const relatedShippingIncidents = filterRelatedByRequest(rows.shippingIncidents, requestIds, query, (row) => [row.title, row.incident_type, row.severity, row.status]);
  const shippingIncidentsInRange = relatedShippingIncidents.filter((row) => anyDateInRange([row.created_at, row.updated_at], range.from, range.to));
  const inboundIncidentsInRange = rows.inboundIncidents.filter((row) => anyDateInRange([row.created_at, row.updated_at], range.from, range.to) && matchesNeedle([row.title, row.incident_type, row.severity, row.status], query));

  const quoteCreated = quotesInRange.filter((row) => dateInRange(row.created_at, range.from, range.to)).length + crmQuotesInRange.filter((row) => dateInRange(row.created_at, range.from, range.to)).length;
  const quoteSent = quotesInRange.filter((row) => dateInRange(row.sent_at, range.from, range.to)).length + crmQuotesInRange.filter((row) => dateInRange(row.sent_at, range.from, range.to)).length;
  const quoteViewed = quotesInRange.filter((row) => dateInRange(row.viewed_at, range.from, range.to)).length + crmQuotesInRange.filter((row) => dateInRange(row.viewed_at, range.from, range.to)).length;
  const quoteSigned = quotesInRange.filter((row) => dateInRange(row.signed_at, range.from, range.to)).length + crmQuotesInRange.filter((row) => dateInRange(row.accepted_at, range.from, range.to)).length;
  const activeOrders = ordersInRange.filter((row) => !row.cancelled_at && !["refunded"].includes(normalized(row.status)));
  const cancelledOrders = ordersInRange.filter((row) => row.cancelled_at || ["refunded", "partially_refunded"].includes(normalized(row.status)));
  const orderValue = sum(activeOrders, (row: MasterOrderRow) => row.order_value);
  const quoteValue = sum(quotesInRange, (row: MasterQuoteRow) => row.total_value) + sum(crmQuotesInRange, (row: CrmQuoteRow) => row.customer_live_total || row.total_gross);
  const pipelineValue = sum(filteredRequests, (row: MasterRequestRow) => row.final_value || row.estimated_value);
  const openSalesTasks = tasksInRange.filter((row) => ["open", "waiting", "blocked"].includes(normalized(row.status))).length;
  const overdueSalesTasks = tasksInRange.filter((row) => ["open", "waiting", "blocked"].includes(normalized(row.status)) && row.due_at && new Date(row.due_at).getTime() < now.getTime()).length;
  const completedCalls = callsInRange.filter((row) => normalized(row.call_done) === "yes").length;
  const openShippingIncidents = shippingIncidentsInRange.filter((row) => ["open", "acknowledged"].includes(normalized(row.status))).length;
  const openInboundIncidents = inboundIncidentsInRange.filter((row) => ["open", "acknowledged"].includes(normalized(row.status))).length;

  const costEntriesInRange = rows.costEntries.filter((row) => dateInRange(row.occurred_on, range.from, range.to));
  const knownAdSpend = sum(costEntriesInRange.filter((row) => row.category === "ads" && row.currency === "EUR"), (row) => row.amount);
  const knownAiSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "ai" && row.currency === "USD"), (row) => row.amount);
  const knownVoiceSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "voice" && row.currency === "USD"), (row) => row.amount);
  const knownInboundProductionSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "production" && row.subcategory === "china_supplier_production" && row.currency === "USD"), (row) => row.amount);
  const knownInboundShippingSpendUsd = sum(costEntriesInRange.filter((row) => row.category === "shipping" && row.subcategory === "china_inbound_shipping" && row.currency === "USD"), (row) => row.amount);
  const legacyAdsLatest = latestDate(rows.googleAdsDailySpend, (row: GoogleAdsDailySpendRow) => row.date);
  const seaAdsLatest = latestDate(rows.seaCampaignDaily, (row: SeaCampaignDailyRow) => row.date);
  const costBookLatest = latestDate(rows.costEntries, (row) => row.occurred_on);

  const riskFeed: ManagementRiskItem[] = [
    ...shippingIncidentsInRange
      .filter((row) => ["open", "acknowledged"].includes(normalized(row.status)))
      .map((row) => ({
        key: `shipping:${row.id}`,
        label: row.title,
        detail: [row.request_id, row.incident_type, row.description].filter(Boolean).join(" - "),
        severity: row.severity,
        href: row.request_id ? `/ops/customer-records/shipping?requestId=${encodeURIComponent(row.request_id)}` : "/ops/customer-records/shipping",
      })),
    ...inboundIncidentsInRange
      .filter((row) => ["open", "acknowledged"].includes(normalized(row.status)))
      .map((row) => ({
        key: `inbound:${row.id}`,
        label: row.title,
        detail: [row.incident_type, row.description].filter(Boolean).join(" - "),
        severity: row.severity,
        href: "/ops/customer-records/inbound-shipping",
      })),
    ...(overdueSalesTasks
      ? [{
          key: "sales_tasks:overdue",
          label: "Überfällige Sales-Aufgaben",
          detail: `${overdueSalesTasks} offene Aufgaben sind überfällig.`,
          severity: "high" as const,
          href: "/ops/customer-records/calls",
        }]
      : []),
  ].sort((left, right) => ({ urgent: 3, high: 2, watch: 1 }[right.severity] - { urgent: 3, high: 2, watch: 1 }[left.severity])).slice(0, 12);

  const dataQuality: ManagementKpiDataQualityItem[] = [
    statusQuality("good", "Umsatzdaten", `${activeOrders.length} aktive Shopify-Bestellungen im Zeitraum, ${cancelledOrders.length} stornierte/erstattete Fälle separat gezählt.`, "orders"),
    statusQuality(filteredRequests.filter((row) => row.utm_source || row.utm_campaign || row.landing_page_url).length ? "partial" : "missing", "Attribution", `${filteredRequests.filter((row) => row.utm_source || row.utm_campaign || row.landing_page_url).length} von ${filteredRequests.length} Anfragen haben UTM/Landingpage-Daten.`, "attribution"),
    statusQuality(costBookLatest && staleDays(costBookLatest, now)! <= 2 ? "good" : "partial", "Kostenbuch", `${costEntriesInRange.length} Kostenbuch-Zeilen im Zeitraum. Letzter Kostenbuch-Tag: ${costBookLatest || "unbekannt"}.`, "cost_book"),
    statusQuality(seaAdsLatest && staleDays(seaAdsLatest, now)! <= 2 ? "good" : "partial", "SEA-Kosten", `Aktuelle Quelle sea_campaign_daily bis ${seaAdsLatest || "unbekannt"}. Legacy google_ads_daily_spend bis ${legacyAdsLatest || "unbekannt"} ist als Legacy-Kostenquelle im Kostenbuch enthalten.`, "ads_costs"),
    statusQuality("partial", "Kosten/Marge", "Google Ads, AI-Token, Voice-Schaetzungen sowie Sign-SHIPPED Produktions- und China-Inbound-Versandkosten sind im Kostenbuch. Marge bleibt ohne Outbound-Versand, Zoll/Import und Refunds nur teilweise belastbar.", "margin"),
    statusQuality(openShippingIncidents ? "risk" : "good", "Versand-Risiken", `${openShippingIncidents} offene ausgehende Shipping-Incidents im Zeitraum.`, "shipping"),
    statusQuality("risk", "RLS-Hinweis", "Supabase meldet deaktivierte RLS u.a. für sales_tasks und ops_offer_events. Nicht automatisch behoben, weil Policies definiert werden müssen.", "rls"),
  ];

  const summary: ManagementKpiCard[] = [
    {
      key: "revenue",
      label: "Shopify-Umsatz",
      value: money(orderValue),
      detail: `${activeOrders.length} aktive Bestellungen, ${cancelledOrders.length} storniert/erstattet separat`,
      tone: orderValue > 0 ? "good" : "neutral",
    },
    {
      key: "pipeline",
      label: "Pipeline-Wert",
      value: money(pipelineValue),
      detail: `${filteredRequests.length} neue Anfragen im Zeitraum`,
      tone: pipelineValue > 0 ? "neutral" : "watch",
    },
    {
      key: "conversion",
      label: "Quote Conversion",
      value: pct(quoteSigned, quoteSent) === null ? "-" : `${pct(quoteSigned, quoteSent)}%`,
      detail: `${quoteSigned} angenommen/signiert von ${quoteSent} gesendet`,
      tone: quoteSent ? "neutral" : "watch",
    },
    {
      key: "risks",
      label: "Akute Risiken",
      value: String(openShippingIncidents + openInboundIncidents + overdueSalesTasks),
      detail: `${openShippingIncidents} Versand, ${openInboundIncidents} Wareneingang, ${overdueSalesTasks} Aufgaben`,
      tone: openShippingIncidents + openInboundIncidents + overdueSalesTasks ? "danger" : "good",
    },
    {
      key: "ad_spend",
      label: "SEA-Kosten",
      value: money(knownAdSpend),
      detail: `${costEntriesInRange.filter((row) => row.category === "ads").length} Kostenbuch-Zeilen im Zeitraum`,
      tone: knownAdSpend > 0 ? "neutral" : "watch",
    },
    {
      key: "ai_cost",
      label: "AI-Kosten",
      value: money(knownAiSpendUsd, "USD"),
      detail: `${costEntriesInRange.filter((row) => row.category === "ai").length} Kostenbuch-Zeilen im Zeitraum`,
      tone: knownAiSpendUsd > 0 ? "neutral" : "watch",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    range: {
      preset: range.preset,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      label: range.label,
    },
    filters: {
      query: cleanText(input.query),
      source: cleanText(input.source),
      segment: cleanText(input.segment),
      country: cleanText(input.country),
      customerType: cleanText(input.customerType),
    },
    summary,
    sales: {
      newRequests: filteredRequests.length,
      quoteCreated,
      quoteSent,
      quoteViewed,
      quoteSigned,
      orders: activeOrders.length,
      cancelledOrders: cancelledOrders.length,
      orderValue,
      quoteValue,
      pipelineValue,
      conversionRate: pct(quoteSigned, quoteSent),
      topSources: countBy(filteredRequests, (row) => row.utm_source || row.referrer || row.landing_page_url, (row) => asNumber(row.final_value || row.estimated_value)),
      topSegments: countBy(filteredRequests, (row) => row.segment || row.s_kategorie || "Ohne Segment", (row) => asNumber(row.final_value || row.estimated_value)),
    },
    operations: {
      openSalesTasks,
      overdueSalesTasks,
      completedCalls,
      openShippingIncidents,
      openInboundIncidents,
      riskFeed,
    },
    costs: {
      knownAdSpend,
      knownAiSpendUsd,
      knownVoiceSpendUsd,
      knownInboundProductionSpendUsd,
      knownInboundShippingSpendUsd,
      knownCostCoverage: "partial",
      missingSources: [
        "ausgehende DPD/DHL-Versandkosten je Kundenpaket",
        "Zoll- und Importkosten",
        "Refund-/Chargeback-Kosten",
        "Abo-/Toolkostenplaene",
      ],
    },
    dataQuality,
  };
}

async function fetchKpiRows(input: ManagementKpiInput): Promise<KpiRows> {
  const range = resolveManagementRange(input);
  const [requests, quotes, crmQuotes, orders, seaCampaignDaily, googleAdsDailySpend, anthropicCosts, costEntries, salesTasks, salesCallResults, shippingIncidents, inboundIncidents] = await Promise.all([
    supabaseRequest<MasterRequestRow[]>("master_requests", undefined, {
      select: "id,request_id,status,deal_status,segment,s_kategorie,customer_type,country,estimated_value,final_value,utm_source,utm_medium,utm_campaign,landing_page_url,referrer,created_at,updated_at",
      and: dateAndFilter("created_at", range.from.toISOString(), range.to.toISOString()),
      order: "created_at.desc",
      limit: 5000,
    }),
    supabaseRequest<MasterQuoteRow[]>("master_quotes", undefined, {
      select: "id,request_id,pandadoc_status,total_value,currency,created_at,sent_at,viewed_at,signed_at,updated_at",
      order: "created_at.desc",
      limit: 5000,
    }),
    supabaseRequest<CrmQuoteRow[]>("crm_quotes", undefined, {
      select: "id,request_id,status,total_gross,customer_live_total,sent_at,viewed_at,accepted_at,rejected_at,shopify_order_id,created_at",
      order: "created_at.desc",
      limit: 5000,
    }),
    supabaseRequest<MasterOrderRow[]>("master_orders", undefined, {
      select: "id,request_id,shopify_order_number,order_value,subtotal_price,total_tax,currency,status,cancelled_at,shopify_created_at,created_at,updated_at",
      order: "created_at.desc",
      limit: 5000,
    }),
    supabaseRequest<SeaCampaignDailyRow[]>("sea_campaign_daily", undefined, {
      select: "date,cost_eur,conversions,conversion_value,synced_at",
      and: dateAndFilter("date", range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)),
      order: "date.desc",
      limit: 1000,
    }),
    supabaseRequest<GoogleAdsDailySpendRow[]>("google_ads_daily_spend", undefined, {
      select: "date,spend,synced_at",
      order: "date.desc",
      limit: 500,
    }),
    supabaseRequest<AnthropicCostRow[]>("anthropic_api_daily_costs", undefined, {
      select: "cost_date,total_cost_usd,total_cost_cents",
      and: dateAndFilter("cost_date", range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)),
      order: "cost_date.desc",
      limit: 500,
    }),
    supabaseRequest<CostEntryRow[]>("ops_cost_entries", undefined, {
      select: "id,cost_key,source,category,subcategory,amount,currency,occurred_on,confidence",
      and: dateAndFilter("occurred_on", range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10)),
      order: "occurred_on.desc",
      limit: 5000,
    }),
    supabaseRequest<SalesTaskRow[]>("sales_tasks", undefined, {
      select: "id,request_id,status,task_type,priority_tier,assignee_label,due_at,completed_at,created_at,updated_at",
      order: "updated_at.desc",
      limit: 5000,
    }),
    supabaseRequest<SalesCallResultRow[]>("sales_call_results", undefined, {
      select: "id,request_id,call_done,call_outcome,next_step,operator_id,superseded_at,created_at",
      and: dateAndFilter("created_at", range.from.toISOString(), range.to.toISOString()),
      order: "created_at.desc",
      limit: 1000,
    }),
    supabaseRequest<ShippingIncidentRow[]>("shipping_incidents", undefined, {
      select: "id,request_id,incident_type,severity,status,title,description,created_at,updated_at",
      order: "updated_at.desc",
      limit: 1000,
    }),
    supabaseRequest<InboundIncidentRow[]>("inbound_incidents", undefined, {
      select: "id,shipment_id,incident_type,severity,status,title,description,created_at,updated_at",
      order: "updated_at.desc",
      limit: 1000,
    }),
  ]);

  return {
    requests,
    quotes,
    crmQuotes,
    orders,
    seaCampaignDaily,
    googleAdsDailySpend,
    anthropicCosts,
    costEntries,
    salesTasks,
    salesCallResults,
    shippingIncidents,
    inboundIncidents,
  };
}

export async function getManagementKpiDashboard(input: ManagementKpiInput = {}) {
  const rows = await fetchKpiRows(input);
  return buildManagementKpiDashboardFromRows(rows, input);
}
