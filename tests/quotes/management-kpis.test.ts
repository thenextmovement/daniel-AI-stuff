import assert from "node:assert/strict";
import test from "node:test";
import { buildManagementKpiDashboardFromRows, resolveManagementRange } from "../../src/lib/ops/management-kpis";

function berlinDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", dateStyle: "short" }).format(value);
}

const emptyRows = {
  requests: [],
  quotes: [],
  crmQuotes: [],
  orders: [],
  seaCampaignDaily: [],
  googleAdsDailySpend: [],
  anthropicCosts: [],
  salesTasks: [],
  salesCallResults: [],
  shippingIncidents: [],
  inboundIncidents: [],
};

test("resolveManagementRange supports stable 7 day Berlin-window presets", () => {
  const range = resolveManagementRange({ range: "7d" }, new Date("2026-06-07T10:00:00.000Z"));

  assert.equal(range.preset, "7d");
  assert.equal(range.label, "Letzte 7 Tage");
  assert.equal(berlinDate(range.from), "2026-06-01");
  assert.equal(range.to.toISOString(), "2026-06-07T10:00:00.000Z");
});

test("buildManagementKpiDashboardFromRows separates revenue, pipeline, costs and operational risks", () => {
  const dashboard = buildManagementKpiDashboardFromRows(
    {
      ...emptyRows,
      requests: [
        {
          id: "request-row-1",
          request_id: "REQ-1",
          status: "new",
          deal_status: "open",
          segment: "b2b",
          s_kategorie: "S1",
          customer_type: "business",
          country: "DE",
          estimated_value: 1200,
          final_value: null,
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "brand",
          landing_page_url: "https://neontrip.de",
          referrer: null,
          created_at: "2026-06-05T10:00:00.000Z",
          updated_at: "2026-06-05T10:00:00.000Z",
        },
      ],
      quotes: [
        {
          id: "quote-1",
          request_id: "REQ-1",
          pandadoc_status: "sent",
          total_value: 1500,
          currency: "EUR",
          created_at: "2026-06-05T11:00:00.000Z",
          sent_at: "2026-06-05T11:10:00.000Z",
          viewed_at: "2026-06-05T12:00:00.000Z",
          signed_at: null,
          updated_at: "2026-06-05T12:00:00.000Z",
        },
      ],
      orders: [
        {
          id: "order-1",
          request_id: "REQ-1",
          shopify_order_number: "#1001",
          order_value: 990,
          subtotal_price: 831.93,
          total_tax: 158.07,
          currency: "EUR",
          status: "paid",
          cancelled_at: null,
          shopify_created_at: "2026-06-06T09:00:00.000Z",
          created_at: "2026-06-06T09:00:00.000Z",
          updated_at: "2026-06-06T09:00:00.000Z",
        },
      ],
      seaCampaignDaily: [{ date: "2026-06-06", cost_eur: 44, conversions: 2, conversion_value: 500, synced_at: "2026-06-06T23:00:00.000Z" }],
      googleAdsDailySpend: [{ date: "2026-01-29", spend: 10, synced_at: "2026-01-29T23:00:00.000Z" }],
      anthropicCosts: [{ cost_date: "2026-06-06", total_cost_usd: 3.5, total_cost_cents: 350 }],
      salesTasks: [
        {
          id: "task-1",
          request_id: "REQ-1",
          status: "open",
          task_type: "call_quote_sent",
          priority_tier: "important",
          assignee_label: "Fabienne",
          due_at: "2026-06-06T08:00:00.000Z",
          completed_at: null,
          created_at: "2026-06-05T12:00:00.000Z",
          updated_at: "2026-06-05T12:00:00.000Z",
        },
      ],
      salesCallResults: [
        {
          id: "call-result-1",
          request_id: "REQ-1",
          call_done: "yes",
          call_outcome: "reached",
          next_step: "followup",
          operator_id: "Fabienne",
          superseded_at: null,
          created_at: "2026-06-06T13:00:00.000Z",
        },
      ],
      shippingIncidents: [
        {
          id: "shipping-incident-1",
          request_id: "REQ-1",
          incident_type: "delivery_failed",
          severity: "high",
          status: "open",
          title: "Zustellung fehlgeschlagen",
          description: "Paket konnte nicht zugestellt werden.",
          created_at: "2026-06-06T14:00:00.000Z",
          updated_at: "2026-06-06T14:00:00.000Z",
        },
      ],
    },
    { range: "7d" },
    new Date("2026-06-07T10:00:00.000Z"),
  );

  assert.equal(dashboard.sales.newRequests, 1);
  assert.equal(dashboard.sales.quoteSent, 1);
  assert.equal(dashboard.sales.orders, 1);
  assert.equal(dashboard.sales.orderValue, 990);
  assert.equal(dashboard.sales.pipelineValue, 1200);
  assert.equal(dashboard.costs.knownAdSpend, 44);
  assert.equal(dashboard.costs.knownAiSpendUsd, 3.5);
  assert.equal(dashboard.operations.completedCalls, 1);
  assert.equal(dashboard.operations.openSalesTasks, 1);
  assert.equal(dashboard.operations.overdueSalesTasks, 1);
  assert.equal(dashboard.operations.openShippingIncidents, 1);
  assert.equal(dashboard.operations.riskFeed[0]?.key, "shipping:shipping-incident-1");
  assert.equal(dashboard.dataQuality.find((item) => item.key === "margin")?.status, "partial");
});
