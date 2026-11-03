# NEONTRIP installation documents

## Scope and release state (2026-11-02)

Implemented locally; **not published, no customer mail sent**. The user approved implementation,
chose **confirmed transport scan**, and explicitly waived an internal test email. Offline
verification is the agreed test surface. Final exact-commit publication approval is still required
by repository AGENTS. The previous preparation commit was `4034629772b6c67117e85262ff43b1588622767b`.

Ziel: one appropriate document mail per actual Shopify fulfillment, with Mika's existing signature,
only after an explicit carrier transport event, and no historical backfill.
Nachbar: existing pickup notices, internal shipping warnings, 17TRACK scheduling and credentials.
Wirkung: one durable reservation in the existing shipping_notifications table, one Outlook draft,
one send authorization and provider evidence from Sent Items. No new queue, table, workflow,
credential, scheduler or AI-generated customer text.
Allowed paths: private installation assets, installation server route/modules, existing shipping
notification RPCs, three necessary Shopify import nodes and a new branch in the same Shipping Agent.

## Entry points and handoffs

- `src/lib/ops/shipping-installation-documents.ts`: deterministic order/fulfillment and PDF selection.
- `src/lib/ops/shipping-installation-delivery.ts`: reservation and Graph evidence validation.
- `POST /api/internal/shipping/installation-documents`: existing internal authentication,
  no-store, 1 MB order / 5 MB evidence limits. Default action `prepare` remains read-only.
  `reserve` accepts a current Shopify order, target fulfillment, verified mailbox profile and
  Sent Items folder. `authorize` validates the actual draft including PDF bytes. `complete`
  validates the same immutable message in Sent Items. This endpoint never calls Graph itself.
- `supabase/migrations/20261102122441_shipping_installation_documents.sql`: extends the existing
  notification kind constraint and excludes document notifications from the legacy claimant and
  legacy sent/failed markers. New RPCs are SECURITY INVOKER and executable only by service_role.
- `scripts/build_shipping_installation_workflow.mjs`: local, non-publishing patch builder. Requires
  workflow `QtG2XHw7DsvOEPtQ`, published version `35d9a83b-6c4c-4f26-b8db-d750fcccd743`.
  Input baseline: `n8n/backups/2026-11-02-shipping-installation-documents/active-before.json`.
  This is an evidence snapshot; refresh complete live draft/active state before release.

The existing hourly Shopify poll now includes partial fulfillments, follows Link pagination on the
owned shop, and processes every page and Graph event input with its proper shipment linkage.
Only these three original nodes change: Recent Fulfilled Orders, Build Shipment Records,
Build Shopify Event Records. All existing connections remain; one additional sibling branch is added.
The new branch uses the **existing** Outlook OAuth credential `CTEmJD5CjYu9hawu`, queries `/me`
and pins support@neontrip.de / mailbox ID `4d977ed3-c401-43e5-ad00-b171a294e787` before creating drafts.
Mika is the named contact/signature and Reply-To display; the mailbox itself stays support@neontrip.de.

The branch isolates errors from existing notifications, drops all non-ready responses, and never
retries a POST. GETs may retry three times. Pairing uses the corresponding input item, never the first
customer's claim. Graph draft creation, read-back, send and Sent Items lookup all use immutable IDs.
After a 30-second settlement wait, the same message is read with its attachments and headers.

## Eligibility, replay and failure handling

A Shopify success/label status does not qualify. Neither does the tracker's generic in_transit
normalization: that mapper can default unknown text to in_transit. Eligibility requires either:

- an actual Shopify FulfillmentEvent ID and explicit IN_TRANSIT, CARRIER_PICKED_UP,
  OUT_FOR_DELIVERY or READY_FOR_PICKUP status; or
- a 17TRACK **individual event** with an explicit transit/delivery/pickup status and an actual,
  parseable event timestamp matching the persisted event time. A latest-status envelope or
  synthetic fallback timestamp does not qualify.

The event must match the current fulfillment's tracking number and shipment. Returning/returned/closed fulfillments are excluded. A newly delivered parcel still qualifies
when its first transport scan is new; the hourly poll must not discard instructions merely because
delivery happened between polls. The first qualifying scan must be on or after the migration's
permanent activation timestamp in the existing audit log and within 21 days; old scans on another
parcel of the same fulfillment also suppress backfill. Reapplying the migration keeps that timestamp.
The poll covers orders updated within 21 days. An unusually delayed shipment with no Shopify update
in that window needs manual review; there is no claim of unlimited historical coverage.

The unique key is `customer:installation_documents:shopify:<order>:<fulfillment>`. Different parcels
of one fulfillment cannot create another reservation. Separate partial fulfillments can each receive
only their own documents. The database insert has one winner under concurrent calls.

Reservations remain pending and hold a random owner token, expected recipient/subject/body hash,
PDF filenames/sizes/hashes and scan evidence. They can authorize sending once, within 15 minutes.
The authorization persists the immutable provider message ID and changes status to sending before
the external send. No expired claim or uncertain send is automatically reclaimed or retried.

The Sent Items proof must match immutable ID, sender, single recipient, no CC/BCC, reply address,
subject, complete visible body text, signature image URLs, notification header, every PDF hash,
Sent Items folder, provider message ID and a plausible send time. Only then is the record sent.
This proves provider submission/Sent Items, not inbox delivery or absence of a later bounce.

The existing Shipping Notification Monitor covers pending records older than 2 hours and sending
records older than 45 minutes. Document review reasons are stored in last_error. Missing/uncertain
provider proof remains pending/sending for reconciliation. **Never retry an n8n execution at a
Create/Send node or reset a claim.** Inspect the recorded immutable draft ID, the custom message
header and Outlook Sent Items first. An orphan draft after a lost create response is never resent
by the automated flow. A green workflow execution alone is not mail proof; inspect node errors and
canonical records. Infrastructure failures before a reservation require checking n8n/endpoint errors.

Observed before implementation: 69 shipments and 741 events created in the prior 30 days were
label_created. No real eligible transport scan or live send is claimed at this checkpoint. The
new automation waits for explicit evidence; it does not reinterpret labels to force a send.

## Document provenance and limits

Wall, ceiling v3, LED connection, frontlit and nonlit German PDFs are unchanged byte copies from
the user-owned `NEONTRIP-Montageanleitungen_Aktuell` collection dated 2026-10-27. The ceiling guide
matches the confirmed cylinder holder with a loose top stopper. The one-page power notice
`NT-PSU-DE-01` condenses the existing overload/overheating warning from pages 1/4 of
`NEONTRIP-Montage-Bedienungsanleitung-LED-Neonschilder.pdf`, omitting an unverified universal 12-V
claim and unfinished pairing notes. All six PDFs were parsed and rendered/inspected locally.

All mails include the power notice, applicable when power supplies are supplied. LED connection
applies to LED neon only. Mounting PDFs depend on purchased, fulfilled accessories, including both
wall and ceiling where applicable. No mounting accessory means no guessed mounting PDF. Invalid
quantities, conflicting selections, duplicate/foreign positions or unknown products stop dispatch.

3D frontlit/nonlit require a described construction covered by the guide. Frontlit RGB/CCT is
excluded from the single-colour guide. Backlit remains for review: the existing local PDF says the
letter lies against the wall, refers to a PSU plus/minus input and does not clarify the standoff
construction. It cannot safely be substituted with Frontlit. Adhesive/table-stand instructions are
also unavailable. These cases reserve a review record and send **no incomplete document mail**.

Repair prepared on 2026-11-03: the German product alias "rückleuchtend" maps to backlit.
The exact known "3D Standardversand ca. N Werktage" and "Outdoor/IP67 Ausführung" lines
are services/surcharges, not unknown physical products. Unknown products with similar
prefixes still block delivery. This does not approve a backlit guide.
For #NEONT4627, the current pending, never-attempted reservation was reconciled to the
single genuine reason `backlit_manual_not_cleared`; its send hold remains.
Existing reservations are not automatically recomputed by an application release.

Manifest in `assets/neontrip-installation-documents/manifest.json` pins filenames, byte sizes and
SHA256. Server assets remain private, traced into Next and copied into Docker runtime. Payloads
over 3,900,000 bytes are held for review. The four-document example is 3,668,527 bytes.
Mika's exact signature is from published workflow `cW08nxn9ANfGFEou`, version
`c45cadf2-0c69-468b-ae53-b652c3176e96`, without reusing its marketing text.

## Verification commands

- `npx tsx --test tests/quotes/shipping-installation*.test.ts`
- `node --test scripts/test_shipping_installation_workflow.mjs`
- `python3 scripts/test_shipping_installation_db.py` (disposable PostgreSQL 17, network disabled,
  synthetic data, concurrent claims and actual migrated functions; container removed afterward).
- `NODE_OPTIONS=--test-reporter=tap npm run test:quotes`
- `npx tsc --noEmit --incremental false`
- `npm run build`

Workflow validation checks the complete candidate. The two executeOnce notices are intentional:
mailbox identity and Sent Items folder are fetched once, not once per Shopify page. Browser preview,
actual attachment hashes and PDF page parsing were checked in the preparation stage. No internal
email or customer canary is sent; the user waived the former. Runtime provider proof remains open.

Verified results (final local checks): 46 focused mail/route tests, 18 isolated PostgreSQL tests,
8 workflow checks; full suite 1737 passed, 2 existing skips, 0 failures. TypeScript and production
build passed. A local production-server smoke returned 401 without authentication, prepared four
real PDFs with Mika when authorized, and returned 404 for direct private-asset access. No send.

## Release order and rollback

1. Complete checks, inspect the full diff, commit only this scope and obtain approval of the exact
   clean commit for Ops deployment, migration and the named Shipping Agent publication.
2. Recheck origin/main and all live function bodies being replaced. Capture full workflow draft,
   active graph/version and activation state and rollback immediately before writing. Stop on drift.
3. Run `codex-predeploy ops` in the approved clean worktree, then `codex-safe-push-main` only when
   printed full commit equals approval and HEAD. Verify deployed source/build before workflow use.
4. Apply the single reviewed migration via the supported Supabase migration flow. Verify constraint,
   RPC privileges, legacy-kind exclusions and activation boundary read-only. No mail occurs here.
5. Re-fetch workflow version, generate patch against the unchanged active source, preserve unrelated
   draft edits, compare the complete graph, then publish the approved delta with activation unchanged.
   Do not manually execute the customer workflow. Observe the ordinary scheduler and reconcile
   eligible notifications with exact PDF selection and Outlook evidence.
6. Rollback: restore the captured shipping workflow graph first, keeping its activation state. Keep
   document reservations and the new-kind exclusions in the database so uncertain messages cannot
   enter the old retry path. Do not drop notification rows or reset the activation cutoff. Reverting
   the app does not undo sent messages. Any database rollback beyond disabling this branch must
   reconcile saved drafts/sends first; never blindly apply the original kind constraint over records.

Authoritative API references consulted:
[Microsoft immutable IDs and Sent Items](https://learn.microsoft.com/en-us/graph/outlook-immutable-id),
[Graph message read](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0),
[Shopify Link pagination](https://shopify.dev/docs/api/admin-rest/usage/pagination).
