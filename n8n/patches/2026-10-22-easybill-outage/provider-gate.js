const config = $('Billing Worker Config').first().json;
const state = $getWorkflowStaticData('global');
const healthy = Number($json.statusCode) === 200 && Array.isArray($json.body?.items);
const now = Date.now();
const code = healthy ? null : String($json.statusCode || 'CONNECTION_UNCONFIRMED');
const previous = state.easybillAvailability;
const notify = !healthy && (!previous || previous.code !== code || now - previous.alertedAt >= 24*60*60*1000);
if (healthy) delete state.easybillAvailability;
else if (notify) state.easybillAvailability = {code, alertedAt:now};
return [{json:{...config,providerHealthy:healthy,notifyProviderFailure:notify,providerStatus:code,
  emailSubject:'NEONTRIP: easybill nicht erreichbar – Belegaufträge warten sicher',
  emailBody:'<h2>easybill-Verarbeitung angehalten</h2><p>Prozess: Rechnungen, Pro-forma und Stornobelege.</p><p>Die API-Prüfung ist fehlgeschlagen. Es wurde kein neuer Belegauftrag übernommen und kein Versuch dafür verbraucht. Nach einer erfolgreichen Prüfung läuft die Warteschlange automatisch weiter.</p><p>Bitte easybill-Erreichbarkeit prüfen, wenn der Zustand anhält. Bereits zuvor blockierte Einzelfälle müssen gesondert geprüft werden. Identische Ausfälle werden höchstens einmal in 24 Stunden gemeldet.</p>'
} }];