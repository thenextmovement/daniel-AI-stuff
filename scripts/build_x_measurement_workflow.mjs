import fs from 'node:fs';
const nodes = [], connections = {};
const shopify = { shopifyAccessTokenApi: { id: 'WZah58udMOwKiRR3', name: 'Shopify Access Token account' } };
const worker = { httpHeaderAuth: { id: '52s73ZL3sfST19A8', name: 'NEONTRIP Billing Worker' } };
const oauth = { oAuth1Api: { id: 'o8ZFzyjOQTAPdXXa', name: 'NEONTRIP X Ads Conversion API' } };
function node(id, name, type, parameters, extra = {}) {
  const n = { id, name, type: 'n8n-nodes-base.'+type, typeVersion: type === 'httpRequest' ? 4.2 : type === 'if' ? 2.2 : type === 'code' ? 2 : type === 'scheduleTrigger' ? 1.2 : 1, position: [nodes.length*240, 240], parameters, ...extra };
  nodes.push(n); return name;
}
function link(source, target, branch = 0) {
  const main = (connections[source] ??= { main: [] }).main;
  while (main.length <= branch) main.push([]);
  main[branch].push({ node: target, type: 'main', index: 0 });
}
function http(id, name, parameters, credentials, extra = {}) {
  return node(id, name, 'httpRequest', { ...parameters, options: { timeout: 20000, ...parameters.options } }, { credentials, ...extra });
}
function internal(id, name, jsonBody) {
  return http(id,name,{ method:'POST',url:'https://ops.neontrip.de/api/internal/measurement/x',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody },worker);
}
function gate(id, name, expression) {
  return node(id,name,'if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:id+'-condition',leftValue:expression,rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
}
const manual = node('x-access-check','Check X Access Only','manualTrigger',{}, {position:[0,0]});
const access = http('x-account-access','Read X Account Access',{url:'https://ads-api.x.com/12/accounts/18ce55xv4u4/authenticated_user_access',authentication:'genericCredentialType',genericAuthType:'oAuth1Api'},oauth,{position:[240,0]});
link(manual,access);
const schedule = node('x-schedule','Reconcile Every Five Minutes','scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:5}]}});
const pending = internal('x-pending','Check Pending Contexts','={{ { action: "pending" } }}');
const needed = gate('x-needed','Has Pending Contexts','={{ $json.pending === true }}');
const orders = http('x-orders','Read Paid Order Associations',{
  url:'={{ "https://galaxybuzzdk.myshopify.com/admin/api/2026-07/orders.json?status=any&financial_status=paid&limit=250&fields=id,checkout_token&updated_at_min=" + encodeURIComponent($now.minus({days:30}).toISO()) }}',
  authentication:'predefinedCredentialType',nodeCredentialType:'shopifyAccessTokenApi',
  options:{response:{response:{fullResponse:true,responseFormat:'json'}},pagination:{pagination:{paginationMode:'responseContainsNextURL',nextURL:'={{ (($response.headers.link || "").match(/<([^>]+)>; rel="next"/) || ["", ""])[1] }}',paginationCompleteWhen:'other',completeExpression:'={{ !$response.headers.link || !$response.headers.link.includes(\'rel="next"\') }}',limitPagesFetched:true,maxRequests:20,requestInterval:600}}}
},shopify);
const bundle = node('x-bundle','Validate Association Pages','code',{jsCode:'const pages = $input.all().map(i => i.json);\nif (pages.some(p => p.statusCode !== 200 || !Array.isArray(p.body?.orders))) throw new Error("Shopify association read failed");\nif ((pages.at(-1)?.headers?.link || "").includes(\'rel="next"\')) throw new Error("Shopify pagination incomplete");\nreturn [{json:{action:"associate",orders:pages.flatMap(p=>p.body.orders.map(o=>({id:String(o.id),checkout_token:o.checkout_token})))}}];'});
const associate = internal('x-associate','Associate Consented Checkouts','={{ $json }}');
const claim = internal('x-claim','Claim One Purchase','={{ { action: "claim" } }}');
const hasJob = gate('x-has-job','Has Claimed Purchase','={{ Boolean($json.job) }}');
const order = http('x-order','Read Canonical Shopify Order',{
  url:'={{ "https://galaxybuzzdk.myshopify.com/admin/api/2026-07/orders/" + $json.job.order_id + ".json?fields=id,checkout_token,financial_status,test,cancelled_at,total_price,currency" }}',authentication:'predefinedCredentialType',nodeCredentialType:'shopifyAccessTokenApi'
},shopify);
const query = 'query XPaymentProof($id: ID!) { order(id: $id) { id displayFinancialStatus test cancelledAt totalPriceSet { shopMoney { amount currencyCode } } totalReceivedSet { shopMoney { amount currencyCode } } transactions(first: 100) { id status kind manualPaymentGateway test processedAt amountSet { shopMoney { amount currencyCode } } } } }';
const payment = http('x-payment','Read Shopify Payment Evidence',{
  method:'POST',url:'https://galaxybuzzdk.myshopify.com/admin/api/2026-07/graphql.json',authentication:'predefinedCredentialType',nodeCredentialType:'shopifyAccessTokenApi',sendBody:true,specifyBody:'json',
  jsonBody:'={{ { query: '+JSON.stringify(query)+', variables: { id: "gid://shopify/Order/" + $("Claim One Purchase").first().json.job.order_id } } }}'
},shopify);
const prepare = internal('x-prepare','Verify Consent and Payment','={{ { action: "prepare", job: $("Claim One Purchase").first().json.job, proof: { rest: $("Read Canonical Shopify Order").first().json.order, graphql: $json } } }}');
const ready = gate('x-ready','Ready to Send','={{ $json.ready === true }}');
const send = http('x-send','Send Paid Conversion to X',{
  method:'POST',url:'https://ads-api.x.com/12/measurement/conversions/rhd4k',authentication:'genericCredentialType',genericAuthType:'oAuth1Api',sendBody:true,specifyBody:'json',jsonBody:'={{ $json.payload }}',
  options:{timeout:15000,response:{response:{fullResponse:true,responseFormat:'json',neverError:true}}}
},oauth,{onError:'continueRegularOutput'});
const receipt = internal('x-receipt','Record X Receipt','={{ { action: "receipt", job: $("Claim One Purchase").first().json.job, response: { statusCode: $json.statusCode || 0, body: { data: $json.body?.data || null, errors: Boolean($json.body?.errors) } } } }}');
for (const [a,b] of [[schedule,pending],[pending,needed],[needed,orders],[orders,bundle],[bundle,associate],[associate,claim],[claim,hasJob],[hasJob,order],[order,payment],[payment,prepare],[prepare,ready],[ready,send],[send,receipt]]) link(a,b);
const workflow = { name:'NEONTRIP X Ads - Conversion Delivery',active:false,nodes,connections,settings:{executionOrder:'v1',timezone:'Europe/Berlin',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,executionTimeout:240,availableInMCP:true} };
fs.mkdirSync('workflows/x-measurement',{recursive:true});
fs.writeFileSync('workflows/x-measurement/conversion-delivery.inactive.json',JSON.stringify(workflow,null,2)+'\n');
