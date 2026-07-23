import { createHash } from "node:crypto";
import type { DpdPdfLayout, PdfQaResult } from "./pdf";
import { PrintInputError } from "./printing";

export const EASYDPD_PRODUCT_LABELS = [
  "B2C",
  "B2C Predict",
  "DPD Express 8:30",
  "DPD Express 12:00",
  "DPD Express 18:00",
] as const;

export type EasyDpdProductLabel = (typeof EASYDPD_PRODUCT_LABELS)[number];
export type BrowserPurchaseResult = "validated" | "dispatching" | "retryable_error" | "uncertain" | "existing_label";

export function validateBrowserWorkerId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/.test(value)) throw new PrintInputError("Ungueltige Browser-Worker-ID.");
  return value;
}

export function validateBrowserPurchaseJobId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new PrintInputError("Ungueltige Browser-Auftrags-ID.");
  }
  return value;
}

export function validateDpdPdfLayout(value: unknown): DpdPdfLayout {
  const candidate = value as DpdPdfLayout | null;
  if (!candidate || typeof candidate !== "object") throw new PrintInputError("DPD-PDF-Layout fehlt.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(String(candidate.version || ""))) throw new PrintInputError("Ungueltige DPD-PDF-Layoutversion.");
  if (!['portrait', 'landscape'].includes(String(candidate.orientation))) throw new PrintInputError("Ungueltige DPD-PDF-Ausrichtung.");
  const rectangles = [candidate.safeArea, ...(Array.isArray(candidate.protectedAreas) ? candidate.protectedAreas : [])];
  if (!candidate.safeArea || !Array.isArray(candidate.protectedAreas) || rectangles.some((rect) => (
    !rect || ![rect.x, rect.y, rect.width, rect.height].every((entry) => Number.isFinite(entry))
  ))) throw new PrintInputError("Ungueltige DPD-PDF-Schutzbereiche.");
  return candidate;
}

export function assertEasyDpdPdf(bytes: Uint8Array) {
  if (bytes.byteLength < 100 || bytes.byteLength > 10 * 1024 * 1024) throw new PrintInputError("EasyDPD-PDF hat eine ungueltige Groesse.");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new PrintInputError("EasyDPD-Download ist kein PDF.");
  return createHash("sha256").update(bytes).digest("hex");
}

export function extractUniqueDpdTrackingNumber(text: string, incomingDhlTrackingNumber: string) {
  const incoming = incomingDhlTrackingNumber.replace(/\D/g, "");
  const candidates = new Set<string>();
  for (const match of text.matchAll(/(?<!\d)(?:\d[\s-]?){14}(?!\d)/g)) {
    const normalized = match[0].replace(/\D/g, "");
    if (normalized.length === 14 && normalized !== incoming) candidates.add(normalized);
  }
  if (candidates.size !== 1) throw new PrintInputError("DPD-Sendungsnummer konnte im PDF nicht eindeutig als 14-stellige Nummer erkannt werden.");
  return [...candidates][0];
}

export type BrowserArtifactRecord = {
  id: string;
  case_id: string;
  artifact_kind: "original_pdf" | "annotated_pdf" | "rendered_preview" | "delivery_note_pdf";
  storage_bucket: string;
  storage_key: string;
  sha256: string;
  content_type: string;
  byte_size: number;
  page_width_points: number | null;
  page_height_points: number | null;
  qa_result: PdfQaResult | Record<string, unknown>;
};
