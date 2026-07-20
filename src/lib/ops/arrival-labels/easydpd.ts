import type { DpdPdfLayout } from "./pdf";

export type EasyDpdCreateLabelInput = {
  idempotencyKey: string;
  shopifyOrderId: string;
  incomingDhlTrackingNumber: string;
  productCode: string;
};

export type EasyDpdLabel = {
  trackingNumber: string;
  pdf: Uint8Array;
  sourceReference: string;
};

export interface EasyDpdPort {
  findExisting(input: Pick<EasyDpdCreateLabelInput, "shopifyOrderId" | "incomingDhlTrackingNumber">): Promise<EasyDpdLabel | null>;
  createLabel(input: EasyDpdCreateLabelInput): Promise<EasyDpdLabel>;
  pdfLayout(): Promise<DpdPdfLayout>;
}

export function createUnconfiguredEasyDpdPort(): EasyDpdPort {
  const unavailable = async (): Promise<never> => {
    throw new Error("EasyDPD API contract and approved product mapping are not configured; writes remain fail-closed.");
  };
  return { findExisting: unavailable, createLabel: unavailable, pdfLayout: unavailable };
}
