function proveGrossRounding(ctx, doc, expected, actual) {
  const payload=ctx.documentPayload||{};
  const requested=payload.items;
  const received=doc.items;
  if(!['CREATE_PROFORMA','CREATE_INVOICE'].includes(ctx.job?.job_type) ||
     payload.calc_vat_from!==1 || Number(doc.calc_vat_from)!==1 ||
     String(doc.currency)!==String(payload.currency) ||
     String(doc.number)!==String(ctx.documentNumber) ||
     String(doc.external_id)!==String(ctx.job.idempotency_key) ||
     String(doc.type)!==String(payload.type) ||
     !Array.isArray(requested)||!requested.length||
     !Array.isArray(received)||received.length!==requested.length) return {};
  const rate=Number(requested[0].vat_percent);
  if(!Number.isFinite(rate)||rate<=0||rate>100) return {};
  let gross=0, lineRoundedNet=0;
  for(let index=0;index<requested.length;index++) {
    const want=requested[index], got=received[index];
    const quantity=Number(want.quantity), price=Number(want.single_price_gross);
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<0||
       Number(want.vat_percent)!==rate||Number(got.vat_percent)!==rate||
       Number(got.quantity)!==quantity||!Number.isFinite(Number(got.single_price_gross))||
       Math.abs(Number(got.single_price_gross)-price)>Number.EPSILON*Math.max(1,Math.abs(price))*4||
       String(got.description)!==String(want.description)||
       Number(got.discount||0)!==0) return {};
    const lineGross=Math.round(quantity*price);
    gross+=lineGross;
    lineRoundedNet+=Math.round(lineGross*100/(100+rate));
  }
  const aggregateNet=Math.round(gross*100/(100+rate));
  if(gross!==expected.grossCents||gross!==actual.grossCents||
     lineRoundedNet!==expected.netCents||
     expected.vatCents!==gross-lineRoundedNet||
     actual.netCents!==aggregateNet||actual.vatCents!==gross-aggregateNet) return {};
  return {method:'GROSS_AGGREGATE_VS_ROUNDED_LINES',vatPercent:rate,lineCount:requested.length,
    sourceAmounts:expected,documentAmounts:actual,netDifferenceCents:actual.netCents-expected.netCents};
}
