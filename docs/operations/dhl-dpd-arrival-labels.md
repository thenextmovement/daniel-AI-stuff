# DHL Express arrivals → DPD labels

Status: implemented as an inactive, read-only-first candidate including a local print-worker design. No production label or print job was created, no n8n workflow was activated, no local print service was installed, and no database migration was applied.

## Existing environment

- Outlook mailbox: `support@neontrip.de`; production integration uses Microsoft Graph `Mail.Read` application permission and an explicit DHL sender-domain allowlist.
- Trello board `Quentin`: used only as shipment/order projection and matching aid.
- Shopify shop `Neontrip`: Admin GraphQL provides order, customer, note, shipping-line and fulfillment evidence.
- Supabase project `neontrip-followup`: existing inbound/shipping tables remain untouched; the additive migration introduces the authoritative arrival-label state.
- Existing active n8n shipping workflows remain unchanged. The new workflow is generated inactive and only calls the tested Ops dry-run endpoint.
- The current Codex host has no CUPS client (`lp`/`lpstat`) and no configured office printer. A dedicated always-on device in the NEONTRIP WLAN is therefore required for physical printing.
- No documented EasyDPD API contract, credential or confirmed product map was discoverable. The adapter therefore fails closed.

## Architecture

The Ops TypeScript service owns all deterministic rules. Outlook, Trello, Shopify and existing-shipment evidence are normalized, then a case is decided. Postgres stores current case state, per-run snapshots, append-only events and artifact metadata. Trello is never the source of truth.

The idempotency boundary is `Shopify order GID + full inbound DHL tracking number`. A unique database index enforces the same pair. Before any future label write, both Shopify fulfillment/tracking and database shipment evidence must be empty. A lease RPC uses `FOR UPDATE SKIP LOCKED` for future side-effect serialization.

States include `label_planned`, `existing_label`, `manual_review`, `missing_data`, `ambiguous_match`, `conflicting_instructions`, `special_case`, and future post-write/PDF states. Non-standard Shopify notes, unclear shipping class, ambiguous matches and absent product configuration never plan a label. Generic Express, Eilauftrag, Express 09:00, Express 12:00 and optional Express 18:00 are separate configuration keys; two stated deadlines conflict, and an unconfigured deadline always goes to review.

The PDF processor accepts only a versioned A6 layout. Its safe area must be inside the page and disjoint from configured address, DPD tracking, QR and barcode protection rectangles. It writes the last four inbound-DHL digits only, revalidates the page, renders a PNG, records SHA-256 QA data and stores files below the controlled artifact root. The full inbound DHL number is used in paths to prevent collisions such as two shipments ending in `5500`.

After successful PDF QA, a future execute run can enqueue exactly one print job for the annotated artifact. A local worker makes outbound HTTPS requests to Ops, optionally through a scoped Cloudflare Access service token, verifies the PDF magic, byte size and SHA-256, then submits it to an allowlisted CUPS queue without scaling. It durably marks the job `dispatching` before calling CUPS. Expired claims are recoverable only before that boundary; exhausted attempts and any uncertainty after it become manual review and are never automatically reprinted. `printed` requires the exact CUPS job ID to appear as completed.

Two inactive n8n workflows cover the trigger strategy without mixing triggers: the Outlook workflow reacts to an allowlisted DHL email every minute, and the daily workflow reconciles anything missed. Neither workflow can reach EasyDPD, Shopify mutations or the local printer directly.

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
4. Confirm the exact standard, Express and Eil product codes, including the rule for 09:00, 12:00, DPD Express 12:00 and DPD Express 18:00.
5. Validate a real existing label's layout and approve a versioned protected-area configuration.
6. Install CUPS on a dedicated office-LAN device, identify the exact queue and supported A6 media keyword, and complete a no-page self-test.
7. Confirm whether EasyDPD creates Shopify fulfillment/tracking automatically. If it does, Ops must never duplicate that mutation.
8. Run and approve a real read-only report.
9. Deploy only after `codex-predeploy ops`; import both n8n JSON files inactive and shadow-run them.
10. Perform a witnessed test print with a non-reference fixture and verify physical size, orientation, scanability and CUPS completion evidence.
11. A later write rollout additionally requires an explicit user approval. `ARRIVAL_LABEL_WRITES_ENABLED` remains `false` until then.

The current code contains no usable EasyDPD write adapter, never enqueues a production print job, and the execute path throws even if the flag is set. This is intentional.
