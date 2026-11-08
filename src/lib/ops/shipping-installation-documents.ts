import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import manifest from "../../../assets/neontrip-installation-documents/manifest.json";
import { supplierSaleMountingSelection } from "./supplier-sales-display";
import { MIKA_INSTALLATION_SIGNATURE_HTML } from "./shipping-installation-signature";

type RecordValue = Record<string, unknown>;
export type InstallationDocumentId = keyof typeof manifest;
export type InstallationSelection = {
  documentIds: InstallationDocumentId[];
  reviewReasons: string[];
  fulfillmentId: string;
  orderId: string;
  notificationKey: string;
};
const record = (v: unknown): RecordValue => v && typeof v === "object" && !Array.isArray(v) ? v as RecordValue : {};
const array = (v: unknown): RecordValue[] => Array.isArray(v) ? v.map(record) : [];
const text = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
const normalized = (v: unknown) => text(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const html = (v: unknown) => text(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function properties(item: RecordValue) {
  return array(item.properties).map(p => ({ name: text(p.name), value: text(p.value) }));
}

function mountingDetails(item: RecordValue) {
  const props = properties(item);
  const details = props.map(p => `${p.name.replace(/^_/, "")}: ${p.value}`);
  // The configurator publishes selected quantities; zero means not purchased.
  const quantities = props.find(p => p.name === "_Zubehörmengen pro Schild");
  if (quantities) {
    let values: RecordValue;
    try { values = record(JSON.parse(quantities.value)); } catch { throw new Error("accessory_quantities_invalid"); }
    for (const [key, label] of [["wall-mount", "Wandmontage"], ["hanging-kit", "Hängeset"]]) {
      const quantity = values[key];
      if (quantity !== undefined && (!Number.isInteger(quantity) || Number(quantity) < 0)) throw new Error("accessory_quantities_invalid");
      const selection = supplierSaleMountingSelection([{ title: text(item.title), variantTitle: text(item.variant_title), selectionDetails: details, quantity: 1 }]);
      if (quantity === 0 && selection[key === "wall-mount" ? "wall" : "hanging"]) throw new Error("accessory_selection_conflict");
      if (Number(quantity) > 0) details.push(`${label}: Ja`);
    }
    for (const key of ["adhesive-kit", "table-stand"]) {
      if (Number(values[key]) > 0) throw new Error(`unsupported_mounting:${key}`);
    }
  }
  for (const p of props) {
    const key = normalized(p.name).replace(/^_/, "");
    if (["montage", "mounting", "installation"].includes(key) && /adhesive|table|klebe|stand/.test(normalized(p.value))) {
      throw new Error("unsupported_mounting");
    }
    if (["klebeset", "tischstander"].includes(key) && /^(ja|yes|true|[1-9]\d*)$/.test(normalized(p.value))) {
      throw new Error("unsupported_mounting");
    }
  }
  return details;
}

function classify(item: RecordValue) {
  const title = normalized(item.title);
  const props = properties(item);
  const section = normalized(item.product_type || props.find(p => p.name === "Bereich")?.value);
  const description = normalized(props.find(p => ["Beschreibung", "Description"].includes(p.name))?.value);
  // Canonical service/surcharge lines are not additional physical products.
  // Match the complete known title so an unknown sign cannot bypass review.
  if (/^3d standardversand ca\. \d+ werktage$/.test(title)
    || title === "liefertermin standardlieferung"
    || title === "outdoor/ip67 ausfuhrung") return "accessory";
  if (/^(wandmontage|wall.mount|deckenabhang|deckenabhaeng|drahtseil|abhangeset|abhaengeset|hangeset|haengeset|hanging.kit)/.test(title)) return "mounting";
  if (/^(weisses netzteil|schwarzes netzteil|netzteil|dimmer|fernbedienung|verlangerungskabel|verlangerung|versand|lieferung|expressversand)/.test(title)) return "accessory";
  const product = `${section}\n${title}\n${description}`;
  if (/\b3d\b|profilbuchstaben/.test(product)) {
    if (/backlit|ruckbeleucht|rueckbeleucht|ruckleucht|rueckleucht|hinterleucht|halo/.test(product)) return "backlit";
    if (/frontlit|frontbeleucht|frontleucht/.test(product)) return "frontlit";
    if (/unbeleucht|non.?lit|ohne beleuchtung/.test(product)) return "nonlit";
    return "unknown";
  }
  if (/led.?neon|neon.?flex|neonschild/.test(product)) return "led";
  if (title === "neontrip konfiguration" && props.some(p => p.name === "_Schrift") && props.some(p => p.name === "_Leuchtmodus")) return "led";
  return "unknown";
}

/** Uses only positions in this fulfillment; order-wide accessory text never selects an attachment. */
export function selectInstallationDocuments(orderInput: unknown, fulfillmentId: string): InstallationSelection {
  const order = record(orderInput);
  const orderId = text(order.id);
  const reasons = new Set<string>();
  const docs = new Set<InstallationDocumentId>(["power"]);
  if (!/^\d+$/.test(orderId) || !/^\d+$/.test(fulfillmentId)) reasons.add("invalid_order_or_fulfillment_id");
  const matches = array(order.fulfillments).filter(f => text(f.id) === fulfillmentId);
  const fulfillment = matches[0] || {};
  if (matches.length !== 1 || text(fulfillment.order_id) !== orderId) reasons.add("fulfillment_not_uniquely_linked");
  if (fulfillment.status !== "success" || order.cancelled_at) reasons.add("fulfillment_not_successful");
  const shipped = array(fulfillment.line_items);
  const ordered = array(order.line_items);
  if (!shipped.length) reasons.add("fulfillment_items_missing");
  if (new Set(shipped.map(i => text(i.id))).size !== shipped.length) reasons.add("duplicate_fulfillment_item");
  let led = false;
  let otherProduct = false;
  let hasMounting = false;
  const selectedItems: { title: string; variantTitle: string; selectionDetails: string[]; quantity: number }[] = [];
  for (const item of shipped) {
    const sourceMatches = ordered.filter(i => text(i.id) === text(item.id));
    const source = sourceMatches[0];
    if (sourceMatches.length !== 1 || !text(item.id) || !Number.isInteger(item.quantity) || Number(item.quantity) <= 0 || Number(item.quantity) > Number(source?.quantity)) {
      reasons.add("invalid_fulfillment_item"); continue;
    }
    const fullItem: RecordValue = { ...source, quantity: item.quantity };
    try {
      selectedItems.push({ title: text(fullItem.title), variantTitle: text(fullItem.variant_title), selectionDetails: mountingDetails(fullItem), quantity: Number(item.quantity) });
    } catch (error) { reasons.add(error instanceof Error ? error.message : "invalid_mounting"); }
    const type = classify(fullItem);
    if (type === "led") { led = true; docs.add("led_connection"); }
    if (type === "mounting") hasMounting = true;
    if (type === "backlit") { otherProduct = true; reasons.add("backlit_manual_not_cleared"); }
    if (type === "unknown") reasons.add("unknown_product");
    if (type === "frontlit" || type === "nonlit") {
      otherProduct = true;
      // These guides cover threaded rods/rear nuts (and suitable adhesive for non-lit).
      // Unknown construction or multi-channel frontlit needs internal review first.
      const description = normalized(properties(fullItem).find(p => ["Beschreibung", "Description"].includes(p.name))?.value);
      if (!/gewindestang|threaded rod|klebemontage/.test(description) || (type === "frontlit" && (/rgb|mehrfarbig|cct/.test(description) || !/gewindestang|threaded rod/.test(description)))) {
        reasons.add(`construction_review_required:${type}`);
      } else docs.add(type);
    }
  }
  const mounting = supplierSaleMountingSelection(selectedItems);
  if (!led && hasMounting && ordered.some(item => !["led", "mounting", "accessory"].includes(classify(item)))) {
    reasons.add("mounting_parent_product_ambiguous");
  }
  if (otherProduct && (mounting.wall || mounting.hanging)) reasons.add("mixed_product_mounting_ambiguous");
  if (!otherProduct && (led || hasMounting)) {
    if (mounting.wall) docs.add("wall");
    if (mounting.hanging) docs.add("ceiling");
  }
  return {
    documentIds: [...docs], reviewReasons: [...reasons], fulfillmentId, orderId,
    notificationKey: `customer:installation_documents:shopify:${orderId}:${fulfillmentId}`,
  };
}

export async function loadInstallationAttachments(ids: InstallationDocumentId[]) {
  return Promise.all([...new Set(ids)].map(async id => {
    const entry = manifest[id];
    if (!entry) throw new Error("unknown_document");
    const bytes = await readFile(path.join(process.cwd(), "assets/neontrip-installation-documents", entry.filename));
    if (bytes.subarray(0, 5).toString() !== "%PDF-" || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`document_integrity_failed:${id}`);
    return { "@odata.type": "#microsoft.graph.fileAttachment", name: entry.filename, contentType: "application/pdf", contentBytes: bytes.toString("base64") };
  }));
}

export async function prepareInstallationMail(orderInput: unknown, fulfillmentId: string) {
  const order = record(orderInput);
  const selection = selectInstallationDocuments(order, fulfillmentId);
  const recipient = text(order.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) selection.reviewReasons.push("recipient_invalid");
  if (selection.reviewReasons.length) return { ready: false as const, selection };
  const attachments = await loadInstallationAttachments(selection.documentIds);
  const subject = `Ihre NEONTRIP Bestellung ${text(order.name)} – Montageanleitungen und wichtige Hinweise`;
  const labels: Record<InstallationDocumentId, string> = {
    wall: "Wandmontage für LED-Neon", ceiling: "Abhängeset / Deckenmontage", led_connection: "LED-Neon: Anschluss und Bedienung",
    frontlit: "3D-Buchstaben: frontbeleuchtet", nonlit: "3D-Buchstaben: unbeleuchtet", power: "Wichtige Hinweise zur Stromversorgung",
  };
  const bodyHtml = `<div style="font:15px/1.6 Arial,Helvetica,sans-serif;color:#111;max-width:600px">
<p>Guten Tag,</p><p>anbei erhalten Sie die Montage- und Anschlusshinweise zu Ihrer NEONTRIP Lieferung${order.name ? ` (${html(order.name)})` : ""}. Bitte lesen Sie die passenden Unterlagen vor der Montage und geben Sie diese auch an die ausführende Montageperson weiter.</p>
<ul>${selection.documentIds.map(id => `<li>${labels[id]}</li>`).join("")}</ul>
<p><strong>Wichtig bei mitgelieferten Netzteilen:</strong> Bitte verwenden Sie alle für Ihr Schild vorgesehenen Netzteile und Anschlüsse – auch wenn das Schild bereits mit weniger Netzteilen leuchtet. Eine unvollständige Versorgung kann zu Überlastung und Überhitzung führen. Beachten Sie unbedingt die beigefügten Anschluss- und Sicherheitshinweise.</p>
<p>Falls etwas unklar ist, antworten Sie vor der Montage oder Inbetriebnahme einfach auf diese E-Mail.</p><p>Viele Grüße</p></div>${MIKA_INSTALLATION_SIGNATURE_HTML}`;
  const graphDraft = {
    subject, body: { contentType: "HTML", content: bodyHtml },
    toRecipients: [{ emailAddress: { address: recipient } }],
    replyTo: [{ emailAddress: { address: "support@neontrip.de", name: "Mika Zangane · NEONTRIP" } }],
    internetMessageHeaders: [{ name: "X-NEONTRIP-Installation-Key", value: selection.notificationKey }], attachments,
  };
  if (Buffer.byteLength(JSON.stringify(graphDraft)) > 3_900_000) return { ready: false as const, selection: { ...selection, reviewReasons: ["attachment_payload_too_large"] } };
  return { ready: true as const, selection, graphDraft, bodyHtml, subject };
}
