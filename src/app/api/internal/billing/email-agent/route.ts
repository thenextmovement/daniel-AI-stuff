import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseRequest, supabaseRpc } from '@/lib/quotes/supabase-rest';
import { signBillingConfirmation, verifyBillingConfirmation, validateEmailBillingChanges } from '@/lib/ops/billing/email-confirmation';

import { requiresEuVatValidation, validateVatIdWithVies } from '@/lib/ops/billing/vies';

export const dynamic = 'force-dynamic';
const fields = 'id,customer_email,shopify_order_name,billing_address,delivery_address,vat_id,current_revision,updated_at,final_invoice_at,invoice_requested_at,status,tax_review_status';
type Case = {id:string; customer_email:string; shopify_order_name:string; billing_address:Record<string,unknown>; delivery_address:Record<string,unknown>; vat_id:string|null; current_revision:number; updated_at:string; final_invoice_at:string|null; invoice_requested_at:string|null; status:string; tax_review_status:string};
const email = (value:unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s@(),*]+@[^\s@(),*]+\.[^\s@(),*]+$/.test(value);
const text = (value:unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
const uuid = (value:unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
function json(error:string, status:number) { return NextResponse.json({ok:false,error}, {status}); }

export async function POST(request:NextRequest) {
  const secret = String(process.env.BILLING_EMAIL_AUTOMATION_TOKEN_SHA256 || '');
  if (!/^[a-f\d]{64}$/.test(secret)) return json('billing_email_not_configured',503);
  const authorization = request.headers.get('authorization') || '';
  const actual = createHash('sha256').update(authorization.startsWith('Bearer ') ? authorization.slice(7) : '').digest();
  if (!timingSafeEqual(Buffer.from(secret,'hex'),actual)) return json('unauthorized',401);
  const raw = await request.text();
  if (raw.length > 24000) return json('request_too_large',413);
  let body:Record<string,unknown>;
  try { body=JSON.parse(raw); } catch { return json('invalid_request',422); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !email(body.customerEmail)) return json('invalid_request',422);
  const customerEmail=body.customerEmail.toLowerCase();
  const allowed:Record<string,string[]> = {
    lookup:['operation','customerEmail','reference'],
    prepare:['operation','customerEmail','caseId','conversationId','requestMessageId','action','changes'],
    execute:['operation','customerEmail','conversationId','confirmationMessageId','customerConfirmed','confirmationToken'],
  };
  const operation=String(body.operation);
  if (!allowed[operation] || Object.keys(body).some(k=>!allowed[operation].includes(k))) return json('invalid_request',422);
  try {
    if(operation==='lookup') {
      if(body.reference !== undefined && (typeof body.reference !== 'string' || !/^#?NEONT\d+$/i.test(body.reference))) return json('invalid_reference',422);
      const query:Record<string,string|number>={select:fields,customer_email:`eq.${customerEmail}`,limit:21,order:'created_at.desc'};
      if(body.reference) query.shopify_order_name=`eq.#${String(body.reference).replace(/^#/,'').toUpperCase()}`;
      const cases=await supabaseRequest<Case[]>('billing_cases',undefined,query);
      return NextResponse.json({ok:true,cases:cases.slice(0,20),ambiguous:cases.length!==1,hasMore:cases.length>20});
    }
    if(operation==='prepare') {
      if(!uuid(body.caseId)||!text(body.conversationId)||!text(body.requestMessageId)||!['change','convert','change_and_convert'].includes(String(body.action))) return json('invalid_request',422);
      const cases=await supabaseRequest<Case[]>('billing_cases',undefined,{select:fields,id:`eq.${body.caseId}`,customer_email:`eq.${customerEmail}`,limit:1});
      const current=cases[0];
      if(!current) return json('billing_case_not_matched',409);
      if(current.final_invoice_at||current.invoice_requested_at) return json('billing_final_invoice_requires_correction',409);
      if(current.tax_review_status==='REVIEW_REQUIRED'||!['PAYMENT_PENDING','PAID','DELIVERED'].includes(current.status)) return json('billing_case_not_ready',409);
      const changes=validateEmailBillingChanges(body.changes,false);
      if(body.action!=='change' && 'deliveryAddress' in changes) return json('invoice_delivery_change_not_allowed',422);
      const billingAddress={...current.billing_address,...(changes.billingAddress as Record<string,unknown> || {})};
      if(!['street','zip','city','country'].every(k=>typeof billingAddress[k]==='string'&&String(billingAddress[k]).trim()) || ![billingAddress.company,billingAddress.name].some(v=>typeof v==='string'&&v.trim())) return json('billing_address_incomplete',422);
      const proposal={caseId:current.id,customerEmail,conversationId:body.conversationId,requestMessageId:body.requestMessageId,revision:current.current_revision,updatedAt:current.updated_at,action:body.action as 'change'|'convert'|'change_and_convert',changes,expiresAt:Math.floor(Date.now()/1000)+14*86400};
      return NextResponse.json({ok:true,confirmationToken:signBillingConfirmation(proposal,secret),billingAddress,deliveryAddress:changes.deliveryAddress?{...current.delivery_address,...changes.deliveryAddress as object}:null,vatId:changes.vatId??current.vat_id,action:proposal.action,reference:current.shopify_order_name});
    }
    if(body.customerConfirmed!==true||!text(body.conversationId)||!text(body.confirmationMessageId)||typeof body.confirmationToken!=='string') return json('customer_confirmation_required',422);
    const p=verifyBillingConfirmation(body.confirmationToken,secret,{customerEmail,conversationId:body.conversationId});
    if(body.confirmationMessageId===p.requestMessageId) return json('separate_customer_confirmation_required',422);
    let vatValidation:Record<string,unknown>|null=null;
    if(Object.keys(p.changes).length){
      const rows=await supabaseRequest<Case[]>('billing_cases',undefined,{select:fields,id:`eq.${p.caseId}`,customer_email:`eq.${customerEmail}`,limit:1});
      const current=rows[0];if(!current)return json('billing_case_not_matched',409);
      const country=(p.changes.deliveryAddress as Record<string,unknown>|undefined)?.country??current.delivery_address.country;
      const vat=p.changes.vatId??current.vat_id;
      if(requiresEuVatValidation(country,vat)){
        const validation=await validateVatIdWithVies({deliveryCountry:country,vatId:vat,company:(p.changes.billingAddress as Record<string,unknown>|undefined)?.company??current.billing_address.company});
        if(!validation.valid||validation.identityComparison==='MISMATCH')return json('vat_validation_requires_review',409);
        vatValidation=validation;
      }
    }
    const result=await supabaseRpc<Record<string,unknown>>('billing_email_apply_confirmed',{
      p_case_id:p.caseId,p_revision:p.revision,p_updated_at:p.updatedAt,p_customer_email:p.customerEmail,
      p_conversation_id:p.conversationId,p_request_message_id:p.requestMessageId,p_confirmation_message_id:body.confirmationMessageId,
      p_vat_validation:vatValidation,p_changes:p.changes,p_convert:p.action!=='change',p_proposal_key:createHash('sha256').update(body.confirmationToken).digest('hex'),
    });
    return NextResponse.json({ok:true,result});
  }catch(error) {
    const message=error instanceof Error?error.message:'';
    if(/invalid_|not_allowed|required|confirmation_|no_allowed_changes/.test(message)) return json('invalid_or_unmatched_confirmation',422);
    // No raw provider error or customer data is returned to the agent.
    return json('billing_operation_unconfirmed',409);
  }
}
