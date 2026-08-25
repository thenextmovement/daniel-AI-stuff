import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as scanInsolvencyCases } from "../../src/app/api/internal/ops/dunning/insolvency-scan/route";
import {
  buildDunningInsolvencyIdentity,
  dunningInsolvencyEventKey,
  dunningInsolvencyIdentityHash,
  lookupOfficialInsolvencyPublications,
  parseOfficialInsolvencySearchResult,
} from "../../src/lib/ops/dunning-insolvency";

const companyIdentity = buildDunningInsolvencyIdentity({
  companyName: "Muster GmbH",
  locality: "Viersen",
});

function resultPage(content: string) {
  return `
    <html><head><title>Suchergebnis - Insolvenzbekanntmachungen</title></head>
    <body>
      <h1>Veröffentlichungsübersicht</h1>
      <span id="otx_firmaNachnameValue">Muster GmbH</span>
      <span id="otx_sitzValue">Viersen</span>
      ${content}
    </body></html>
  `;
}

test("the official check identity requires an exact entity and locality", () => {
  assert.deepEqual(companyIdentity, {
    kind: "company",
    companyName: "Muster GmbH",
    firstName: null,
    lastName: null,
    locality: "Viersen",
    complete: true,
  });
  assert.equal(
    buildDunningInsolvencyIdentity({
      firstName: "Max",
      lastName: "Muster",
    }).complete,
    false,
  );
  assert.match(dunningInsolvencyIdentityHash(companyIdentity), /^[a-f0-9]{64}$/);
});

test("event keys are deterministic and change when the review event changes", () => {
  const first = dunningInsolvencyEventKey({
    orderNumber: "#NEONT5000",
    legalReviewDueAt: "2026-08-20T10:00:00.000Z",
    identity: companyIdentity,
  });
  const replay = dunningInsolvencyEventKey({
    orderNumber: "#NEONT5000",
    legalReviewDueAt: "2026-08-20T10:00:00.000Z",
    identity: companyIdentity,
  });
  const changed = dunningInsolvencyEventKey({
    orderNumber: "#NEONT5000",
    legalReviewDueAt: "2026-08-21T10:00:00.000Z",
    identity: companyIdentity,
  });
  assert.equal(first, replay);
  assert.notEqual(first, changed);
});

test("an official no-hit page is stored as no public notice, never as solvent", () => {
  const result = parseOfficialInsolvencySearchResult(
    resultPage('<span id="otx_keineTreffer">Keine Treffer</span>'),
    companyIdentity,
  );
  assert.deepEqual(result, {
    resultCode: "no_public_notice_found",
    matches: [],
    matchCount: 0,
  });
});

test("an exact official publication exposes court and file number", () => {
  const result = parseOfficialInsolvencySearchResult(
    resultPage(`
      <table id="tbl_ergebnis"><tbody><tr>
        <td><span id="tbl_ergebnis:0:otx_datum">25.08.2026</span></td>
        <td><span id="tbl_ergebnis:0:otx_azAkt">91 IN 123/26</span></td>
        <td><span id="tbl_ergebnis:0:otx_Gericht">Amtsgericht Mönchengladbach</span></td>
        <td><span id="tbl_ergebnis:0:otx_schuldner">Muster GmbH</span></td>
        <td><span id="tbl_ergebnis:0:otx_Sitz">Viersen</span></td>
        <td><span id="tbl_ergebnis:0:otx_register">HRB 12345</span></td>
      </tr></tbody></table>
    `),
    companyIdentity,
  );
  assert.equal(result.resultCode, "public_notice_found");
  assert.equal(result.matchCount, 1);
  assert.deepEqual(result.matches[0], {
    publicationDate: "25.08.2026",
    court: "Amtsgericht Mönchengladbach",
    fileNumber: "91 IN 123/26",
    subjectName: "Muster GmbH",
    locality: "Viersen",
    register: "HRB 12345",
  });
});

test("non-exact result rows are marked ambiguous and the echoed query is verified", () => {
  const ambiguous = parseOfficialInsolvencySearchResult(
    resultPage(`
      <table id="tbl_ergebnis"><tbody><tr>
        <td><span id="tbl_ergebnis:0:otx_datum">25.08.2026</span></td>
        <td><span id="tbl_ergebnis:0:otx_azAkt">91 IN 124/26</span></td>
        <td><span id="tbl_ergebnis:0:otx_Gericht">Amtsgericht Düsseldorf</span></td>
        <td><span id="tbl_ergebnis:0:otx_schuldner">Muster Holding GmbH</span></td>
        <td><span id="tbl_ergebnis:0:otx_Sitz">Viersen</span></td>
        <td><span id="tbl_ergebnis:0:otx_register">HRB 54321</span></td>
      </tr></tbody></table>
    `),
    companyIdentity,
  );
  assert.equal(ambiguous.resultCode, "ambiguous_match");
  assert.throws(
    () =>
      parseOfficialInsolvencySearchResult(
        resultPage('<span id="otx_keineTreffer">Keine Treffer</span>').replace(
          "Muster GmbH",
          "Andere GmbH",
        ),
        companyIdentity,
      ),
    /INSOLVENCY_QUERY_ECHO_MISMATCH/,
  );
});

test("the lookup posts only to the fixed official host and carries the exact query", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (!init?.method)
      return new Response(
        '<form id="frm_suche" action="/ap/suche.jsf;session=one">' +
          '<input name="jakarta.faces.ViewState" value="state-one" /></form>',
        {
          status: 200,
          headers: {
            "content-type": "text/html;charset=UTF-8",
            "set-cookie": "JSESSIONID=test; Path=/; Secure",
          },
        },
      );
    return new Response(
      resultPage('<span id="otx_keineTreffer">Keine Treffer</span>'),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  const result = await lookupOfficialInsolvencyPublications(
    companyIdentity,
    fakeFetch,
  );
  assert.equal(result.resultCode, "no_public_notice_found");
  assert.equal(calls.length, 2);
  assert.equal(
    new URL(calls[1]!.url).hostname,
    "neu.insolvenzbekanntmachungen.de",
  );
  const body = calls[1]!.init?.body;
  assert.ok(body instanceof URLSearchParams);
  assert.equal(
    body.get("frm_suche:litx_firmaNachName:text"),
    "Muster GmbH",
  );
  assert.equal(body.get("frm_suche:litx_sitzWohnsitz:text"), "Viersen");
});

test("the internal scan route rejects unauthenticated, wrong-type and oversized requests before data access", async () => {
  const original = {
    ops: process.env.OPS_INTERNAL_API_KEY,
    quote: process.env.QUOTE_INTERNAL_API_TOKEN,
    internal: process.env.INTERNAL_API_KEY,
  };
  const internalTestKey = "ticket-159-" + "internal-test-key-12345";
  try {
    delete process.env.OPS_INTERNAL_API_KEY;
    delete process.env.QUOTE_INTERNAL_API_TOKEN;
    delete process.env.INTERNAL_API_KEY;
    const unauthorized = await scanInsolvencyCases(
      new NextRequest(
        "https://ops.neontrip.de/api/internal/ops/dunning/insolvency-scan",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      ),
    );
    assert.equal(unauthorized.status, 401);

    process.env.OPS_INTERNAL_API_KEY = internalTestKey;
    const wrongType = await scanInsolvencyCases(
      new NextRequest(
        "https://ops.neontrip.de/api/internal/ops/dunning/insolvency-scan",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${internalTestKey}`,
            "content-type": "text/plain",
          },
          body: "{}",
        },
      ),
    );
    assert.equal(wrongType.status, 415);

    const oversized = await scanInsolvencyCases(
      new NextRequest(
        "https://ops.neontrip.de/api/internal/ops/dunning/insolvency-scan",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${internalTestKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ limit: "x".repeat(3000) }),
        },
      ),
    );
    assert.equal(oversized.status, 413);
  } finally {
    if (original.ops === undefined) delete process.env.OPS_INTERNAL_API_KEY;
    else process.env.OPS_INTERNAL_API_KEY = original.ops;
    if (original.quote === undefined)
      delete process.env.QUOTE_INTERNAL_API_TOKEN;
    else process.env.QUOTE_INTERNAL_API_TOKEN = original.quote;
    if (original.internal === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = original.internal;
  }
});
