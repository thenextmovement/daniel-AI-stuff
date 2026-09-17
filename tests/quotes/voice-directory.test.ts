import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { listVoiceDirectory, directoryPhoneDigits } from "../../src/lib/ops/voice-directory";
import { dialPhoneNumber, readPhoneCentralResponse } from "../../src/app/ops/voice-copilot/phone-central-data";
import { GET } from "../../src/app/api/ops/voice-copilot/context/route";
import { middleware } from "../../src/middleware";

const contact = (id: string, phone: string | null, requestId: string | null = null) => ({
  id, name: "Testkontakt " + id, first_name: null, last_name: null, company: null, company_name: null,
  email: "kontakt-" + id + "@example.invalid", phone, original_phone: null, request_id: null,
  requests: requestId ? [{ request_id: requestId, title: "Synthetischer Vorgang" }] : [],
});
async function fixture(rows: unknown[], run: (requests: URL[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const before = { ...process.env };
  const requests: URL[] = [];
  try {
    process.env.SUPABASE_URL = "https://directory.example.invalid";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-only";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(url.origin, "https://directory.example.invalid");
      assert.equal(url.pathname, "/rest/v1/master_customers");
      assert.equal(init?.method || "GET", "GET");
      assert.equal(init?.cache, "no-store");
      assert.ok(init?.signal);
      return new Response(JSON.stringify(rows), {headers: {"content-type": "application/json"}});
    }) as typeof fetch;
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}

test("directory returns contacts without a request and does not load external dossiers", async () => {
  await fixture([contact("one", "+4930123456"), contact("two", null, "request-two")], async requests => {
    const result = await listVoiceDirectory("");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].customerId, "one");
    assert.equal(result.results[0].requestId, null);
    assert.equal(result.results[1].requestId, "request-two");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].searchParams.get("requests.limit"), "1");
    assert.match(requests[0].searchParams.get("select")!, /requests_customer_id_fkey/);
    assert.equal(requests[0].searchParams.get("limit"), "21");
    assert.equal(result.nextOffset, null);
  });
});

test("directory matches domestic, +49, 0049 and formatted phones without merging contacts", async () => {
  const rows = [
    contact("one", "030 123 4567", "request-one"),
    contact("two", "+49 (30) 123-4567", "request-two"),
    contact("three", "0049 30 1234567"),
    contact("wrong", "+49 30 12934567"),
  ];
  for (const query of ["0301234567", "+49 30 1234567", "0049301234567", "+49 (0)30 1234567"]) {
    await fixture(rows, async requests => {
      const result = await listVoiceDirectory(query);
      assert.deepEqual(result.results.map(row => row.customerId), ["one","two","three"], query);
      assert.equal(requests.length, 1);
      assert.match(requests[0].searchParams.get("or")!, /phone\.ilike/);
    });
  }
  assert.equal(directoryPhoneDigits("+44 20 123456"), "4420123456");
});

test("directory uses original phone for lookup but dials the current phone only", async () => {
  await fixture([{...contact("one", "+49305555555"), original_phone:"0301234567"}], async () => {
    const result = await listVoiceDirectory("0301234567");
    assert.equal(result.results[0].phone, "+49305555555");
  });
});

test("directory paginates contacts and preserves the next page after candidate filtering", async () => {
  await fixture(Array.from({length:21}, (_,i) => contact(String(i), "+49301234567")), async requests => {
    const result = await listVoiceDirectory("",20);
    assert.equal(result.results.length,20);
    assert.equal(result.nextOffset,40);
    assert.equal(requests[0].searchParams.get("offset"),"20");
  });
});

test("directory treats email, name and filter punctuation as literal data", async () => {
  await fixture([], async requests => {
    await listVoiceDirectory('a"),id.neq.0');
    const filter = requests[0].searchParams.get("or")!;
    assert.ok(filter.includes('name.ilike."*a\\"),id.neq.0*"'));
    assert.ok(filter.includes("email.ilike."));
    assert.ok(filter.includes("company.ilike."));
  });
});

test("directory rejects invalid pagination and ignores one-character/wildcard-only searches", async () => {
  await fixture([], async requests => {
    await assert.rejects(() => listVoiceDirectory("",-1));
    await assert.rejects(() => listVoiceDirectory("",1.5));
    await assert.rejects(() => listVoiceDirectory("a".repeat(161)));
    assert.deepEqual(await listVoiceDirectory("x"), {results:[],nextOffset:null});
    assert.deepEqual(await listVoiceDirectory("***"), {results:[],nextOffset:null});
    assert.equal(requests.length,0);
  });
});

test("directory context route keeps JSON and no-store and uses one Supabase read", async () => {
  await fixture([contact("one", "+4930123456")], async requests => {
    (process.env as Record<string,string|undefined>).NODE_ENV = "development";
    const response = await GET(new NextRequest("http://localhost/api/ops/voice-copilot/context?directory=1", {headers:{host:"localhost"}}));
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    assert.equal((await response.json()).results[0].customerId,"one");
    assert.equal(requests.length,1);
  });
});

test("directory path remains behind existing production session middleware", async () => {
  await fixture([], async requests => {
    (process.env as Record<string,string|undefined>).NODE_ENV = "production";
    process.env.OPS_PORTAL_TOKEN = "synthetic-test-only";
    delete process.env.OPS_CLOUDFLARE_ACCESS_ISSUER;
    delete process.env.OPS_CLOUDFLARE_ACCESS_TEAM_DOMAIN;
    const response = await middleware(new NextRequest("https://ops.example.invalid/api/ops/voice-copilot/context?directory=1", {headers:{host:"ops.example.invalid"}}));
    assert.equal(response.status,401);
    assert.deepEqual(await response.json(),{ok:false,error:"unauthorized"});
    assert.equal(requests.length,0);
  });
});

test("HTML gateway failures and malformed responses never become empty successful searches", async () => {
  const message = "Suche nicht erreichbar";
  await assert.rejects(() => readPhoneCentralResponse(new Response("<!DOCTYPE html><title>Bad gateway</title>", {status:502}), message), new RegExp(message));
  await assert.rejects(() => readPhoneCentralResponse(new Response("<html>proxy</html>", {status:200}), message), new RegExp(message));
  await assert.rejects(() => readPhoneCentralResponse(new Response('{"ok":false}', {status:200}), message), new RegExp(message));
  await assert.rejects(() => readPhoneCentralResponse(new Response("{}", {status:401}), message), /Sitzung/);
  assert.deepEqual(await readPhoneCentralResponse(new Response('{"ok":true,"results":[]}'),message),{ok:true,results:[]});
});

test("dial pad allows ordinary phone numbers but rejects control sequences and URL injection", () => {
  assert.equal(dialPhoneNumber("030 123-4567"), "0301234567");
  assert.equal(dialPhoneNumber("+49 (30) 1234567"), "+49301234567");
  assert.equal(dialPhoneNumber("+49 (0)30 1234567"), "+49301234567");
  for (const value of ["", "+", "112", "*21*123456#", "123456;ext=1", "javascript:123456", "+49+30123456", "1".repeat(16)]) {
    assert.equal(dialPhoneNumber(value),null,value);
  }
});

test("directory database failure stays an explicit JSON failure, not zero contacts", async () => {
  await fixture([], async () => {
    (process.env as Record<string,string|undefined>).NODE_ENV = "development";
    globalThis.fetch = (async () => new Response('{"code":"fixture_failure"}', {status:400})) as typeof fetch;
    const response = await GET(new NextRequest("http://localhost/api/ops/voice-copilot/context?directory=1", {headers:{host:"localhost"}}));
    assert.equal(response.status,502);
    assert.deepEqual(await response.json(),{ok:false,error:"voice_data_unavailable"});
  });
});

test("bound customer lookup retrieves the exact SSOT contact without a request or telephone search",async()=>{
 const id="29500000-0000-4000-8000-000000000301";
 await fixture([contact(id,"+493055501234")],async requests=>{
  (process.env as Record<string,string|undefined>).NODE_ENV="development";
  const response=await GET(new NextRequest("http://localhost/api/ops/voice-copilot/context?directory=1&customerId="+id,{headers:{host:"localhost"}}));
  assert.equal(response.status,200);assert.equal((await response.json()).results[0].customerId,id);
  assert.equal(requests.length,1);assert.equal(requests[0].searchParams.get("id"),"eq."+id);
  assert.equal(requests[0].searchParams.get("limit"),"1");assert.equal(requests[0].searchParams.has("or"),false);
 });
});
test("bound customer lookup rejects filter injection and never returns another identity",async()=>{
 const id="29500000-0000-4000-8000-000000000301";
 await fixture([contact("29500000-0000-4000-8000-000000000302","+493055501234")],async requests=>{
  await assert.rejects(()=>listVoiceDirectory("",0,"invalid),id.neq.0"));
  assert.equal(requests.length,0);
  assert.deepEqual((await listVoiceDirectory("",0,id)).results,[]);
 });
});
