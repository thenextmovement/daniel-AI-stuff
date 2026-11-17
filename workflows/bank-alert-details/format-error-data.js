
const errorData = $('Error Trigger').first().json;
const config = $('Config').first().json;

// Preserve actionable bank diagnostics before the generic formatter can discard them.
if (errorData.workflow?.id === 'FyZCGkPNoA6EQI3N') {
  const execution = errorData.execution || {};
  const error = execution.error || errorData.trigger?.error || {};
  const plain = value => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  const redact = value => plain(value).slice(0, 8000)
    .replace(/(["']?(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+\S+|[^\s,;<>]+)/gi, '$1[entfernt]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, '[Zugangsdaten entfernt]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL entfernt]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-Mail entfernt]')
    .replace(/\b[A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30}\b/gi, '[IBAN entfernt]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID entfernt]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[Kennung entfernt]')
    .replace(/\+?\d[\d ()/.-]{7,}\d/g, '[Nummer entfernt]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  const html = value => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const allowedNodes = new Set(['Webhook','Qonto: Transaktionen','Mappen + Batchen','Supabase: Upsert',
    'Mirror every 15 minutes','Verify Mirror Write','Record Verified Sync']);
  const candidateNode = execution.lastNodeExecuted || error.node?.name || errorData.trigger?.error?.node?.name;
  const lastNode = allowedNodes.has(candidateNode) ? candidateNode : 'Unbekannter Schritt';
  const message = redact(error.message) || 'Keine Fehlerursache vom Auslöser übermittelt';
  const description = redact(error.description);
  const code = plain(error.code || error.httpCode || error.statusCode);
  const safeCode = /^[A-Z0-9_]{2,40}$/i.test(code) ? code : '';
  const errorMessage = [message, description && 'Details: '+description, safeCode && 'Code: '+safeCode].filter(Boolean).join(' | ');
  const executionId = /^\d{1,30}$/.test(plain(execution.id)) ? plain(execution.id) : '';
  const executionUrl = 'https://fuajob.online/workflow/FyZCGkPNoA6EQI3N' + (executionId ? '/executions/'+executionId : '');
  const test = error.message === 'OPS_MIRROR_ALERT_PATH_TEST';
  const emailBody = (test
    ? '<p>Kontrollierter Alarmtest. Kein echter Ausfall und keine Kundenaktion.</p>'
    : '<p>Der Bankspiegel konnte nicht vollständig aktualisiert werden. Die OPS-Gesamtsummen sind bis zum bestätigten Abgleich vorläufig.</p>')
    + '<p>Betroffener Schritt: <strong>'+html(lastNode)+'</strong>.</p>'
    + '<p>Fehlerursache (bereinigt): '+html(errorMessage)+'</p>'
    + '<p>Betroffenen Lauf <a href="'+executionUrl+'">in n8n prüfen</a>, Ursache beheben und den vollständigen Abgleich wiederholen. Keine Mahnung aus einem unbestätigten Datenstand ableiten.</p>';
  return [{json:{
    emailRecipient:'support@neontrip.de',
    emailSubject:(test?'[Test erfolgreich ausgeloest] ':'')+'Bankspiegel – Aktualisierung nicht bestätigt',
    emailBody, workflowName:'Bankspiegel', workflowId:'FyZCGkPNoA6EQI3N',
    errorMessage,lastNode,executionUrl,executionId,timestamp:new Date().toISOString()
  }}];
}


// Only this source gets the bounded support-only template; other sources keep their format.
if (errorData.workflow?.id === 'rBggMnVkWwiVXXXO') {
  const workflowId = 'rBggMnVkWwiVXXXO';
  const workflowName = 'NEONTRIP Konfigurator → Trello 2D Assets';
  const allowedNodes = new Set([
    'Every 5 Minutes', 'Shopify Recent Orders', 'Extract Configurator Items',
    'Check Existing Card', 'Allow Unique Item', 'Render 2D PNG', 'Store PNG',
    'Create Trello Card', 'Attach PNG Preview', 'Render Outlined SVG',
    'Attach Outlined SVG', 'Return Result'
  ]);
  const node = errorData.execution?.lastNodeExecuted || errorData.execution?.error?.node?.name;
  const lastNode = allowedNodes.has(node) ? node : 'Unbekannter Schritt';
  const rawId = String(errorData.execution?.id || '');
  const executionId = /^\d{1,30}$/.test(rawId) ? rawId : '';
  const executionUrl = 'https://fuajob.online/workflow/' + workflowId
    + (executionId ? '/executions/' + executionId : '');
  const error = errorData.execution?.error || {};
  const status = String(error.httpCode || error.statusCode || error.status || '');
  const message = typeof error.message === 'string' ? error.message.slice(0, 1000) : '';
  const httpStatus = /^[45]\d{2}$/.test(status) ? status
    : (message.match(/^\s*(?:HTTP(?: status)?\s*)?([45]\d{2})\b/i)?.[1] || '');
  const errorClass = httpStatus ? 'HTTP_' + httpStatus
    : /timeout|timed out|etimedout/i.test(message) ? 'TIMEOUT'
    : /eai_again|enotfound|econnrefused|econnreset/i.test(message) ? 'CONNECTION_FAILED'
    : 'EXECUTION_FAILED';
  const errorMessage = 'CONFIGURATOR_ASSET_' + errorClass;
  const emailSubject = 'N8N Fehler: NEONTRIP Konfigurator-Assets nicht vollständig erstellt';
  const emailBody = '<p>Die automatische Übernahme von Konfigurator-Bestellungen nach Trello '
    + 'konnte nicht vollständig bestätigt werden.</p>'
    + '<p>Betroffener Schritt: <strong>' + lastNode + '</strong>. Fehlerklasse: '
    + errorClass + '.</p>'
    + '<p>Bitte <a href="' + executionUrl + '">die betroffene Ausführung prüfen</a> '
    + 'und die Ursache beheben. Vor einer Wiederholung vorhandene Trello-Karten und '
    + 'Anhänge abgleichen, damit keine Dubletten entstehen.</p>';
  return [{json:{
    emailRecipient:'support@neontrip.de', emailSubject, emailBody,
    workflowId, workflowName, errorMessage, lastNode, executionUrl, executionId,
    timestamp:new Date().toISOString()
  }}];
}

const workflowName = (errorData.workflow && errorData.workflow.name) || 'Unknown Workflow';
const workflowId = (errorData.workflow && errorData.workflow.id) || '';
const errorMessage = (errorData.execution && errorData.execution.error && errorData.execution.error.message) || 'Unknown error';
const lastNode = (errorData.execution && errorData.execution.lastNodeExecuted) || 'Unknown node';
const executionUrl = (errorData.execution && errorData.execution.url) || ('https://fuajob.online/workflow/' + workflowId);
const executionId = (errorData.execution && errorData.execution.id) || '';
const timestamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

// Intelligent solution suggestion based on error pattern
let solution = '1. Execution-Log in n8n öffnen und Details prüfen';
const lower = errorMessage.toLowerCase();
if (/invalid_grant|refresh token|expired|revoked|unauthorized|authorization grant/.test(lower)) {
  solution = '1. n8n → Credentials öffnen\n2. Betroffene Credential reconnecten / neu autorisieren\n3. Anschließend Workflow erneut triggern';
} else if (/forbidden|permission_denied|storage quota/.test(lower)) {
  solution = '1. Service-Account-Berechtigungen prüfen (Drive-Folder mit Service-Account-Email sharen)\n2. Falls Service-Account-Quota: zurück auf OAuth oder Workspace nutzen';
} else if (/429|rate limit|quota exceeded/.test(lower)) {
  solution = '1. Rate-Limit der API erreicht — kurz abwarten\n2. Falls häufiger: Workflow-Frequenz reduzieren oder API-Quota erhöhen';
} else if (/timeout|etimedout|econnrefused|enotfound/.test(lower)) {
  solution = '1. Netzwerk / Ziel-API erreichbar? Manueller Test der URL\n2. Falls Ziel down: warten und Workflow später re-triggern';
} else if (/cannot read|undefined|null|typeerror|referenceerror/.test(lower)) {
  solution = '1. Code-Node debuggen — sieht nach Daten-Shape-Problem aus\n2. Upstream-Node-Output checken: hat das erwartete Feld geheißen wie erwartet?';
}

const erklaerung = 'Der Workflow ist im Node „' + lastNode + '" mit einem Fehler abgebrochen.';

const emailSubject = 'RH Fehler im Workflow (' + workflowName + ')';
const emailBody = [
  '<div style="font-family:-apple-system,Arial,sans-serif;color:#222;line-height:1.5;">',
  '<h2 style="margin:0 0 16px;color:#c0392b">⚠ ' + workflowName + ' — Fehler</h2>',
  '<table style="border-collapse:collapse;width:100%;margin-bottom:16px;">',
  '<tr><td style="padding:8px 12px;background:#f6f8fa;border:1px solid #e1e4e8;font-weight:600;width:160px;vertical-align:top">Einfache Erläuterung</td>',
  '<td style="padding:8px 12px;border:1px solid #e1e4e8;">' + erklaerung + '</td></tr>',
  '<tr><td style="padding:8px 12px;background:#f6f8fa;border:1px solid #e1e4e8;font-weight:600;vertical-align:top">Grund</td>',
  '<td style="padding:8px 12px;border:1px solid #e1e4e8;"><code style="background:#fff5f5;padding:2px 4px;border-radius:3px;">' + errorMessage + '</code></td></tr>',
  '<tr><td style="padding:8px 12px;background:#f6f8fa;border:1px solid #e1e4e8;font-weight:600;vertical-align:top">Lösung</td>',
  '<td style="padding:8px 12px;border:1px solid #e1e4e8;white-space:pre-line;">' + solution + '</td></tr>',
  '<tr><td style="padding:8px 12px;background:#f6f8fa;border:1px solid #e1e4e8;font-weight:600;vertical-align:top">Link zum Workflow</td>',
  '<td style="padding:8px 12px;border:1px solid #e1e4e8;"><a href="' + executionUrl + '">' + executionUrl + '</a></td></tr>',
  '<tr><td style="padding:8px 12px;background:#f6f8fa;border:1px solid #e1e4e8;font-weight:600;vertical-align:top">Zeit</td>',
  '<td style="padding:8px 12px;border:1px solid #e1e4e8;">' + timestamp + '</td></tr>',
  '<tr><td style="padding:8px 12px;background:#f6f8fa;border:1px solid #e1e4e8;font-weight:600;vertical-align:top">Execution ID</td>',
  '<td style="padding:8px 12px;border:1px solid #e1e4e8;">' + executionId + '</td></tr>',
  '</table>',
  '<p style="color:#666;font-size:12px;margin-top:24px;">Automatischer Alert von n8n. Reply-to support@neontrip.de</p>',
  '</div>'
].join('');

function mirrorFailureAlert(errorData) {
 const names={FyZCGkPNoA6EQI3N:"Bankspiegel",m6VJ0hvDT7I40xy0:"Shopify-Abgleich"};
 const workflowId=String(errorData.workflow?.id||"");
 if(!names[workflowId])return null;
 const executionId=/^[A-Za-z0-9_-]+$/.test(String(errorData.execution?.id||""))?String(errorData.execution.id):"";
 const test=errorData.execution?.error?.message==="OPS_MIRROR_ALERT_PATH_TEST";
 const url="https://fuajob.online/workflow/"+workflowId+(executionId?"/executions/"+executionId:"");
 return {emailRecipient:"support@neontrip.de",
   emailSubject:(test?"[Test erfolgreich ausgeloest] ":"")+names[workflowId]+" – Aktualisierung nicht bestätigt",
   emailBody:(test?"<p>Kontrollierter Alarmtest. Kein echter Ausfall und keine Kundenaktion.</p>":"<p>Der "+names[workflowId]+" konnte nicht vollständig aktualisiert werden. Die OPS-Gesamtsummen sind bis zum bestätigten Abgleich vorläufig.</p>")+"<p>Betroffenen Lauf <a href=\""+url+"\">in n8n prüfen</a>, Ursache beheben und den vollständigen Abgleich wiederholen. Keine Mahnung aus einem unbestätigten Datenstand ableiten.</p>",
   workflowName:names[workflowId],workflowId,errorMessage:test?"OPS_MIRROR_ALERT_PATH_TEST":"OPS_SOURCE_MIRROR_FAILED",lastNode:"",executionUrl:url,executionId,timestamp:new Date().toISOString()
 };
}

const mirrorAlert=mirrorFailureAlert(errorData);if(mirrorAlert)return [{json:mirrorAlert}];

const dunningWorkflowIds = new Set(['sEP7CFh1qr6EpO0V','HzMgctp78bcMq44A','oA57luKTeHEE06uN']);
if (dunningWorkflowIds.has(workflowId)) {
  const safeId = /^[A-Za-z0-9_-]+$/.test(String(executionId)) ? String(executionId) : '';
  const safeUrl = 'https://fuajob.online/workflow/' + workflowId + (safeId ? '/executions/' + safeId : '');
  return [{json: {
    emailRecipient: 'support@neontrip.de',
    emailSubject: 'Mahnlauf nicht bestätigt: ' + workflowId,
    emailBody: '<p>Der Mahnprozess <strong>' + workflowId + '</strong> ist fehlgeschlagen. Der aktuelle Prüflauf oder Versand ist nicht bestätigt.</p><p>Bitte <a href="' + safeUrl + '">die Ausführung prüfen</a>, Ursache beheben und vor einer Wiederholung den tatsächlichen Versand in Outlook und OPS abgleichen. Nicht ungeprüft erneut senden.</p>',
    workflowName, workflowId, errorMessage: 'DUNNING_EXECUTION_FAILED', lastNode: '', executionUrl: safeUrl, executionId: safeId, timestamp
  }}];
}

return [{ json: {
  emailRecipient: config.emailRecipient,
  emailSubject,
  emailBody,
  workflowName, errorMessage, lastNode, executionUrl, executionId, timestamp
}}];
