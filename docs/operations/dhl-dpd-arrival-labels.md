# DHL Express arrivals → DPD labels

Status: implemented as an inactive, read-only-first candidate including a local print-worker design. The automation created no carrier label and submitted no automated print job; no n8n workflow was activated, no local print service was installed, and no database migration was applied. Separately, an operator manually verified, annotated and printed one already existing EasyDPD label (`#NEONT4498`) exactly once; that audited action is not an automation activation.

The binding operator rules, including manual Trello lists, stale-label handling and the six-digit policy, are recorded in [dhl-dpd-arrival-labels-operating-standard.md](dhl-dpd-arrival-labels-operating-standard.md). The four manual photo cases from 2026-07-20 and the separately completed existing-label case are preserved in [dhl-dpd-arrival-labels-manual-batch-2026-07-20.md](dhl-dpd-arrival-labels-manual-batch-2026-07-20.md).

## Existing environment

- Outlook mailbox: `support@neontrip.de`; production integration uses Microsoft Graph `Mail.Read` application permission and an explicit DHL sender-domain allowlist.
- Trello board `Quentin`: used only as shipment/order projection and matching aid.
- Shopify shop `Neontrip`: Admin GraphQL provides order, customer, shipping address/country, note, custom-attribute, shipping-line and fulfillment evidence. The admin URL is constructed from the validated `*.myshopify.com` domain and numeric order GID; untrusted note URLs are never reused.
- Supabase project `neontrip-followup`: existing inbound/shipping tables remain untouched; the additive migration introduces the authoritative arrival-label state.
- Existing active n8n shipping workflows remain unchanged. The new workflow is generated inactive and only calls the tested Ops dry-run endpoint.
- The current Codex host has no CUPS client (`lp`/`lpstat`) and no configured office printer. A dedicated always-on device in the NEONTRIP WLAN is therefore required for physical printing.
- No documented EasyDPD API contract, credential or confirmed product map was discoverable. The adapter therefore fails closed.

## Architecture

The Ops TypeScript service owns all deterministic rules. Outlook, Trello, Shopify and existing-shipment evidence are normalized, then a case is decided. Postgres stores current case state, per-run snapshots, append-only events and artifact metadata. Trello is never the source of truth.

The idempotency boundary is `Shopify order GID + full inbound DHL tracking number`. A unique database index enforces the same pair. Before any future label write, both Shopify fulfillment/tracking and database shipment evidence must be empty. A lease RPC uses `FOR UPDATE SKIP LOCKED` for future side-effect serialization.

States include `label_planned`, `existing_label`, `manual_review`, `missing_data`, `ambiguous_match`, `conflicting_instructions`, `special_case`, and future post-write/PDF states. Shopify is checked fail-closed before existing-label, purchase or print logic. Empty notes or the exact four-line NEONTRIP offer metadata format are accepted; pickup/Ladenlokal wording, extra note content, mismatched offer URLs, unknown or incomplete custom attributes and prompt-like free text block automation. Trello lists explicitly denoting manual work, including `Problem with Sign`, can only block automation and never grant it. Unclear shipping class, ambiguous matches and absent product configuration also never plan a label. Generic Express, Eilauftrag, Express 09:00, Express 12:00 and optional Express 18:00 are separate configuration keys; two stated deadlines conflict, and an unconfigured deadline always goes to review.

Destination handling is also fail-closed. Germany follows the domestic DPD configuration. Switzerland and every other non-EU country always become manual review and produce the internal `info@neontrip.de` notification. Regular EU destinations outside Germany are eligible only with a complete Shopify delivery address, an explicitly approved EU DPD product mapping, and a separate A4 delivery-note printer. EU VAT/customs exceptions such as the Canary Islands, Ceuta/Melilla, Åland, Mount Athos, Heligoland/Büsingen, Livigno and Campione d'Italia remain manual. The country list and special-territory policy must be reviewed against the official European Commission territorial-scope table before activation.

Every blocked decision creates an idempotent Postgres review-notification outbox entry. Its deterministic plain-text message is fixed to `info@neontrip.de`, states that no new label was bought or queued for printing, and contains the trusted Shopify admin link when an order was resolved. The notification is marked `dispatching` before Outlook send. Any uncertainty after that boundary becomes manual review and is never automatically resent.

The PDF processor accepts only a versioned A6 layout. Its safe area must be inside the page and disjoint from configured address, DPD tracking, QR and barcode protection rectangles. It writes the last six inbound-DHL digits only, revalidates the page, renders a PNG, records SHA-256 QA data and stores files below the controlled artifact root. The full inbound DHL number remains the identity and storage key. An `existing_label` result blocks a second purchase but does not by itself authorize download or print; an old or already used shipment label must never be reused.

For an approved EU destination, the service can generate a separate, price-free A4 delivery note from the verified Shopify delivery address and line items. Every page is reopened, checked for A4 dimensions and unexpected price/tax fields, rendered to PNG for QA, and stored with SHA-256 metadata. This is intentionally not the Sales-Vergabe order confirmation (which contains commercial data), and no EasyBill API integration is assumed. A database trigger blocks transition to `label_created`, `pdf_processed`, or `completed` until the QA-approved delivery-note print job is confirmed `printed`.

After successful PDF QA, a future execute run can enqueue exactly one print job for the annotated artifact. A local worker makes outbound HTTPS requests to Ops, optionally through a scoped Cloudflare Access service token, verifies the PDF magic, byte size and SHA-256, then submits it to an allowlisted CUPS queue without scaling. It durably marks the job `dispatching` before calling CUPS. Expired claims are recoverable only before that boundary; exhausted attempts and any uncertainty after it become manual review and are never automatically reprinted. `printed` requires the exact CUPS job ID to appear as completed.

Three inactive n8n workflows keep their triggers separate: the Outlook workflow reacts to an allowlisted DHL email every minute, the daily workflow reconciles anything missed, and a third worker drains the internal review-mail outbox. The first two run `dry_run` with audit persistence; none can reach EasyDPD, Shopify mutations or the local printer directly.

## Manual operation

Read-only live run (requires runtime secrets):

```bash
npm run arrival-labels:dry-run
```

Specific Berlin date:

```bash
npm run arrival-labels:dry-run -- --date 2026-07-20
```

Saved reference fixture:

```bash
npm run arrival-labels:dry-run -- --date 2026-07-20 --fixture tests/fixtures/arrival-labels/reference-dry-run.json
```

Exit code `2` means the run completed but produced manual-review cases. Reports are written with mode `0600` below `ARRIVAL_LABEL_REPORT_DIR` (default `var/arrival-labels/reports`), never the personal Downloads folder.

## Activation gates

1. Review and apply the additive database migration.
2. Provide scoped Graph, Trello, Shopify and private storage runtime secrets.
3. Obtain EasyDPD's documented API contract and a test credential; implement and contract-test the adapter.
4. Confirm the exact domestic and EU standard, Express and Eil product codes, including the rule for 09:00, 12:00, DPD Express 12:00 and DPD Express 18:00. Never reuse a domestic product code for EU shipments without explicit approval.
5. Validate a real existing label's layout and approve a versioned protected-area configuration.
6. Install CUPS on dedicated office-LAN workers, identify the exact A6 label queue and the separate A4 delivery-note queue/media, and complete no-page self-tests for both.
7. Confirm whether EasyDPD creates Shopify fulfillment/tracking automatically. If it does, Ops must never duplicate that mutation.
8. Run and approve a real read-only report.
9. Deploy only after `codex-predeploy ops`; import all three n8n JSON files inactive and shadow-run them.
10. Perform witnessed A6-label and A4-delivery-note test prints with non-reference fixtures and verify physical size, orientation, scanability and CUPS completion evidence.
11. A later write rollout additionally requires an explicit user approval. `ARRIVAL_LABEL_WRITES_ENABLED` remains `false` until then.

The current code contains no usable EasyDPD write adapter, never enqueues a production print job, and the execute path throws even if the flag is set. This is intentional.
