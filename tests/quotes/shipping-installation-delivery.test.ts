import test, { before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareInstallationMail } from "../../src/lib/ops/shipping-installation-documents";
import { installationBodyHash, reserveInstallationDelivery, validateInstallationMessage, checkpointInstallationDelivery } from "../../src/lib/ops/shipping-installation-delivery";

const MAILBOX_ID = "4d977ed3-c401-43e5-ad00-b171a294e787";
const ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const items = [{ id: 1, title: "LED Neonschild Test", quantity: 1 }, { id: 2, title: "Wandmontage Set", quantity: 1 }];
const order = { id: 123, name: "#TEST", email: "synthetic@example.test", line_items: items, fulfillments: [{ id: 456, order_id: 123, status: "success", tracking_numbers: ["parcel-1"], line_items: items }] };
let prepared: Extract<Awaited<ReturnType<typeof prepareInstallationMail>>, { ready: true }>;
let expected: any, draft: any, sent: any;
before(async () => {
const result = await prepareInstallationMail(order, "456");
assert(result.ready);
prepared = result;
expected = {
  subject: prepared.subject, recipient: "synthetic@example.test", bodyHash: installationBodyHash(prepared.bodyHtml),
  notificationKey: prepared.selection.notificationKey, sentFolderId: "sent-folder",
  assetUrls: [...prepared.bodyHtml.matchAll(/<img\b[^>]*src="([^"]+)"/gi)].map(m => m[1]),
  attachments: prepared.graphDraft.attachments.map(a => ({ name: a.name, bytes: Buffer.from(a.contentBytes, "base64").length, sha256: createHash("sha256").update(Buffer.from(a.contentBytes,"base64")).digest("hex") })).sort((a,b) => a.name.localeCompare(b.name)),
};
draft = { ...prepared.graphDraft, id: "immutable-draft", isDraft: true };
sent = { ...draft, isDraft: false, from: {emailAddress:{address:"support@neontrip.de"}}, sender: {emailAddress:{address:"support@neontrip.de"}}, parentFolderId: "sent-folder", internetMessageId: "<synthetic-receipt>", sentDateTime: new Date().toISOString() };
});

test("real PDF content and full text survive Graph wrapping", () => {
  validateInstallationMessage(draft, expected, false);
  validateInstallationMessage({ ...draft, body: {content:`<html><head><style>p { color: black }</style></head><body>${prepared.bodyHtml}</body></html>`} }, expected, false);
  validateInstallationMessage(sent, expected, true);
});
for (const [name, mutate] of Object.entries({
  recipient: (m:any): any => m.toRecipients[0].emailAddress.address = "other@example.test",
  cc: (m:any): any => m.ccRecipients = [{emailAddress:{address:"other@example.test"}}],
  bcc: (m:any): any => m.bccRecipients = [{emailAddress:{address:"other@example.test"}}],
  subject: (m:any): any => m.subject += " changed",
  warning: (m:any): any => m.body.content = m.body.content.replace("Überhitzung", "something else"),
  signatureImage: (m:any): any => m.body.content = m.body.content.replace(expected.assetUrls[0], "https://example.test/replaced.png"),
  header: (m:any): any => m.internetMessageHeaders = [],
  replyTo: (m:any): any => m.replyTo = [],
  missingPDF: (m:any): any => m.attachments.pop(),
  duplicatePDF: (m:any): any => m.attachments.push(m.attachments[0]),
  changedPDF: (m:any): any => m.attachments[0].contentBytes = Buffer.concat([Buffer.from(m.attachments[0].contentBytes,"base64"),Buffer.from("changed")]).toString("base64"),
})) test(`draft rejects ${name} before authorization`, () => {
  const m = structuredClone(draft); mutate(m); assert.throws(() => validateInstallationMessage(m,expected,false));
});
for (const [name, mutate] of Object.entries({
  stillDraft: (m:any): any => m.isDraft = true,
  wrongFolder: (m:any): any => m.parentFolderId = "drafts-folder",
  wrongSender: (m:any): any => m.sender.emailAddress.address = "other@example.test",
  noProviderReceipt: (m:any): any => m.internetMessageId = "",
  noSentTime: (m:any): any => delete m.sentDateTime,
})) test(`receipt rejects ${name}`, () => {
  const m = structuredClone(sent); mutate(m); assert.throws(() => validateInstallationMessage(m,expected,true));
});

async function mockedDb<T>(fn: () => Promise<T>, respond: (url: URL, body: any) => unknown) {
  const old = {fetch:globalThis.fetch,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
  process.env.SUPABASE_URL="https://db.example.test"; process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-test-only";
  globalThis.fetch = async (input,init) => new Response(JSON.stringify(respond(new URL(String(input)), init?.body ? JSON.parse(String(init.body)) : null)),{status:200});
  try { return await fn(); } finally {
    globalThis.fetch=old.fetch;
    if(old.url===undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL=old.url;
    if(old.key===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=old.key;
  }
}
const input = {order,fulfillmentId:"456",mailboxProfile:{id:MAILBOX_ID,mail:"support@neontrip.de"},sentFolderId:"sent-folder"};
test("no confirmed scan or repeated reservation returns no send payload", async () => {
  const result=await mockedDb(()=>reserveInstallationDelivery(input),(url,body)=>{
    assert.equal(url.pathname,"/rest/v1/rpc/shipping_reserve_installation_documents");
    assert.deepEqual(body.p_tracking_numbers,["parcel-1"]); assert.equal(body.p_metadata.expected.bodyHash,expected.bodyHash);
    return [];
  });
  assert.equal(result.ready,false); assert(!("graphDraft" in result));
});
test("only atomic winner gets the complete Graph draft", async () => {
  const result=await mockedDb(()=>reserveInstallationDelivery(input),()=>[{id:ID}]);
  assert.equal(result.ready,true); assert.equal(result.graphDraft?.attachments.length,3); assert(result.owner);
});
test("mailbox mismatch never reserves", async () => {
  await mockedDb(async()=>{await assert.rejects(reserveInstallationDelivery({...input,mailboxProfile:{id:"wrong",mail:"support@neontrip.de"}}),/mailbox_mismatch/);},()=>{throw new Error("must not call DB");});
});
test("unknown/backlit stores review reason without returning a draft", async () => {
  const backlit=structuredClone(order); backlit.line_items[0].title="3D Backlit";
  const result=await mockedDb(()=>reserveInstallationDelivery({...input,order:backlit}),(url,body)=>{
    assert(body.p_metadata.review_reason.includes("backlit_manual_not_cleared")); assert.equal(body.p_metadata.expected,null); return [{id:ID}];
  });
  assert.equal(result.ready,false); assert(!("graphDraft" in result));
});
test("authorize advances only after validated draft and returns one permit", async () => {
  let writes=0;
  const result=await mockedDb(()=>checkpointInstallationDelivery({notificationId:ID,owner:OWNER,message:draft},false),(url,body)=>{
    if(!body)return [{id:ID,status:"pending",metadata:{owner_token:OWNER,expected}}];
    writes++; assert.equal(url.pathname,"/rest/v1/rpc/shipping_authorize_installation_send"); assert.equal(body.p_draft_id,draft.id); return [{status:"sending",provider_message_id:draft.id}];
  });
  assert(result.ready); assert.equal(writes,1);
});
test("replay or wrong owner cannot call authorization", async () => {
  for(const row of [{status:"sending",metadata:{owner_token:OWNER,expected}},{status:"pending",metadata:{owner_token:ID,expected}}]) {
    const result=await mockedDb(()=>checkpointInstallationDelivery({notificationId:ID,owner:OWNER,message:draft},false),(url,body)=>{assert.equal(body,null);return [{id:ID,...row}];});
    assert.equal(result.ready,false);
  }
});
test("sent proof stores receipt, never calls Graph or sends mail", async () => {
  let writes=0;
  const result=await mockedDb(()=>checkpointInstallationDelivery({notificationId:ID,owner:OWNER,message:sent},true),(url,body)=>{
    if(!body)return [{id:ID,status:"sending",metadata:{owner_token:OWNER,expected},provider_message_id:draft.id,claimed_at:new Date().toISOString()}];
    writes++; assert.equal(url.pathname,"/rest/v1/rpc/shipping_complete_installation_send"); assert.equal(body.p_receipt.internetMessageId,sent.internetMessageId); return [{status:"sent",provider_message_id:draft.id}];
  });
  assert.equal(result.status,"sent"); assert.equal(result.ready,false); assert.equal(writes,1);
});

test("singular tracking fallback matches existing Shopify importer", async () => {
  const alternate: any = structuredClone(input);
  alternate.order.email = " synthetic@example.test ";
  alternate.order.fulfillments[0].tracking_numbers = [];
  alternate.order.fulfillments[0].tracking_number = "parcel-1";
  const result = await mockedDb(() => reserveInstallationDelivery(alternate), (url, body) => {
    assert.deepEqual(body.p_tracking_numbers, ["parcel-1"]);
    assert.equal(body.p_recipient, "synthetic@example.test");
    return [{ id: ID }];
  });
  assert.equal(result.ready, true);
});
