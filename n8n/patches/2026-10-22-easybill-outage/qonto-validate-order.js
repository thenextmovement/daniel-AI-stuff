const candidatePayload = $input.first().json || {};

const primaryPayload = $('Shopify: Find Order').first().json || {};

const prevData = $('Not Duplicate?').first().json || {};

function coreResolve({prevData, primaryOrders, candidatePayload}) {
  const legalTokens = new Set([
    'gmbh','ag','kg','mbh','ohg','ug','ev','e','v','se','gbr','kgaa','ltd','limited',
    'inc','llc','plc','corp','corporation','company','co','cokg','und'
  ]);
  const genericTokens = new Set([
    'zahlung','ueberweisung','sepa','rechnung','rechnungsnummer','kunde','konto',
    'bank','betriebs','betrieb','betriebsgesellschaft','gesellschaft','holding',
    'hotel','restaurant','service','services','group'
  ]);

  function normalizeWords(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/&/g, ' und ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function identityTokens(value) {
    return normalizeWords(value)
      .filter(token => !legalTokens.has(token))
      .filter(token => token.length > 1);
  }

  function distinctiveTokens(tokens) {
    return tokens.filter(token => token.length >= 3 && !genericTokens.has(token));
  }

  function identityFields(order) {
    const customer = order?.customer || {};
    const billing = order?.billing_address || {};
    const shipping = order?.shipping_address || {};
    return [
      {field: 'billing_company', value: billing.company},
      {field: 'shipping_company', value: shipping.company},
      {field: 'customer_company', value: customer.company},
      {field: 'customer_name', value: [customer.first_name, customer.last_name].filter(Boolean).join(' ')},
      {field: 'billing_name', value: [billing.first_name, billing.last_name].filter(Boolean).join(' ')},
      {field: 'shipping_name', value: [shipping.first_name, shipping.last_name].filter(Boolean).join(' ')}
    ].filter(entry => String(entry.value || '').trim());
  }

  const payerCandidates = Array.from(new Set(
    [
      ...(Array.isArray(prevData?.customer_identity_candidates) ? prevData.customer_identity_candidates : []),
      prevData?.customer_name
    ].map(value => String(value || '').trim()).filter(Boolean)
  ));

  function bestIdentityMatch(order, allowCompanySpacing = false) {
    let best = {score: 0, type: 'NO_MATCH', payer: payerCandidates[0] || '', field: '', value: ''};

    for (const payer of payerCandidates) {
      const payerTokens = identityTokens(payer);
      const payerDistinctive = distinctiveTokens(payerTokens);
      if (!payerDistinctive.length) continue;

      for (const entry of identityFields(order)) {
        const targetTokens = identityTokens(entry.value);
        const targetDistinctive = distinctiveTokens(targetTokens);
        if (!targetDistinctive.length) continue;

        const payerKey = payerTokens.join(' ');
        const targetKey = targetTokens.join(' ');
        const sharedDistinctive = payerDistinctive.filter(token => targetDistinctive.includes(token));
        let score = 0;
        let type = 'NO_MATCH';

        if (payerKey && payerKey === targetKey && sharedDistinctive.length) {
          score = 100;
          type = 'EXACT_NORMALIZED';
        } else if (
          allowCompanySpacing &&
          entry.field.endsWith('_company') &&
          payerTokens.join('').length >= 6 &&
          payerTokens.join('') === targetTokens.join('')
        ) {
          // Exact company spelling; only word separators differ.
          score = 100;
          type = 'EXACT_COMPANY_COMPACT';
        } else {
          const payerSet = new Set(payerTokens);
          const targetSet = new Set(targetTokens);
          const payerContained = payerTokens.every(token => targetSet.has(token));
          const targetContained = targetTokens.every(token => payerSet.has(token));
          const union = new Set([...payerTokens, ...targetTokens]);
          const intersection = [...payerSet].filter(token => targetSet.has(token));
          const jaccard = union.size ? intersection.length / union.size : 0;

          if ((payerContained || targetContained) && sharedDistinctive.length) {
            score = 90;
            type = 'TOKEN_CONTAINMENT';
          } else if (jaccard >= 0.75 && sharedDistinctive.length) {
            score = 85;
            type = 'STRONG_TOKEN_OVERLAP';
          }
        }

        if (score > best.score) {
          best = {score, type, payer, field: entry.field, value: entry.value};
        }
      }
    }

    return best;
  }

  function canonicalNeon(value) {
    const match = String(value || '').toUpperCase().match(/NEONT?(\d{4})/);
    return match ? 'NEONT' + match[1] : String(value || '').replace(/^#/, '').toUpperCase();
  }

  function cents(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function mapGraphOrder(order) {
    return {
      id: String(order?.legacyResourceId || '').replace(/\D/g, ''),
      name: order?.name || '',
      cancelled_at: order?.cancelledAt || null,
      financial_status: String(order?.displayFinancialStatus || '').toLowerCase(),
      total_price: String(order?.totalPriceSet?.shopMoney?.amount ?? ''),
      current_total_price: String(order?.currentTotalPriceSet?.shopMoney?.amount ?? ''),
      currency: order?.totalPriceSet?.shopMoney?.currencyCode || order?.currentTotalPriceSet?.shopMoney?.currencyCode || 'EUR',
      email: order?.email || null,
      contact_email: order?.email || null,
      tags: Array.isArray(order?.tags) ? order.tags.join(', ') : String(order?.tags || ''),
      customer: {
        first_name: order?.customer?.firstName || '',
        last_name: order?.customer?.lastName || '',
        email: order?.customer?.email || '',
        company: ''
      },
      billing_address: {
        company: order?.billingAddress?.company || '',
        first_name: order?.billingAddress?.firstName || '',
        last_name: order?.billingAddress?.lastName || ''
      },
      shipping_address: {
        company: order?.shippingAddress?.company || '',
        first_name: order?.shippingAddress?.firstName || '',
        last_name: order?.shippingAddress?.lastName || ''
      }
    };
  }

  const txCents = Number(prevData?.amountCents || cents(prevData?.amount));
  const referenceNeonNumber = canonicalNeon(prevData?.neonNumber);
  const exactPrimaryOrders = (Array.isArray(primaryOrders) ? primaryOrders : [])
    .filter(order => canonicalNeon(order?.name) === referenceNeonNumber);
  const primary = exactPrimaryOrders[0] || null;

  function orderCompanyCandidates(order) {
    return [
      order?.billing_address?.company,
      order?.shipping_address?.company,
      order?.customer?.company
    ].map(value => String(value || '').trim()).filter(Boolean);
  }

  function orderEmailCandidates(order) {
    return [
      order?.email,
      order?.contact_email,
      order?.customer?.email
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  }

  function settlementFor(order) {
    const orderCents = cents(order?.total_price);
    const isUmdaschCustomer =
      orderCompanyCandidates(order).some(value => /umdasch/i.test(value)) ||
      orderEmailCandidates(order).some(value => /@(?:[a-z0-9-]+\.)*umdasch\.[a-z]{2,}$/i.test(value));
    const skontoPercent = 3;
    const skontoDays = 30;
    const skontoCents = Math.round(orderCents * skontoPercent / 100);
    const skontoPaymentCents = orderCents - skontoCents;
    const isUmdaschSkonto = isUmdaschCustomer && txCents === skontoPaymentCents;
    return {orderCents, isUmdaschCustomer, skontoPercent, skontoDays, skontoCents, isUmdaschSkonto};
  }

  function success(order, match, rematched, rematchReason) {
    const settlement = settlementFor(order);
    const shopifyAlreadyPaid = String(order?.financial_status || '').toLowerCase() === 'paid';
    const targetNeonNumber = canonicalNeon(order?.name);
    const id = String(order?.id || '').replace(/^gid:\/\/shopify\/Order\//, '');
    return {
      ...prevData,
      stop: false,
      sendEmail: false,
      neonNumber: targetNeonNumber,
      referenceNeonNumber,
      rematched,
      rematchedFromNeonNumber: rematched ? referenceNeonNumber : null,
      rematchedToNeonNumber: rematched ? targetNeonNumber : null,
      rematchReason: rematched ? rematchReason : null,
      customerIdentityMatched: true,
      identityMatchType: match.type,
      identityMatchField: match.field,
      order,
      isUmdaschCustomer: settlement.isUmdaschCustomer,
      isUmdaschSkonto: settlement.isUmdaschSkonto,
      skontoPercent: settlement.isUmdaschSkonto ? settlement.skontoPercent : null,
      skontoDays: settlement.isUmdaschSkonto ? settlement.skontoDays : null,
      skontoCents: settlement.isUmdaschSkonto ? settlement.skontoCents : 0,
      settlementGrossCents: settlement.orderCents,
      shopifyOrderId: id,
      shopifyOrderGid: 'gid://shopify/Order/' + id,
      shopifyNeedsUpdate: !shopifyAlreadyPaid,
      shopifyAlreadyPaid,
      orderLink: 'https://admin.shopify.com/store/galaxybuzzdk/orders/' + id
    };
  }

  let primaryFailureReason = 'order_not_found';
  let primaryIdentity = {score: 0, type: 'NO_MATCH', field: ''};

  if (primary) {
    const settlement = settlementFor(primary);
    primaryIdentity = bestIdentityMatch(primary, prevData?.fuzzyMatch === false);

    if (primary?.cancelled_at) {
      primaryFailureReason = 'order_cancelled';
    } else if (settlement.orderCents !== txCents && !settlement.isUmdaschSkonto) {
      primaryFailureReason = 'amount_mismatch';
    } else if (primaryIdentity.score < 85) {
      primaryFailureReason = payerCandidates.length ? 'customer_identity_mismatch' : 'payer_identity_unavailable';
    } else {
      return success(primary, primaryIdentity, false, null);
    }
  }

  // A settled credit with an exact reference and strong payer identity is money received,
  // even when a small balance remains. Notify operations; never waive it automatically.
  const bank = prevData.raw_transaction || {};
  const financialState = String(primary?.financial_status || '').toLowerCase();
  const outstandingText = primary?.total_outstanding;
  const outstandingCents = outstandingText !== undefined && outstandingText !== null && /^\d+(?:\.\d{1,2})?$/.test(String(outstandingText))
    ? cents(outstandingText) : financialState === 'pending' ? cents(primary?.total_price) : null;
  const missingCents = outstandingCents === null ? null : outstandingCents - txCents;
  if (exactPrimaryOrders.length === 1 && primary && !primary.cancelled_at &&
      prevData.fuzzyMatch === false && primaryIdentity.score >= 85 &&
      ['pending','partially_paid'].includes(financialState) &&
      primary.currency === 'EUR' && bank.currency === 'EUR' &&
      bank.status === 'completed' && bank.side === 'credit' &&
      Number.isSafeInteger(txCents) && txCents > 0 && Number.isSafeInteger(missingCents) && missingCents > 0) {
    const small = missingCents <= 2000;
    const money = value => (value / 100).toLocaleString('de-DE', {minimumFractionDigits:2,maximumFractionDigits:2}) + ' €';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const id = String(primary.id || '').replace(/^gid:\/\/shopify\/Order\//, '');
    const orderLink = 'https://admin.shopify.com/store/galaxybuzzdk/orders/' + encodeURIComponent(id);
    return {
      ...prevData, stop:true, sendEmail:true,
      reason:small ? 'confirmed_underpayment_small' : 'confirmed_underpayment',
      receivedCents:txCents, remainingCents:missingCents, outstandingBeforeCents:outstandingCents,
      emailRecipient:'support@neontrip.de',
      emailSubject:'Zahlung eingegangen – ' + (small ? 'nur ' : '') + money(missingCents) + ' offen – ' + primary.name,
      emailBody:'<h2>Zahlung eingegangen</h2><p><strong>' + esc(primary.name) + '</strong></p>' +
        '<p style="padding:16px;background:#e8f5e9;color:#14532d;font-size:20px"><strong>Bankeingang: ' + money(txCents) + '</strong></p>' +
        '<p style="padding:16px;background:#fff3cd;color:#78350f;font-size:20px"><strong>Noch offen: ' + money(missingCents) + '</strong></p>' +
        '<p>' + (small ? 'Kleiner Restbetrag bis 20 €: Bitte Produktionsfreigabe und Erlass oder Nachforderung ausdrücklich entscheiden. Den Auftrag nicht unbemerkt als vollständig unbezahlt liegen lassen.' : 'Bitte Teilzahlung zuordnen und den verbleibenden Betrag prüfen.') + '</p>' +
        '<p>Die Bankzahlung ist eingegangen. Shopify und easybill wurden noch nicht als vollständig bezahlt markiert; ein Erlass erfolgt nur nach Freigabe. Weitere noch nicht zugeordnete Zahlungen bitte berücksichtigen.</p>' +
        '<p><a href="' + orderLink + '">Bestellung in Shopify öffnen</a></p><p>Zahler: ' + esc(prevData.customer_name) +
        '<br>Verwendungszweck: ' + esc(prevData.reference) + '<br>Qonto-ID: ' + esc(prevData.transaction_id) + '</p>',
      orderLink, primaryOrderName:primary.name, primaryFailureReason:'amount_mismatch',
      primaryIdentityMatchType:primaryIdentity.type, customerIdentityMatched:true
    };
  }

  const graphConnection = candidatePayload?.data?.orders || null;
  const graphErrors = Array.isArray(candidatePayload?.errors) ? candidatePayload.errors : [];
  const graphNodes = Array.isArray(graphConnection?.nodes) ? graphConnection.nodes : [];
  const searchIncomplete = graphConnection?.pageInfo?.hasNextPage === true;
  const mappedCandidates = graphNodes.map(mapGraphOrder);

  const eligibleMatches = mappedCandidates
    .map(order => ({order, identity: bestIdentityMatch(order)}))
    .filter(entry => !entry.order.cancelled_at)
    .filter(entry => cents(entry.order.total_price) === txCents)
    .filter(entry => {
      const state = String(entry.order.financial_status || '').toLowerCase();
      return state === 'pending' || state === '';
    })
    .filter(entry => entry.identity.score >= 85);

  if (!graphErrors.length && !searchIncomplete && eligibleMatches.length === 1) {
    return success(eligibleMatches[0].order, eligibleMatches[0].identity, true, primaryFailureReason);
  }

  let reason = 'shopify_rematch_unresolved';
  if (graphErrors.length || !graphConnection) reason = 'shopify_rematch_search_failed';
  else if (searchIncomplete) reason = 'shopify_rematch_search_incomplete';
  else if (eligibleMatches.length > 1) reason = 'shopify_rematch_ambiguous';

  const safeCandidates = eligibleMatches.slice(0, 10).map(entry => ({
    name: entry.order.name,
    amount: entry.order.total_price,
    financial_status: entry.order.financial_status,
    identity_match: entry.identity.type,
    identity_field: entry.identity.field
  }));

  const bodyLines = [
    'PROBLEM: Shopify-Zuordnung konnte nicht sicher abgeschlossen werden',
    '',
    'Die im Verwendungszweck erkannte NEONT-Nummer ist nur ein Suchhinweis.',
    'Der Referenztreffer wurde nicht verarbeitet, weil Nummer, Betrag, Bestellstatus und Kundenidentitaet nicht gemeinsam bestaetigt sind.',
    '',
    'TRANSAKTIONS-DETAILS:',
    '• Betrag: €' + (txCents / 100).toFixed(2),
    '• Zahler: ' + (prevData?.customer_name || 'Unbekannt'),
    '• Verwendungszweck: ' + (prevData?.reference || ''),
    '• Qonto Transaction ID: ' + (prevData?.transaction_id || 'N/A'),
    '',
    'PRUEFERGEBNIS:',
    '• Referenz: ' + referenceNeonNumber,
    '• Referenztreffer: ' + (primary ? String(primary.name || referenceNeonNumber) : 'nicht gefunden'),
    '• Konflikt: ' + primaryFailureReason,
    '• Eindeutige Betrag-/Identitaetskandidaten: ' + eligibleMatches.length,
    '• Kandidatensuche vollstaendig: ' + (!searchIncomplete && !graphErrors.length ? 'Ja' : 'Nein'),
    '',
    'WAS WURDE GEMACHT:',
    '• Shopify: NICHT als bezahlt markiert',
    '• Billing/easybill: NICHT verarbeitet',
    '• Tag gesetzt: Nein',
    '',
    'AKTION ERFORDERLICH:',
    'Bitte Zahlung manuell anhand von Betrag, Zahler und Shopify-Kunde pruefen. Keine Rueckerstattung allein wegen der falschen Referenz veranlassen.'
  ];

  return {
    ...prevData,
    stop: true,
    reason,
    sendEmail: true,
    emailSubject: 'N8N Pruefen: Shopify-Zuordnung nicht eindeutig - ' + referenceNeonNumber,
    emailBody: bodyLines.join('\n'),
    referenceNeonNumber,
    primaryFailureReason,
    primaryOrderName: primary?.name || null,
    primaryIdentityMatchType: primaryIdentity.type,
    rematchCandidateCount: eligibleMatches.length,
    rematchCandidates: safeCandidates,
    shopifyRematchSearchIncomplete: searchIncomplete,
    shopifyRematchSearchErrors: graphErrors.slice(0, 3).map(error => String(error?.message || error))
  };
}

const resolved = coreResolve({

  prevData,

  primaryOrders: Array.isArray(primaryPayload.orders) ? primaryPayload.orders : [],

  candidatePayload

});

return [{ json: resolved }];
