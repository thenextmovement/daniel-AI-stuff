import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { prepareInstallationMail } from "../src/lib/ops/shipping-installation-documents";

async function main() {
  const destination = process.argv[2];
  if (!destination || !path.isAbsolute(destination)) throw new Error("Supply an absolute output folder; this script never sends mail.");
  const items = [
    { id: 1, title: "LED Neonschild – Beispiel", quantity: 1 },
    { id: 2, title: "Wandmontage Set", quantity: 1 },
    { id: 3, title: "Deckenabhängung Drahtseile", quantity: 1 },
  ];
  const result = await prepareInstallationMail({
    id: 123, name: "#BEISPIEL", email: "preview@example.test", line_items: items,
    fulfillments: [{ id: 456, order_id: 123, status: "success", line_items: items }],
  }, "456");
  if (!result.ready) throw new Error(result.selection.reviewReasons.join(","));
  await mkdir(destination, { recursive: true });
  for (const attachment of result.graphDraft.attachments) {
    await writeFile(path.join(destination, attachment.name), Buffer.from(attachment.contentBytes, "base64"));
  }
  const links = result.graphDraft.attachments.map(a => `<li><a href="${encodeURIComponent(a.name)}">${a.name}</a></li>`).join("");
  await writeFile(path.join(destination, "Mika-Versandmail-Vorschau.html"), `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEONTRIP Versandmail – Vorschau</title><body style="background:#f4f5f7;color:#111;font:14px/1.6 Arial;margin:0;padding:24px"><main style="max-width:650px;margin:auto;background:white;padding:24px;border:1px solid #ddd"><p style="color:#555">Lokale Vorschau · nicht versendet · Beispielbestellung</p><h1 style="font-size:20px">${result.subject}</h1><p>Signatur und Antworten: Mika Zangane · NEONTRIP</p><details><summary>Vier PDF-Anhänge öffnen</summary><ul>${links}</ul></details><hr style="border:0;border-top:1px solid #ddd;margin:24px 0">${result.bodyHtml}</main></body></html>`);
  await writeFile(path.join(destination, "Anhang-Pruefung.json"), JSON.stringify({
    exampleOnly: true, sent: false, actualSenderMailboxVerified: false,
    subject: result.subject, notificationKey: result.selection.notificationKey,
    attachments: result.graphDraft.attachments.map(a => ({ name: a.name, bytes: Buffer.from(a.contentBytes, "base64").length })),
    graphPayloadBytes: Buffer.byteLength(JSON.stringify(result.graphDraft)),
  }, null, 2) + "\n");
  console.log(JSON.stringify({ preview: path.join(destination, "Mika-Versandmail-Vorschau.html"), attachments: result.graphDraft.attachments.length, sent: false }));
}
void main();
