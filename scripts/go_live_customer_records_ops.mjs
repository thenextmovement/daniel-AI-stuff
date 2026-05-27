import { spawnSync } from "node:child_process";

const smokeUrl = String(process.env.OPS_SMOKE_BASE_URL || process.argv[2] || "").trim();

const steps = [
  ["Deploy-Env", "npm", ["run", "check:ops-deploy"]],
  ["Datenbank-Schema", "npm", ["run", "check:ops-schema"]],
  ["Dependency-Audit", "npm", ["audit"]],
  ["TypeScript", "npx", ["tsc", "--noEmit"]],
  ["Quote/Ops-Tests", "npm", ["run", "test:quotes"]],
  ["Production-Build", "npm", ["run", "build"]],
];

if (smokeUrl) {
  steps.push(["Smoke-Test", "node", ["scripts/smoke_customer_records_ops.mjs", smokeUrl]]);
}

function runStep([label, command, args]) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`${label} konnte nicht gestartet werden: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${label} fehlgeschlagen.`);
    process.exit(result.status || 1);
  }
}

for (const step of steps) {
  runStep(step);
}

if (!smokeUrl) {
  console.log("\nHinweis: Kein Smoke-URL-Argument gesetzt. Fuer Production z. B. ausfuehren:");
  console.log("node scripts/go_live_customer_records_ops.mjs https://ops.neontrip.de");
}

console.log("\nCustomer Records Ops Go-Live-Gates gruen.");
