import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ArrivalCaseDecision, ShopifyShippingAddressEvidence } from "./domain";
import { extractPdfTextAllPages } from "./pdf";

const A4_WIDTH = 210 * 72 / 25.4;
const A4_HEIGHT = 297 * 72 / 25.4;
const PAGE_MARGIN = 48;
const FIRST_PAGE_ITEMS = 11;
const CONTINUATION_PAGE_ITEMS = 15;

export type ArrivalDeliveryNoteQa = {
  ok: boolean;
  pageCount: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  a4: boolean;
  lineItemCount: number;
  destinationCountryCode: string;
  containsPriceFields: false;
  sha256: string;
  errors: string[];
};

function pdfText(value: unknown, maximum = 180) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[€£$]/g, "")
    .replace(/\b(?:EUR|Netto|Brutto|MwSt|USt|Preis)\b/gi, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function wrapText(font: PDFFont, value: string, fontSize: number, maximumWidth: number, maximumLines = 2) {
  const words = pdfText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maximumWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maximumLines) break;
  }
  if (current && lines.length < maximumLines) lines.push(current);
  if (words.length && !lines.length) lines.push(pdfText(value, 30));
  return lines.slice(0, maximumLines);
}

function addressLines(address: ShopifyShippingAddressEvidence) {
  return [
    address.name,
    address.company,
    address.address1,
    address.address2,
    [address.zip, address.city].filter(Boolean).join(" "),
    address.country,
  ].map((value) => pdfText(value)).filter(Boolean);
}

function drawHeader(page: PDFPage, font: PDFFont, bold: PDFFont, decision: ArrivalCaseDecision, localDate: string, pageNumber: number, pageCount: number) {
  page.drawRectangle({ x: 0, y: A4_HEIGHT - 142, width: A4_WIDTH, height: 142, color: rgb(0.13, 0.03, 0.16) });
  page.drawText("NEONTRIP", { x: PAGE_MARGIN, y: A4_HEIGHT - 54, size: 15, font: bold, color: rgb(1, 0.83, 0.1) });
  page.drawText("Lieferschein", { x: PAGE_MARGIN, y: A4_HEIGHT - 104, size: 34, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`${pdfText(decision.shopifyOrder?.name || "Bestellung")}  |  ${localDate}`, {
    x: 344, y: A4_HEIGHT - 60, size: 9, font, color: rgb(0.95, 0.92, 0.96),
  });
  page.drawText(`Seite ${pageNumber}/${pageCount}`, { x: 469, y: 28, size: 8, font, color: rgb(0.4, 0.36, 0.42) });
  page.drawText("NEONTRIP Lieferschein - ohne Preise - ersetzt keine Rechnung", {
    x: PAGE_MARGIN, y: 28, size: 8, font, color: rgb(0.4, 0.36, 0.42),
  });
}

function drawLabel(page: PDFPage, font: PDFFont, bold: PDFFont, title: string, lines: string[], x: number, y: number, width: number, height: number) {
  page.drawRectangle({ x, y, width, height, color: rgb(0.96, 0.95, 0.97), borderColor: rgb(0.85, 0.82, 0.87), borderWidth: 1 });
  page.drawText(title, { x: x + 14, y: y + height - 20, size: 8, font: bold, color: rgb(0.46, 0.1, 0.5) });
  lines.slice(0, 6).forEach((line, index) => {
    page.drawText(pdfText(line, 80), { x: x + 14, y: y + height - 39 - index * 13, size: 9.5, font, color: rgb(0.13, 0.09, 0.15) });
  });
}

export async function generateArrivalDeliveryNotePdf(input: {
  decision: ArrivalCaseDecision;
  localDate: string;
}) {
  const { decision } = input;
  const order = decision.shopifyOrder;
  const address = order?.shippingAddress;
  if (!order || !address) throw new Error("Shopify-Bestellung mit Lieferadresse ist fuer den Lieferschein erforderlich.");
  if (decision.destinationClass !== "eu" || !decision.deliveryNoteRequired || decision.destinationCountryCode === "DE") {
    throw new Error("Lieferschein darf nur fuer freigegebene EU-Auslandssendungen erzeugt werden.");
  }
  try {
    if (Temporal.PlainDate.from(input.localDate).toString() !== input.localDate) throw new Error("invalid");
  } catch {
    throw new Error("Lieferscheindatum muss ein gueltiges Datum im Format YYYY-MM-DD sein.");
  }
  const recipient = addressLines(address);
  if (recipient.length < 4 || !address.address1 || !address.zip || !address.city) throw new Error("Lieferadresse ist fuer den Lieferschein unvollstaendig.");
  if (!order.lineItems.length || order.lineItems.some((item) => !pdfText(item.title) || !Number.isInteger(item.quantity) || item.quantity < 1)) {
    throw new Error("Lieferscheinpositionen sind unvollstaendig oder ungueltig.");
  }

  const document = await PDFDocument.create();
  document.setTitle(`Lieferschein ${pdfText(order.name)}`);
  document.setAuthor("NEONTRIP");
  document.setSubject("Preisfreier Lieferschein fuer EU-Auslandssendung");
  document.setCreator("NEONTRIP Arrival Label Automation");
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const chunks = [order.lineItems.slice(0, FIRST_PAGE_ITEMS)];
  for (let offset = FIRST_PAGE_ITEMS; offset < order.lineItems.length; offset += CONTINUATION_PAGE_ITEMS) {
    chunks.push(order.lineItems.slice(offset, offset + CONTINUATION_PAGE_ITEMS));
  }

  chunks.forEach((items, pageIndex) => {
    const page = document.addPage([A4_WIDTH, A4_HEIGHT]);
    drawHeader(page, font, bold, decision, input.localDate, pageIndex + 1, chunks.length);
    if (pageIndex === 0) {
      drawLabel(page, font, bold, "EMPFANGER / LIEFERANSCHRIFT", recipient, PAGE_MARGIN, 560, 300, 112);
      drawLabel(page, font, bold, "REFERENZ", [
        `Shopify: ${order.name}`,
        `Eingang DHL: ${decision.trackingNumber}`,
        `Zuordnung: ${decision.lastSix}`,
        `Zielland: ${decision.destinationCountryCode}`,
      ], 368, 560, 179, 112);
    }
    const top = pageIndex === 0 ? 526 : 670;
    page.drawRectangle({ x: PAGE_MARGIN, y: top - 25, width: A4_WIDTH - PAGE_MARGIN * 2, height: 25, color: rgb(0.46, 0.1, 0.5) });
    page.drawText("POS.", { x: PAGE_MARGIN + 10, y: top - 17, size: 9, font: bold, color: rgb(1, 1, 1) });
    page.drawText("ARTIKEL / BESCHREIBUNG", { x: PAGE_MARGIN + 60, y: top - 17, size: 9, font: bold, color: rgb(1, 1, 1) });
    page.drawText("MENGE", { x: A4_WIDTH - PAGE_MARGIN - 54, y: top - 17, size: 9, font: bold, color: rgb(1, 1, 1) });
    let y = top - 48;
    items.forEach((item, itemIndex) => {
      const absoluteIndex = (pageIndex === 0 ? 0 : FIRST_PAGE_ITEMS + (pageIndex - 1) * CONTINUATION_PAGE_ITEMS) + itemIndex + 1;
      const titleLines = wrapText(font, item.title, 9.5, 385, 2);
      const rowHeight = titleLines.length > 1 ? 35 : 25;
      if (itemIndex % 2 === 0) page.drawRectangle({ x: PAGE_MARGIN, y: y - rowHeight + 8, width: A4_WIDTH - PAGE_MARGIN * 2, height: rowHeight, color: rgb(0.98, 0.975, 0.985) });
      page.drawText(String(absoluteIndex), { x: PAGE_MARGIN + 12, y, size: 9.5, font, color: rgb(0.15, 0.1, 0.16) });
      titleLines.forEach((line, lineIndex) => page.drawText(line, { x: PAGE_MARGIN + 60, y: y - lineIndex * 12, size: 9.5, font, color: rgb(0.15, 0.1, 0.16) }));
      page.drawText(String(item.quantity), { x: A4_WIDTH - PAGE_MARGIN - 42, y, size: 9.5, font: bold, color: rgb(0.15, 0.1, 0.16) });
      y -= rowHeight;
    });
    page.drawText("Bitte diese Unterlage der Sendung beilegen.", { x: PAGE_MARGIN, y: 58, size: 9, font: bold, color: rgb(0.46, 0.1, 0.5) });
  });

  const pdf = await document.save({ useObjectStreams: false, addDefaultPage: false });
  const verification = await PDFDocument.load(pdf, { updateMetadata: false });
  const pages = verification.getPages();
  const sizes = pages.map((page) => page.getSize());
  const a4 = sizes.every((size) => Math.abs(size.width - A4_WIDTH) <= 2 && Math.abs(size.height - A4_HEIGHT) <= 2);
  const errors: string[] = [];
  if (!pages.length) errors.push("Lieferschein enthaelt keine Seite.");
  if (!a4) errors.push("Lieferschein ist nicht durchgehend A4.");
  if (pages.length !== chunks.length) errors.push("Lieferschein-Seitenzahl stimmt nicht mit den Positionen ueberein.");
  const extractedText = (await extractPdfTextAllPages(pdf)).join(" ");
  const containsPriceFields = /\b(?:EUR|Netto|Brutto|MwSt|USt)\b|€/i.test(extractedText);
  if (containsPriceFields) errors.push("Lieferschein enthaelt unerwartete Preis- oder Steuerfelder.");
  const qa: ArrivalDeliveryNoteQa = {
    ok: errors.length === 0,
    pageCount: pages.length,
    pageWidthPoints: sizes[0]?.width || 0,
    pageHeightPoints: sizes[0]?.height || 0,
    a4,
    lineItemCount: order.lineItems.length,
    destinationCountryCode: decision.destinationCountryCode as string,
    containsPriceFields: false,
    sha256: createHash("sha256").update(pdf).digest("hex"),
    errors,
  };
  if (!qa.ok) throw new Error(qa.errors.join(" "));
  return { pdf, qa };
}
