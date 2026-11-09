import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildShippingNotificationEmail, type ClaimedShippingNotificationRow } from '../../src/lib/ops/shipping-notifications';
// @ts-ignore MJS workflow builder is exercised against its live baseline.
import { buildCustomerWarningWorkflow, NODE_ID } from '../../scripts/build_shipping_customer_warning_workflow.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('../../n8n/backups/2026-11-09-shipping-customer-warning/active-before.json', import.meta.url), 'utf8'));
const candidate = buildCustomerWarningWorkflow(baseline);
const code = candidate.nodes.find((n: any) => n.id === NODE_ID).parameters.jsCode;
function row(overrides: Partial<ClaimedShippingNotificationRow> = {}): ClaimedShippingNotificationRow {
  return { notification_id:'notice',notification_key:'internal:delivery_problem:incident',kind:'internal_delivery_problem',
    recipient_type:'customer',recipient_email:'customer@example.com',attempts:1,shipment_id:'shipment',incident_id:'incident',
    shipment_key:'shipment',shopify_order_number:'#NEONT1234',request_id:null,customer_name:'Alex Example',
    customer_email:'customer@example.com',carrier:'dhl',tracking_number:'1234567890',
    tracking_url:'https://www.dhl.com/us-en/home/tracking.html?tracking-id=1234567890',status:'delivery_failed',
    incident_type:'delivery_failed',incident_title:'Zustellung fehlgeschlagen',incident_description:null,incident_severity:'urgent',
    latest_event_time:'2026-11-09T11:46:00Z',latest_event_location:'Kehlen',latest_event_status_text:'No response',...overrides };
}
function renderN8n(value: ClaimedShippingNotificationRow, source = code) {
  return vm.runInNewContext('(function(){' + source + '})()', {$input:{all:()=>[{json:value}]}});
}
test('only the notification renderer changes; all send nodes, credentials, triggers and connections remain identical',()=>{
  const expected=structuredClone(baseline);
  expected.nodes.find((n:any)=>n.id===NODE_ID).parameters.jsCode=code;
  assert.deepEqual(candidate,expected);
  assert.throws(()=>buildCustomerWarningWorkflow({...baseline,activeVersionId:'other'}));
});
test('customer warning contains Mika photo/logo, clear action and costs; n8n matches the API exactly',()=>{
  const value=row(), mail=buildShippingNotificationEmail(value), actual=renderN8n(value)[0].json;
  assert.equal(actual.to,mail.recipientEmail); assert.equal(actual.subject,mail.subject); assert.equal(actual.bodyHtml,mail.bodyHtml);
  assert.equal(actual.route,'customer'); assert.match(mail.bodyHtml,/möglichst noch heute/);
  assert.match(mail.bodyHtml,/zusätzliche Transportkosten/); assert.match(mail.bodyHtml,/verzögern Ihre Lieferung/);
  assert.match(mail.bodyHtml,/Mika Zangane/); assert.match(mail.bodyHtml,/Mika_3.jpg/); assert.match(mail.bodyHtml,/weiss_logo_NEONTRIP.png/);
  assert.doesNotMatch(mail.bodyHtml,/Fabienne|intern pruefen|Kosten in Höhe|berechnen wir/);
});
test('returning and returned use status-specific actions without promising another delivery',()=>{
  for (const [incident_type,status] of [['return_to_sender','returning'],['returned','returned']]) {
    const value=row({incident_type,status}), mail=buildShippingNotificationEmail(value);
    assert.equal(renderN8n(value)[0].json.bodyHtml,mail.bodyHtml);
    assert.match(mail.bodyHtml,status==='returning'?/ob die Rücksendung noch gestoppt werden kann/:/Bitte antworten Sie zeitnah/);
    assert.doesNotMatch(mail.bodyHtml,/möglichst noch heute/);
  }
});
test('rejects incorrect/internal/multiple recipients, obsolete state, missing tracking and any retry',()=>{
  const bad: Partial<ClaimedShippingNotificationRow>[]=[
    {recipient_type:'internal'},{recipient_email:'info@neontrip.de'},{recipient_email:'x@neontrip.test'},
    {recipient_email:'other@example.com'},{recipient_email:'a,b@example.com',customer_email:'a,b@example.com'},
    {recipient_email:'a;b@example.com',customer_email:'a;b@example.com'},
    {recipient_email:''},{status:'delivered'},{incident_type:'stale_in_transit'},{tracking_number:null},
    {attempts:0},{attempts:2},{tracking_number:'parcel\nInjected'}
  ];
  for(const change of bad) { assert.throws(()=>buildShippingNotificationEmail(row(change))); assert.throws(()=>renderN8n(row(change))); }
});
test('escapes customer data and only includes official HTTPS tracking links',()=>{
  const mail=buildShippingNotificationEmail(row({customer_name:'<script> Alex',shopify_order_number:'#<bad>',tracking_number:'<&123'}));
  assert.doesNotMatch(mail.bodyHtml,/<script>|#<bad>/); assert.match(mail.bodyHtml,/&lt;script&gt;/);
  for(const tracking_url of ['javascript:alert(1)','https://dhl.com.evil.test/x','https://user@dhl.com/x','https://dhl.com\\@evil.test/x','https://evil.test/']) {
    assert.doesNotMatch(buildShippingNotificationEmail(row({tracking_url})).bodyHtml,/Sendungsverfolgung öffnen/);
  }
  assert.match(buildShippingNotificationEmail(row()).bodyHtml,/Sendungsverfolgung öffnen/);
});
test('pickup mail and its route are unchanged byte for byte',()=>{
  const value=row({kind:'customer_pickup_available',status:'pickup_available',incident_type:'pickup_available'});
  const old=renderN8n(value,baseline.nodes.find((n:any)=>n.id===NODE_ID).parameters.jsCode)[0].json;
  assert.deepEqual(JSON.parse(JSON.stringify(renderN8n(value)[0].json)),JSON.parse(JSON.stringify(old)));
});
