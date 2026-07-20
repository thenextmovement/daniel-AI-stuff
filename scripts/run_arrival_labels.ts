import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArrivalDataClients } from "../src/lib/ops/arrival-labels/clients";
import type { DhlMailEvidence, ExistingDpdEvidence, ProductConfig, ShopifyOrderEvidence, TrelloCardEvidence } from "../src/lib/ops/arrival-labels/domain";
import { arrivalRunMarkdown } from "../src/lib/ops/arrival-labels/report";
import { runArrivalLabels } from "../src/lib/ops/arrival-labels/service";

type Fixture = {
  messages: DhlMailEvidence[];
  cards: TrelloCardEvidence[];
  orders: ShopifyOrderEvidence[];
  existingLabels?: Record<string, ExistingDpdEvidence[]>;
  productConfig?: ProductConfig | null;
};

function argument(name: string) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function fixtureClients(fixturePath: string) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const clients: ArrivalDataClients = {
    outlook: { async listMessagesForLocalDate() { return fixture.messages; } },
    trello: { async listQuentinCards() { return fixture.cards; } },
    shopify: { async listRecentOrders() { return fixture.orders; } },
    existingLabels: { async findForOrders() { return new Map(Object.entries(fixture.existingLabels || {})); } },
  };
  return { clients, productConfig: fixture.productConfig };
}

async function main() {
  const requestedMode = argument("mode") || "dry_run";
  if (!hasFlag("acknowledge-production-write") && requestedMode !== "dry_run") {
    throw new Error("Execute erfordert --acknowledge-production-write und bleibt bis zur EasyDPD-Freigabe zusätzlich gesperrt.");
  }
  if (!hasFlag("persist") && requestedMode !== "dry_run") {
    throw new Error("Execute erfordert ein persistiertes Audit (--persist).");
  }
  const fixturePath = argument("fixture");
  const fixture = fixturePath ? await fixtureClients(path.resolve(fixturePath)) : null;
  const result = await runArrivalLabels({
    localDate: argument("date"),
    mode: requestedMode as "dry_run" | "execute",
    persist: hasFlag("persist"),
    triggerType: fixture ? "fixture_test" : "manual_cli",
    clients: fixture?.clients,
    productConfig: fixture ? fixture.productConfig : undefined,
  });
  const report = arrivalRunMarkdown(result);
  const reportRoot = path.resolve(process.env.ARRIVAL_LABEL_REPORT_DIR || "var/arrival-labels/reports");
  await mkdir(reportRoot, { recursive: true });
  const stem = `${result.localDate}-${result.correlationId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const markdownPath = path.join(reportRoot, `${stem}.md`);
  const jsonPath = path.join(reportRoot, `${stem}.json`);
  await Promise.all([
    writeFile(markdownPath, report, { encoding: "utf8", mode: 0o600 }),
    writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
  ]);
  process.stdout.write(report);
  process.stdout.write(`\nBericht: ${markdownPath}\nJSON: ${jsonPath}\n`);
  if (result.summary.reviewNotifications > 0) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`Arrival-Labels fehlgeschlagen: ${error instanceof Error ? error.message : "Unbekannter Fehler"}\n`);
  process.exitCode = 1;
});
