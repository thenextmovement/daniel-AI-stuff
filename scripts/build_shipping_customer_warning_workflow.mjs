import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export const BASE_VERSION = 'd8426ca3-d643-43fd-93e8-0db787bba6d8';
export const NODE_ID = 'build-shipping-notification-emails';
const root = new URL('../', import.meta.url);
export function buildCustomerWarningWorkflow(source) {
  if (source.id !== 'QtG2XHw7DsvOEPtQ' || source.activeVersionId !== BASE_VERSION) throw new Error('shipping_active_version_changed');
  const wf = structuredClone(source);
  const node = wf.nodes.find(n => n.id === NODE_ID);
  if (!node) throw new Error('shipping_notification_node_missing');
  const originalTail = "return rows.map((row) => ({ json: row.kind === 'customer_pickup_available' ? customerPickup(row) : internalWarning(row) }));";
  if (!node.parameters.jsCode.endsWith(originalTail)) throw new Error('shipping_notification_source_changed');
  const sourceText = fs.readFileSync(new URL('src/lib/ops/shipping-notifications.ts', root), 'utf8');
  const ast = ts.createSourceFile('mail.ts', sourceText, ts.ScriptTarget.Latest, true);
  const functions = ['assertValidCustomerRecipient','greeting','buildDeliveryProblemCustomerEmail'].map(name => {
    const decl = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
    if (!decl) throw new Error('mail_function_missing:' + name);
    return decl.getText(ast).replace(/^export /, '');
  }).join('\n');
  const signatureText = fs.readFileSync(new URL('src/lib/ops/shipping-installation-signature.ts', root), 'utf8');
  const signature = JSON.parse(signatureText.match(/export const MIKA_INSTALLATION_SIGNATURE_HTML = (".*");/s)[1]);
  const compiled = ts.transpile(functions, { target: ts.ScriptTarget.ES2022 });
  const appended = [
    'const trimNullable = compact;',
    'const paragraph = p;',
    'const QuoteValidationError = Error;',
    'const MIKA_INSTALLATION_SIGNATURE_HTML = ' + JSON.stringify(signature) + ';',
    compiled,
    'return rows.map((row, index) => {',
    "  if (row.kind === 'customer_pickup_available') return {json: customerPickup(row), pairedItem: {item: index}};",
    "  if (row.kind !== 'internal_delivery_problem') throw new Error('unsupported_shipping_notification_kind');",
    '  const mail = buildDeliveryProblemCustomerEmail(row);',
    "  return {json: {...base(row), to: mail.recipientEmail, subject: mail.subject, bodyHtml: mail.bodyHtml, route: 'customer'}, pairedItem: {item: index}};",
    '});'
  ].join('\n');
  node.parameters.jsCode = node.parameters.jsCode.slice(0, -originalTail.length) + appended;
  return wf;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('usage: builder source.json output.json');
  fs.writeFileSync(process.argv[3], JSON.stringify(buildCustomerWarningWorkflow(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2) + '\n');
}
