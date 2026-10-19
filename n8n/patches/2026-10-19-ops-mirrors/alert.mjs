export function mirrorFailureAlert(errorData) {
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
