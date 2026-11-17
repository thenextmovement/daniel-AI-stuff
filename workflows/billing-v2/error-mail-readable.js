const errorData = $input.first()?.json || {};

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function escapeHtml(value) {
  return clean(value, 4000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const workflowName = clean(errorData.workflow?.name || 'Unknown Workflow', 200);
const workflowId = clean(errorData.workflow?.id || 'unknown', 100);
const executionId = clean(errorData.execution?.id || 'N/A', 100);
const errorMessage = clean(errorData.execution?.error?.message || 'Unbekannter Fehler', 500);
const errorDescription = clean(errorData.execution?.error?.description || '', 1000);
const executionUrlRaw = clean(errorData.execution?.url || '', 1000);
const executionUrl = /^https:\/\/fuajob\.online\//.test(executionUrlRaw) ? executionUrlRaw : '';
const failedNode = clean(errorData.execution?.lastNodeExecuted || errorData.execution?.error?.node?.name || 'unknown', 200);
const rawError = clean(JSON.stringify(errorData.execution?.error || {}), 4000);
const normalizedError = errorMessage.toLowerCase().replace(/\b\d{4,}\b/g, '#').slice(0, 240);
const fingerprint = [workflowId, failedNode, normalizedError].join('|');

const now = Date.now();
const cooldownMs = 15 * 60 * 1000;
const outageThresholdMs = 10 * 60 * 1000;
const recoveryGapMs = 3 * 60 * 1000;
const hourKey = new Date(now).toISOString().slice(0, 13);
const state = $getWorkflowStaticData('global');
state.alertDedupe = state.alertDedupe && typeof state.alertDedupe === 'object' ? state.alertDedupe : { fingerprints: {}, hours: {} };
state.alertDedupe.fingerprints = state.alertDedupe.fingerprints || {};
state.alertDedupe.hours = state.alertDedupe.hours || {};
for (const [key, entry] of Object.entries(state.alertDedupe.fingerprints)) {
  if (!entry || now - Number(entry.lastSeenAt || 0) > 24 * 60 * 60 * 1000) delete state.alertDedupe.fingerprints[key];
}
for (const key of Object.keys(state.alertDedupe.hours)) {
  if (key !== hourKey) delete state.alertDedupe.hours[key];
}

// Billing-Worker laufen jede Minute. Vorübergehende Claim-/Gateway-Ausfälle
// werden deshalb durch den nächsten Planlauf automatisch erneut geprüft.
// Erst ein mindestens zehn Minuten durchgehend sichtbarer Ausfall alarmiert.
const combinedErrorText = [errorMessage, errorDescription, rawError].join(' ').toLowerCase();
const isBillingWorkflow = /^neontrip billing v2\b/i.test(workflowName);
const isClaimPath = /^claim .+ job$/i.test(failedNode)
  || /^raise .+ claim error$/i.test(failedNode)
  || failedNode === 'Raise Claim Error'
  || failedNode === 'Prepare Shopify Tax Sync Failure';
const hasTransientSignal = /(bad gateway|origin_bad_gateway|cloudflare|service failed|gateway timeout|timed? out|timeout|econnreset|econnrefused|socket hang up|fetch failed|too many requests|http(?: status)?\s*(?:429|500|502|503|504)\b|billing-job konnte nicht abgeholt werden|kundenversand-job konnte nicht abgeholt werden|änderungsbenachrichtigung konnte keinen job abrufen|shopify_tax_sync_failure_without_job)/i.test(combinedErrorText);
const isTransientBillingOpsOutage = isBillingWorkflow && isClaimPath && hasTransientSignal;

if (state.billingOpsOutage && now - Number(state.billingOpsOutage.lastSeenAt || 0) > recoveryGapMs) {
  delete state.billingOpsOutage;
}

if (isTransientBillingOpsOutage) {
  let incident = state.billingOpsOutage;
  if (!incident) {
    incident = {
      firstSeenAt: now,
      lastSeenAt: now,
      count: 0,
      alertSentAt: 0,
      workflows: {},
      latestExecutionId: executionId,
      latestExecutionUrl: executionUrl,
      latestError: errorMessage
    };
  }
  incident.lastSeenAt = now;
  incident.count = Number(incident.count || 0) + 1;
  incident.workflows = incident.workflows && typeof incident.workflows === 'object' ? incident.workflows : {};
  incident.workflows[workflowId] = {
    name: workflowName,
    failedNode,
    lastSeenAt: now,
    lastExecutionId: executionId
  };
  incident.latestExecutionId = executionId;
  incident.latestExecutionUrl = executionUrl;
  incident.latestError = errorMessage;
  state.billingOpsOutage = incident;

  const outageDurationMs = now - Number(incident.firstSeenAt || now);
  if (outageDurationMs < outageThresholdMs || Number(incident.alertSentAt || 0) > 0) {
    return [];
  }

  const sentThisHour = Number(state.alertDedupe.hours[hourKey] || 0);
  if (sentThisHour >= 20) return [];

  incident.alertSentAt = now;
  state.billingOpsOutage = incident;
  state.alertDedupe.hours[hourKey] = sentThisHour + 1;

  const workflowEntries = Object.values(incident.workflows)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((entry) => `<li><strong>${escapeHtml(entry.name)}</strong> – ${escapeHtml(entry.failedNode)}</li>`)
    .join('');
  const firstSeen = new Date(Number(incident.firstSeenAt)).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const lastSeen = new Date(Number(incident.lastSeenAt)).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const safeUrl = escapeHtml(incident.latestExecutionUrl || '');
  const bodyHtml = `<h2>Billing-Ops seit mindestens 10 Minuten nicht erreichbar</h2>
<p>Die minütlichen automatischen Wiederholungen sind weiterhin fehlgeschlagen. Es handelt sich um einen zusammengefassten Vorfall; die einzelnen Billing-Worker senden dafür keine separaten Warnungen.</p>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;">
<tr style="background:#f44336;color:white;"><td style="padding:10px;" colspan="2"><strong>Störungsbericht</strong></td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;width:190px;"><strong>Erstmals erkannt</strong></td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(firstSeen)}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Zuletzt bestätigt</strong></td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(lastSeen)}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Fehlversuche</strong></td><td style="padding:8px;border:1px solid #ddd;">${Number(incident.count || 0)}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Betroffene Worker</strong></td><td style="padding:8px;border:1px solid #ddd;"><ul>${workflowEntries}</ul></td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Letzter Fehler</strong></td><td style="padding:8px;border:1px solid #ddd;color:#d32f2f;">${escapeHtml(incident.latestError || 'Unbekannter Fehler')}</td></tr>
${incident.latestExecutionUrl ? `<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Letzte Ausführung</strong></td><td style="padding:8px;border:1px solid #ddd;"><a href="${safeUrl}">${safeUrl}</a></td></tr>` : ''}
</table>
<p>Nach einer fehlerfreien Lücke von drei Minuten gilt der Vorfall automatisch als erholt. Ein späterer neuer Ausfall wird separat überwacht.</p>`;

  return [{ json: {
    alert_type: 'error',
    severity_hint: 'critical',
    source_workflow_id: 'billing-ops-outage',
    source_workflow_name: 'NEONTRIP Billing v2',
    subject: 'DRINGEND: Billing-Ops seit 10 Minuten nicht erreichbar',
    body_html: bodyHtml,
    metadata: {
      execution_id: incident.latestExecutionId,
      execution_url: incident.latestExecutionUrl || null,
      alert_fingerprint: 'billing-ops-outage',
      first_seen_at: new Date(Number(incident.firstSeenAt)).toISOString(),
      last_seen_at: new Date(Number(incident.lastSeenAt)).toISOString(),
      failure_count: Number(incident.count || 0),
      affected_workflow_ids: Object.keys(incident.workflows),
      retry_window_minutes: 10
    }
  } }];
}

const previous = state.alertDedupe.fingerprints[fingerprint] || { lastSentAt: 0, lastSeenAt: 0, suppressed: 0 };
previous.lastSeenAt = now;
if (now - Number(previous.lastSentAt || 0) < cooldownMs) {
  previous.suppressed = Number(previous.suppressed || 0) + 1;
  state.alertDedupe.fingerprints[fingerprint] = previous;
  return [];
}
const sentThisHour = Number(state.alertDedupe.hours[hourKey] || 0);
if (sentThisHour >= 20) {
  previous.suppressed = Number(previous.suppressed || 0) + 1;
  state.alertDedupe.fingerprints[fingerprint] = previous;
  return [];
}
const suppressedSinceLastAlert = Number(previous.suppressed || 0);
previous.lastSentAt = now;
previous.suppressed = 0;
state.alertDedupe.fingerprints[fingerprint] = previous;
state.alertDedupe.hours[hourKey] = sentThisHour + 1;


function readable(value) {
  return clean(String(value ?? '')
    .replace(/data:[^\s"'<>]+/gi, '[eingebettete Daten entfernt]')
    .replace(/<!DOCTYPE[\s\S]*|<html[\s\S]*/gi, '[HTML-Fehlerseite des Dienstes]')
    .replace(/<[^>]*>/g, ' '), 2500);
}
const originalError = errorData.execution?.error || {};
const stackHeadline = String(originalError.stack || '').split(/\r?\n\s+at\s/)[0].replace(/^(?:\w*Error):\s*/, '');
const recoveredMessage = /^(?:https?|\/\/|image\/)/i.test(errorMessage) || /^https?$/.test(errorDescription)
  ? (stackHeadline || errorMessage) : errorMessage;
const readableMessage = readable(recoveredMessage);
const vatNotice = workflowId === 'gdnW2tkXdwwHoKLy' && failedNode === 'Send VAT Review Through Error Mail';
const orderReference = readableMessage.match(/#NEONT\d+/i)?.[0] || '';
const vatUnchecked = /checked=false/.test(readableMessage);
const vatInvalid = /checked=true, valid=false/.test(readableMessage);
const vatAddress = /checked=true, valid=true/.test(readableMessage) && /addressComparison=DIFFERENT_REQUIRES_REVIEW/.test(readableMessage);
let explanation = 'Der automatische Ablauf „' + workflowName + '“ konnte einen Arbeitsschritt nicht abschließen. Der erfolgreiche Abschluss ist damit nicht bestätigt.';
let nextStep = 'Bitte den betroffenen Vorgang und die technischen Details prüfen. Vor einer Wiederholung klären, ob bereits eine Rechnung, Zahlung oder Nachricht verarbeitet wurde.';
if (vatNotice) {
  explanation = (orderReference ? 'Bei Bestellung ' + orderReference + ' ' : 'Bei dieser Bestellung ')
    + (vatUnchecked ? 'konnte die Umsatzsteuer-ID nicht erfolgreich geprüft werden. Das bedeutet nicht, dass die Nummer ungültig ist.'
       : vatInvalid ? 'wurde die Umsatzsteuer-ID bei der Prüfung nicht als gültig bestätigt.'
       : vatAddress ? 'ist die Umsatzsteuer-ID gültig, aber die Rechnungsanschrift weicht von der Anschrift der EU-Auskunft ab.'
       : 'müssen Umsatzsteuer-ID, Firmenangaben und Rechnungsanschrift vor der steuerlichen Freigabe geklärt werden.')
    + ' Dies ist ein fachlicher Prüfhinweis. Laut diesem Ablauf bleibt die finale steuerfreie Rechnung gesperrt; andere vorhandene Sperren werden dadurch nicht aufgehoben.';
  nextStep = 'Die angegebenen Firmen- und Rechnungsdaten mit der EU-Auskunft vergleichen. Bei Abweichungen die richtige Zuordnung beim Kunden bestätigen lassen und die Klärung in OPS dokumentieren.';
} else if (/503|service unavailable|gleich wieder erreichbar/i.test(combinedErrorText) && /easybill/i.test(combinedErrorText + ' ' + failedNode)) {
  explanation = 'easybill war beim Abruf vorübergehend nicht erreichbar. Deshalb konnte der Ablauf die benötigten Rechnungsdaten nicht lesen und diesen Schritt nicht abschließen. Die Meldung beweist weder eine fehlende Kundenzahlung noch einen Fehler in der Rechnung.';
  nextStep = 'Nach Wiederherstellung von easybill den betroffenen Auftrag und den erfolgreichen Folgelauf prüfen. Zahlungen oder Erstattungen nicht ungeprüft erneut auslösen.';
} else if (/502|504|timeout|timed out|bad gateway/i.test(combinedErrorText)) {
  explanation = 'Ein benötigter Dienst hat nicht rechtzeitig oder mit einem Verbindungsfehler geantwortet. Deshalb konnte der erfolgreiche Abschluss dieses Arbeitsschritts nicht bestätigt werden.';
}
const explanationHtml = '<p>' + escapeHtml(explanation) + '</p><p><strong>Was ist zu tun?</strong> ' + escapeHtml(nextStep) + '</p>';

const safeWorkflowName = escapeHtml(workflowName);
const safeExecutionId = escapeHtml(executionId);
const safeErrorMessage = escapeHtml(readableMessage);
const safeDescription = escapeHtml(/^https?$/.test(readable(errorDescription)) ? 'Der vollständige Hinweis steht oben; der ursprüngliche Fehler wurde an einer Webadresse aufgeteilt.' : readable(errorDescription) || 'Keine zusätzliche technische Beschreibung vorhanden.');
const safeFailedNode = escapeHtml(failedNode);
const safeUrl = escapeHtml(executionUrl);
const bodyHtml = `<h2>${vatNotice ? 'Umsatzsteuerprüfung: Klärung erforderlich' : 'Automatischer Ablauf konnte nicht abgeschlossen werden'}</h2>\n${explanationHtml}
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;">
<tr style="background:#f44336;color:white;"><td style="padding:10px;" colspan="2"><strong>Fehlerbericht</strong></td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;width:170px;"><strong>Workflow</strong></td><td style="padding:8px;border:1px solid #ddd;">${safeWorkflowName}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Node</strong></td><td style="padding:8px;border:1px solid #ddd;">${safeFailedNode}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Execution ID</strong></td><td style="padding:8px;border:1px solid #ddd;">${safeExecutionId}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Fehlermeldung</strong></td><td style="padding:8px;border:1px solid #ddd;color:#d32f2f;">${safeErrorMessage}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Beschreibung</strong></td><td style="padding:8px;border:1px solid #ddd;">${safeDescription}</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Unterdrückt seit letzter Meldung</strong></td><td style="padding:8px;border:1px solid #ddd;">${suppressedSinceLastAlert}</td></tr>
${executionUrl ? `<tr><td style="padding:8px;border:1px solid #ddd;"><strong>Execution Link</strong></td><td style="padding:8px;border:1px solid #ddd;"><a href="${safeUrl}">${safeUrl}</a></td></tr>` : ''}
</table>
<p>Weitere identische Fehler werden 15 Minuten lang zusammengefasst. Globales Sicherheitslimit: 20 Fehlermails pro Stunde.</p>`;

return [{ json: {
  alert_type: 'error',
  severity_hint: 'warning',
  source_workflow_id: workflowId,
  source_workflow_name: workflowName,
  subject: `N8N Fehler: ${workflowName}`,
  body_html: bodyHtml,
  metadata: {
    execution_id: executionId,
    execution_url: executionUrl || null,
    failed_node: failedNode,
    error_message: errorMessage,
    error_description: errorDescription,
    alert_fingerprint: fingerprint,
    suppressed_since_last_alert: suppressedSinceLastAlert,
    dedupe_window_minutes: 15
  }
} }];

