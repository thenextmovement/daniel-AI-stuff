const audit=$('Build Daily OPS Reconciliation').first().json.audit_record;
if(!audit||audit.status!=='success'||!Array.isArray(audit.metadata?.cases))throw Error('DUNNING_ALERT_SOURCE_UNVERIFIED');
const actions={
 held:'Bestehende Pause, Zahlung oder Vereinbarung klären; nicht automatisch freigeben.',
 sender_blocked:'Versandblockade prüfen; tatsächlichen Outlook-Versand vor Wiederholung abgleichen.',
 follow_up_due:'Fälligen Folgeschritt prüfen und Zahlung, Beleg sowie Kundeneinwände abgleichen.',
 reminder_missing:'Erinnerung nicht nachgewiesen; zuerst Zahlung, Beleg und Kundeneinwände prüfen.',
 payment_recording_required:'Belegten Zahlungseingang in der Abrechnung zuordnen; keine Mahnung.',
 payment_data_conflict:'Widersprüchliche Zahlungsdaten klären; keine Mahnung.',
 stage_source_review:'Zuordnung von Altbestand und aktuellem Mahnablauf prüfen; keine automatische Fortsetzung.',
 final_stage_review:'Letzte Mahnstufe erreicht; weiteren Fallweg manuell prüfen.'
};
const cases=audit.metadata.cases.filter(c=>Object.hasOwn(actions,c.status));
if(!cases.length)return [];
if(cases.some(c=>!/^#NEONT[0-9]+$/.test(c.order)))throw Error('DUNNING_ALERT_ORDER_INVALID');
const grouped=Object.keys(actions).map(status=>({status,orders:cases.filter(c=>c.status===status).map(c=>c.order).sort(),stageDetails:cases.filter(c=>c.status===status).filter(c=>c.stage_label).map(c=>c.order+': '+c.stage_label+(c.stage_source==='t099'?' (aktueller Ablauf)':'')).sort()})).filter(g=>g.orders.length);
const body='<p>Die tägliche Kontrolle der Bestellungen älter als 35 Tage ist abgeschlossen. Bei '+cases.length+' Fällen ist eine Prüfung nötig. Gesperrte Fälle bleiben gesperrt; dies ist keine automatische Freigabe zum Versand.</p>'
+grouped.map(g=>'<p><strong>'+g.orders.join(', ')+'</strong><br>'+actions[g.status]+(['final_stage_review','stage_source_review'].includes(g.status)?'<br>'+g.stageDetails.join('; '):'')+'</p>').join('')
+'<p>Details und E-Mail-Prüfhinweise stehen in OPS. <a href="https://fuajob.online/workflow/oA57luKTeHEE06uN">Kontrolllauf öffnen</a>.</p>';
return [{json:{
 emailRecipient:'support@neontrip.de',emailSubject:'Mahnkontrolle: '+cases.length+' Fälle zur Prüfung',
 emailBody:body,workflowName:'NEONTRIP | Daily 35-Day Dunning Control',source_workflow_name:'NEONTRIP | Daily 35-Day Dunning Control',
 errorMessage:grouped.map(g=>g.status+':'+g.orders.join(',')).join('|'),lastNode:'Daily 35-Day Dunning Control',
 audit_id:$('Verify Daily Dunning Audit').first().json.audit_id
}}];