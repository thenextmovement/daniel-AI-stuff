const errorData = $input.first()?.json || {};

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function escapeHtml(value) {
  return clean(value, 2000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
const normalizedError = errorMessage.toLowerCase().replace(/\b\d{4,}\b/g, '#').slice(0, 240);
const fingerprint = [workflowId, failedNode, normalizedError].join('|');

const now = Date.now();
const cooldownMs = 15 * 60 * 1000;
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

const safeWorkflowName = escapeHtml(workflowName);
const safeExecutionId = escapeHtml(executionId);
const safeErrorMessage = escapeHtml(errorMessage);
const safeDescription = escapeHtml(errorDescription || 'Keine Beschreibung');
const safeFailedNode = escapeHtml(failedNode);
const safeUrl = escapeHtml(executionUrl);
const bodyHtml = `<h2>Workflow-Fehler aufgetreten</h2>
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
