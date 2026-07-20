import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as claimPrintJob } from "../../src/app/api/internal/arrival-labels/print-jobs/claim/route";
import { POST as updatePrintJob } from "../../src/app/api/internal/arrival-labels/print-jobs/[jobId]/result/route";

const TOKEN = "print-worker-test-token-32-characters-long";
const WORKER_ID = "office-worker-01";

function request(path: string, body: Record<string, unknown>, token = TOKEN, workerId = WORKER_ID) {
  return new NextRequest(`https://ops.example.invalid${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Neontrip-Print-Worker": workerId,
    },
    body: JSON.stringify(body),
  });
}

async function withPrintEnvironment<T>(run: () => Promise<T>) {
  const previous = {
    token: process.env.ARRIVAL_LABEL_PRINT_API_TOKEN,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch,
  };
  process.env.ARRIVAL_LABEL_PRINT_API_TOKEN = TOKEN;
  process.env.SUPABASE_URL = "https://supabase.example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  try {
    return await run();
  } finally {
    if (previous.token === undefined) delete process.env.ARRIVAL_LABEL_PRINT_API_TOKEN;
    else process.env.ARRIVAL_LABEL_PRINT_API_TOKEN = previous.token;
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
    globalThis.fetch = previous.fetch;
  }
}

test("print claim API rejects missing auth without touching storage", async () => {
  await withPrintEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const response = await claimPrintJob(request(
      "/api/internal/arrival-labels/print-jobs/claim",
      { workerId: WORKER_ID, printerKey: "shipping-a6" },
      "wrong-token",
    ));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(called, false);
  });
});

test("print claim API validates the worker identity before database access", async () => {
  await withPrintEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const response = await claimPrintJob(request(
      "/api/internal/arrival-labels/print-jobs/claim",
      { workerId: "different-worker", printerKey: "shipping-a6" },
    ));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_request");
    assert.equal(called, false);
  });
});

test("print claim API returns an approved queue job with a stable document path", async () => {
  await withPrintEnvironment(async () => {
    let call = 0;
    globalThis.fetch = async (input) => {
      call += 1;
      const url = String(input);
      if (url.includes("arrival_label_product_config")) {
        return Response.json([{
          version: 1,
          enabled: true,
          standard_product_code: "DPD-CLASSIC",
          express_product_mapping: { express: "DPD-EXPRESS-12" },
          eu_product_mapping: { standard: "DPD-EU-CLASSIC" },
          printer_key: "shipping-a6",
          print_media: "A6",
          delivery_note_printer_key: "office-a4",
          delivery_note_print_media: "A4",
        }]);
      }
      if (url.includes("rpc/arrival_labels_claim_print_job")) {
        return Response.json([{
          id: "11111111-1111-4111-8111-111111111111",
          case_id: "22222222-2222-4222-8222-222222222222",
          artifact_id: "33333333-3333-4333-8333-333333333333",
          document_kind: "label",
          idempotency_key: "shopify-order:incoming-dhl:print",
          printer_key: "shipping-a6",
          document_sha256: "a".repeat(64),
          status: "claimed",
          attempts: 1,
          max_attempts: 3,
          lease_owner: WORKER_ID,
          lease_expires_at: "2026-07-20T10:00:00Z",
          cups_job_id: null,
          last_error: null,
        }]);
      }
      throw new Error(`unexpected request ${url}`);
    };
    const response = await claimPrintJob(request(
      "/api/internal/arrival-labels/print-jobs/claim",
      { workerId: WORKER_ID, printerKey: "shipping-a6" },
    ));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.job.documentPath, "/api/internal/arrival-labels/print-jobs/11111111-1111-4111-8111-111111111111/document");
    assert.equal(payload.job.documentKind, "label");
    assert.equal(payload.job.sha256, "a".repeat(64));
    assert.equal(call, 2);
  });
});

test("print claim API also allows the separately approved A4 delivery-note queue", async () => {
  await withPrintEnvironment(async () => {
    let call = 0;
    globalThis.fetch = async (input) => {
      call += 1;
      const url = String(input);
      if (url.includes("arrival_label_product_config")) {
        return Response.json([{
          version: "test-v1",
          enabled: true,
          standard_product_code: "DPD-CLASSIC",
          express_product_mapping: {},
          eu_product_mapping: { standard: "DPD-EU-CLASSIC" },
          printer_key: "shipping-a6",
          print_media: "A6",
          delivery_note_printer_key: "office-a4",
          delivery_note_print_media: "A4",
        }]);
      }
      if (url.includes("rpc/arrival_labels_claim_print_job")) return Response.json([]);
      throw new Error(`unexpected request ${url}`);
    };
    const response = await claimPrintJob(request(
      "/api/internal/arrival-labels/print-jobs/claim",
      { workerId: WORKER_ID, printerKey: "office-a4" },
    ));
    assert.equal(response.status, 204);
    assert.equal(call, 2);
  });
});

test("print claim API rejects a configuration that maps A4 and A6 to the same logical printer", async () => {
  await withPrintEnvironment(async () => {
    let call = 0;
    globalThis.fetch = async (input) => {
      call += 1;
      const url = String(input);
      if (url.includes("arrival_label_product_config")) {
        return Response.json([{
          version: "unsafe-same-printer",
          enabled: true,
          standard_product_code: "DPD-CLASSIC",
          express_product_mapping: {},
          eu_product_mapping: { standard: "DPD-EU-CLASSIC" },
          printer_key: "shipping-a6",
          print_media: "4x6",
          delivery_note_printer_key: "shipping-a6",
          delivery_note_print_media: "A4",
        }]);
      }
      throw new Error(`unexpected request ${url}`);
    };
    const response = await claimPrintJob(request(
      "/api/internal/arrival-labels/print-jobs/claim",
      { workerId: WORKER_ID, printerKey: "shipping-a6" },
    ));
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /getrennt/);
    assert.equal(call, 1);
  });
});

test("print result API rejects malformed status without a downstream call", async () => {
  await withPrintEnvironment(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("must not run"); };
    const response = await updatePrintJob(
      request(
        "/api/internal/arrival-labels/print-jobs/11111111-1111-4111-8111-111111111111/result",
        { workerId: WORKER_ID, result: "print-again" },
      ),
      { params: Promise.resolve({ jobId: "11111111-1111-4111-8111-111111111111" }) },
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_result");
    assert.equal(called, false);
  });
});

test("print claim API hides downstream failure details", async () => {
  await withPrintEnvironment(async () => {
    globalThis.fetch = async () => new Response("contains-sensitive-database-detail", { status: 500 });
    const response = await claimPrintJob(request(
      "/api/internal/arrival-labels/print-jobs/claim",
      { workerId: WORKER_ID, printerKey: "shipping-a6" },
    ));
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.error, "claim_failed");
    assert.doesNotMatch(JSON.stringify(payload), /sensitive-database-detail/);
  });
});
