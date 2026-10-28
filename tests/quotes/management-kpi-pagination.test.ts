import assert from "node:assert/strict";
import test from "node:test";
import { getManagementKpiDashboard } from "../../src/lib/ops/management-kpis";

test("management KPIs follow every page before applying combined filters, even with a lower server page cap", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const offsets: number[] = [];
  const rows = Array.from({ length: 5103 }, (_, index) => ({
    id: `row-${index}`, request_id: `REQ-${index}`, country: index < 5100 ? "AT" : "DE",
    utm_source: "google", created_at: index == 5100 ? "2026-09-01T10:00:00Z" : "2026-10-28T10:00:00Z", status: "new",
  }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/master_orders")) {
      if (Number(url.searchParams.get("offset") || 0) > 0) return Response.json([]);
      return Response.json([
        { id: "order-de", request_id: "REQ-5100", created_at: "2026-10-28T12:00:00Z", order_value: 100 },
        { id: "order-at", request_id: "REQ-1", created_at: "2026-10-28T12:00:00Z", order_value: 200 },
      ]);
    }
    if (!url.pathname.endsWith("/master_requests")) return Response.json([]);
    const offset = Number(url.searchParams.get("offset") || 0);
    offsets.push(offset);

    return Response.json(rows.slice(offset, offset + Math.min(80, Number(url.searchParams.get("limit")))));
  };
  try {
    const result = await getManagementKpiDashboard({ range: "custom", from: "2026-10-28", to: "2026-10-28", country: "DE", source: "google" });
    assert.equal(result.sales.newRequests, 2);
    assert.equal(result.sales.orders, 1, "country filter must restrict orders, including orders with older matching requests");
    assert.equal(result.sales.orderValue, 100);
    const empty = await getManagementKpiDashboard({ range: "custom", from: "2026-10-28", to: "2026-10-28", country: "CH" });
    assert.equal(empty.sales.orders, 0, "zero matching requests must not disable filters");
    const combined = await getManagementKpiDashboard({ range: "custom", from: "2026-10-28", to: "2026-10-28", country: "DE", query: "REQ-1" });
    assert.equal(combined.sales.orders, 0, "free text must not bypass a country filter");
    assert.ok(offsets.includes(5103), "must fetch through an empty terminal page, not assume a short page is complete");
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("management KPIs reject a later failed page instead of returning a partial total", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/master_requests")) return Response.json([]);
    if (Number(url.searchParams.get("offset") || 0) > 0) return new Response("unavailable", { status: 400 });
    return Response.json([{ id: "one", request_id: "REQ-1", created_at: "2026-10-28T10:00:00Z" }]);
  };
  try {
    await assert.rejects(getManagementKpiDashboard({ range: "custom", from: "2026-10-28", to: "2026-10-28" }), /Supabase Anfrage fehlgeschlagen/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
