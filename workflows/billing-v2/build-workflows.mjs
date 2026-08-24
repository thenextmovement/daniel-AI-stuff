import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const generated = path.join(root, "generated");
const easybillCredentials = { httpHeaderAuth: { id: "CONFIGURE_EASYBILL_BEARER", name: "easybill REST API" } };
const opsCredentials = { httpHeaderAuth: { id: "CONFIGURE_BILLING_WORKER_BEARER", name: "NEONTRIP Billing Worker" } };
const shopifyCredentials = { httpHeaderAuth: { id: "CONFIGURE_NEONTRIP_SHOPIFY_ADMIN", name: "NEONTRIP Shopify Admin" } };

function node(id, name, type, position, parameters, extra = {}) {
  return { id, name, type, typeVersion: type === "n8n-nodes-base.httpRequest" ? 4.2 : 2, position, parameters, ...extra };
}

const prepareCode = String.raw`
const claimed = ($json.body ?? $json).claimed;
if (!claimed?.job || !claimed?.billingCase) return [{json:{hasJob:false}}];
const job = claimed.job;
const billingCase = claimed.billingCase;
const originalInvoice = claimed.originalInvoice || null;
const address = billingCase.billing_address || {};
const delivery = billingCase.delivery_address || {};
const customer = billingCase.customer || {};
const aliases = {Deutschland:'DE',Germany:'DE',Österreich:'AT',Oesterreich:'AT',Austria:'AT',Schweiz:'CH',Switzerland:'CH'};
const country = value => { const raw=String(value||'').trim(); return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : aliases[raw] || raw; };
const taxOption = billingCase.tax_treatment === 'EU_B2B_REVERSE_CHARGE' ? 'IG' : billingCase.tax_treatment === 'EXPORT_THIRD_COUNTRY' ? 'AL' : 'NULL';
const documentType = {CREATE_PROFORMA:'PROFORMA_INVOICE',CREATE_INVOICE:'INVOICE',CREATE_CREDIT:'CREDIT',CREATE_CANCELLATION:'STORNO'}[job.job_type];
if (!documentType) throw new Error('unsupported_billing_job_type:' + job.job_type);
const documentNumber = String(job.payload?.documentNumber || '');
if (!/^((PF|GS|ST)-)?NEONT\d+(-\d+)?$/.test(documentNumber.replace(/^#/,''))) throw new Error('invalid_document_number');
const customerNumber = 'NT-' + String(billingCase.shopify_order_name || '').replace(/[^A-Za-z0-9]/g,'');
const name = String(customer.name || address.name || 'Kunde').trim();
const company = String(customer.company || address.company || name).trim();
const names = name.split(/\s+/);
const invoiceEmail = String(billingCase.customer_email || address.invoiceEmail || customer.email || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail) || invoiceEmail.length > 254) throw new Error('billing_invoice_email_invalid');
const projectNumber = String(billingCase.project_number || address.projectNumber || '').trim();
if (projectNumber.length > 100 || /[<>\r\n]/.test(projectNumber)) throw new Error('billing_project_number_invalid');
const configuredVatPercent = Number(billingCase.original_vat_rate ?? billingCase.totals?.originalVatRate);
const effectiveVatPercent = Math.round((Number(billingCase.vat_cents||0) / Math.max(Number(billingCase.subtotal_net_cents||1),1))*10000)/100;
const vatPercent = billingCase.tax_exempt
  ? 0
  : Number.isFinite(configuredVatPercent)
    ? configuredVatPercent
    : billingCase.tax_treatment === 'DE_STANDARD'
      ? 19
      : effectiveVatPercent;
let items = (Array.isArray(billingCase.line_items) ? billingCase.line_items : []).map((item)=>{
  const section = String(item.section||'').trim().toLowerCase();
  const title = String(item.title||'').trim();
  let description = title;
  if (section === 'versand') {
    const normalizedTitle = title.toLowerCase();
    if (normalizedTitle.includes('standardlieferung')) description = 'Standardlieferung';
    else if (normalizedTitle.includes('eilauftrag')) description = 'Eilauftrag';
    else if (normalizedTitle.includes('express')) description = 'Express';
    else description = title;
  }
  return {
    description:description.slice(0,4000),
    quantity:Number(item.normalizedQuantity || item.quantity || 1),
    unit:'Stück',
    single_price_net:Math.round(Number(item.unitPriceNet || 0)*100),
    vat_percent:vatPercent
  };
});
if(job.job_type==='CREATE_CREDIT') {
  if(!originalInvoice?.easybill_document_id) throw new Error('credit_original_invoice_missing');
  const refundLines=Array.isArray(job.payload?.refundLineItems)?job.payload.refundLineItems:[];
  items=refundLines.length?refundLines.map((item)=>({description:String(item.title||item.description||'Erstattung').slice(0,4000),quantity:Number(item.quantity||1),unit:'Stück',single_price_net:Math.round(Number(item.unitPriceNet||item.netAmount||0)*100),vat_percent:Number(item.vatPercent||vatPercent)})):[{description:'Erstattung zu '+String(billingCase.shopify_order_name||''),quantity:1,unit:'Stück',single_price_net:Number(job.payload.netCents||0),vat_percent:Number(job.payload.netCents||0)>0?Math.round((Number(job.payload.vatCents||0)/Number(job.payload.netCents))*10000)/100:0}];
}
if(job.job_type==='CREATE_CANCELLATION'&&!originalInvoice?.easybill_document_id) throw new Error('cancellation_original_invoice_missing');
const dueInDays = billingCase.payment_method === 'KAUF_AUF_RECHNUNG' ? Number(billingCase.payment_terms_days || 14) : 0;
const paymentText = billingCase.payment_method === 'VORKASSE'
  ? 'Zahlbar sofort. Mit unserer Auftragsbestätigung beginnt die Produktion Ihres individuellen Auftrags bereits. Der Auftrag ist verbindlich. Sollte die Zahlung nicht rechtzeitig eingehen, kann die Produktion vor Fertigstellung pausiert werden. Dadurch kann sich der Liefertermin verschieben.'
  : 'Zahlbar innerhalb von ' + dueInDays + ' Tagen nach Erhalt der Ware.';
const documentText = [projectNumber ? 'Projektnummer: ' + projectNumber : '', paymentText].filter(Boolean).join('\n\n');
const documentLabel = documentType==='PROFORMA_INVOICE'?'Pro-forma-Rechnung':documentType==='CREDIT'?'Gutschrift':documentType==='STORNO'?'Stornobeleg':'Rechnung';
const initialProforma = job.job_type === 'CREATE_PROFORMA' && Number(job.payload?.revision || 0) === 0;
const portalUrl = String(job.payload?.portalUrl || '').trim();
if (initialProforma && !/^https:\/\/rechnung\.neontrip\.de\/[A-Za-z0-9_-]+$/.test(portalUrl)) throw new Error('billing_portal_url_missing');
return [{json:{
  hasJob:true,
  job,
  billingCase,
  invoiceEmail,
  projectNumber,
  documentLabel,
  customerNumber,
  customerPayload:{number:customerNumber,company_name:company,last_name:names.slice(-1)[0]||company,first_name:names.slice(0,-1).join(' ')||'',street:String(address.street||''),zip_code:String(address.zip||address.zipCode||''),city:String(address.city||''),country:country(address.country||delivery.country),emails:[invoiceEmail],vat_identifier:billingCase.vat_id||null,tax_options:taxOption,delivery_company_name:String(delivery.company||delivery.contactCompany||company),delivery_first_name:String(delivery.firstName||delivery.contactName||''),delivery_last_name:String(delivery.lastName||''),delivery_street:String(delivery.street||''),delivery_zip_code:String(delivery.zip||delivery.zipCode||''),delivery_city:String(delivery.city||''),delivery_country:country(delivery.country)},
  documentNumber,
  documentPayload:{type:documentType,number:documentNumber,order_number:String(billingCase.shopify_order_name||''),buyer_reference:projectNumber,external_id:job.idempotency_key,currency:billingCase.currency||'EUR',due_in_days:dueInDays,customer_id:null,ref_id:originalInvoice?.easybill_document_id?Number(originalInvoice.easybill_document_id):undefined,items,vat_option:taxOption,vat_country:country(address.country||delivery.country),shipping_country:country(delivery.country),title:documentLabel+' '+String(billingCase.shopify_order_name||''),text:documentText,calc_vat_from:0}
}}];`;

const workflow = {
  name: "NEONTRIP Billing v2 - Easybill Document Worker (INACTIVE)",
  active: false,
  nodes: [
    node("schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-1120, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { typeVersion: 1.3 }),
    node("config", "Billing Worker Config", "n8n-nodes-base.code", [-900, 0], { mode: "runOnceForAllItems", jsCode: "return [{json:{opsBaseUrl:'https://ops.neontrip.de',worker:'n8n-easybill-document-v2'}}];" }),
    node("claim", "Claim Billing Job", "n8n-nodes-base.httpRequest", [-680, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ { worker: $json.worker, jobTypes: ['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION'], leaseSeconds: 180 } }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "continueErrorOutput" }),
    node("normalize", "Prepare Easybill Command", "n8n-nodes-base.code", [-440, -80], { mode: "runOnceForAllItems", jsCode: prepareCode }, { onError: "continueErrorOutput" }),
    node("has-job", "Has Billing Job", "n8n-nodes-base.if", [-220, -80], { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.hasJob }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("find-customer", "Easybill Find Customer", "n8n-nodes-base.httpRequest", [20, -160], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/customers?number=' + encodeURIComponent($json.customerNumber) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("resolve-customer", "Resolve Easybill Customer", "n8n-nodes-base.code", [260, -160], { jsCode: "const ctx=$('Prepare Easybill Command').first().json; const body=$json.body??$json; const rows=Array.isArray(body)?body:(body.items||[]); const match=rows.find(x=>String(x.number||'')===ctx.customerNumber); return [{json:{...ctx,customerId:match?.id||null,createCustomer:!match}}];" }, { onError: "continueErrorOutput" }),
    node("needs-customer", "Create Customer Needed", "n8n-nodes-base.if", [480, -160], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.createCustomer }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("create-customer", "Easybill Create Customer", "n8n-nodes-base.httpRequest", [700, -280], { method: "POST", url: "https://api.easybill.de/rest/v1/customers", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ $json.customerPayload }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("created-customer", "Use Created Customer", "n8n-nodes-base.code", [920, -280], { jsCode: "const ctx=$('Prepare Easybill Command').first().json; const body=$json.body??$json; if(!body.id) throw new Error('easybill_customer_id_missing'); return [{json:{...ctx,customerId:body.id}}];" }, { onError: "continueErrorOutput" }),
    node("update-customer", "Easybill Update Existing Customer", "n8n-nodes-base.httpRequest", [700, -80], { method: "PUT", url: "={{ 'https://api.easybill.de/rest/v1/customers/' + encodeURIComponent($json.customerId) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ $json.customerPayload }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("updated-customer", "Use Updated Customer", "n8n-nodes-base.code", [920, -80], { jsCode: "const ctx=$('Resolve Easybill Customer').first().json;const body=$json.body??$json;return [{json:{...ctx,customerId:body.id||ctx.customerId}}];" }, { onError: "continueErrorOutput" }),
    node("customer-ready", "Customer Ready", "n8n-nodes-base.code", [1040, -120], { jsCode: "if(!$json.customerId) throw new Error('easybill_customer_id_missing'); return [{json:$json}];" }, { onError: "continueErrorOutput" }),
    node("is-cancellation", "Cancellation Job", "n8n-nodes-base.if", [1160, -120], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.job.job_type }}", rightValue: "CREATE_CANCELLATION", operator: { type: "string", operation: "equals" } }], combinator: "and" } }),
    node("load-original-invoice", "Easybill Load Original Invoice", "n8n-nodes-base.httpRequest", [1380, -300], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($json.documentPayload.ref_id) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("prepare-cancellation", "Prepare Cancellation State", "n8n-nodes-base.code", [1600, -300], { jsCode: "const prepared=$('Prepare Easybill Command').all();const ctx=prepared[0]?.json;const original=$json.body??$json;if(!ctx?.job||!original?.id)throw new Error('cancellation_original_invoice_load_failed');const cancelId=original.cancel_id?String(original.cancel_id):'';return [{json:{...ctx,originalEasybillDocument:original,hasExistingCancellation:Boolean(cancelId),easybillDocument:cancelId?{id:cancelId}:null}}];" }, { onError: "continueErrorOutput" }),
    node("has-cancellation", "Original Invoice Already Cancelled", "n8n-nodes-base.if", [1820, -300], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.hasExistingCancellation }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("cancel-invoice", "Easybill Cancel Invoice", "n8n-nodes-base.httpRequest", [2040, -160], { method: "POST", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($json.originalEasybillDocument.id) + '/cancel' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("find-document", "Easybill Find Document", "n8n-nodes-base.httpRequest", [1380, 20], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents?number=' + encodeURIComponent($json.documentNumber) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("resolve-document", "Resolve Existing Document", "n8n-nodes-base.code", [1400, -120], { jsCode: "const ctx=$('Prepare Easybill Command').first().json; const customerId=$('Customer Ready').first().json.customerId; const body=$json.body??$json; const rows=Array.isArray(body)?body:(body.items||[]); const match=rows.find(x=>String(x.number||'')===ctx.documentNumber); return [{json:{...ctx,customerId,existingDocument:match||null,hasExistingDocument:Boolean(match)}}];" }, { onError: "continueErrorOutput" }),
    node("has-document", "Document Already Exists", "n8n-nodes-base.if", [1620, -120], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.hasExistingDocument }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("reuse-document", "Reuse Existing Document", "n8n-nodes-base.code", [1840, -240], { jsCode: "return [{json:{...$json,easybillDocument:$json.existingDocument}}];" }),
    node("existing-draft", "Existing Document Is Draft", "n8n-nodes-base.if", [2050, -240], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.easybillDocument.is_draft }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("create-document", "Easybill Create Document", "n8n-nodes-base.httpRequest", [1840, 20], { method: "POST", url: "https://api.easybill.de/rest/v1/documents", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {...$json.documentPayload, customer_id: $json.customerId} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("done-document", "Easybill Finalize Document", "n8n-nodes-base.httpRequest", [2260, -20], { method: "PUT", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent(($json.easybillDocument||$json.body||$json).id) + '/done' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("load-document", "Easybill Load Finalized Document", "n8n-nodes-base.httpRequest", [2470, -120], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent(($json.easybillDocument||$json.body||$json).id) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("prepare-completion", "Prepare Document Completion", "n8n-nodes-base.code", [2690, -120], { jsCode: "const ctx=$('Prepare Easybill Command').first().json;const doc=$json.body??$json;if(!doc.id||doc.is_draft===true)throw new Error('easybill_document_not_finalized');return [{json:{...ctx,easybillDocument:doc,emailWasAlreadySent:Boolean(doc.last_postbox_id)}}];" }, { onError: "continueErrorOutput" }),
    node("success", "Prepare Successful Completion", "n8n-nodes-base.code", [3130, -120], { jsCode: "const ctx=$('Prepare Document Completion').first().json;const doc=ctx.easybillDocument;if(!doc.id)throw new Error('easybill_document_id_missing');return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-easybill-document-v2',easybillDocumentId:String(doc.id),documentNumber:String(doc.number||ctx.documentNumber),sent:Boolean(ctx.emailWasAlreadySent),recipient:ctx.emailWasAlreadySent?ctx.invoiceEmail:null,projectNumber:ctx.projectNumber||null,emailWasAlreadySent:ctx.emailWasAlreadySent,customerEmailSuppressed:true}}}];" }, { onError: "continueErrorOutput" }),
    node("complete", "Complete Billing Job", "n8n-nodes-base.httpRequest", [3590, -120], { method: "POST", url: "={{ $('Billing Worker Config').first().json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "stopWorkflow" }),
    node("failure", "Prepare Failed Completion", "n8n-nodes-base.code", [1840, 300], { jsCode: "const prepared=$('Prepare Easybill Command').all();const claimedItems=$('Claim Billing Job').all();const claimBody=claimedItems[0]?.json?.body??claimedItems[0]?.json??{};const job=prepared[0]?.json?.job??claimBody.claimed?.job;if(!job?.id||!job?.lease_token)throw new Error('billing_failure_context_missing');const message=String($json.error?.message||$json.message||$json.description||'Easybill adapter failed').slice(0,1800);return [{json:{jobId:job.id,leaseToken:job.lease_token,success:false,result:{worker:'n8n-easybill-document-v2'},error:message}}];" }),
    node("claim-failure", "Raise Claim Error", "n8n-nodes-base.code", [-440, 200], { jsCode: "throw new Error('Fehler Rechnung Shopify/Easybill: Billing-Job konnte nicht abgeholt werden.');" }),
    node("blocked", "Raise Urgent Billing Error", "n8n-nodes-base.code", [3820, -120], { jsCode: "const body=$json.body??$json; if(body.completed?.status==='BLOCKED'||body.completed?.billingCaseStatus==='SYNC_BLOCKED') throw new Error('Fehler Rechnung Shopify/Easybill: Job nach vier Versuchen blockiert. Bitte Ops-Rechnungsabteilung prüfen.'); return [{json:{ok:true,status:body.completed?.status||'DONE'}}];" })
  ],
  connections: {
    "Every Minute": { main: [[{ node: "Billing Worker Config", type: "main", index: 0 }]] },
    "Billing Worker Config": { main: [[{ node: "Claim Billing Job", type: "main", index: 0 }]] },
    "Claim Billing Job": { main: [[{ node: "Prepare Easybill Command", type: "main", index: 0 }], [{ node: "Raise Claim Error", type: "main", index: 0 }]] },
    "Prepare Easybill Command": { main: [[{ node: "Has Billing Job", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Has Billing Job": { main: [[{ node: "Easybill Find Customer", type: "main", index: 0 }], []] },
    "Easybill Find Customer": { main: [[{ node: "Resolve Easybill Customer", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Resolve Easybill Customer": { main: [[{ node: "Create Customer Needed", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Create Customer Needed": { main: [[{ node: "Easybill Create Customer", type: "main", index: 0 }], [{ node: "Easybill Update Existing Customer", type: "main", index: 0 }]] },
    "Easybill Create Customer": { main: [[{ node: "Use Created Customer", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Use Created Customer": { main: [[{ node: "Customer Ready", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Update Existing Customer": { main: [[{ node: "Use Updated Customer", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Use Updated Customer": { main: [[{ node: "Customer Ready", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Customer Ready": { main: [[{ node: "Cancellation Job", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Cancellation Job": { main: [[{ node: "Easybill Load Original Invoice", type: "main", index: 0 }], [{ node: "Easybill Find Document", type: "main", index: 0 }]] },
    "Easybill Load Original Invoice": { main: [[{ node: "Prepare Cancellation State", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Prepare Cancellation State": { main: [[{ node: "Original Invoice Already Cancelled", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Original Invoice Already Cancelled": { main: [[{ node: "Easybill Load Finalized Document", type: "main", index: 0 }], [{ node: "Easybill Cancel Invoice", type: "main", index: 0 }]] },
    "Easybill Cancel Invoice": { main: [[{ node: "Easybill Load Finalized Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Find Document": { main: [[{ node: "Resolve Existing Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Resolve Existing Document": { main: [[{ node: "Document Already Exists", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Document Already Exists": { main: [[{ node: "Reuse Existing Document", type: "main", index: 0 }], [{ node: "Easybill Create Document", type: "main", index: 0 }]] },
    "Reuse Existing Document": { main: [[{ node: "Existing Document Is Draft", type: "main", index: 0 }]] },
    "Existing Document Is Draft": { main: [[{ node: "Easybill Finalize Document", type: "main", index: 0 }], [{ node: "Easybill Load Finalized Document", type: "main", index: 0 }]] },
    "Easybill Create Document": { main: [[{ node: "Easybill Finalize Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Finalize Document": { main: [[{ node: "Easybill Load Finalized Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Load Finalized Document": { main: [[{ node: "Prepare Document Completion", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Prepare Document Completion": { main: [[{ node: "Prepare Successful Completion", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Prepare Successful Completion": { main: [[{ node: "Complete Billing Job", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Prepare Failed Completion": { main: [[{ node: "Complete Billing Job", type: "main", index: 0 }]] },
    "Complete Billing Job": { main: [[{ node: "Raise Urgent Billing Error", type: "main", index: 0 }], []] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", availableInMCP: false },
  versionId: "neontrip-billing-v2-easybill-document-worker-inactive"
};

function intakeWorkflow({ name, versionId, code, endpoint }) {
  return {
    name,
    active: false,
    nodes: [
      node("trigger", "Called by Existing Source Workflow", "n8n-nodes-base.executeWorkflowTrigger", [-420, 0], { inputSource: "passthrough" }),
      node("validate", "Validate Financial Event", "n8n-nodes-base.code", [-180, 0], { mode: "runOnceForAllItems", jsCode: code }),
      node("post", "Record in BillingCase", "n8n-nodes-base.httpRequest", [80, 0], { method: "POST", url: `={{ String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'') + '${endpoint}' }}`, authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ $json }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "continueErrorOutput" }),
      node("error", "Raise Billing Intake Error", "n8n-nodes-base.code", [320, 160], { jsCode: "throw new Error('Fehler Rechnung Shopify/Easybill: Financial Event konnte nicht in Ops gespeichert werden.');" })
    ],
    connections: {
      "Called by Existing Source Workflow": { main: [[{ node: "Validate Financial Event", type: "main", index: 0 }]] },
      "Validate Financial Event": { main: [[{ node: "Record in BillingCase", type: "main", index: 0 }]] },
      "Record in BillingCase": { main: [[], [{ node: "Raise Billing Intake Error", type: "main", index: 0 }]] }
    },
    settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", callerPolicy: "workflowsFromSameOwner", availableInMCP: false },
    versionId
  };
}

const shopifyEventWorkflow = intakeWorkflow({
  name: "NEONTRIP Billing v2 - Shopify Event Adapter (INACTIVE)",
  versionId: "neontrip-billing-v2-shopify-event-adapter-inactive",
  endpoint: "/api/internal/billing/shopify/events",
  code: "const x=$input.first()?.json||{}; const allowed=new Set(['ORDER_DELIVERED','ORDER_CANCELLED','REFUND_CREATED']); const ints=['amountCents','netCents','vatCents']; if(!x.shopifyOrderId||!x.eventId||!allowed.has(x.eventType)||ints.some(k=>!Number.isSafeInteger(Number(x[k]||0)))) throw new Error('invalid_shopify_billing_event'); if(x.eventType==='ORDER_DELIVERED'&&x.allLineItemsDelivered!==true) throw new Error('shopify_order_not_fully_delivered'); if(x.eventType==='REFUND_CREATED'&&Number(x.amountCents)!==Number(x.netCents)+Number(x.vatCents)) throw new Error('refund_cents_mismatch'); return [{json:{...x,source:'shopify',eventId:String(x.eventId)}}];"
});

const paymentWorkflow = intakeWorkflow({
  name: "NEONTRIP Billing v2 - Payment Match Adapter (INACTIVE)",
  versionId: "neontrip-billing-v2-payment-match-adapter-inactive",
  endpoint: "/api/internal/billing/payments",
  code: "const x=$input.first()?.json||{}; if(!x.shopifyOrderId||!x.provider||!x.providerTransactionId||!x.sourceEventId||!Number.isSafeInteger(Number(x.amountCents))||Number(x.amountCents)<=0||!/^[A-Z]{3}$/.test(String(x.currency||''))||!Number.isFinite(Date.parse(String(x.bookedAt||'')))) throw new Error('invalid_payment_match'); return [{json:x}];"
});

const paymentProjectionWorkflow = {
  name: "NEONTRIP Billing v2 - Payment Projection Worker (INACTIVE)",
  active: false,
  nodes: [
    node("projection-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-900, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { typeVersion: 1.3 }),
    node("projection-config", "Projection Worker Config", "n8n-nodes-base.code", [-700, 0], { jsCode: "const base=String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,''); if(!/^https:\\/\\//.test(base)) throw new Error('NEONTRIP_OPS_BASE_URL missing'); return [{json:{opsBaseUrl:base,worker:'n8n-payment-projection-v2'}}];" }),
    node("projection-claim", "Claim Projection Job", "n8n-nodes-base.httpRequest", [-500, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("projection-normalize", "Normalize Projection Job", "n8n-nodes-base.code", [-280, 0], { jsCode: "const claimed=($json.body??$json).claimed; if(!claimed?.job) return []; return [{json:{...claimed,job:claimed.job,billingCase:claimed.billingCase}}];" }),
    node("projection-route", "Easybill Payment", "n8n-nodes-base.if", [-60, 0], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.job.job_type }}", rightValue: "PROJECT_PAYMENT_EASYBILL", operator: { type: "string", operation: "equals" } }], combinator: "and" } }),
    node("easybill-payment", "Easybill Record Payment", "n8n-nodes-base.httpRequest", [180, -120], { method: "POST", url: "https://api.easybill.de/rest/v1/document-payments", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {document_id:Number($json.job.payload.documentId),amount:Number($json.job.payload.amountCents),payment_at:String($json.job.payload.paidAt).slice(0,10),type:'BANK_TRANSFER',provider:'NEONTRIP Billing v2',reference:$json.billingCase.shopify_order_name} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("shopify-query", "Shopify Read Payment State", "n8n-nodes-base.httpRequest", [180, 120], { method: "POST", url: "https://galaxybuzzdk.myshopify.com/admin/api/2026-07/graphql.json", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {query:'query BillingPaymentState($id: ID!) { order(id:$id) { id name canMarkAsPaid displayFinancialStatus } }',variables:{id:$json.billingCase.shopify_order_id}} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: shopifyCredentials, onError: "continueErrorOutput" }),
    node("shopify-decision", "Decide Shopify Payment", "n8n-nodes-base.code", [420, 120], { jsCode: "const ctx=$('Normalize Projection Job').first().json; const order=($json.body??$json).data?.order; if(!order) throw new Error('shopify_order_missing'); if(order.displayFinancialStatus==='PAID') return [{json:{...ctx,alreadyDone:true}}]; if(order.canMarkAsPaid!==true) throw new Error('shopify_order_cannot_mark_paid'); return [{json:{...ctx,alreadyDone:false}}];" }, { onError: "continueErrorOutput" }),
    node("shopify-needed", "Shopify Mutation Needed", "n8n-nodes-base.if", [640, 120], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.alreadyDone }}", rightValue: false, operator: { type: "boolean", operation: "false", singleValue: true } }], combinator: "and" } }),
    node("shopify-paid", "Shopify Mark Order Paid", "n8n-nodes-base.httpRequest", [860, 40], { method: "POST", url: "https://galaxybuzzdk.myshopify.com/admin/api/2026-07/graphql.json", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {query:'mutation BillingMarkPaid($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input:$input) { order { id displayFinancialStatus } userErrors { field message } } }',variables:{input:{id:$json.billingCase.shopify_order_id}}} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: shopifyCredentials, onError: "continueErrorOutput" }),
    node("projection-success", "Prepare Projection Success", "n8n-nodes-base.code", [1100, -40], { jsCode: "const ctx=$('Normalize Projection Job').first().json; const body=$json.body??$json; const errors=body.data?.orderMarkAsPaid?.userErrors||[]; if(errors.length) throw new Error('shopify_mark_paid:'+errors.map(x=>x.message).join(';')); return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-payment-projection-v2',projection:ctx.job.job_type}}}];" }, { onError: "continueErrorOutput" }),
    node("projection-failure", "Prepare Projection Failure", "n8n-nodes-base.code", [860, 300], { jsCode: "const ctx=$('Normalize Projection Job').first().json; return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:false,result:{worker:'n8n-payment-projection-v2'},error:String($json.error?.message||$json.message||'payment_projection_failed').slice(0,1800)}}];" }),
    node("projection-complete", "Complete Projection Job", "n8n-nodes-base.httpRequest", [1340, -40], { method: "POST", url: "={{ $('Projection Worker Config').first().json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("projection-blocked", "Raise Projection Block", "n8n-nodes-base.code", [1560, -40], { jsCode: "const body=$json.body??$json;if(body.completed?.status==='BLOCKED')throw new Error('Fehler Rechnung Shopify/Easybill: Zahlungsprojektion blockiert.');return [{json:{ok:true}}];" })
  ],
  connections: {
    "Every Minute": { main: [[{ node: "Projection Worker Config", type: "main", index: 0 }]] },
    "Projection Worker Config": { main: [[{ node: "Claim Projection Job", type: "main", index: 0 }]] },
    "Claim Projection Job": { main: [[{ node: "Normalize Projection Job", type: "main", index: 0 }]] },
    "Normalize Projection Job": { main: [[{ node: "Easybill Payment", type: "main", index: 0 }]] },
    "Easybill Payment": { main: [[{ node: "Easybill Record Payment", type: "main", index: 0 }], [{ node: "Shopify Read Payment State", type: "main", index: 0 }]] },
    "Easybill Record Payment": { main: [[{ node: "Prepare Projection Success", type: "main", index: 0 }], [{ node: "Prepare Projection Failure", type: "main", index: 0 }]] },
    "Shopify Read Payment State": { main: [[{ node: "Decide Shopify Payment", type: "main", index: 0 }], [{ node: "Prepare Projection Failure", type: "main", index: 0 }]] },
    "Decide Shopify Payment": { main: [[{ node: "Shopify Mutation Needed", type: "main", index: 0 }], [{ node: "Prepare Projection Failure", type: "main", index: 0 }]] },
    "Shopify Mutation Needed": { main: [[{ node: "Shopify Mark Order Paid", type: "main", index: 0 }], [{ node: "Prepare Projection Success", type: "main", index: 0 }]] },
    "Shopify Mark Order Paid": { main: [[{ node: "Prepare Projection Success", type: "main", index: 0 }], [{ node: "Prepare Projection Failure", type: "main", index: 0 }]] },
    "Prepare Projection Success": { main: [[{ node: "Complete Projection Job", type: "main", index: 0 }], [{ node: "Prepare Projection Failure", type: "main", index: 0 }]] },
    "Prepare Projection Failure": { main: [[{ node: "Complete Projection Job", type: "main", index: 0 }]] },
    "Complete Projection Job": { main: [[{ node: "Raise Projection Block", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", availableInMCP: false },
  versionId: "neontrip-billing-v2-payment-projection-worker-inactive"
};

const shopifyTaxPrepareCode = String.raw`
const claimed = ($json.body ?? $json).claimed;
if (!claimed?.job || !claimed?.billingCase) return [{json:{hasJob:false}}];
const job = claimed.job;
const billingCase = claimed.billingCase;
if (job.job_type !== 'SYNC_SHOPIFY_TAX') throw new Error('shopify_tax_sync_job_type_invalid');
if (!/^gid:\/\/shopify\/Order\/\d+$/.test(String(billingCase.shopify_order_id || ''))) throw new Error('shopify_tax_sync_order_id_invalid');
if (!/^#NEONT\d+$/.test(String(billingCase.shopify_order_name || ''))) throw new Error('shopify_tax_sync_order_name_invalid');
if (!['EU_B2B_REVERSE_CHARGE','EU_B2C_OSS','DE_STANDARD','EXPORT_THIRD_COUNTRY'].includes(String(billingCase.tax_treatment || ''))) throw new Error('shopify_tax_sync_treatment_invalid');
return [{json:{hasJob:true,job,billingCase}}];`;

const shopifyTaxAnalyzeCode = String.raw`
const ctx = $('Prepare Shopify Tax Sync').first().json;
const body = $json.body ?? $json;
if (Array.isArray(body.errors) && body.errors.length) throw new Error('shopify_tax_sync_read_graphql:' + body.errors.map(x=>x.message).join(';'));
const order = body.data?.order;
if (!order || order.id !== ctx.billingCase.shopify_order_id || order.name !== ctx.billingCase.shopify_order_name) throw new Error('shopify_tax_sync_order_identity_mismatch');
const cents = value => Math.round(Number(value || 0) * 100);
const expectedTotalCents = Number(ctx.billingCase.total_gross_cents);
const expectedTaxCents = Number(ctx.billingCase.vat_cents);
if (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents <= 0 || !Number.isSafeInteger(expectedTaxCents) || expectedTaxCents < 0) throw new Error('shopify_tax_sync_expected_totals_invalid');
const currentTotalCents = cents(order.currentTotalPriceSet?.shopMoney?.amount);
const currentTaxCents = cents(order.totalTaxSet?.shopMoney?.amount);
const taxExempt = ctx.billingCase.tax_exempt === true;
if (taxExempt && expectedTaxCents !== 0) throw new Error('shopify_tax_sync_tax_exempt_case_has_tax');
const requiresEdit = currentTotalCents !== expectedTotalCents || currentTaxCents !== expectedTaxCents;
if (requiresEdit && !taxExempt) throw new Error('shopify_tax_sync_gross_order_total_mismatch_manual_review');
const activeLines = (order.lineItems?.nodes || []).filter(line => Number(line.currentQuantity) > 0);
if (requiresEdit) {
  if (!['PENDING','AUTHORIZED'].includes(String(order.displayFinancialStatus || '')) || String(order.displayFulfillmentStatus || '') !== 'UNFULFILLED') throw new Error('shopify_tax_sync_order_paid_or_fulfilled');
  if (!activeLines.length || activeLines.length > 100 || activeLines.some(line => Number(line.unfulfilledQuantity) !== Number(line.currentQuantity))) throw new Error('shopify_tax_sync_order_paid_or_fulfilled');
}
const caseLines = (Array.isArray(ctx.billingCase.line_items) ? ctx.billingCase.line_items : []).map((line,index)=>{
  const title = String(line.title || '').trim().slice(0,255);
  const quantity = Number(line.normalizedQuantity || line.quantity || 1);
  const unitPriceCents = Math.round(Number(line.unitPriceNet || 0) * 100);
  if (!title || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000 || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new Error('shopify_tax_sync_line_invalid:' + index);
  return {title,quantity,unitPriceCents,requiresShipping:true};
});
if (!caseLines.length || caseLines.length > 50) throw new Error('shopify_tax_sync_line_count_invalid');
const expectedSubtotalCents = Number(ctx.billingCase.subtotal_net_cents);
const calculatedSubtotalCents = caseLines.reduce((sum,line)=>sum + line.quantity * line.unitPriceCents,0);
if (requiresEdit && calculatedSubtotalCents !== expectedSubtotalCents) throw new Error('shopify_tax_sync_line_subtotal_mismatch');
const customerId = String(order.customer?.id || '');
if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) throw new Error('shopify_tax_sync_customer_missing');
const address = value => {
  const x=value||{};
  const name=String(x.name||x.contactName||'').trim().split(/\s+/).filter(Boolean);
  const countryAliases={Deutschland:'DE',Germany:'DE',Österreich:'AT',Oesterreich:'AT',Austria:'AT',Schweiz:'CH',Switzerland:'CH'};
  const rawCountry=String(x.countryCode||x.country||'').trim();
  const countryCode=/^[A-Za-z]{2}$/.test(rawCountry)?rawCountry.toUpperCase():countryAliases[rawCountry];
  const result={address1:String(x.street||x.address1||'').trim(),city:String(x.city||'').trim(),zip:String(x.zip||x.zipCode||'').trim(),countryCode,company:String(x.company||x.contactCompany||'').trim()||undefined,firstName:String(x.firstName||name.slice(0,-1).join(' ')||'').trim()||undefined,lastName:String(x.lastName||name.slice(-1)[0]||'').trim()||undefined};
  if (!result.address1 || !result.city || !result.zip || !result.countryCode) throw new Error('shopify_tax_sync_address_invalid');
  return result;
};
const exemptions = taxExempt && ctx.billingCase.tax_treatment === 'EU_B2B_REVERSE_CHARGE' ? ['EU_REVERSE_CHARGE_EXEMPTION_RULE'] : [];
const deliveryChange = ctx.job.payload?.deliveryAddressChange;
const formatAddress = value => {
  const x=value||{};
  const person=[x.firstName,x.lastName].filter(Boolean).join(' ')||x.name||x.contactName;
  return [x.company||x.contactCompany,person,x.street||x.address1,[x.zip||x.zipCode,x.city].filter(Boolean).join(' '),x.countryCode||x.country].filter(Boolean).map(v=>String(v).trim()).join(', ').slice(0,700);
};
let orderNote=String(order.note||'');
if(deliveryChange?.changeRequestId){
  const marker='[NEONTRIP-LIEFERADRESSE:'+String(deliveryChange.changeRequestId)+']';
  if(!orderNote.includes(marker)){
    const instructions=String(deliveryChange.next?.deliveryInstructions||'').trim().slice(0,500);
    const divider='────────────────────────────────';
    const block=[divider,'● LIEFERADRESSE GEÄNDERT',divider,'Vorher:','  '+formatAddress(deliveryChange.previous),'Neu:','  '+formatAddress(deliveryChange.next),...(instructions?['Lieferhinweis:','  '+instructions]:[]),divider,marker].join('\\n');
    orderNote=(block+(orderNote?'\\n\\n'+orderNote:'')).slice(0,5000);
  }
}
return [{json:{...ctx,order,customerId,requiresEdit,expectedTotalCents,expectedTaxCents,caseLines,activeLines,customerMutation:{query:'mutation BillingSyncCustomerTax($customer: CustomerInput!, $customerId: ID!, $exemptions: [TaxExemption!]!, $order: OrderInput!) { replace: customerReplaceTaxExemptions(customerId:$customerId,taxExemptions:$exemptions) { customer { id taxExempt taxExemptions } userErrors { field message } } customerUpdate(input:$customer) { customer { id taxExempt taxExemptions } userErrors { field message } } orderUpdate(input:$order) { order { id note } userErrors { field message } } }',variables:{customerId,exemptions,customer:{id:customerId,taxExempt},order:{id:order.id,note:orderNote,billingAddress:address(ctx.billingCase.billing_address),shippingAddress:address(ctx.billingCase.delivery_address)}}}}}];`;

const shopifyTaxCheckCustomerCode = String.raw`
const ctx=$('Analyze Shopify Order').first().json;
const body=$json.body??$json;
if(Array.isArray(body.errors)&&body.errors.length)throw new Error('shopify_tax_sync_customer_graphql:'+body.errors.map(x=>x.message).join(';'));
for(const key of ['replace','customerUpdate','orderUpdate']){const errors=body.data?.[key]?.userErrors||[];if(errors.length)throw new Error('shopify_tax_sync_'+key+':'+errors.map(x=>x.message).join(';'));}
return [{json:ctx}];`;

const shopifyTaxBuildStageCode = String.raw`
const ctx=$('Analyze Shopify Order').first().json;
const body=$json.body??$json;
if(Array.isArray(body.errors)&&body.errors.length)throw new Error('shopify_tax_sync_begin_graphql:'+body.errors.map(x=>x.message).join(';'));
const started=body.data?.orderEditBegin;
const errors=started?.userErrors||[];
if(errors.length)throw new Error('shopify_tax_sync_begin:'+errors.map(x=>x.message).join(';'));
const calculatedOrderId=String(started?.calculatedOrder?.id||'');
const calculatedLines=started?.calculatedOrder?.calculatedLineItems?.nodes||[];
if(!/^gid:\/\/shopify\/CalculatedOrder\/\d+$/.test(calculatedOrderId)||!calculatedLines.length)throw new Error('shopify_tax_sync_calculated_order_invalid');
const declarations=['$id:ID!'];
const fields=[];
const variables={id:calculatedOrderId};
calculatedLines.forEach((line,index)=>{const key='remove'+index;declarations.push('$'+key+':ID!');variables[key]=line.id;fields.push(key+':orderEditSetQuantity(id:$id,lineItemId:$'+key+',quantity:0,restock:false){userErrors{field message}}');});
ctx.caseLines.forEach((line,index)=>{const title='title'+index,price='price'+index,quantity='quantity'+index;declarations.push('$'+title+':String!','$'+price+':MoneyInput!','$'+quantity+':Int!');variables[title]=line.title;variables[price]={amount:(line.unitPriceCents/100).toFixed(2),currencyCode:String(ctx.billingCase.currency||'EUR')};variables[quantity]=line.quantity;fields.push('add'+index+':orderEditAddCustomItem(id:$id,title:$'+title+',price:$'+price+',quantity:$'+quantity+',requiresShipping:true,taxable:false){userErrors{field message}}');});
return [{json:{...ctx,calculatedOrderId,stageMutation:{query:'mutation BillingStageTaxSync('+declarations.join(',')+'){'+fields.join(' ')+'}',variables}}}];`;

const shopifyTaxValidateStageCode = String.raw`
const ctx=$('Build Shopify Tax Edit').first().json;
const body=$json.body??$json;
if(Array.isArray(body.errors)&&body.errors.length)throw new Error('shopify_tax_sync_stage_graphql:'+body.errors.map(x=>x.message).join(';'));
for(const [key,value] of Object.entries(body.data||{})){const errors=value?.userErrors||[];if(errors.length)throw new Error('shopify_tax_sync_stage_'+key+':'+errors.map(x=>x.message).join(';'));}
return [{json:ctx}];`;

const shopifyTaxValidatePreviewCode = String.raw`
const ctx=$('Build Shopify Tax Edit').first().json;
const body=$json.body??$json;
if(Array.isArray(body.errors)&&body.errors.length)throw new Error('shopify_tax_sync_preview_graphql:'+body.errors.map(x=>x.message).join(';'));
const calculated=body.data?.node;
const cents=value=>Math.round(Number(value||0)*100);
const total=cents(calculated?.totalPriceSet?.shopMoney?.amount);
const tax=cents(calculated?.totalTaxSet?.shopMoney?.amount);
if(total!==ctx.expectedTotalCents||tax!==ctx.expectedTaxCents)throw new Error('shopify_tax_sync_total_mismatch:expected='+ctx.expectedTotalCents+'/'+ctx.expectedTaxCents+',actual='+total+'/'+tax);
return [{json:ctx}];`;

const shopifyTaxValidateCommitCode = String.raw`
const ctx=$('Build Shopify Tax Edit').first().json;
const body=$json.body??$json;
if(Array.isArray(body.errors)&&body.errors.length)throw new Error('shopify_tax_sync_commit_graphql:'+body.errors.map(x=>x.message).join(';'));
const result=body.data?.orderEditCommit;
const errors=result?.userErrors||[];
if(errors.length)throw new Error('shopify_tax_sync_commit:'+errors.map(x=>x.message).join(';'));
const cents=value=>Math.round(Number(value||0)*100);
const total=cents(result?.order?.currentTotalPriceSet?.shopMoney?.amount);
const tax=cents(result?.order?.totalTaxSet?.shopMoney?.amount);
if(total!==ctx.expectedTotalCents||tax!==ctx.expectedTaxCents)throw new Error('shopify_tax_sync_total_mismatch:expected='+ctx.expectedTotalCents+'/'+ctx.expectedTaxCents+',actual='+total+'/'+tax);
return [{json:{...ctx,verifiedTotalCents:total,verifiedTaxCents:tax}}];`;

const shopifyTaxSyncWorkflow = {
  name:"NEONTRIP Billing v2 - Shopify Tax Sync Worker (INACTIVE)",active:false,
  nodes:[
    node("tax-sync-schedule","Every Minute","n8n-nodes-base.scheduleTrigger",[-1180,0],{rule:{interval:[{field:"minutes",minutesInterval:1}]}},{typeVersion:1.3}),
    node("tax-sync-config","Shopify Tax Sync Config","n8n-nodes-base.code",[-980,0],{jsCode:"const base=String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{opsBaseUrl:base,worker:'n8n-shopify-tax-sync-v2'}}];"}),
    node("tax-sync-claim","Claim Shopify Tax Sync Job","n8n-nodes-base.httpRequest",[-780,0],{method:"POST",url:"={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ {worker:$json.worker,jobTypes:['SYNC_SHOPIFY_TAX'],leaseSeconds:300} }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:opsCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-prepare","Prepare Shopify Tax Sync","n8n-nodes-base.code",[-560,0],{jsCode:shopifyTaxPrepareCode},{onError:"continueErrorOutput"}),
    node("tax-sync-has-job","Has Shopify Tax Sync Job","n8n-nodes-base.if",[-340,0],{conditions:{options:{typeValidation:"strict"},conditions:[{leftValue:"={{ $json.hasJob }}",rightValue:true,operator:{type:"boolean",operation:"true",singleValue:true}}],combinator:"and"}}),
    node("tax-sync-read","Read Shopify Order","n8n-nodes-base.httpRequest",[-120,-80],{method:"POST",url:"https://galaxybuzzdk.myshopify.com/admin/api/2026-10/graphql.json",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ {query:'query BillingTaxSyncOrder($id:ID!){order(id:$id){id name note displayFinancialStatus displayFulfillmentStatus customer{id} currentTotalPriceSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}} lineItems(first:100){nodes{id title currentQuantity unfulfilledQuantity}}}}',variables:{id:$json.billingCase.shopify_order_id}} }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:shopifyCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-analyze","Analyze Shopify Order","n8n-nodes-base.code",[100,-80],{jsCode:shopifyTaxAnalyzeCode},{onError:"continueErrorOutput"}),
    node("tax-sync-customer","Sync Shopify Customer and Addresses","n8n-nodes-base.httpRequest",[320,-80],{method:"POST",url:"https://galaxybuzzdk.myshopify.com/admin/api/2026-10/graphql.json",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ $json.customerMutation }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:shopifyCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-check-customer","Check Shopify Customer Sync","n8n-nodes-base.code",[540,-80],{jsCode:shopifyTaxCheckCustomerCode},{onError:"continueErrorOutput"}),
    node("tax-sync-required","Shopify Order Edit Required","n8n-nodes-base.if",[760,-80],{conditions:{options:{typeValidation:"strict"},conditions:[{leftValue:"={{ $json.requiresEdit }}",rightValue:true,operator:{type:"boolean",operation:"true",singleValue:true}}],combinator:"and"}}),
    node("tax-sync-begin","Begin Shopify Order Edit","n8n-nodes-base.httpRequest",[980,-160],{method:"POST",url:"https://galaxybuzzdk.myshopify.com/admin/api/2026-10/graphql.json",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ {query:'mutation BillingBeginTaxSync($id:ID!){orderEditBegin(id:$id){calculatedOrder{id calculatedLineItems(first:100){nodes{id quantity}}} userErrors{field message}}}',variables:{id:$json.billingCase.shopify_order_id}} }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:shopifyCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-build-edit","Build Shopify Tax Edit","n8n-nodes-base.code",[1200,-160],{jsCode:shopifyTaxBuildStageCode},{onError:"continueErrorOutput"}),
    node("tax-sync-stage","Stage Shopify Tax Edit","n8n-nodes-base.httpRequest",[1420,-160],{method:"POST",url:"https://galaxybuzzdk.myshopify.com/admin/api/2026-10/graphql.json",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ $json.stageMutation }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:shopifyCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-validate-stage","Validate Shopify Tax Edit","n8n-nodes-base.code",[1640,-160],{jsCode:shopifyTaxValidateStageCode},{onError:"continueErrorOutput"}),
    node("tax-sync-preview","Read Shopify Tax Edit Preview","n8n-nodes-base.httpRequest",[1860,-160],{method:"POST",url:"https://galaxybuzzdk.myshopify.com/admin/api/2026-10/graphql.json",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ {query:'query BillingTaxSyncPreview($id:ID!){node(id:$id){... on CalculatedOrder{id totalPriceSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}}}}}',variables:{id:$json.calculatedOrderId}} }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:shopifyCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-validate-preview","Validate Shopify Tax Preview","n8n-nodes-base.code",[2080,-160],{jsCode:shopifyTaxValidatePreviewCode},{onError:"continueErrorOutput"}),
    node("tax-sync-commit","Commit Shopify Tax Edit","n8n-nodes-base.httpRequest",[2300,-160],{method:"POST",url:"https://galaxybuzzdk.myshopify.com/admin/api/2026-10/graphql.json",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ {query:'mutation BillingCommitTaxSync($id:ID!,$note:String!){orderEditCommit(id:$id,notifyCustomer:false,staffNote:$note){order{id name currentTotalPriceSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}}} userErrors{field message}}}',variables:{id:$json.calculatedOrderId,note:'NEONTRIP Billing: bestätigte Rechnungs- und Steuerdaten synchronisiert'}} }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:shopifyCredentials,onError:"continueErrorOutput"}),
    node("tax-sync-validate-commit","Validate Shopify Tax Commit","n8n-nodes-base.code",[2520,-160],{jsCode:shopifyTaxValidateCommitCode},{onError:"continueErrorOutput"}),
    node("tax-sync-success","Prepare Shopify Tax Sync Success","n8n-nodes-base.code",[2740,-40],{jsCode:"const ctx=$json.billingCase?$json:$('Analyze Shopify Order').first().json;return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,opsBaseUrl:$('Shopify Tax Sync Config').first().json.opsBaseUrl,success:true,result:{worker:'n8n-shopify-tax-sync-v2',shopifyOrderId:ctx.billingCase.shopify_order_id,totalCents:Number(ctx.expectedTotalCents),taxCents:Number(ctx.expectedTaxCents),customerEmailSuppressed:true}}}];"},{onError:"continueErrorOutput"}),
    node("tax-sync-failure","Prepare Shopify Tax Sync Failure","n8n-nodes-base.code",[1420,240],{jsCode:"const prepared=$('Prepare Shopify Tax Sync').all().find(x=>x.json?.job)?.json;const analyzed=$('Analyze Shopify Order').all().find(x=>x.json?.job)?.json;const ctx=analyzed||prepared;if(!ctx?.job)throw new Error('shopify_tax_sync_failure_without_job');return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,opsBaseUrl:$('Shopify Tax Sync Config').first().json.opsBaseUrl,success:false,result:{worker:'n8n-shopify-tax-sync-v2'},error:String($json.error?.message||$json.message||'shopify_tax_sync_failed').slice(0,1800)}}];"}),
    node("tax-sync-complete","Complete Shopify Tax Sync Job","n8n-nodes-base.httpRequest",[2960,-40],{method:"POST",url:"={{ $json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}",authentication:"genericCredentialType",genericAuthType:"httpHeaderAuth",sendBody:true,specifyBody:"json",jsonBody:"={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}",options:{timeout:30000,response:{response:{fullResponse:true,responseFormat:"json"}}}},{credentials:opsCredentials,onError:"stopWorkflow"}),
    node("tax-sync-blocked","Raise Shopify Tax Sync Block","n8n-nodes-base.code",[3180,-40],{jsCode:"const body=$json.body??$json;if(body.completed?.status==='BLOCKED')throw new Error('Fehler Rechnung Shopify/Easybill: Shopify-Steuerabgleich blockiert.');return [{json:{ok:true}}];"})
  ],
  connections:{
    "Every Minute":{main:[[{node:"Shopify Tax Sync Config",type:"main",index:0}]]},
    "Shopify Tax Sync Config":{main:[[{node:"Claim Shopify Tax Sync Job",type:"main",index:0}]]},
    "Claim Shopify Tax Sync Job":{main:[[{node:"Prepare Shopify Tax Sync",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Prepare Shopify Tax Sync":{main:[[{node:"Has Shopify Tax Sync Job",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Has Shopify Tax Sync Job":{main:[[{node:"Read Shopify Order",type:"main",index:0}],[]]},
    "Read Shopify Order":{main:[[{node:"Analyze Shopify Order",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Analyze Shopify Order":{main:[[{node:"Sync Shopify Customer and Addresses",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Sync Shopify Customer and Addresses":{main:[[{node:"Check Shopify Customer Sync",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Check Shopify Customer Sync":{main:[[{node:"Shopify Order Edit Required",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Shopify Order Edit Required":{main:[[{node:"Begin Shopify Order Edit",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Success",type:"main",index:0}]]},
    "Begin Shopify Order Edit":{main:[[{node:"Build Shopify Tax Edit",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Build Shopify Tax Edit":{main:[[{node:"Stage Shopify Tax Edit",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Stage Shopify Tax Edit":{main:[[{node:"Validate Shopify Tax Edit",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Validate Shopify Tax Edit":{main:[[{node:"Read Shopify Tax Edit Preview",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Read Shopify Tax Edit Preview":{main:[[{node:"Validate Shopify Tax Preview",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Validate Shopify Tax Preview":{main:[[{node:"Commit Shopify Tax Edit",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Commit Shopify Tax Edit":{main:[[{node:"Validate Shopify Tax Commit",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Validate Shopify Tax Commit":{main:[[{node:"Prepare Shopify Tax Sync Success",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Prepare Shopify Tax Sync Success":{main:[[{node:"Complete Shopify Tax Sync Job",type:"main",index:0}],[{node:"Prepare Shopify Tax Sync Failure",type:"main",index:0}]]},
    "Prepare Shopify Tax Sync Failure":{main:[[{node:"Complete Shopify Tax Sync Job",type:"main",index:0}]]},
    "Complete Shopify Tax Sync Job":{main:[[{node:"Raise Shopify Tax Sync Block",type:"main",index:0}],[]]}
  },
  settings:{executionOrder:"v1",timezone:"Europe/Berlin",saveDataErrorExecution:"all",saveDataSuccessExecution:"all",errorWorkflow:"M4uG1HAtN9Zggxww",availableInMCP:false},
  versionId:"neontrip-billing-v2-shopify-tax-sync-worker-inactive"
};

const vatReviewWorkflow = {
  name: "NEONTRIP Billing v2 - VAT Review Alert Worker (INACTIVE)", active: false,
  nodes: [
    node("vat-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-760, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { typeVersion: 1.3 }),
    node("vat-config", "VAT Review Config", "n8n-nodes-base.code", [-560, 0], { jsCode: "const base=String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{opsBaseUrl:base,worker:'n8n-vat-review-alert-v2'}}];" }),
    node("vat-claim", "Claim VAT Review Job", "n8n-nodes-base.httpRequest", [-340, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['VERIFY_VAT'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("vat-prepare", "Prepare VAT Review Alert", "n8n-nodes-base.code", [-100, 0], { jsCode: "const claimed=($json.body??$json).claimed;if(!claimed?.job||!claimed?.billingCase)return [];const c=claimed.billingCase;const v=c.vat_validation||{};const clean=x=>String(x??'').replace(/[\\r\\n]+/g,' ').slice(0,500);const ops=String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'')+'/ops/rechnungen?caseId='+encodeURIComponent(c.id);const message=['Umsatzsteuer-ID passt nicht zur Firma – Bitte prüfen',`Auftrag: ${clean(c.shopify_order_name)}`,`Ops-Fall: ${ops}`,`USt-ID: ${clean(c.vat_id)}`,`Prüfstatus: checked=${v.checked===true}, valid=${v.valid===true}, comparison=${clean(v.identityComparison||'UNAVAILABLE')}`,`Bei VIES gelistete Firma: ${clean(v.name||'nicht geliefert')}`,`Registeranschrift: ${clean(v.address||'nicht geliefert')}`,'Nächster Schritt: Daten mit VIES vergleichen, bei Bedarf Kundennachweis anfordern und den Fall in Ops ausdrücklich als netto oder brutto freigeben.','Offizielle Prüfung: https://ec.europa.eu/taxation_customs/vies/#/vat-validation','Produktion und Lieferung bleiben möglich; nur die finale steuerfreie Rechnung bleibt gesperrt.'].join(' | ');return [{json:{jobId:claimed.job.id,leaseToken:claimed.job.lease_token,opsBaseUrl:String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,''),message,result:{worker:'n8n-vat-review-alert-v2',alertPrepared:true,shopifyOrderName:c.shopify_order_name}}}];" }),
    node("vat-complete", "Complete VAT Review Job", "n8n-nodes-base.httpRequest", [160, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:true,result:$json.result} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("vat-alert", "Send VAT Review Through Error Mail", "n8n-nodes-base.code", [420, 0], { jsCode: "throw new Error($('Prepare VAT Review Alert').first().json.message);" })
  ],
  connections: {
    "Every Minute": { main: [[{ node: "VAT Review Config", type: "main", index: 0 }]] },
    "VAT Review Config": { main: [[{ node: "Claim VAT Review Job", type: "main", index: 0 }]] },
    "Claim VAT Review Job": { main: [[{ node: "Prepare VAT Review Alert", type: "main", index: 0 }]] },
    "Prepare VAT Review Alert": { main: [[{ node: "Complete VAT Review Job", type: "main", index: 0 }]] },
    "Complete VAT Review Job": { main: [[{ node: "Send VAT Review Through Error Mail", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", availableInMCP: false },
  versionId: "neontrip-billing-v2-vat-review-alert-worker-inactive"
};

const proformaVoidWorkflow = {
  name: "NEONTRIP Billing v2 - Easybill Proforma Void Worker (INACTIVE)", active: false,
  nodes: [
    node("void-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-760, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { typeVersion: 1.3 }),
    node("void-config", "Void Worker Config", "n8n-nodes-base.code", [-560, 0], { jsCode: "const base=String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{opsBaseUrl:base,worker:'n8n-easybill-proforma-void-v2'}}];" }),
    node("void-claim", "Claim Proforma Void Job", "n8n-nodes-base.httpRequest", [-340, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['VOID_PROFORMA'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("void-prepare", "Prepare Proforma Void", "n8n-nodes-base.code", [-100, 0], { jsCode: "const claimed=($json.body??$json).claimed;if(!claimed?.job)return [];const id=String(claimed.job.payload?.easybillDocumentId||'');if(!/^\\d+$/.test(id))throw new Error('easybill_proforma_id_missing');return [{json:{...claimed,job:claimed.job,easybillDocumentId:id,opsBaseUrl:String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'')}}];" }, { onError: "continueErrorOutput" }),
    node("void-easybill", "Easybill Cancel Proforma", "n8n-nodes-base.httpRequest", [160, -80], { method: "POST", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($json.easybillDocumentId) + '/cancel' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("void-success", "Prepare Void Success", "n8n-nodes-base.code", [400, -80], { jsCode: "const ctx=$('Prepare Proforma Void').first().json;return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,opsBaseUrl:ctx.opsBaseUrl,success:true,result:{worker:'n8n-easybill-proforma-void-v2',easybillDocumentId:ctx.easybillDocumentId,cancelDocumentId:String(($json.body??$json).id||'')}}}];" }),
    node("void-failure", "Prepare Void Failure", "n8n-nodes-base.code", [400, 160], { jsCode: "const ctx=$('Prepare Proforma Void').first().json;return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,opsBaseUrl:ctx.opsBaseUrl,success:false,result:{worker:'n8n-easybill-proforma-void-v2'},error:String($json.error?.message||$json.message||'easybill_proforma_void_failed').slice(0,1800)}}];" }),
    node("void-complete", "Complete Proforma Void Job", "n8n-nodes-base.httpRequest", [660, -40], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("void-blocked", "Raise Proforma Void Block", "n8n-nodes-base.code", [900, -40], { jsCode: "const body=$json.body??$json;if(body.completed?.status==='BLOCKED')throw new Error('Fehler Rechnung Shopify/Easybill: Pro-forma konnte in Easybill nicht storniert werden.');return [{json:{ok:true}}];" })
  ],
  connections: {
    "Every Minute": { main: [[{ node: "Void Worker Config", type: "main", index: 0 }]] },
    "Void Worker Config": { main: [[{ node: "Claim Proforma Void Job", type: "main", index: 0 }]] },
    "Claim Proforma Void Job": { main: [[{ node: "Prepare Proforma Void", type: "main", index: 0 }]] },
    "Prepare Proforma Void": { main: [[{ node: "Easybill Cancel Proforma", type: "main", index: 0 }], [{ node: "Prepare Void Failure", type: "main", index: 0 }]] },
    "Easybill Cancel Proforma": { main: [[{ node: "Prepare Void Success", type: "main", index: 0 }], [{ node: "Prepare Void Failure", type: "main", index: 0 }]] },
    "Prepare Void Success": { main: [[{ node: "Complete Proforma Void Job", type: "main", index: 0 }]] },
    "Prepare Void Failure": { main: [[{ node: "Complete Proforma Void Job", type: "main", index: 0 }]] },
    "Complete Proforma Void Job": { main: [[{ node: "Raise Proforma Void Block", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", availableInMCP: false },
  versionId: "neontrip-billing-v2-easybill-proforma-void-worker-inactive"
};

const shopifyOrderIntakeWorkflow = {
  name: "NEONTRIP Billing v2 - Shopify Order Intake Adapter (INACTIVE)", active: false,
  nodes: [
    node("order-trigger", "Called by Shopify Order Source", "n8n-nodes-base.executeWorkflowTrigger", [-420, 0], { inputSource: "passthrough" }),
    node("order-sign", "Validate and Sign BillingCase", "n8n-nodes-base.code", [-180, 0], { jsCode: "const x=$input.first()?.json||{};if(!x.sourceEventId||!x.shopifyOrderId||!/^#NEONT\\d+$/.test(String(x.shopifyOrderName||''))||!Array.isArray(x.lineItems)||!x.lineItems.length||!x.totals||!x.billingAddress||!x.deliveryAddress)throw new Error('invalid_shopify_order_billing_intake');const secret=String($env.BILLING_WEBHOOK_SECRET||'');if(secret.length<32)throw new Error('BILLING_WEBHOOK_SECRET missing');const payload={...x,source:'shopify',sourceEventId:String(x.sourceEventId)};const body=JSON.stringify(payload);const timestamp=String(Math.floor(Date.now()/1000));const {createHmac}=require('crypto');const signature='sha256='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');const base=String($env.NEONTRIP_OPS_BASE_URL||'https://ops.neontrip.de').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{body,timestamp,signature,eventId:String(x.sourceEventId),url:base+'/api/internal/billing/cases'}}];" }),
    node("order-post", "Create BillingCase", "n8n-nodes-base.httpRequest", [80, 0], { method: "POST", url: "={{ $json.url }}", sendHeaders: true, headerParameters: { parameters: [{ name: "X-Neontrip-Timestamp", value: "={{ $json.timestamp }}" }, { name: "X-Neontrip-Signature", value: "={{ $json.signature }}" }, { name: "X-Neontrip-Event-Id", value: "={{ $json.eventId }}" }] }, sendBody: true, contentType: "raw", rawContentType: "application/json", body: "={{ $json.body }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { onError: "continueErrorOutput" }),
    node("order-error", "Raise Shopify Intake Error", "n8n-nodes-base.code", [320, 160], { jsCode: "throw new Error('Fehler Rechnung Shopify/Easybill: Shopify-Bestellung konnte nicht als BillingCase angelegt werden.');" })
  ],
  connections: {
    "Called by Shopify Order Source": { main: [[{ node: "Validate and Sign BillingCase", type: "main", index: 0 }]] },
    "Validate and Sign BillingCase": { main: [[{ node: "Create BillingCase", type: "main", index: 0 }]] },
    "Create BillingCase": { main: [[], [{ node: "Raise Shopify Intake Error", type: "main", index: 0 }]] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", callerPolicy: "workflowsFromSameOwner", availableInMCP: false },
  versionId: "neontrip-billing-v2-shopify-order-intake-adapter-inactive"
};

fs.mkdirSync(generated, { recursive: true });
fs.writeFileSync(path.join(generated, "easybill-document-worker-v2.inactive.json"), JSON.stringify(workflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "shopify-event-adapter-v2.inactive.json"), JSON.stringify(shopifyEventWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "payment-match-adapter-v2.inactive.json"), JSON.stringify(paymentWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "payment-projection-worker-v2.inactive.json"), JSON.stringify(paymentProjectionWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "shopify-tax-sync-worker-v2.inactive.json"), JSON.stringify(shopifyTaxSyncWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "vat-review-alert-worker-v2.inactive.json"), JSON.stringify(vatReviewWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "easybill-proforma-void-worker-v2.inactive.json"), JSON.stringify(proformaVoidWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "shopify-order-intake-adapter-v2.inactive.json"), JSON.stringify(shopifyOrderIntakeWorkflow, null, 2) + "\n");
console.log("Generated inactive billing v2 workflows.");
const customerDeliveryPrepareCode = String.raw`
const claimed = ($json.body ?? $json).claimed;
if (!claimed?.job || !claimed?.billingCase) {
  const empty = {hasJob:false};
  return [{json:empty}];
}
const job = claimed.job;
const billingCase = claimed.billingCase;
const payload = job.payload || {};
const recipient = String(payload.recipient || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254) {
  throw new Error('FATAL_billing_customer_delivery_recipient_missing_or_invalid');
}
const easybillDocumentId = String(payload.easybillDocumentId || '');
if (!/^\d+$/.test(easybillDocumentId)) throw new Error('billing_customer_delivery_easybill_id_invalid');
const documentNumber = String(payload.documentNumber || '').trim();
const shopifyOrderName = String(payload.shopifyOrderName || billingCase.shopify_order_name || '').trim();
if (!/^#NEONT\d+$/.test(shopifyOrderName)) throw new Error('billing_customer_delivery_order_number_invalid');
const portalUrl = String(payload.portalUrl || '').trim();
if (!/^https:\/\/rechnung\.neontrip\.de\/[A-Za-z0-9_-]+$/.test(portalUrl)) throw new Error('billing_customer_delivery_portal_url_invalid');
const projectNumber = String(payload.projectNumber || billingCase.project_number || '').trim();
if (projectNumber.length > 100 || /[<>\r\n]/.test(projectNumber)) throw new Error('billing_customer_delivery_project_number_invalid');
const kind = String(payload.deliveryKind || '');
const subjects = {
  ORDER_CONFIRMATION_PROFORMA:'Auftragsbestätigung und Rechnung ' + shopifyOrderName,
  PROFORMA_UPDATE:'Aktualisierte Pro-forma-Rechnung ' + documentNumber + ' – NEONTRIP',
  INVOICE:'Rechnung ' + documentNumber + ' – NEONTRIP',
  CREDIT:'Gutschrift ' + documentNumber + ' – NEONTRIP',
  CANCELLATION:'Stornobeleg ' + documentNumber + ' – NEONTRIP'
};
if (!subjects[kind]) throw new Error('billing_customer_delivery_kind_invalid');
const common = [
  'Bestellnummer: ' + shopifyOrderName,
  projectNumber ? 'Projektnummer: ' + projectNumber : '',
  'Rechnungsdaten und Dokumente: ' + portalUrl,
  'AGB: https://angebote.neontrip.de/legal/agb'
].filter(Boolean);
const messages = {
  ORDER_CONFIRMATION_PROFORMA:[
    'vielen Dank für Ihre verbindliche Bestellung bei NEONTRIP. Hiermit bestätigen wir den Eingang und die Annahme Ihres Auftrags.',
    'Ihre Pro-forma-Rechnung ' + documentNumber + ' finden Sie als PDF im Anhang.',
    'Zahlbar sofort. Mit unserer Auftragsbestätigung beginnt die Produktion Ihres individuellen Auftrags bereits. Der Auftrag ist verbindlich. Sollte die Zahlung nicht rechtzeitig eingehen, kann die Produktion vor Fertigstellung pausiert werden. Dadurch kann sich der Liefertermin verschieben.',
    'Über den folgenden Link können Sie ausschließlich Änderungen zu Ihren Rechnungsdaten anfragen. Änderungen am Auftrag selbst sind dort nicht möglich.'
  ],
  PROFORMA_UPDATE:[
    'die von uns freigegebenen Änderungen an Ihren Rechnungsdaten wurden übernommen.',
    'Ihre aktualisierte Pro-forma-Rechnung ' + documentNumber + ' finden Sie als PDF im Anhang.'
  ],
  INVOICE:[
    'anbei erhalten Sie Ihre Rechnung ' + documentNumber + ' als PDF.',
    'Die Rechnung wurde auf Grundlage des bestätigten Auftrags und des aktuellen Zahlungs-/Lieferstatus erstellt.'
  ],
  CREDIT:[
    'anbei erhalten Sie die Gutschrift ' + documentNumber + ' zu Ihrer Bestellung als PDF.',
    'Der in Shopify erfasste Erstattungsbetrag wurde in diesem Beleg berücksichtigt.'
  ],
  CANCELLATION:[
    'anbei erhalten Sie den Stornobeleg ' + documentNumber + ' zu Ihrer Bestellung als PDF.',
    'Die Stornierung wurde mit dem zugehörigen Shopify-Auftrag abgeglichen.'
  ]
};
const message = ['Guten Tag,','',...messages[kind],'',...common,'','Freundliche Grüße','Ihr NEONTRIP-Team'].join('\n');
const output = {
  hasJob:true,
  job,
  billingCase,
  recipient,
  easybillDocumentId,
  documentNumber,
  shopifyOrderName,
  portalUrl,
  kind,
  subject:subjects[kind],
  message
};
return [{json:output}];`;

const customerDeliveryWorkflow = {
  name: "NEONTRIP Billing v2 - Customer Document Delivery Worker",
  active: false,
  nodes: [
    node("delivery-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-1120, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { typeVersion: 1.3 }),
    node("delivery-config", "Customer Delivery Config", "n8n-nodes-base.code", [-900, 0], { mode: "runOnceForAllItems", jsCode: "const config={opsBaseUrl:'https://ops.neontrip.de',worker:'n8n-customer-document-delivery-v2'};return [{json:config}];" }),
    node("delivery-claim", "Claim Customer Delivery Job", "n8n-nodes-base.httpRequest", [-680, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['SEND_CUSTOMER_DOCUMENT'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "continueErrorOutput" }),
    node("delivery-prepare", "Prepare Customer Delivery", "n8n-nodes-base.code", [-440, -80], { mode: "runOnceForAllItems", jsCode: customerDeliveryPrepareCode }, { onError: "continueErrorOutput" }),
    node("delivery-has-job", "Has Customer Delivery Job", "n8n-nodes-base.if", [-220, -80], { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.hasJob }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("delivery-load", "Easybill Load Customer Document", "n8n-nodes-base.httpRequest", [20, -80], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($json.easybillDocumentId) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("delivery-check", "Check Existing Customer Delivery", "n8n-nodes-base.code", [260, -80], { jsCode: "const ctx=$('Prepare Customer Delivery').first().json;const doc=$json.body??$json;if(!doc.id||String(doc.number||'')!==ctx.documentNumber)throw new Error('billing_customer_delivery_document_mismatch');const output={...ctx,easybillDocument:doc,emailAlreadySent:Boolean(doc.last_postbox_id)};return [{json:output}];" }, { onError: "continueErrorOutput" }),
    node("delivery-already-sent", "Customer Document Already Sent", "n8n-nodes-base.if", [500, -80], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.emailAlreadySent }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("delivery-send", "Easybill Send Customer Document", "n8n-nodes-base.httpRequest", [740, 40], { method: "POST", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($json.easybillDocumentId) + '/send/email' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {to:$json.recipient,subject:$json.subject,message:$json.message,send_with_attachment:true,document_file_type:'default',send_by_self:false} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("delivery-wait", "Wait for Easybill Postbox", "n8n-nodes-base.wait", [980, 40], { resume: "timeInterval", amount: 3, unit: "seconds" }, { typeVersion: 1.1 }),
    node("delivery-reload", "Easybill Reload Sent Document", "n8n-nodes-base.httpRequest", [1220, 40], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($('Prepare Customer Delivery').first().json.easybillDocumentId) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("delivery-success", "Prepare Customer Delivery Success", "n8n-nodes-base.code", [1460, -80], { jsCode: "const ctx=$('Prepare Customer Delivery').first().json;const doc=$json.easybillDocument||$json.body||$json;if(!doc.last_postbox_id)throw new Error('billing_customer_delivery_postbox_missing');const result={worker:'n8n-customer-document-delivery-v2',easybillDocumentId:ctx.easybillDocumentId,documentNumber:ctx.documentNumber,recipient:ctx.recipient,deliveryKind:ctx.kind,sent:true,postboxId:String(doc.last_postbox_id)};const output={jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result};return [{json:output}];" }, { onError: "continueErrorOutput" }),
    node("delivery-failure", "Prepare Customer Delivery Failure", "n8n-nodes-base.code", [740, 280], { jsCode: "const prepared=$('Prepare Customer Delivery').all();const claimedItems=$('Claim Customer Delivery Job').all();const claimBody=claimedItems[0]?.json?.body??claimedItems[0]?.json??{};const job=prepared[0]?.json?.job??claimBody.claimed?.job;if(!job?.id||!job?.lease_token)throw new Error('billing_customer_delivery_failure_context_missing');const message=String($json.error?.message||$json.message||$json.description||'customer_document_delivery_failed').slice(0,1800);const result={worker:'n8n-customer-document-delivery-v2'};const output={jobId:job.id,leaseToken:job.lease_token,success:false,result,error:message};return [{json:output}];" }),
    node("delivery-complete", "Complete Customer Delivery Job", "n8n-nodes-base.httpRequest", [1700, -80], { method: "POST", url: "={{ $('Customer Delivery Config').first().json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "stopWorkflow" }),
    node("delivery-blocked", "Raise Customer Delivery Block", "n8n-nodes-base.code", [1940, -80], { jsCode: "const body=$json.body??$json;const prepared=$('Prepare Customer Delivery').all()[0]?.json??{};const claim=$('Claim Customer Delivery Job').all()[0]?.json??{};const claimed=(claim.body??claim).claimed??{};const payload=prepared.job?.payload??claimed.job?.payload??{};const documentNumber=prepared.documentNumber??payload.documentNumber??'UNBEKANNT';const orderName=prepared.shopifyOrderName??payload.shopifyOrderName??claimed.billingCase?.shopify_order_name??'UNBEKANNT';const recipient=prepared.recipient??payload.recipient??'KEINE GUELTIGE EMPFAENGERADRESSE';if(body.completed?.status==='BLOCKED')throw new Error('FATAL Fehler Rechnung Shopify/Easybill: Kundenbeleg '+documentNumber+' zu '+orderName+' konnte nach vier Versuchen nicht an '+recipient+' versendet werden. Bitte sofort in Ops/Rechnungen und Easybill pruefen.');const output={ok:true,status:body.completed?.status||'DONE'};return [{json:output}];" }),
    node("delivery-claim-failure", "Raise Customer Delivery Claim Error", "n8n-nodes-base.code", [-440, 200], { jsCode: "throw new Error('Fehler Rechnung Shopify/Easybill: Kundenversand-Job konnte nicht abgeholt werden.');return [];" })
  ],
  connections: {
    "Every Minute": { main: [[{ node: "Customer Delivery Config", type: "main", index: 0 }]] },
    "Customer Delivery Config": { main: [[{ node: "Claim Customer Delivery Job", type: "main", index: 0 }]] },
    "Claim Customer Delivery Job": { main: [[{ node: "Prepare Customer Delivery", type: "main", index: 0 }], [{ node: "Raise Customer Delivery Claim Error", type: "main", index: 0 }]] },
    "Prepare Customer Delivery": { main: [[{ node: "Has Customer Delivery Job", type: "main", index: 0 }], [{ node: "Prepare Customer Delivery Failure", type: "main", index: 0 }]] },
    "Has Customer Delivery Job": { main: [[{ node: "Easybill Load Customer Document", type: "main", index: 0 }], []] },
    "Easybill Load Customer Document": { main: [[{ node: "Check Existing Customer Delivery", type: "main", index: 0 }], [{ node: "Prepare Customer Delivery Failure", type: "main", index: 0 }]] },
    "Check Existing Customer Delivery": { main: [[{ node: "Customer Document Already Sent", type: "main", index: 0 }], [{ node: "Prepare Customer Delivery Failure", type: "main", index: 0 }]] },
    "Customer Document Already Sent": { main: [[{ node: "Prepare Customer Delivery Success", type: "main", index: 0 }], [{ node: "Easybill Send Customer Document", type: "main", index: 0 }]] },
    "Easybill Send Customer Document": { main: [[{ node: "Wait for Easybill Postbox", type: "main", index: 0 }], [{ node: "Prepare Customer Delivery Failure", type: "main", index: 0 }]] },
    "Wait for Easybill Postbox": { main: [[{ node: "Easybill Reload Sent Document", type: "main", index: 0 }]] },
    "Easybill Reload Sent Document": { main: [[{ node: "Prepare Customer Delivery Success", type: "main", index: 0 }], [{ node: "Prepare Customer Delivery Failure", type: "main", index: 0 }]] },
    "Prepare Customer Delivery Success": { main: [[{ node: "Complete Customer Delivery Job", type: "main", index: 0 }], [{ node: "Prepare Customer Delivery Failure", type: "main", index: 0 }]] },
    "Prepare Customer Delivery Failure": { main: [[{ node: "Complete Customer Delivery Job", type: "main", index: 0 }]] },
    "Complete Customer Delivery Job": { main: [[{ node: "Raise Customer Delivery Block", type: "main", index: 0 }], []] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", availableInMCP: false },
  versionId: "neontrip-billing-v2-customer-document-delivery-worker-inactive"
};

fs.writeFileSync(path.join(generated, "customer-document-delivery-worker-v2.inactive.json"), JSON.stringify(customerDeliveryWorkflow, null, 2) + "\n");

const changeRequestNotificationPrepareCode = String.raw`
const claimed = ($json.body ?? $json).claimed;
if (!claimed?.job || !claimed?.billingCase) return [{json:{hasJob:false}}];
const job = claimed.job;
const billingCase = claimed.billingCase;
if (job.job_type !== 'NOTIFY_CHANGE_REQUEST') throw new Error('billing_change_notification_job_type_invalid');
const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
const requestedChanges = payload.requestedChanges && typeof payload.requestedChanges === 'object' && !Array.isArray(payload.requestedChanges) ? payload.requestedChanges : {};
const caseId = String(billingCase.id || '');
if (!/^[0-9a-f-]{36}$/i.test(caseId)) throw new Error('billing_change_notification_case_id_invalid');
const orderName = String(billingCase.shopify_order_name || payload.shopifyOrderName || '').trim();
if (!orderName || orderName.length > 80) throw new Error('billing_change_notification_order_name_invalid');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const bounded = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500);
const formatAddress = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bounded(value);
  return [value.company, value.name, value.street, [value.zip || value.zipCode, value.city].filter(Boolean).join(' '), value.country]
    .map(bounded).filter(Boolean).join(', ');
};
const notificationKind = String(payload.notificationKind || 'REQUEST_INTERNAL');
if (notificationKind === 'DECISION_CUSTOMER') {
  const recipient = bounded(payload.recipient).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254) throw new Error('billing_change_decision_recipient_invalid');
  const decision = String(payload.decision || '').toUpperCase();
  if (!['APPLY','REJECT'].includes(decision)) throw new Error('billing_change_decision_invalid');
  const portalUrl = String(payload.portalUrl || '').trim();
  if (!/^https:\/\/rechnung\.neontrip\.de\/[A-Za-z0-9_-]+$/.test(portalUrl)) throw new Error('billing_change_decision_portal_url_invalid');
  const accepted = decision === 'APPLY';
  const subject = (accepted ? 'Rechnungsänderung akzeptiert – ' : 'Rechnungsänderung abgelehnt – ') + orderName;
  const bodyHtml = '<div style="font-family:Arial,sans-serif;color:#171717;line-height:1.55;max-width:680px">'
    + '<h2 style="margin:0 0 12px">'+(accepted ? 'Ihre Rechnungsänderung wurde akzeptiert' : 'Ihre Rechnungsänderung wurde abgelehnt')+'</h2>'
    + '<p style="margin:0 0 14px">Bestellnummer: <strong>'+escapeHtml(orderName)+'</strong></p>'
    + '<p style="margin:0 0 18px">'+(accepted
      ? 'Wir haben die geprüften Rechnungsdaten übernommen. Den aktuellen Stand und Ihre Dokumente sehen Sie jederzeit im Rechnungsportal.'
      : 'Wir haben die angefragte Änderung geprüft und nicht übernommen. Ihre bisherigen Rechnungsdaten bleiben bestehen.')+'</p>'
    + '<p style="margin:0 0 18px"><a href="'+escapeHtml(portalUrl)+'" style="display:inline-block;background:#f6299a;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Rechnungsportal öffnen</a></p>'
    + '<p style="font-size:13px;color:#666;margin:0">Diese Entscheidung betrifft ausschließlich Ihre Rechnungsdaten, nicht den beauftragten Leistungsumfang.</p></div>';
  return [{json:{hasJob:true,job,billingCase,recipient,subject,bodyHtml,opsUrl:portalUrl,orderName,notificationKind,decision}}];
}
const currentValues = {
  billingAddress: billingCase.billing_address || {},
  deliveryAddress: billingCase.delivery_address || {},
  vatId: billingCase.vat_id || '',
  invoiceEmail: billingCase.customer_email || billingCase.billing_address?.invoiceEmail || billingCase.customer?.email || '',
  projectNumber: billingCase.project_number || ''
};
const labels = {
  billingAddress: 'Rechnungsanschrift',
  deliveryAddress: 'Lieferanschrift',
  vatId: 'Umsatzsteuer-ID',
  invoiceEmail: 'Rechnungs-E-Mail',
  projectNumber: 'Projektnummer'
};
const renderValue = (key, value) => key === 'billingAddress' || key === 'deliveryAddress' ? formatAddress(value) : bounded(value);
const rows = Object.keys(labels).filter(key => Object.prototype.hasOwnProperty.call(requestedChanges, key)).map(key => {
  const before = renderValue(key, currentValues[key]) || '–';
  const after = renderValue(key, requestedChanges[key]) || '–';
  return '<tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;vertical-align:top">'+escapeHtml(labels[key])+'</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">'+escapeHtml(before)+'</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">'+escapeHtml(after)+'</td></tr>';
});
if (!rows.length) throw new Error('billing_change_notification_changes_missing');
const requesterEmailRaw = bounded(payload.requesterEmail || '');
const requesterEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmailRaw) ? requesterEmailRaw.toLowerCase() : 'nicht angegeben';
const submittedAtDate = new Date(String(payload.submittedAt || job.created_at || ''));
const submittedAt = Number.isNaN(submittedAtDate.getTime()) ? 'nicht verfügbar' : new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Berlin'}).format(submittedAtDate) + ' Uhr';
const opsUrl = 'https://ops.neontrip.de/ops/rechnungen/' + encodeURIComponent(caseId);
const subject = 'Rechnungsänderung angefordert – ' + orderName;
const bodyHtml = '<div style="font-family:Arial,sans-serif;color:#171717;line-height:1.55;max-width:760px">'
  + '<h2 style="margin:0 0 12px">Ein Kunde hat eine Rechnungsänderung angefordert</h2>'
  + '<p style="margin:0 0 18px">Bitte prüfen und anschließend in der Rechnungsabteilung freigeben oder ablehnen.</p>'
  + '<table style="border-collapse:collapse;width:100%;margin:0 0 18px"><tr><td style="padding:5px 0;font-weight:700;width:190px">Bestellnummer</td><td>'+escapeHtml(orderName)+'</td></tr><tr><td style="padding:5px 0;font-weight:700">Angefordert am</td><td>'+escapeHtml(submittedAt)+'</td></tr><tr><td style="padding:5px 0;font-weight:700">Absender</td><td>'+escapeHtml(requesterEmail)+'</td></tr></table>'
  + '<h3 style="margin:0 0 8px">Gewünschte Änderungen</h3>'
  + '<table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;margin:0 0 22px"><thead><tr style="background:#f5f5f5"><th style="padding:10px 12px;text-align:left">Feld</th><th style="padding:10px 12px;text-align:left">Bisher</th><th style="padding:10px 12px;text-align:left">Gewünscht</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>'
  + '<p style="margin:0 0 18px"><a href="'+escapeHtml(opsUrl)+'" style="display:inline-block;background:#f6299a;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Rechnungsänderung in Ops prüfen</a></p>'
  + '<p style="font-size:13px;color:#666;margin:0">Diese Nachricht wurde nur intern versendet. Die Änderung ist noch nicht freigegeben und hat Shopify oder easybill nicht verändert.</p></div>';
return [{json:{hasJob:true,job,billingCase,recipient:'info@neontrip.de',subject,bodyHtml,opsUrl,orderName,requesterEmail}}];`;

const changeRequestNotificationWorkflow = {
  name: "NEONTRIP Billing v2 - Change Request Notification Worker (INACTIVE)",
  active: false,
  nodes: [
    node("change-alert-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-1120, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }, { typeVersion: 1.3 }),
    node("change-alert-config", "Change Notification Config", "n8n-nodes-base.code", [-900, 0], { mode: "runOnceForAllItems", jsCode: "return [{json:{opsBaseUrl:'https://ops.neontrip.de',worker:'n8n-billing-change-notification-v1'}}];" }),
    node("change-alert-claim", "Claim Change Notification Job", "n8n-nodes-base.httpRequest", [-680, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['NOTIFY_CHANGE_REQUEST'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "continueErrorOutput" }),
    node("change-alert-prepare", "Prepare Change Notification", "n8n-nodes-base.code", [-440, -80], { mode: "runOnceForAllItems", jsCode: changeRequestNotificationPrepareCode }, { onError: "continueErrorOutput" }),
    node("change-alert-has-job", "Has Change Notification Job", "n8n-nodes-base.if", [-220, -80], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.hasJob }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("change-alert-send", "Send Internal Change Notification", "n8n-nodes-base.microsoftOutlook", [20, -80], { resource: "message", operation: "send", toRecipients: "={{ $json.recipient }}", subject: "={{ $json.subject }}", bodyContent: "={{ $json.bodyHtml }}", additionalFields: { bodyContentType: "html" } }, { credentials: { microsoftOutlookOAuth2Api: { id: "CTEmJD5CjYu9hawu", name: "Microsoft Outlook support@neontrip.de" } }, onError: "continueErrorOutput" }),
    node("change-alert-success", "Prepare Change Notification Success", "n8n-nodes-base.code", [260, -160], { jsCode: "const ctx=$('Prepare Change Notification').first().json;const provider=$json.body??$json;return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-billing-change-notification-v1',recipient:ctx.recipient,shopifyOrderName:ctx.orderName,opsUrl:ctx.opsUrl,providerMessageId:String(provider.id||provider.messageId||'outlook-node-success')}}}];" }, { onError: "continueErrorOutput" }),
    node("change-alert-failure", "Prepare Change Notification Failure", "n8n-nodes-base.code", [260, 120], { jsCode: "const prepared=$('Prepare Change Notification').all();const claimedItems=$('Claim Change Notification Job').all();const claimBody=claimedItems[0]?.json?.body??claimedItems[0]?.json??{};const job=prepared[0]?.json?.job??claimBody.claimed?.job;if(!job?.id||!job?.lease_token)throw new Error('billing_change_notification_failure_context_missing');const message=String($json.error?.message||$json.message||$json.description||'billing_change_notification_failed').slice(0,1800);return [{json:{jobId:job.id,leaseToken:job.lease_token,success:false,result:{worker:'n8n-billing-change-notification-v1'},error:message}}];" }),
    node("change-alert-complete", "Complete Change Notification Job", "n8n-nodes-base.httpRequest", [500, -80], { method: "POST", url: "={{ $('Change Notification Config').first().json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "stopWorkflow" }),
    node("change-alert-blocked", "Raise Change Notification Block", "n8n-nodes-base.code", [740, -80], { jsCode: "const body=$json.body??$json;if(body.completed?.status==='BLOCKED')throw new Error('FATAL: Eine Rechnungsänderung wurde gespeichert, aber die interne Prüf-E-Mail konnte nach vier Versuchen nicht gesendet werden. Bitte Ops/Rechnungen sofort prüfen.');return [{json:{ok:true,status:body.completed?.status||'DONE'}}];" }),
    node("change-alert-claim-failure", "Raise Change Notification Claim Error", "n8n-nodes-base.code", [-440, 200], { jsCode: "throw new Error('Billing-Änderungsbenachrichtigung konnte keinen Job abrufen.');" })
  ],
  connections: {
    "Every Minute": { main: [[{ node: "Change Notification Config", type: "main", index: 0 }]] },
    "Change Notification Config": { main: [[{ node: "Claim Change Notification Job", type: "main", index: 0 }]] },
    "Claim Change Notification Job": { main: [[{ node: "Prepare Change Notification", type: "main", index: 0 }], [{ node: "Raise Change Notification Claim Error", type: "main", index: 0 }]] },
    "Prepare Change Notification": { main: [[{ node: "Has Change Notification Job", type: "main", index: 0 }], [{ node: "Prepare Change Notification Failure", type: "main", index: 0 }]] },
    "Has Change Notification Job": { main: [[{ node: "Send Internal Change Notification", type: "main", index: 0 }], []] },
    "Send Internal Change Notification": { main: [[{ node: "Prepare Change Notification Success", type: "main", index: 0 }], [{ node: "Prepare Change Notification Failure", type: "main", index: 0 }]] },
    "Prepare Change Notification Success": { main: [[{ node: "Complete Change Notification Job", type: "main", index: 0 }], [{ node: "Prepare Change Notification Failure", type: "main", index: 0 }]] },
    "Prepare Change Notification Failure": { main: [[{ node: "Complete Change Notification Job", type: "main", index: 0 }]] },
    "Complete Change Notification Job": { main: [[{ node: "Raise Change Notification Block", type: "main", index: 0 }], []] }
  },
  settings: { executionOrder: "v1", timezone: "Europe/Berlin", saveDataErrorExecution: "all", saveDataSuccessExecution: "all", errorWorkflow: "M4uG1HAtN9Zggxww", availableInMCP: false },
  versionId: "neontrip-billing-v2-change-request-notification-worker-inactive"
};

fs.writeFileSync(path.join(generated, "change-request-notification-worker-v1.inactive.json"), JSON.stringify(changeRequestNotificationWorkflow, null, 2) + "\n");
