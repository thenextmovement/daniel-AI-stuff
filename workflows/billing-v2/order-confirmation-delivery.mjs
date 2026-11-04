// Add the approved AB to the existing Easybill delivery without changing invoice transport or its postbox guard.
export function attachOrderConfirmation(workflow) {
  const get=name=>workflow.nodes.find(n=>n.name===name);
  if(get('Proforma Needs Order Confirmation'))throw new Error('order_confirmation_already_installed');
  const opsCredentials=get('Claim Customer Delivery Job').credentials;
  const easybillCredentials=get('Easybill Load Customer Document').credentials;
  const edge=node=>({node,type:'main',index:0});
  const connect=(from,to)=>workflow.connections[from]={main:[[edge(to)],[edge('Prepare Customer Delivery Failure')]]};
  const add=(id,name,type,parameters,credentials)=>{
    const n={id:'ab-'+id,name,type:'n8n-nodes-base.'+type,typeVersion:type==='httpRequest'?4.2:2,position:[750+workflow.nodes.filter(n=>n.id.startsWith('ab-')).length*220,500],parameters};
    if(type!=='if')n.onError='continueErrorOutput';if(credentials)n.credentials=credentials;
    workflow.nodes.push(n);return n;
  };
  const condition=(expression)=>({conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{leftValue:expression,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
  const response={timeout:30000,response:{response:{fullResponse:true,responseFormat:'json'}}};
  add('needed','Proforma Needs Order Confirmation','if',condition("={{ ['ORDER_CONFIRMATION_PROFORMA','PROFORMA_UPDATE'].includes($('Check Existing Customer Delivery').first().json.kind) }}"));
  add('pdf','Load Order Confirmation PDF','httpRequest',{method:'POST',url:"={{ $('Customer Delivery Config').first().json.opsBaseUrl + '/api/internal/billing/order-confirmation' }}",authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:"={{ {billingCaseId:$('Check Existing Customer Delivery').first().json.billingCase.id} }}",options:response},opsCredentials);
  add('ids','Order Confirmation Attachment IDs','code',{jsCode:`
const ctx=$('Check Existing Customer Delivery').first().json;
// This mailbox explicitly permits only one PDF. Keep the invoice on hold rather than send a rejected two-PDF message.
if(ctx.recipient==='erechnung@duesseldorf.de')throw new Error('FATAL_order_confirmation_single_pdf_mailbox_requires_manual_combined_document');
const pdf=$json.body??$json;
if(!pdf.ok||pdf.contentType!=='application/pdf'||!/^auftragsbestaetigung-[A-Za-z0-9._-]+\\.pdf$/.test(pdf.filename)||!String(pdf.contentBase64||'').startsWith('JVBERi0'))throw new Error('order_confirmation_pdf_invalid');
const ids=ctx.easybillDocument.attachment_ids||[];
return (ids.length?ids:[null]).map(id=>({json:{attachmentId:id}}));`});
  add('has-id','Has Existing Attachment IDs','if',condition('={{ Boolean($json.attachmentId) }}'));
  add('metadata','Load Existing Attachment Metadata','httpRequest',{method:'GET',url:"={{ 'https://api.easybill.de/rest/v1/attachments/' + encodeURIComponent($json.attachmentId) }}",authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:response},easybillCredentials);
  add('select','Select Existing Order Confirmation','code',{jsCode:`
const pdfResponse=$('Load Order Confirmation PDF').first().json;const pdf=pdfResponse.body??pdfResponse;
const ctx=$('Check Existing Customer Delivery').first().json;
const existing=$input.all().map(i=>i.json.body??i.json).filter(a=>a.file_name===pdf.filename);
if(existing.some(a=>String(a.document_id)!==String(ctx.easybillDocumentId)))throw new Error('order_confirmation_attachment_ownership_mismatch');
return [{json:{attached:existing.length>0,attachmentId:existing[0]?.id??null}}];`});
  add('attached','Order Confirmation Already Attached','if',condition('={{ $json.attached }}'));
  add('binary','Prepare Order Confirmation Upload','code',{jsCode:`
const response=$('Load Order Confirmation PDF').first().json;const pdf=response.body??response;
return [{json:{filename:pdf.filename},binary:{data:{data:pdf.contentBase64,mimeType:'application/pdf',fileName:pdf.filename,fileExtension:'pdf'}}}];`});
  add('upload','Upload Order Confirmation PDF','httpRequest',{method:'POST',url:'https://api.easybill.de/rest/v1/attachments',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,contentType:'multipart-form-data',bodyParameters:{parameters:[{parameterType:'formBinaryData',name:'file',inputDataFieldName:'data'}]},options:response},easybillCredentials);
  add('link','Link Order Confirmation PDF','httpRequest',{method:'PUT',url:"={{ 'https://api.easybill.de/rest/v1/attachments/' + encodeURIComponent(($json.body ?? $json).id) }}",authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:"={{ {document_id:Number($('Check Existing Customer Delivery').first().json.easybillDocumentId)} }}",options:response},easybillCredentials);
  add('verify','Verify Order Confirmation Link','code',{jsCode:`
const a=$json.body??$json;const ctx=$('Check Existing Customer Delivery').first().json;
const response=$('Load Order Confirmation PDF').first().json;const pdf=response.body??response;
if(!a.id||String(a.document_id)!==String(ctx.easybillDocumentId)||a.file_name!==pdf.filename)throw new Error('order_confirmation_attachment_link_not_confirmed');
return [{json:{attached:true,attachmentId:a.id}}];`});
  add('content','Load Existing Order Confirmation Content','httpRequest',{method:'GET',url:"={{ 'https://api.easybill.de/rest/v1/attachments/' + encodeURIComponent($('Select Existing Order Confirmation').first().json.attachmentId) + '/content' }}",authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:{timeout:30000,response:{response:{responseFormat:'file',outputPropertyName:'data'}}}},easybillCredentials);
  add('content-check','Verify Existing Order Confirmation Content','code',{jsCode:`
const response=$('Load Order Confirmation PDF').first().json;const pdf=response.body??response;
const bytes=await this.helpers.getBinaryDataBuffer(0,'data');
if(bytes.toString('base64')!==pdf.contentBase64)throw new Error('FATAL_order_confirmation_stale_attachment_remove_old_AB_in_Easybill_before_retry');
return [{json:{attached:true}}];`});
  workflow.connections['Customer Document Already Sent'].main[1]=[edge('Proforma Needs Order Confirmation')];
  workflow.connections['Proforma Needs Order Confirmation']={main:[[edge('Load Order Confirmation PDF')],[edge('Easybill Send Customer Document')]]};
  connect('Load Order Confirmation PDF','Order Confirmation Attachment IDs');connect('Order Confirmation Attachment IDs','Has Existing Attachment IDs');
  workflow.connections['Has Existing Attachment IDs']={main:[[edge('Load Existing Attachment Metadata')],[edge('Select Existing Order Confirmation')]]};
  connect('Load Existing Attachment Metadata','Select Existing Order Confirmation');connect('Select Existing Order Confirmation','Order Confirmation Already Attached');
  workflow.connections['Order Confirmation Already Attached']={main:[[edge('Load Existing Order Confirmation Content')],[edge('Prepare Order Confirmation Upload')]]};
  connect('Load Existing Order Confirmation Content','Verify Existing Order Confirmation Content');connect('Verify Existing Order Confirmation Content','Easybill Send Customer Document');
  connect('Prepare Order Confirmation Upload','Upload Order Confirmation PDF');connect('Upload Order Confirmation PDF','Link Order Confirmation PDF');connect('Link Order Confirmation PDF','Verify Order Confirmation Link');connect('Verify Order Confirmation Link','Easybill Send Customer Document');
  const send=get('Easybill Send Customer Document');
  send.parameters.url="={{ 'https://api.easybill.de/rest/v1/documents/' + encodeURIComponent($('Check Existing Customer Delivery').first().json.easybillDocumentId) + '/send/email' }}";
  send.parameters.jsonBody="={{ {to:$('Check Existing Customer Delivery').first().json.recipient,subject:$('Check Existing Customer Delivery').first().json.subject,message:$('Check Existing Customer Delivery').first().json.message,send_with_attachment:true,document_file_type:'default',send_by_self:false} }}";
  const prepare=get('Prepare Customer Delivery');
  prepare.parameters.jsCode=prepare.parameters.jsCode.replace("'Ihre Pro-forma-Rechnung ' + documentNumber + ' finden Sie als PDF im Anhang.'","'Ihre Auftragsbestätigung und Ihre Pro-forma-Rechnung ' + documentNumber + ' finden Sie als PDFs im Anhang.'").replace("'Ihre aktualisierte Pro-forma-Rechnung ' + documentNumber + ' finden Sie als PDF im Anhang.'","'Ihre aktualisierte Pro-forma-Rechnung ' + documentNumber + ' und Ihre Auftragsbestätigung finden Sie als PDFs im Anhang.'");
  return workflow;
}
