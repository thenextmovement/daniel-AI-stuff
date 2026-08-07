import assert from "node:assert/strict";
import {
  FABIENNE_PHOTO_URL,
  buildMissingDesignAutoReplyHtml,
  buildRiesenobjekteSignatureHtml,
} from "./missing-attachment-autoreply-patch.mjs";
import {
  legacyMissingDesignAutoReplyHtml,
  legacyNormalSignatureTail,
  normalizePatches,
  operations,
  patch,
} from "./brand-signature-patch.mjs";

function applyStrictPatches(source, patches) {
  let result = source;
  for (const entry of patches) {
    const first = result.indexOf(entry.find);
    assert.notEqual(first, -1, `missing patch anchor: ${entry.find.slice(0, 80)}`);
    assert.equal(result.indexOf(entry.find, first + entry.find.length), -1, "ambiguous patch anchor");
    result = result.slice(0, first) + entry.replace + result.slice(first + entry.find.length);
  }
  return result;
}

const signature = buildRiesenobjekteSignatureHtml();
assert.equal(FABIENNE_PHOTO_URL, "https://cdn.shopify.com/s/files/1/0534/7819/5350/files/fabienne123.jpg?v=1764000653");
assert.equal((signature.match(/<img\b/g) || []).length, 1);
assert.match(signature, /fabienne123\.jpg/);
assert.match(signature, /alt="Fabienne Trapp"/);
assert.match(signature, /role="img" aria-label="RIESENOBJEKTE"/);
assert.match(signature, /RIESEN<span style="color:#ccff00">OBJEKTE<\/span>/);
assert.match(signature, /Inflatables &amp; aufblasbare Sonderformen/);
assert.match(signature, /info@riesenobjekte\.de/);
assert.match(signature, /www\.riesenobjekte\.de/);
assert.doesNotMatch(signature, /NEONTRIP|support@neontrip\.de|weiss_logo_NEONTRIP/i);

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const missingHtml = buildMissingDesignAutoReplyHtml("<Thomas>", escapeHtml);
assert.match(missingHtml, /Hallo &lt;Thomas&gt;,/);
assert.equal((missingHtml.match(/fabienne123\.jpg/g) || []).length, 1);
assert.equal((missingHtml.match(/aria-label="RIESENOBJEKTE"/g) || []).length, 1);
assert.doesNotMatch(missingHtml, /Fabienne von RIESENOBJEKTE/);

const currentFixture = `${legacyMissingDesignAutoReplyHtml}\nconst normalAutoReplyHtml = 'body' +\n${legacyNormalSignatureTail}`;
const migrated = applyStrictPatches(currentFixture, normalizePatches);
assert.match(migrated, /function buildRiesenobjekteSignatureHtml/);
assert.equal((migrated.match(/buildRiesenobjekteSignatureHtml\(\)/g) || []).length, 3);
assert.doesNotMatch(migrated, /Fabienne von RIESENOBJEKTE/);
assert.doesNotMatch(migrated, /font-size:13px;color:#555;margin-top:20px/);

assert.equal(patch.workflowId, "1hRkUxPXUZoYRSgL");
assert.equal(patch.expectedNodeCount, 25);
assert.equal(patch.expectedActiveVersionId, "4765b26c-5298-46c3-be3d-bdbffe0ab2f1");
assert.equal(operations.length, 1);
assert.equal(operations[0].type, "patchNodeField");

console.log("RIESENOBJEKTE brand signature patch checks passed");
