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
