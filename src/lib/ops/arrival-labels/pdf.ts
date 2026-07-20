import { createHash } from "node:crypto";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { lastFourOfTracking } from "./domain";

export type PdfRect = { x: number; y: number; width: number; height: number };

export type DpdPdfLayout = {
  version: string;
  orientation: "portrait" | "landscape";
  safeArea: PdfRect;
  protectedAreas: Array<PdfRect & { name: string }>;
  fontSize?: number;
};

export type PdfQaResult = {
  ok: boolean;
  pageWidthPoints: number;
  pageHeightPoints: number;
  a6: boolean;
  overlayText: string;
  overlayArea: PdfRect;
  protectedAreaIntersections: string[];
  sha256: string;
  errors: string[];
};

const POINTS_PER_MM = 72 / 25.4;
const A6_PORTRAIT = { width: 105 * POINTS_PER_MM, height: 148 * POINTS_PER_MM };

function ensurePdfGlobals() {
  const globals = globalThis as Record<string, unknown>;
  globals.DOMMatrix ||= DOMMatrix;
  globals.ImageData ||= ImageData;
  globals.Path2D ||= Path2D;
}

function approx(value: number, expected: number, tolerance = 3) {
  return Math.abs(value - expected) <= tolerance;
}

function rectInsidePage(rect: PdfRect, width: number, height: number) {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

export function rectanglesIntersect(a: PdfRect, b: PdfRect) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

export function validateA6Layout(width: number, height: number, layout: DpdPdfLayout) {
  const expected = layout.orientation === "portrait"
    ? A6_PORTRAIT
    : { width: A6_PORTRAIT.height, height: A6_PORTRAIT.width };
  const errors: string[] = [];
  if (!approx(width, expected.width) || !approx(height, expected.height)) {
    errors.push(`PDF ist nicht A6 ${layout.orientation} (${width.toFixed(2)}x${height.toFixed(2)} pt).`);
  }
  if (!rectInsidePage(layout.safeArea, width, height)) errors.push("Konfigurierte Aufdruckflaeche liegt ausserhalb der Seite.");
  for (const area of layout.protectedAreas) {
    if (!rectInsidePage(area, width, height)) errors.push(`Schutzbereich ${area.name} liegt ausserhalb der Seite.`);
  }
  const intersections = layout.protectedAreas
    .filter((area) => rectanglesIntersect(layout.safeArea, area))
    .map((area) => area.name);
  if (intersections.length) errors.push(`Aufdruckflaeche ueberlappt Schutzbereiche: ${intersections.join(", ")}.`);
  return { ok: errors.length === 0, errors, intersections };
}

export async function annotateDpdLabelPdf(inputPdf: Uint8Array, trackingNumber: string, layout: DpdPdfLayout) {
  if (!layout.version.trim()) throw new Error("PDF-Layoutversion fehlt.");
  const overlayText = lastFourOfTracking(trackingNumber);
  const document = await PDFDocument.load(inputPdf, { updateMetadata: false });
  if (document.getPageCount() !== 1) throw new Error("DPD-Etikett muss genau eine PDF-Seite enthalten.");
  const page = document.getPage(0);
  const { width, height } = page.getSize();
  const validation = validateA6Layout(width, height, layout);
  if (!validation.ok) throw new Error(validation.errors.join(" "));

  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const requestedFontSize = Math.min(Math.max(layout.fontSize || 24, 12), 42);
  const maximumWidth = layout.safeArea.width * 0.9;
  const measured = font.widthOfTextAtSize(overlayText, requestedFontSize);
  const fontSize = measured <= maximumWidth ? requestedFontSize : requestedFontSize * (maximumWidth / measured);
  if (fontSize < 12) throw new Error("Aufdruckflaeche ist fuer vier gut sichtbare Ziffern zu klein.");
  const textWidth = font.widthOfTextAtSize(overlayText, fontSize);
  const textHeight = font.heightAtSize(fontSize, { descender: false });
  page.drawText(overlayText, {
    x: layout.safeArea.x + (layout.safeArea.width - textWidth) / 2,
    y: layout.safeArea.y + (layout.safeArea.height - textHeight) / 2,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  const output = await document.save({ useObjectStreams: false, addDefaultPage: false });
  const verification = await PDFDocument.load(output);
  const verifiedPage = verification.getPage(0);
  const verifiedSize = verifiedPage.getSize();
  const afterValidation = validateA6Layout(verifiedSize.width, verifiedSize.height, layout);
  const qa: PdfQaResult = {
    ok: afterValidation.ok,
    pageWidthPoints: verifiedSize.width,
    pageHeightPoints: verifiedSize.height,
    a6: afterValidation.ok,
    overlayText,
    overlayArea: layout.safeArea,
    protectedAreaIntersections: afterValidation.intersections,
    sha256: createHash("sha256").update(output).digest("hex"),
    errors: afterValidation.errors,
  };
  if (!qa.ok) throw new Error(qa.errors.join(" "));
  return { pdf: output, qa };
}

export async function renderPdfFirstPageToPng(pdf: Uint8Array, scale = 3) {
  if (!Number.isFinite(scale) || scale < 1 || scale > 5) throw new Error("PDF-Render-Skalierung muss zwischen 1 und 5 liegen.");
  ensurePdfGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true } as never);
  const document = await task.promise;
  try {
    if (document.numPages !== 1) throw new Error("DPD-Etikett muss genau eine PDF-Seite enthalten.");
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvas, canvasContext: context, viewport } as never).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
}

export async function extractPdfText(pdf: Uint8Array) {
  ensurePdfGlobals();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true } as never);
  const document = await task.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
  } finally {
    await task.destroy();
  }
}
