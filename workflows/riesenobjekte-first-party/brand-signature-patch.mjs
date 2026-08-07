import { pathToFileURL } from "node:url";
import {
  buildMissingDesignAutoReplyHtml,
  buildRiesenobjekteSignatureHtml,
} from "./missing-attachment-autoreply-patch.mjs";

export const legacyMissingDesignAutoReplyHtml = `function buildMissingDesignAutoReplyHtml(firstName, escapeHtml) {
  const safeName = firstName ? escapeHtml(firstName) : "";
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;max-width:640px">' +
    '<p>' + (safeName ? 'Hallo ' + safeName + ',' : 'Guten Tag,') + '</p>' +
    '<p>vielen Dank für Ihre Anfrage bei RIESENOBJEKTE.</p>' +
    '<p>Ich habe gesehen, dass bei Ihrer Anfrage noch kein Design oder Dateianhang dabei war. Können Sie uns die Datei bitte noch zuschicken?</p>' +
    '<p>Antworten Sie einfach direkt auf diese E-Mail und hängen Sie Ihr Motiv möglichst als PDF, SVG oder EPS an. Falls Sie nur eine PNG- oder JPG-Datei haben, ist das ebenfalls in Ordnung.</p>' +
    '<p>Sobald die Datei da ist, können wir Ihre Anfrage vollständig prüfen.</p>' +
    '<p style="margin-top:28px">Viele Grüße<br><strong>Fabienne von RIESENOBJEKTE</strong></p>' +
    '<p style="font-size:13px;color:#555;margin-top:20px"><strong>RIESENOBJEKTE</strong><br>' +
    'E-Mail: <a href="mailto:info@riesenobjekte.de" style="color:#111">info@riesenobjekte.de</a><br>' +
    'Web: <a href="https://www.riesenobjekte.de" style="color:#111">www.riesenobjekte.de</a><br>' +
    'Telefon: <a href="tel:+4921154257240" style="color:#111">+49 211 54257240</a></p></div>';
}`;

export const legacyNormalSignatureTail = `  '<p style="margin-top:28px">Viele Grüße<br><strong>Fabienne von RIESENOBJEKTE</strong></p>' +
  '<p style="font-size:13px;color:#555;margin-top:20px"><strong>RIESENOBJEKTE</strong><br>' +
  'E-Mail: <a href="mailto:info@riesenobjekte.de" style="color:#111">info@riesenobjekte.de</a><br>' +
  'Web: <a href="https://www.riesenobjekte.de" style="color:#111">www.riesenobjekte.de</a><br>' +
  'Telefon: <a href="tel:+4921154257240" style="color:#111">+49 211 54257240</a></p></div>';`;

export const normalizePatches = [
  {
    find: legacyMissingDesignAutoReplyHtml,
    replace: `${buildRiesenobjekteSignatureHtml.toString()}\n${buildMissingDesignAutoReplyHtml.toString()}`,
  },
  {
    find: legacyNormalSignatureTail,
    replace: `  buildRiesenobjekteSignatureHtml() +\n  '</div>';`,
  },
];

export const operations = [{
  type: "patchNodeField",
  nodeName: "Normalize & Validate Submission",
  fieldPath: "parameters.jsCode",
  patches: normalizePatches,
}];

export const patch = {
  workflowId: "1hRkUxPXUZoYRSgL",
  expectedNodeCount: 25,
  expectedActiveVersionId: "4765b26c-5298-46c3-be3d-bdbffe0ab2f1",
  operations,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(patch));
}
