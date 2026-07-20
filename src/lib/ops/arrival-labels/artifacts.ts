import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArrivalCaseDecision } from "./domain";
import { generateArrivalDeliveryNotePdf } from "./delivery-note";
import type { DpdPdfLayout } from "./pdf";
import { annotateDpdLabelPdf, renderPdfFirstPageToPng, renderPdfPagesToPng } from "./pdf";

function safeSegment(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  if (!normalized) throw new Error("Leeres Artefakt-Pfadsegment ist nicht erlaubt.");
  return normalized;
}

export async function processDpdLabelArtifact(input: {
  pdf: Uint8Array;
  incomingDhlTrackingNumber: string;
  shopifyOrderId: string;
  layout: DpdPdfLayout;
  rootDirectory?: string;
}) {
  const tracking = input.incomingDhlTrackingNumber.replace(/\D/g, "");
  if (tracking.length < 10) throw new Error("Vollständige eingehende DHL-Sendungsnummer fehlt.");
  const root = path.resolve(input.rootDirectory || process.env.ARRIVAL_LABEL_ARTIFACT_DIR || "var/arrival-labels/artifacts");
  const caseDirectory = path.join(root, `${safeSegment(input.shopifyOrderId)}__dhl_${tracking}`);
  const relative = path.relative(root, caseDirectory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsicherer Artefaktpfad.");
  await mkdir(caseDirectory, { recursive: true, mode: 0o700 });

  const annotated = await annotateDpdLabelPdf(input.pdf, tracking, input.layout);
  const preview = await renderPdfFirstPageToPng(annotated.pdf, 3);
  const paths = {
    originalPdf: path.join(caseDirectory, "original.pdf"),
    annotatedPdf: path.join(caseDirectory, `dpd-label-${tracking}.pdf`),
    previewPng: path.join(caseDirectory, `dpd-label-${tracking}-qa.png`),
    qaJson: path.join(caseDirectory, `dpd-label-${tracking}-qa.json`),
  };
  await Promise.all([
    writeFile(paths.originalPdf, input.pdf, { mode: 0o600 }),
    writeFile(paths.annotatedPdf, annotated.pdf, { mode: 0o600 }),
    writeFile(paths.previewPng, preview, { mode: 0o600 }),
    writeFile(paths.qaJson, `${JSON.stringify(annotated.qa, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
  ]);
  return { paths, qa: annotated.qa };
}

export async function processArrivalDeliveryNoteArtifact(input: {
  decision: ArrivalCaseDecision;
  localDate: string;
  rootDirectory?: string;
}) {
  const orderId = input.decision.shopifyOrder?.id;
  if (!orderId) throw new Error("Shopify-Bestell-ID fehlt fuer den Lieferschein.");
  const tracking = input.decision.trackingNumber.replace(/\D/g, "");
  if (tracking.length < 10) throw new Error("Vollstaendige eingehende DHL-Sendungsnummer fehlt.");
  const root = path.resolve(input.rootDirectory || process.env.ARRIVAL_LABEL_ARTIFACT_DIR || "var/arrival-labels/artifacts");
  const caseDirectory = path.join(root, `${safeSegment(orderId)}__dhl_${tracking}`);
  const relative = path.relative(root, caseDirectory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsicherer Artefaktpfad.");
  await mkdir(caseDirectory, { recursive: true, mode: 0o700 });

  const generated = await generateArrivalDeliveryNotePdf({ decision: input.decision, localDate: input.localDate });
  const previews = await renderPdfPagesToPng(generated.pdf, 2, 20);
  const paths = {
    deliveryNotePdf: path.join(caseDirectory, `lieferschein-${safeSegment(input.decision.shopifyOrder?.name || orderId)}.pdf`),
    previewPngs: previews.map((_, index) => path.join(caseDirectory, `lieferschein-qa-seite-${index + 1}.png`)),
    qaJson: path.join(caseDirectory, "lieferschein-qa.json"),
  };
  await Promise.all([
    writeFile(paths.deliveryNotePdf, generated.pdf, { mode: 0o600 }),
    ...previews.map((preview, index) => writeFile(paths.previewPngs[index], preview, { mode: 0o600 })),
    writeFile(paths.qaJson, `${JSON.stringify(generated.qa, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
  ]);
  return { paths, qa: generated.qa };
}
