import { NextRequest, NextResponse } from 'next/server';
import { isBillingWorkerAuthorized } from '@/lib/ops/billing/internal-auth';
import { supabaseRequest } from '@/lib/quotes/supabase-rest';
import type { BillingCaseRow } from '@/lib/ops/billing/repository';
import { orderConfirmationFromBillingCase, orderConfirmationFileName, renderOrderConfirmation } from '@/lib/ops/order-confirmation';

export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
  if(!isBillingWorkerAuthorized(request.headers))return NextResponse.json({ok:false,error:'unauthorized'},{status:401});
  const body=await request.json().catch(()=>null);
  if(!/^[0-9a-f-]{36}$/i.test(String(body?.billingCaseId||'')))return NextResponse.json({ok:false,error:'billing_case_id_invalid'},{status:422});
  try {
    const cases=await supabaseRequest<BillingCaseRow[]>('billing_cases',undefined,{select:'*',id:`eq.${body.billingCaseId}`,limit:1});
    const c=cases[0];if(!c)return NextResponse.json({ok:false,error:'not_found'},{status:404});
    const orderId=c.shopify_order_id.replace(/^gid:\/\/shopify\/Order\//,'');
    if(!/^\d+$/.test(orderId))throw new Error('order_confirmation_order_id_invalid');
    const sales=await supabaseRequest<Record<string,any>[]>('supplier_sales',undefined,{select:'id,offer_id,offer_number,document_reference,offer_snapshot,created_at',shopify_order_id:`in.(${orderId},gid://shopify/Order/${orderId})`,limit:3});
    const sale=(c.source_offer_id?sales.find(s=>s.offer_id===c.source_offer_id):null)|| (sales.length===1?sales[0]:null);
    if(sales.length>1&&!sale)throw new Error('order_confirmation_sale_ambiguous');
    const input=orderConfirmationFromBillingCase(c,sale);
    const bytes=await renderOrderConfirmation(input);
    return NextResponse.json({ok:true,filename:orderConfirmationFileName(sale?.document_reference||c.shopify_order_name),contentType:'application/pdf',contentBase64:Buffer.from(bytes).toString('base64')},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    console.error('billing order confirmation failed',error instanceof Error?error.message:'unknown');
    return NextResponse.json({ok:false,error:'billing_order_confirmation_failed'},{status:500});
  }
}
