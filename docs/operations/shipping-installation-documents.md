# NEONTRIP installation documents — preparation

## Scope and current state (2026-11-02)

Implemented locally: deterministic selection from Shopify fulfillment positions,
hash-checked PDF attachments, Mika's existing signature, private preparation endpoint,
offline preview and tests. No production writes, notification claim, mail draft creation,
customer sends or workflow publication. This is NOT the completed delivery automation.

Ziel: one appropriate document mail per actual fulfillment, signed by Mika.
Nachbar: existing pickup and internal shipping warnings stay untouched.
Wirkung: this preparatory revision has no external side effects. Delivery and durable
replay protection remain to be integrated after the trigger decision below.

## Entry points

- `src/lib/ops/shipping-installation-documents.ts`: validates order/fulfillment linkage,
  positive quantities, purchased accessories; reuses `supplierSaleMountingSelection`.
- `POST /api/internal/shipping/installation-documents`: existing internal authentication,
  bounded input and no-store response. Accepts `{order, fulfillmentId}` from a trusted
  Shopify read. Returns `ready: false` with review reasons or the complete Graph draft
  payload. It does not call Graph or Supabase.
- `assets/neontrip-installation-documents/manifest.json`: immutable filename/hash/size
  mapping. These are private server assets, included in Docker and Next tracing.
- `scripts/preview_installation_mail.ts <absolute-output-folder>`: creates a synthetic
  local HTML preview and the four real attachments; no mail is sent.

## Document provenance and limits

Wall, ceiling v3, LED connection, frontlit and nonlit DE are unchanged byte copies from
the user-owned `NEONTRIP-Montageanleitungen_Aktuell` collection dated 2026-10-27.
The ceiling guide matches the user's confirmed cylinder holder with a loose top stopper.
`NT-PSU-DE-01` condenses the existing overload/overheating warning from pages 1/4 of
`NEONTRIP-Montage-Bedienungsanleitung-LED-Neonschilder.pdf` into a general power notice;
it deliberately does not carry over the unverified universal 12-V claim or pairing notes.
Rendered and inspected locally; not a physical certification of shipped hardware.

All mails include the power notice, explicitly applicable when power supplies are supplied.
LED connection applies to LED neon only. No mounting accessory purchased means no
guessed mounting PDF. Only fulfilled positions select accessories; quantities of zero,
negative choices, duplicate or foreign items and conflicting configuration fail closed.
Adhesive/table-stand instructions are not available and cause review when selected.

3D frontlit/nonlit are selected only where the item description explicitly documents a
construction covered by the guide; otherwise internal review is required. Frontlit RGB/CCT
is excluded from the single-colour guide. Backlit stays blocked: the local original says
the letter lies against the wall and refers to a PSU plus/minus input, and does not settle
the standoff construction. Do not attach it automatically or replace it with frontlit.

Mika signature is copied from published workflow `cW08nxn9ANfGFEou`, version
`c45cadf2-0c69-468b-ae53-b652c3176e96`. No marketing copy is reused. Reply-To is
`support@neontrip.de` with Mika's name. Outlook connector profile is support@neontrip.de;
actual sender/display identity must still be verified through the chosen live transport.

## Open integration decisions and required work

User has been asked whether Shopify fulfillment marking or the first confirmed carrier
scan should trigger the mail, and for the internal test recipient. Neither answer is present.
Do not infer the answer from elapsed time.

Observed live Shipping Agent: `QtG2XHw7DsvOEPtQ`, published version
`35d9a83b-6c4c-4f26-b8db-d750fcccd743`. In the 30-day database sample all 69 new
shipments and all 741 new tracking events were still label_created. 66 shipments linked to
supplier_sales, but those snapshots did not include fulfillments. Actual fulfillment items
must therefore be fetched from Shopify, not guessed from the whole sales order.

The existing shipping_notifications kind constraint allows only pickup and internal
problem notifications. Its current claim also reclaims `sending` after 30 minutes.
Never insert document mails under an existing kind or feed them into that old claimant.
The preparation endpoint alone provides no durable duplicate prevention. The stable key
`customer:installation_documents:shopify:<order>:<fulfillment>` is only a proposed identity.
Before delivery: prepare the smallest extension of the existing notification mechanism,
exclude documents from legacy claims, reserve atomically, bind provider draft/receipt,
and stop uncertain sends for reconciliation. No new queue or workflow is justified yet.

Also define activation cutoff (no historical customer backfill), partial-fulfillment scanning
including pagination, internal review handling, and the read-back proof for actual sends.
Existing hourly Shopify poll requests fully shipped orders only; do not claim it covers
partial fulfillments without changing and testing that boundary. Large attachment payloads
over 3,900,000 bytes stay for review rather than silently dropping a PDF.

## Verification

- 51 focused shipping/preparation tests passed after final changes.
- Full suite using the TAP reporter: 1712 passed, 2 existing skips, 0 failed.
  Node 24 defaults caused an unrelated existing QC wrapper to expect TAP but receive spec;
  rerun with `NODE_OPTIONS=--test-reporter=tap` passed without changing that wrapper.
- `npx tsc --noEmit --incremental false` passed; `npm run build` passed.
- Next trace includes all six PDFs and manifest; Docker copies them to the runtime.
- Actual combined payload: 3,668,527 bytes with four PDFs, each parsed as one page and
  hash-verified. This is offline attachment proof, not Outlook delivery proof.

## Release and recovery

No deployment or live activation requested at this checkpoint: preparation remains local
until the missing decisions and delivery work are completed. Follow repository AGENTS
for the final clean commit, exact-SHA approval and codex-predeploy. Capture complete
workflow draft/active state and rollback immediately before any later live workflow write.
This preparatory change can be reverted locally without affecting existing notifications.
