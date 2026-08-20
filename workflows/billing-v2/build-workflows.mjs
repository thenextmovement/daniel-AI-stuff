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
const claimed = $json.claimed;
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
const vatPercent = billingCase.tax_exempt ? 0 : Math.round((Number(billingCase.vat_cents||0) / Math.max(Number(billingCase.subtotal_net_cents||1),1))*10000)/100;
let items = (Array.isArray(billingCase.line_items) ? billingCase.line_items : []).map((item,index)=>({
  number:String(item.id || index+1),
  description:[item.title,item.description].filter(Boolean).join('\n').slice(0,4000),
  quantity:Number(item.normalizedQuantity || item.quantity || 1),
  unit:'Stück',
  single_price_net:Math.round(Number(item.unitPriceNet || 0)*100),
  vat_percent:vatPercent
}));
if(job.job_type==='CREATE_CREDIT') {
  if(!originalInvoice?.easybill_document_id) throw new Error('credit_original_invoice_missing');
  const refundLines=Array.isArray(job.payload?.refundLineItems)?job.payload.refundLineItems:[];
  items=refundLines.length?refundLines.map((item,index)=>({number:String(item.id||index+1),description:String(item.title||item.description||'Erstattung').slice(0,4000),quantity:Number(item.quantity||1),unit:'Stück',single_price_net:Math.round(Number(item.unitPriceNet||item.netAmount||0)*100),vat_percent:Number(item.vatPercent||vatPercent)})):[{number:'1',description:'Erstattung zu '+String(billingCase.shopify_order_name||''),quantity:1,unit:'Stück',single_price_net:Number(job.payload.netCents||0),vat_percent:Number(job.payload.netCents||0)>0?Math.round((Number(job.payload.vatCents||0)/Number(job.payload.netCents))*10000)/100:0}];
}
if(job.job_type==='CREATE_CANCELLATION'&&!originalInvoice?.easybill_document_id) throw new Error('cancellation_original_invoice_missing');
const dueInDays = billingCase.payment_method === 'KAUF_AUF_RECHNUNG' ? Number(billingCase.payment_terms_days || 14) : 0;
const paymentText = billingCase.payment_method === 'VORKASSE'
  ? 'Zahlbar sofort. Die Produktion beginnt bereits. Sollte die Zahlung nicht rechtzeitig eingehen, kann die Produktion vor Fertigstellung pausiert werden. Dadurch kann sich der Liefertermin verschieben.'
  : 'Zahlbar innerhalb von ' + dueInDays + ' Tagen nach Erhalt der Ware.';
const documentText = [projectNumber ? 'Projektnummer: ' + projectNumber : '', paymentText].filter(Boolean).join('\n\n');
const documentLabel = documentType==='PROFORMA_INVOICE'?'Pro-forma-Rechnung':documentType==='CREDIT'?'Gutschrift':documentType==='STORNO'?'Stornobeleg':'Rechnung';
const initialProforma = job.job_type === 'CREATE_PROFORMA' && Number(job.payload?.revision || 0) === 0;
const portalUrl = String(job.payload?.portalUrl || '').trim();
if (initialProforma && !/^https:\/\/rechnung\.neontrip\.de\/[A-Za-z0-9_-]+$/.test(portalUrl)) throw new Error('billing_portal_url_missing');
const orderLabel = String(billingCase.shopify_order_name || '').startsWith('#') ? String(billingCase.shopify_order_name) : '#' + String(billingCase.shopify_order_name || '');
const initialEmailMessage = 'Guten Tag,\n\nvielen Dank für Ihre Bestellung. Hiermit bestätigen wir die Annahme Ihres Auftrags ' + orderLabel + '.\n\nAnbei erhalten Sie Ihre Pro-forma-Rechnung ' + documentNumber + (projectNumber?' für das Projekt '+projectNumber:'') + '.\n\n' + paymentText + '\n\nÜber diesen permanenten Link können Sie Ihre Rechnungsdaten einsehen und Änderungen ausschließlich zu Ihren Rechnungsdaten anfragen:\n' + portalUrl + '\n\nÄnderungen im Rechnungsportal ändern weder den Auftrag noch die bestellten Produkte oder Leistungen.\n\nFreundliche Grüße\nIhr NEONTRIP Team';
const standardEmailMessage = 'Guten Tag,\n\nanbei erhalten Sie Ihre '+documentLabel+(projectNumber?' für das Projekt '+projectNumber:'')+'.\n\nFreundliche Grüße\nIhr NEONTRIP Team';
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
  documentPayload:{type:documentType,number:documentNumber,order_number:String(billingCase.shopify_order_name||''),buyer_reference:projectNumber,external_id:job.idempotency_key,currency:billingCase.currency||'EUR',due_in_days:dueInDays,customer_id:null,ref_id:originalInvoice?.easybill_document_id?Number(originalInvoice.easybill_document_id):undefined,items,vat_option:taxOption,vat_country:country(address.country||delivery.country),shipping_country:country(delivery.country),title:documentLabel+' '+String(billingCase.shopify_order_name||''),text:documentText,calc_vat_from:0},
  emailPayload:{to:invoiceEmail,subject:initialProforma?'Auftragsbestätigung '+orderLabel+' – NEONTRIP':documentLabel+' '+documentNumber+' – NEONTRIP',message:initialProforma?initialEmailMessage:standardEmailMessage,send_with_attachment:true,document_file_type:'default'}
}}];`;

const workflow = {
  name: "NEONTRIP Billing v2 - Easybill Document Worker (INACTIVE)",
  active: false,
  nodes: [
    node("schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-1120, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }),
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
    node("find-document", "Easybill Find Document", "n8n-nodes-base.httpRequest", [1160, -120], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents?number=' + encodeURIComponent($json.documentNumber) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("resolve-document", "Resolve Existing Document", "n8n-nodes-base.code", [1400, -120], { jsCode: "const ctx=$('Prepare Easybill Command').first().json; const customerId=$('Customer Ready').first().json.customerId; const body=$json.body??$json; const rows=Array.isArray(body)?body:(body.items||[]); const match=rows.find(x=>String(x.number||'')===ctx.documentNumber); return [{json:{...ctx,customerId,existingDocument:match||null,hasExistingDocument:Boolean(match)}}];" }, { onError: "continueErrorOutput" }),
    node("has-document", "Document Already Exists", "n8n-nodes-base.if", [1620, -120], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.hasExistingDocument }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("reuse-document", "Reuse Existing Document", "n8n-nodes-base.code", [1840, -240], { jsCode: "return [{json:{...$json,easybillDocument:$json.existingDocument}}];" }),
    node("existing-draft", "Existing Document Is Draft", "n8n-nodes-base.if", [2050, -240], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.easybillDocument.is_draft }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("create-document", "Easybill Create Document", "n8n-nodes-base.httpRequest", [1840, 20], { method: "POST", url: "https://api.easybill.de/rest/v1/documents", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {...$json.documentPayload, customer_id: $json.customerId} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("done-document", "Easybill Finalize Document", "n8n-nodes-base.httpRequest", [2260, -20], { method: "PUT", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent(($json.easybillDocument||$json.body||$json).id) + '/done' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("load-document", "Easybill Load Finalized Document", "n8n-nodes-base.httpRequest", [2470, -120], { method: "GET", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent(($json.easybillDocument||$json.body||$json).id) }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("prepare-email", "Prepare Document Email", "n8n-nodes-base.code", [2690, -120], { jsCode: "const ctx=$('Prepare Easybill Command').first().json;const doc=$json.body??$json;if(!doc.id||doc.is_draft===true)throw new Error('easybill_document_not_finalized');return [{json:{...ctx,easybillDocument:doc,emailWasAlreadySent:Boolean(doc.last_postbox_id)}}];" }, { onError: "continueErrorOutput" }),
    node("email-sent", "Document Email Already Sent", "n8n-nodes-base.if", [2910, -120], { conditions: { options: { typeValidation: "strict" }, conditions: [{ leftValue: "={{ $json.emailWasAlreadySent }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" } }),
    node("send-email", "Easybill Send Document Email", "n8n-nodes-base.httpRequest", [3130, 20], { method: "POST", url: "={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($json.easybillDocument.id) + '/send/email' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ $json.emailPayload }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "text" } } } }, { credentials: easybillCredentials, onError: "continueErrorOutput" }),
    node("success", "Prepare Successful Completion", "n8n-nodes-base.code", [3360, -120], { jsCode: "const ctx=$('Prepare Document Email').first().json;const doc=ctx.easybillDocument;if(!doc.id)throw new Error('easybill_document_id_missing');return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:true,result:{worker:'n8n-easybill-document-v2',easybillDocumentId:String(doc.id),documentNumber:String(doc.number||ctx.documentNumber),sent:true,recipient:ctx.invoiceEmail,projectNumber:ctx.projectNumber||null,emailWasAlreadySent:ctx.emailWasAlreadySent}}}];" }, { onError: "continueErrorOutput" }),
    node("complete", "Complete Billing Job", "n8n-nodes-base.httpRequest", [3590, -120], { method: "POST", url: "={{ $('Billing Worker Config').first().json.opsBaseUrl + '/api/internal/billing/jobs/' + encodeURIComponent($json.jobId) + '/complete' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {leaseToken:$json.leaseToken,success:$json.success,result:$json.result,error:$json.error} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "stopWorkflow" }),
    node("failure", "Prepare Failed Completion", "n8n-nodes-base.code", [1840, 300], { jsCode: "const ctx=$('Prepare Easybill Command').first().json; const message=String($json.error?.message||$json.message||$json.description||'Easybill adapter failed').slice(0,1800); return [{json:{jobId:ctx.job.id,leaseToken:ctx.job.lease_token,success:false,result:{worker:'n8n-easybill-document-v2'},error:message}}];" }),
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
    "Customer Ready": { main: [[{ node: "Easybill Find Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Find Document": { main: [[{ node: "Resolve Existing Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Resolve Existing Document": { main: [[{ node: "Document Already Exists", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Document Already Exists": { main: [[{ node: "Reuse Existing Document", type: "main", index: 0 }], [{ node: "Easybill Create Document", type: "main", index: 0 }]] },
    "Reuse Existing Document": { main: [[{ node: "Existing Document Is Draft", type: "main", index: 0 }]] },
    "Existing Document Is Draft": { main: [[{ node: "Easybill Finalize Document", type: "main", index: 0 }], [{ node: "Easybill Load Finalized Document", type: "main", index: 0 }]] },
    "Easybill Create Document": { main: [[{ node: "Easybill Finalize Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Finalize Document": { main: [[{ node: "Easybill Load Finalized Document", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Easybill Load Finalized Document": { main: [[{ node: "Prepare Document Email", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Prepare Document Email": { main: [[{ node: "Document Email Already Sent", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
    "Document Email Already Sent": { main: [[{ node: "Prepare Successful Completion", type: "main", index: 0 }], [{ node: "Easybill Send Document Email", type: "main", index: 0 }]] },
    "Easybill Send Document Email": { main: [[{ node: "Prepare Successful Completion", type: "main", index: 0 }], [{ node: "Prepare Failed Completion", type: "main", index: 0 }]] },
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
      node("post", "Record in BillingCase", "n8n-nodes-base.httpRequest", [80, 0], { method: "POST", url: `={{ String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,'') + '${endpoint}' }}`, authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ $json }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials, onError: "continueErrorOutput" }),
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
    node("projection-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-900, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }),
    node("projection-config", "Projection Worker Config", "n8n-nodes-base.code", [-700, 0], { jsCode: "const base=String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,''); if(!/^https:\\/\\//.test(base)) throw new Error('NEONTRIP_OPS_BASE_URL missing'); return [{json:{opsBaseUrl:base,worker:'n8n-payment-projection-v2'}}];" }),
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

const vatReviewWorkflow = {
  name: "NEONTRIP Billing v2 - VAT Review Alert Worker (INACTIVE)", active: false,
  nodes: [
    node("vat-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-760, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }),
    node("vat-config", "VAT Review Config", "n8n-nodes-base.code", [-560, 0], { jsCode: "const base=String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{opsBaseUrl:base,worker:'n8n-vat-review-alert-v2'}}];" }),
    node("vat-claim", "Claim VAT Review Job", "n8n-nodes-base.httpRequest", [-340, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['VERIFY_VAT'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("vat-prepare", "Prepare VAT Review Alert", "n8n-nodes-base.code", [-100, 0], { jsCode: "const claimed=($json.body??$json).claimed;if(!claimed?.job||!claimed?.billingCase)return [];const c=claimed.billingCase;const v=c.vat_validation||{};const clean=x=>String(x??'').replace(/[\\r\\n]+/g,' ').slice(0,500);const ops=String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,'')+'/ops/rechnungen?caseId='+encodeURIComponent(c.id);const message=['Umsatzsteuer-ID passt nicht zur Firma – Bitte prüfen',`Auftrag: ${clean(c.shopify_order_name)}`,`Ops-Fall: ${ops}`,`USt-ID: ${clean(c.vat_id)}`,`Prüfstatus: checked=${v.checked===true}, valid=${v.valid===true}, comparison=${clean(v.identityComparison||'UNAVAILABLE')}`,`Bei VIES gelistete Firma: ${clean(v.name||'nicht geliefert')}`,`Registeranschrift: ${clean(v.address||'nicht geliefert')}`,'Nächster Schritt: Daten mit VIES vergleichen, bei Bedarf Kundennachweis anfordern und den Fall in Ops ausdrücklich als netto oder brutto freigeben.','Offizielle Prüfung: https://ec.europa.eu/taxation_customs/vies/#/vat-validation','Produktion und Lieferung bleiben möglich; nur die finale steuerfreie Rechnung bleibt gesperrt.'].join(' | ');return [{json:{jobId:claimed.job.id,leaseToken:claimed.job.lease_token,opsBaseUrl:String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,''),message,result:{worker:'n8n-vat-review-alert-v2',alertPrepared:true,shopifyOrderName:c.shopify_order_name}}}];" }),
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
    node("void-schedule", "Every Minute", "n8n-nodes-base.scheduleTrigger", [-760, 0], { rule: { interval: [{ field: "minutes", minutesInterval: 1 }] } }),
    node("void-config", "Void Worker Config", "n8n-nodes-base.code", [-560, 0], { jsCode: "const base=String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{opsBaseUrl:base,worker:'n8n-easybill-proforma-void-v2'}}];" }),
    node("void-claim", "Claim Proforma Void Job", "n8n-nodes-base.httpRequest", [-340, 0], { method: "POST", url: "={{ $json.opsBaseUrl + '/api/internal/billing/jobs/claim' }}", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth", sendBody: true, specifyBody: "json", jsonBody: "={{ {worker:$json.worker,jobTypes:['VOID_PROFORMA'],leaseSeconds:180} }}", options: { timeout: 30000, response: { response: { fullResponse: true, responseFormat: "json" } } } }, { credentials: opsCredentials }),
    node("void-prepare", "Prepare Proforma Void", "n8n-nodes-base.code", [-100, 0], { jsCode: "const claimed=($json.body??$json).claimed;if(!claimed?.job)return [];const id=String(claimed.job.payload?.easybillDocumentId||'');if(!/^\\d+$/.test(id))throw new Error('easybill_proforma_id_missing');return [{json:{...claimed,job:claimed.job,easybillDocumentId:id,opsBaseUrl:String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,'')}}];" }, { onError: "continueErrorOutput" }),
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
    node("order-sign", "Validate and Sign BillingCase", "n8n-nodes-base.code", [-180, 0], { jsCode: "const x=$input.first()?.json||{};if(!x.sourceEventId||!x.shopifyOrderId||!/^#NEONT\\d+$/.test(String(x.shopifyOrderName||''))||!Array.isArray(x.lineItems)||!x.lineItems.length||!x.totals||!x.billingAddress||!x.deliveryAddress)throw new Error('invalid_shopify_order_billing_intake');const secret=String($env.BILLING_WEBHOOK_SECRET||'');if(secret.length<32)throw new Error('BILLING_WEBHOOK_SECRET missing');const payload={...x,source:'shopify',sourceEventId:String(x.sourceEventId)};const body=JSON.stringify(payload);const timestamp=String(Math.floor(Date.now()/1000));const {createHmac}=require('crypto');const signature='sha256='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');const base=String($env.NEONTRIP_OPS_BASE_URL||'').replace(/\\/+$/,'');if(!/^https:\\/\\//.test(base))throw new Error('NEONTRIP_OPS_BASE_URL missing');return [{json:{body,timestamp,signature,eventId:String(x.sourceEventId),url:base+'/api/internal/billing/cases'}}];" }),
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
fs.writeFileSync(path.join(generated, "vat-review-alert-worker-v2.inactive.json"), JSON.stringify(vatReviewWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "easybill-proforma-void-worker-v2.inactive.json"), JSON.stringify(proformaVoidWorkflow, null, 2) + "\n");
fs.writeFileSync(path.join(generated, "shopify-order-intake-adapter-v2.inactive.json"), JSON.stringify(shopifyOrderIntakeWorkflow, null, 2) + "\n");
console.log("Generated inactive billing v2 workflows.");
