const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TRELLO_API_KEY",
  "TRELLO_TOKEN",
  "OPS_CLOUDFLARE_ACCESS_ISSUER",
  "OPS_CLOUDFLARE_ACCESS_AUD",
  "SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN",
  "DESIGN_WORKER_API_KEY",
];

const recommended = [
  "OPS_ALLOWED_EMAILS",
  "OPS_ALLOWED_EMAIL_DOMAINS",
  "OPS_REQUIRE_CLOUDFLARE_ACCESS",
  "OPS_PLACETEL_CONTACT_URL_TEMPLATE",
];

const missing = required.filter((name) => !String(process.env[name] || "").trim());
const warnings = [];

if (!String(process.env.OPS_ALLOWED_EMAILS || process.env.OPS_ALLOWED_EMAIL_DOMAINS || "").trim()) {
  warnings.push("OPS_ALLOWED_EMAILS oder OPS_ALLOWED_EMAIL_DOMAINS fehlt. Dann gilt nur die Cloudflare-Access-Policy.");
}

if (String(process.env.OPS_REQUIRE_CLOUDFLARE_ACCESS || "").trim().toLowerCase() !== "true") {
  warnings.push("OPS_REQUIRE_CLOUDFLARE_ACCESS ist nicht true. Token-Fallback bleibt auf nicht-lokalen Hosts moeglich.");
}

for (const name of recommended) {
  if (!String(process.env[name] || "").trim()) {
    warnings.push(`${name} ist nicht gesetzt.`);
  }
}

if (missing.length) {
  console.error("Customer Records Ops Deploy-Env ist unvollstaendig.");
  console.error(`Fehlend: ${missing.join(", ")}`);
  if (warnings.length) {
    console.error(`Hinweise: ${warnings.join(" | ")}`);
  }
  process.exit(1);
}

console.log("Customer Records Ops Deploy-Env: Pflichtwerte vorhanden.");
if (warnings.length) {
  console.log(`Hinweise: ${warnings.join(" | ")}`);
}
