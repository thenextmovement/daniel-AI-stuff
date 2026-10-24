
const claimed = ($json.body ?? $json).claimed;
if (!claimed?.job || !claimed?.billingCase) return [{json:{hasJob:false} }];
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
const name = String(address.name || [address.firstName,address.lastName].filter(Boolean).join(' ') || customer.name || 'Kunde').trim();
const company = String(address.company || customer.company || name).trim();
const names = name.split(/\s+/);
const firstName = String(address.firstName || names.slice(0,-1).join(' ') || '').trim();
const lastName = String(address.lastName || names.slice(-1)[0] || company).trim();
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
const sourceItems = Array.isArray(billingCase.line_items) ? billingCase.line_items : [];
let useGrossCalculation = !billingCase.tax_exempt && sourceItems.length > 0 && sourceItems.every((item)=>Number.isFinite(Number(item.unitPriceGross)) && Number(item.unitPriceGross) >= 0);
let items = sourceItems.flatMap((item)=>{
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
  const position = {
    description:description.slice(0,4000),
    quantity:Number(item.normalizedQuantity || item.quantity || 1),
    unit:'Stück',
    ...(useGrossCalculation
      ? {single_price_gross:Number(item.unitPriceGross)*100}
      : {single_price_net:Math.round(Number(item.unitPriceNet || 0)*100)}),
    vat_percent:vatPercent
  };
  if (useGrossCalculation && item.lineGross !== undefined && item.lineGross !== null) {
    const lineGross = Number(item.lineGross);
    const quantity = position.quantity;
    if (!Number.isFinite(lineGross) || lineGross < 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('billing_line_gross_invalid');
    const lineGrossCents = Math.round(lineGross * 100);
    if (Number.isSafeInteger(quantity)) {
      const lower = Math.floor(lineGrossCents / quantity);
      const upperCount = lineGrossCents - lower * quantity;
      const allocated = [];
      if (quantity - upperCount > 0) allocated.push({...position,quantity:quantity-upperCount,single_price_gross:lower});
      if (upperCount > 0) allocated.push({...position,quantity:upperCount,single_price_gross:lower+1});
      return allocated;
    }
    return [{...position,single_price_gross:lineGrossCents/quantity}];
  }
  return [position];
});
if (useGrossCalculation && ['CREATE_PROFORMA','CREATE_INVOICE'].includes(job.job_type)) {
  const projectedGrossCents = Math.round(items.reduce((sum,item)=>sum+item.single_price_gross*item.quantity,0));
  if (projectedGrossCents !== Number(billingCase.total_gross_cents)) throw new Error('billing_document_line_gross_total_mismatch');
}
if(job.job_type==='CREATE_CREDIT') {
  if(!originalInvoice?.easybill_document_id) throw new Error('credit_original_invoice_missing');
  const refundLines=Array.isArray(job.payload?.refundLineItems)?job.payload.refundLineItems:[];
  items=refundLines.length?refundLines.map((item)=>({description:String(item.title||item.description||'Erstattung').slice(0,4000),quantity:Number(item.quantity||1),unit:'Stück',single_price_net:Math.round(Number(item.unitPriceNet||item.netAmount||0)*100),vat_percent:Number(item.vatPercent||vatPercent)})):[{description:'Erstattung zu '+String(billingCase.shopify_order_name||''),quantity:1,unit:'Stück',single_price_net:Number(job.payload.netCents||0),vat_percent:Number(job.payload.netCents||0)>0?Math.round((Number(job.payload.vatCents||0)/Number(job.payload.netCents))*10000)/100:0}];
  // Refund lines are net-priced; do not inherit the original invoice's calculation mode.
  useGrossCalculation = false;
  const refundNetCents = Number(job.payload?.netCents);
  const refundVatCents = Number(job.payload?.vatCents);
  const refundGrossCents = Number(job.payload?.grossCents ?? job.payload?.amountCents);
  // Preserve the exact booked refund, including one-cent partial-refund rounding.
  if (items.length === 1 && items[0].quantity === 1 &&
      [refundNetCents, refundVatCents, refundGrossCents].every(value => Number.isSafeInteger(value) && value >= 0) &&
      refundNetCents + refundVatCents === refundGrossCents &&
      items[0].single_price_net === refundNetCents &&
      Math.round(refundGrossCents / (1 + items[0].vat_percent / 100)) === refundNetCents) {
    const {single_price_net, ...creditItem} = items[0];
    items = [{...creditItem, single_price_gross:refundGrossCents}];
    useGrossCalculation = true;
  }
}
if(job.job_type==='CREATE_CANCELLATION'&&!originalInvoice?.easybill_document_id) throw new Error('cancellation_original_invoice_missing');
const dueInDays = billingCase.payment_method === 'KAUF_AUF_RECHNUNG' ? Number(billingCase.payment_terms_days || 14) : 0;
const paidInvoice = job.job_type === 'CREATE_INVOICE' && Boolean(billingCase.paid_at);
const cashAllowancePercent = Number(billingCase.cash_allowance_percent || 0);
const cashAllowanceDays = Number(billingCase.cash_allowance_days || 0);
const hasCashAllowance = Number.isFinite(cashAllowancePercent) && cashAllowancePercent > 0 && cashAllowancePercent < 100 && Number.isInteger(cashAllowanceDays) && cashAllowanceDays > 0;
const cashAllowanceText = hasCashAllowance ? String(cashAllowancePercent).replace('.', ',') + ' % Skonto bei Zahlung innerhalb von ' + cashAllowanceDays + ' Tagen.' : '';
const paymentText = paidInvoice
  ? 'Zahlung vollständig erhalten. Es ist keine weitere Zahlung erforderlich. Die Produktion ist zur Bearbeitung freigegeben.'
  : billingCase.payment_method === 'VORKASSE'
    ? 'Zahlbar sofort. Mit unserer Auftragsbestätigung beginnt die Produktion Ihres individuellen Auftrags bereits. Der Auftrag ist verbindlich. Sollte die Zahlung nicht rechtzeitig eingehen, kann die Produktion vor Fertigstellung pausiert werden. Dadurch kann sich der Liefertermin verschieben.'
    : 'Zahlbar innerhalb von ' + dueInDays + ' Tagen nach Erhalt der Ware.';
const documentText = [projectNumber ? 'Projektnummer: ' + projectNumber : '', cashAllowanceText, paymentText].filter(Boolean).join('\n\n');
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
  customerPayload:{number:customerNumber,company_name:company,last_name:lastName,first_name:firstName,street:String(address.street||''),zip_code:String(address.zip||address.zipCode||''),city:String(address.city||''),country:country(address.country||delivery.country),emails:[invoiceEmail],vat_identifier:billingCase.vat_id||null,tax_options:taxOption,delivery_company_name:String(delivery.company||delivery.contactCompany||company),delivery_first_name:String(delivery.firstName||delivery.contactName||''),delivery_last_name:String(delivery.lastName||''),delivery_street:String(delivery.street||''),delivery_zip_code:String(delivery.zip||delivery.zipCode||''),delivery_city:String(delivery.city||''),delivery_country:country(delivery.country)},
  documentNumber,
  documentPayload:{type:documentType,number:documentNumber,order_number:String(billingCase.shopify_order_name||''),buyer_reference:projectNumber,external_id:job.idempotency_key,currency:billingCase.currency||'EUR',due_in_days:dueInDays,cash_allowance:hasCashAllowance?cashAllowancePercent:undefined,cash_allowance_days:hasCashAllowance?cashAllowanceDays:undefined,cash_allowance_text:hasCashAllowance?cashAllowanceText:undefined,customer_id:null,ref_id:originalInvoice?.easybill_document_id?Number(originalInvoice.easybill_document_id):undefined,items,vat_option:taxOption,vat_country:country(billingCase.tax_treatment==='EU_B2C_OSS'?delivery.country:(address.country||delivery.country)),shipping_country:country(delivery.country),title:documentLabel+' '+String(billingCase.shopify_order_name||''),text:documentText,bank_debit_form:paidInvoice?null:undefined,payment_link_enabled:paidInvoice?false:undefined,calc_vat_from:useGrossCalculation?1:0}
} }];