
const src=$('Read Summary').first().json, now=new Date().toISOString();
function rest(name){const pages=$(name).all().map(i=>i.json);let all=[],total=null;for(const p of pages){if(![200,206].includes(p.statusCode)||!Array.isArray(p.body))throw Error(name+'_HTTP');const range=String(p.headers?.['content-range']||p.headers?.['Content-Range']||'');const t=range.split('/')[1];if(!/^\d+$/.test(t||''))throw Error(name+'_COUNT');if(total!==null&&total!==Number(t))throw Error(name+'_CHANGED');total=Number(t);all.push(...p.body);}if(all.length!==total)throw Error(name+'_INCOMPLETE');return all;}
const states=rest('Read Daily Dunning States'),logs=rest('Read Daily Reminder Logs'),mails=rest('Read Daily Mail Evidence'),audits=rest('Read Daily Verified Stages');
const senderIssues=rest('Read Daily Sender Issues');
const norm=x=>'#NEONT'+String(x||'').replace(/\D/g,'');
const cents=m=>Math.round(Number(m?.shopMoney?.amount)*100);
const bank=new Map(src.bank.map(b=>[b.transaction_id,b]));
function paid(id,amount){const b=bank.get(id);return b?.side==='credit'&&b.status==='completed'&&b.currency==='EUR'&&Math.round(Number(b.amount)*100)===amount;}
const allocations={
'4421':paid('dara-nova-gmbh-6402-1-transaction-019f2853-7bd1-7c3e-a747-7b4ed2-846c7b',63573)?63573:0,
'4427':paid('dara-nova-gmbh-6402-1-transaction-01a0d8d7-9523-7709-8ea3-36e944-8a7185',59857)?59857:0,
'4652':paid('dara-nova-gmbh-6402-1-transaction-01a0a046-9a76-7918-b6c5-a142cd-7fab25',469693)?100912:0,
'4653':paid('dara-nova-gmbh-6402-1-transaction-01a0a046-9a76-7918-b6c5-a142cd-7fab25',469693)?368781:0,
'4680':paid('dara-nova-gmbh-6402-1-transaction-01a090be-01f2-7dd0-89d0-c38b08-ca545f',2121175)?2121175:0,
'4422':src.bank.some(b=>b.side==='credit'&&b.status==='completed'&&b.amount===330&&String(b.reference||'').includes('4329'))?33000:0,
'4485':105672
};
const issues={
'4421':'635,73 EUR Teilzahlung; manuelle S2 vom 17.09.; Fortsetzung des Altverlaufs prüfen.',
'4422':'330,00 EUR wurden von Altauftrag 4329 zugeordnet; Rest höchstens 62,70 EUR; Erinnerung vom 09.09. nachgewiesen.',
'4427':'598,57 EUR am 25.09. bezahlt; Zahlung in Shopify/Abrechnung noch nicht zugeordnet. Keine weitere Mahnung.',
'4449':'Pause und Stopptag; Leistungs-/Rechnungsprüfung erforderlich.',
'4485':'Zwei dokumentierte PayPal-Zahlungen über 1.056,72 EUR; Shopify offen. Buchungsabgleich erforderlich, keine Mahnung.',
'4499':'Manuelle Zahlungserinnerung am 08.09. nachgewiesen; Rechnung anschließend an invoiceeu@emco-eroller.de.',
'4539':'Stopptag und kollidierende Rechnungsnummer; keine pauschale Nachsendung.',
'4543':'Aktueller Beleg 4543, ursprünglich versandt als Rechnung 4540; Bankreferenz 4543 gehört anderem Kunden. Belegzuordnung prüfen.',
'4652':'Sammelzahlung 4.696,93 EUR vom 14.09. deckt 4652 und 4653 vollständig; Zuordnung in Shopify/Abrechnung fehlt.',
'4653':'Sammelzahlung 4.696,93 EUR vom 14.09. deckt 4652 und 4653 vollständig; Zuordnung in Shopify/Abrechnung fehlt.',
'4662':'Zahlungszuordnung prüfen: zweimal 4.899,24 EUR für anderen Auftrag 4659 eingegangen; möglichen Überhang vor Erinnerung klären.',
'4676':'Barzahlung bei Abholung ausdrücklich vereinbart; Kasse/Abholung prüfen.',
'4680':'50 Prozent / 21.211,75 EUR am 11.09. bezahlt; Restfälligkeit und Stopptag prüfen.'
};
const cases=[];
for(const o of src.shopify.open){const key=norm(o.name),digits=String(o.name).replace(/\D/g,'');const state=states.find(s=>norm(s.shopify_order_number)===key);
const validLogs=logs.filter(l=>norm(l.shopify_order_number)===key&&['sent','sent-custom','import-outlook'].includes(l.status));
const proofs=audits.filter(a=>String(a.document_id)===String(o.legacyResourceId)&&a.metadata?.provider_message_id&&a.metadata?.sent_at);
// The shared status table and imported sent logs may be copies of modern evidence.
const modernProofs=proofs.filter(a=>a.metadata?.evidence_schema==='t099.sender.evidence.v1');
const matchesModern=(stage,sentAt)=>Number.isFinite(Date.parse(sentAt))&&modernProofs.some(a=>Number(a.metadata.stage)===stage&&Date.parse(a.metadata.sent_at)===Date.parse(sentAt));
const legacyLogs=validLogs.filter(l=>!matchesModern(Number(l.mahnstufe)||0,l.sent_at));
const projectedStage=Number(state?.mahnstufe)||0;
const legacyStage=Math.max(matchesModern(projectedStage,state?.last_sent_at)?0:projectedStage,...legacyLogs.map(l=>Number(l.mahnstufe)||0),...proofs.filter(a=>!modernProofs.includes(a)).map(a=>Number(a.metadata.stage)||0));
const modernStage=Math.max(0,...modernProofs.map(a=>Number(a.metadata.stage)||0));
const stage=Math.max(legacyStage,modernStage);
const stageConflict=legacyStage>0&&modernStage>0&&(legacyStage!==modernStage||legacyStage>=4);
const stageSource=stageConflict?'mixed':modernStage>0?'t099':legacyStage>0?'legacy':'unknown';
const labels={0:'Noch keine Nachricht',1:'Kurze Rückfrage',2:'Freundliche Erinnerung',3:'Letzte freundliche Erinnerung',4:'1. Mahnung',5:'2. Mahnung',6:'3. und letzte Mahnung'};
const stageLabel=stageConflict?'Mahnstufe '+stage+' (Zuordnung prüfen)':stageSource==='legacy'&&stage>=4?'Letzte Mahnstufe (Altbestand, Stufe '+stage+')':labels[stage]||'Mahnstufe '+stage;
const finalStage=!stageConflict&&(legacyStage>=4||modernStage>=6);
const docs=[...src.invoices,...src.proformas].filter(d=>norm(d.order_number)===key&&!d.cancel_id&&!d.is_draft);
const email=String(o.email||'').toLowerCase();
const candidates=mails.filter(m=>m.sent_at&&m.message_id&&new RegExp('NEON[T]?[ -]?'+digits+'(?![0-9])','i').test(String(m.subject||''))&&(m.to_emails||[]).some(e=>String(e).toLowerCase()===email));
const reminder=candidates.filter(m=>/mahnung|zahlungserinnerung|offener restbetrag|rechnung.*angekommen|rückfrage.*rechnung/i.test(m.subject||'')).sort((a,b)=>String(b.sent_at).localeCompare(String(a.sent_at)))[0];
const test=['4622','4625'].includes(digits)||(o.tags||[]).some(t=>/e2e|testbestellung/i.test(t));
const gross=cents(o.totalOutstandingSet),allocated=Math.min(gross,allocations[digits]||0),remaining=Math.max(0,gross-allocated);
const hold=Boolean(state?.paused)||(o.tags||[]).some(t=>/mahnstop|mahn.stop|keine.?mahnung|keine.?zahlungserinnerung|nicht.?mahnen|inkasso|insolven|warten.?auf.?zahlung|mit.*anwalt/i.test(t));
let status=o.cancelledAt?'cancelled':test?'test':o.displayFinancialStatus==='PAID'?'payment_data_conflict':remaining===0?'payment_recording_required':hold?'held':stageConflict?'stage_source_review':finalStage?'final_stage_review':stage>0||reminder?'reminder_evidenced':'reminder_missing';
if(!['cancelled','test','payment_data_conflict','payment_recording_required','held','final_stage_review','stage_source_review'].includes(status)&&state?.next_due_at&&String(state.next_due_at)<now.slice(0,10))status='follow_up_due';
const bankCandidates=src.bank.filter(b=>b.side==='credit'&&b.status==='completed'&&new RegExp('NEON\\s*T?\\s*'+digits+'(?![0-9])','i').test(String(b.reference||''))).map(b=>({transaction_id:b.transaction_id,amount:b.amount,settled_at:b.settled_at}));
const latestBlocked=senderIssues.filter(a=>String(a.document_id)===String(o.legacyResourceId)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0];
const latestSent=[state?.last_sent_at,...validLogs.map(l=>l.sent_at),...proofs.map(a=>a.metadata.sent_at)].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
const blockUnresolved=latestBlocked&&(!latestSent||Date.parse(latestBlocked.created_at)>Date.parse(latestSent));
if(blockUnresolved&&!['cancelled','test','payment_data_conflict','payment_recording_required','held','final_stage_review','stage_source_review'].includes(status))status='sender_blocked';
const blockNote=blockUnresolved?'Automatischer Versand Stufe '+latestBlocked.metadata?.stage+' am '+latestBlocked.created_at+' blockiert: '+(latestBlocked.metadata?.reasons||[]).join(', ')+'. ':'';
const stageNote=stageLabel+' | Ablauf: '+(stageSource==='t099'?'aktuell':stageSource==='legacy'?'Altbestand':stageSource==='mixed'?'Zuordnung prüfen':'noch unbelegt')+(state?.next_due_at&&!finalStage&&!stageConflict?' | Nächste Frist '+state.next_due_at:'')+'. ';
const note=stageNote+blockNote+(issues[digits]||(status==='follow_up_due'?'Nächste Mahnstufe seit '+state.next_due_at+' fällig; Versandlauf und Sperren prüfen.':!docs.length?'Kein eindeutig passender offener Easybill-Beleg; Zuordnung prüfen.':status==='reminder_missing'?'Keine Zahlungserinnerung im geprüften Versandnachweis; Zahlung/Beleg/Sperren vor Nachsendung prüfen.':status==='held'?'Bestehende Pause oder Shopify-Sperre beachten.':stageConflict?'Zuordnung zwischen Altbestand und aktuellem Ablauf prüfen; keine automatische Fortsetzung.':finalStage?'Letzte Mahnstufe erreicht; Folgeprüfung statt weiterer pauschaler Erinnerung.':'Versandverlauf vorhanden; nächste Fälligkeit und Sperren prüfen.'));
cases.push({order:key,shopify_order_id:String(o.legacyResourceId),created_at:o.createdAt,customer:o.billingAddress?.company||[o.billingAddress?.firstName,o.billingAddress?.lastName].filter(Boolean).join(' '),email,gross_cents:gross,allocated_cents:allocated,remaining_cents:remaining,stage,stage_source:stageSource,stage_label:stageLabel,next_due_at:state?.next_due_at||null,status,note,sender_blocked:Boolean(blockUnresolved),invoice_count:docs.length,proforma_only:docs.length>0&&docs.every(d=>d.type==='PROFORMA_INVOICE'),last_reminder_at:[latestSent,reminder?.sent_at].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null,bank_candidates:bankCandidates});
}
const active=cases.filter(c=>!['cancelled','test','payment_data_conflict','payment_recording_required'].includes(c.status));
const noteRows=cases.map(c=>{const old=states.find(s=>norm(s.shopify_order_number)===c.order);const prior=String(old?.note||'').replace(/\n?\[35-TAGE-KONTROLLE\][\s\S]*?\[\/35-TAGE-KONTROLLE\]/g,'').trim();const note='[35-TAGE-KONTROLLE] '+now.slice(0,10)+' | '+c.status+' | Arbeitsrest '+(c.remaining_cents/100).toFixed(2)+' EUR | '+c.note+' [/35-TAGE-KONTROLLE]';return{shopify_order_number:c.order,note:[prior,note].filter(Boolean).join('\n'),updated_by:'n8n:35-day-dunning-control',updated_at:now};});
const orderRows=src.shopify.orders.map(o=>({shopify_order_id:String(o.legacyResourceId),name:o.name,financial_status:String(o.displayFinancialStatus||'').toLowerCase(),total_price:Number(o.currentTotalPriceSet.shopMoney.amount),total_outstanding:Number(o.totalOutstandingSet.shopMoney.amount),currency:o.totalOutstandingSet.shopMoney.currencyCode,email:o.email||null,tags:(o.tags||[]).join(', '),created_at:o.createdAt,cancelled_at:o.cancelledAt||null,ingested_at:now}));
const totals={orders_checked:src.shopify.total,raw_positive:cases.length,excluded_cancelled:cases.filter(c=>c.status==='cancelled').length,excluded_tests:cases.filter(c=>c.status==='test').length,payment_recording_required:cases.filter(c=>c.status==='payment_recording_required').length,open_or_review:active.length,working_amount_cents:active.reduce((s,c)=>s+c.remaining_cents,0),sender_blocked:active.filter(c=>c.sender_blocked).length,missing_reminder_evidence:active.filter(c=>c.status==='reminder_missing').length,held:active.filter(c=>c.status==='held').length,follow_up_due:active.filter(c=>c.status==='follow_up_due').length};
const record={document_id:now.slice(0,10),workflow_name:'NEONTRIP Daily 35-Day Dunning Control',action:'daily_35_day_dunning_audit',status:'success',metadata:{schema:'dunning.35day.control.v1',cutoff:src.shopify.cutoff,observed_at:now,totals,stages:[...new Set([0,1,2,3,4,5,6,...active.map(c=>c.stage)])].sort((a,b)=>a-b).map(stage=>({stage,count:active.filter(c=>c.stage===stage).length,amount_cents:active.filter(c=>c.stage===stage).reduce((s,c)=>s+c.remaining_cents,0)})),cases,source_counts:{shopify_pages:src.shopify.pages,invoices:src.invoices.length,proformas:src.proformas.length,unique_bank_transactions:src.bank.length,messages:mails.length}}};
return[{json:{order_rows:orderRows,note_rows:noteRows,audit_record:record,totals}}];
