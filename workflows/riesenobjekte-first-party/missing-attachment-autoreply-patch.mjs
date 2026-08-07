import { pathToFileURL } from "node:url";

export const NORMAL_SUBJECT = "Vielen Dank für Ihre Anfrage bei RIESENOBJEKTE";
export const MISSING_ATTACHMENT_SUBJECT = "Ihre RIESENOBJEKTE-Anfrage – Design oder Datei fehlt noch";
export const FABIENNE_PHOTO_URL = "https://cdn.shopify.com/s/files/1/0534/7819/5350/files/fabienne123.jpg?v=1764000653";

export function buildRiesenobjekteSignatureHtml() {
  return '<div style="margin:28px 0 14px 0">Viele Grüße</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#111">' +
    '<tr>' +
    '<td valign="top" style="vertical-align:top;padding:0 14px 0 0">' +
    '<img src="https://cdn.shopify.com/s/files/1/0534/7819/5350/files/fabienne123.jpg?v=1764000653" width="72" height="72" alt="Fabienne Trapp" style="display:block;width:72px;height:72px;border-radius:50%;object-fit:cover">' +
    '</td>' +
    '<td valign="top" style="vertical-align:top;padding:0">' +
    '<div style="font-weight:700;font-size:14px;margin:0 0 2px 0">Fabienne Trapp</div>' +
    '<div style="font-size:12px;color:#555;margin:0 0 10px 0">Kundenberatung</div>' +
    '<div role="img" aria-label="RIESENOBJEKTE" style="font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;font-size:20px;letter-spacing:.5px;margin:0 0 8px 0;color:#111">' +
    'RIESEN<span style="color:#ccff00">OBJEKTE</span>' +
    '</div>' +
    '<div style="font-size:12px;color:#444;margin:0 0 10px 0">Inflatables &amp; aufblasbare Sonderformen</div>' +
    '<div style="font-size:12px;color:#222">' +
    'Tel.: <a href="tel:+4921154257240" style="color:#222;text-decoration:none">+49 211 54257240</a><br>' +
    'E-Mail: <a href="mailto:info@riesenobjekte.de" style="color:#222;text-decoration:none">info@riesenobjekte.de</a><br>' +
    'Web: <a href="https://www.riesenobjekte.de" style="color:#222;text-decoration:none">www.riesenobjekte.de</a>' +
    '</div>' +
    '</td>' +
    '</tr>' +
    '</table>';
}

export function designContextException(value) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000)
    .toLocaleLowerCase("de-DE");
  const noDesignStatement = /\b(?:kein|keine|keinen|noch kein|noch keine|ohne)\s+(?:eigenes?\s+)?(?:logo|design|grafik|vorlage|datei|skizze)\b/i.test(text);
  const designServiceRequest = /\b(?:k(?:ö|oe)nnt|k(?:ö|oe)nnen|bitte|sollt|m(?:ö|oe)chtet|brauche|ben(?:ö|oe)tige)[^.!?]{0,80}\b(?:design(?:en)?|gestalt(?:en|et)|entwerf(?:en|t)|erstell(?:en|t)|zeichn(?:en|et)|logo\s+mach(?:en|t))\b/i.test(text);
  const suppliedTextDesign = /(?:\b(?:schriftzug|spruch|slogan|text|wortlaut)\s*(?::|soll|lautet|mit)\s*[^.!?\n]{2,}|\b(?:drauf|darauf)\s+(?:soll\s+)?(?:stehen|lauten)\b|["'“”„][^"'“”„]{2,}["'“”„]\s*(?:als\s+)?(?:text|schriftzug|spruch|slogan)\b)/i.test(text);
  if (designServiceRequest) return "design_service_requested";
  if (suppliedTextDesign) return "text_design_supplied";
  if (noDesignStatement) return "no_design_declared";
  return "";
}

export function chooseAutoReplyKind(attachmentCount, projectDescription) {
  const exceptionReason = designContextException(projectDescription);
  return {
    replyKind: Number(attachmentCount) === 0 && !exceptionReason ? "missing_design" : "normal",
    exceptionReason,
  };
}

export function buildMissingDesignAutoReplyHtml(firstName, escapeHtml) {
  const safeName = firstName ? escapeHtml(firstName) : "";
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;max-width:640px">' +
    '<p>' + (safeName ? 'Hallo ' + safeName + ',' : 'Guten Tag,') + '</p>' +
    '<p>vielen Dank für Ihre Anfrage bei RIESENOBJEKTE.</p>' +
    '<p>Ich habe gesehen, dass bei Ihrer Anfrage noch kein Design oder Dateianhang dabei war. Können Sie uns die Datei bitte noch zuschicken?</p>' +
    '<p>Antworten Sie einfach direkt auf diese E-Mail und hängen Sie Ihr Motiv möglichst als PDF, SVG oder EPS an. Falls Sie nur eine PNG- oder JPG-Datei haben, ist das ebenfalls in Ordnung.</p>' +
    '<p>Sobald die Datei da ist, können wir Ihre Anfrage vollständig prüfen.</p>' +
    buildRiesenobjekteSignatureHtml() +
    '</div>';
}

export const helperSource = [
  designContextException.toString(),
  chooseAutoReplyKind.toString(),
  buildRiesenobjekteSignatureHtml.toString(),
  buildMissingDesignAutoReplyHtml.toString(),
].join("\n");

const fileExtFunction = `function fileExt(name) {
  const match = String(name || '').toLowerCase().match(/\\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}`;

const autoReplyTail = `  'Telefon: <a href="tel:+4921154257240" style="color:#111">+49 211 54257240</a></p></div>';`;

export const normalizePatches = [
  {
    find: "const autoReplyHtml = '<div style=\"font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;max-width:640px\">' +",
    replace: "const normalAutoReplyHtml = '<div style=\"font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;max-width:640px\">' +",
  },
  {
    find: autoReplyTail,
    replace: `  buildRiesenobjekteSignatureHtml() +
  '</div>';

const missingDesignAutoReplyHtml = buildMissingDesignAutoReplyHtml(firstName, esc);
const autoReplySubject = autoReplyKind === 'missing_design'
  ? '${MISSING_ATTACHMENT_SUBJECT}'
  : '${NORMAL_SUBJECT}';
const autoReplyHtml = autoReplyKind === 'missing_design'
  ? missingDesignAutoReplyHtml
  : normalAutoReplyHtml;`,
  },
  {
    find: fileExtFunction,
    replace: `${fileExtFunction}\n${helperSource}`,
  },
  {
    find: "const fileEntries = Object.entries(binary);",
    replace: `const fileEntries = Object.entries(binary);
const attachmentCount = fileEntries.length;
const autoReplyDecision = chooseAutoReplyKind(attachmentCount, projectDescription);
const autoReplyKind = autoReplyDecision.replyKind;
const missingDesignExceptionReason = autoReplyDecision.exceptionReason;`,
  },
  {
    find: `    autoReplyHtml: autoReplyHtml,
    attachmentKeys: fileEntries.map(function (entry) { return entry[0]; }).join(','),`,
    replace: `    autoReplySubject: autoReplySubject,
    autoReplyHtml: autoReplyHtml,
    autoReplyKind: autoReplyKind,
    missingDesignExceptionReason: missingDesignExceptionReason,
    attachmentCount: attachmentCount,
    attachmentKeys: fileEntries.map(function (entry) { return entry[0]; }).join(','),`,
  },
];

export const operations = [
  {
    type: "patchNodeField",
    nodeName: "Normalize & Validate Submission",
    fieldPath: "parameters.jsCode",
    patches: normalizePatches,
  },
  {
    type: "updateNode",
    nodeName: "Send Customer AutoReply",
    updates: {
      "parameters.subject": "={{ $('Normalize & Validate Submission').item.json.autoReplySubject }}",
    },
  },
  {
    type: "patchNodeField",
    nodeName: "Complete First-Party Idempotency Record",
    fieldPath: "parameters.jsonBody",
    patches: [{
      find: 'attribution_version: "riesenobjekte_first_party_v2", project_brief:',
      replace: 'attribution_version: "riesenobjekte_first_party_v2", auto_reply_kind: b.autoReplyKind || "normal", missing_design_exception_reason: b.missingDesignExceptionReason || "", project_brief:',
    }],
  },
];

export const patch = {
  workflowId: "1hRkUxPXUZoYRSgL",
  expectedNodeCount: 25,
  operations,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(patch));
}
