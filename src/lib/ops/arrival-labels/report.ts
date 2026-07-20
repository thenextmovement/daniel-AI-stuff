import type { ArrivalRunResult } from "./service";

function cell(value: unknown) {
  return String(value ?? "-").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export function arrivalRunMarkdown(result: ArrivalRunResult) {
  const lines = [
    `# DHL/DPD Dry Run ${result.localDate}`,
    "",
    `- Modus: \`${result.mode}\``,
    `- Zeitzone: \`${result.timezone}\``,
    `- Korrelations-ID: \`${result.correlationId}\``,
    `- Produktkonfiguration: ${result.configVersion ? `\`${result.configVersion}\`` : "nicht freigegeben"}`,
    "",
    "| DHL-Sendung | Letzte 6 | Erwartete Ankunft | Trello / Auftrag | Shopify / Kunde | Notiz / Änderung | Versandart | DPD-Produkt | DPD-Tracking | PDF | Druck | Status / Fehler |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of result.cases) {
    lines.push(`| ${[
      entry.trackingNumber,
      entry.lastSix,
      entry.expectedArrival,
      entry.trelloCard ? `[${cell(entry.trelloCard.name)}](${entry.trelloCard.url})` : "-",
      entry.shopifyOrder ? `${cell(entry.shopifyOrder.name)} / ${cell(entry.shopifyOrder.customerName)}` : "-",
      cell(entry.relevantOrderNote),
      entry.shippingClass,
      cell(entry.selectedDpdProduct),
      cell(entry.existingDpdTracking),
      "-",
      result.mode === "dry_run" ? "nicht eingereiht (Dry Run)" : "-",
      cell(entry.manualReviewReason || entry.status),
    ].join(" | ")} |`);
  }

  lines.push(
    "",
    `Ermittelt: ${result.summary.found}; geplant: ${result.summary.labelPlanned}; bestehend: ${result.summary.existingLabel}; manuell: ${result.summary.manualReview}; Sonderfälle: ${result.summary.specialCase}; Prüfmail-Outbox: ${result.summary.reviewNotifications}.`,
  );
  return `${lines.join("\n")}\n`;
}
