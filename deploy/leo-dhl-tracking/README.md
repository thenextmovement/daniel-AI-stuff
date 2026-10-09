# Leo: direct DHL tracking — prepared, not active

Run only on one designated persistent server. No laptop timers and no parallel worker for the same DHL key. This candidate does not install services, apply migrations, buy labels, print, send WhatsApp messages or deactivate n8n.

## Commands

From the verified Ops release with its existing Node dependencies:

- `node --import tsx scripts/run_leo_dhl_tracking.ts plan`: Trello and mapping reads only; no DHL request or business write.
- `node --import tsx scripts/run_leo_dhl_tracking.ts check`: direct DHL request and private quota/report files; no database mutation.
- `LEO_DHL_SYNC_ENABLED=true node --import tsx scripts/run_leo_dhl_tracking.ts sync`: fresh Trello identity check, then transactional carrier ingest. This mode changes business data and is not a safe connection-only test.

Use a private 0600 environment file outside the repository with DHL_API_KEY, the existing authorized Trello/Supabase runtime connection and absolute LEO_DHL_STATE_DIR. Never paste keys into commands, Git or logs. The state directory must be persistent, 0700, writable only by the worker. Fill every @...@ placeholder in the service template with verified runtime paths/user. The default service runs check mode; do not enable its timer until a successful manual check.

The timer is 09:00, 18:00 and 23:00 Europe/Berlin with DST adjustment and one catch-up on restart. Slot deduplication prevents repeated requests in that slot. A check consumes the slot; switching to sync does not replay that request. Wait for the next slot rather than deleting quota evidence. Every actual HTTP attempt is reserved first, spaced by at least 5.1 seconds, with a conservative 225 requests per rolling 24 hours. The initial DHL development plan is not production approval; confirm the application's current entitlement before activation. If all due candidates cannot fit the remaining budget, the worker checks never-attempted shipments first, then the least recently attempted, up to the remaining quota. It reports incomplete coverage explicitly. Failed and check-only attempts still consume quota; no attempt history is reset or same-slot request replayed.

Trello intake: Sign Approved, Only Super Urgent, Prepare Shipping; Create Invoice catches cards moved before discovery. Already registered cards can continue in Sign SHIPPED. Title/custom-field mismatch, ambiguous ten-digit numbers, duplicate cards or an existing foreign card mapping stop selection. Full waybills retain leading zeroes. Completed cards should leave this list scope through the existing final workflow; verify the plan count before activation to avoid historical-card quota consumption.

## Carrier release rule

The alternatives are German clearance completion with proven physical German arrival, or subsequent German processing/departure after explicit German clearance. One valid path is enough; do not wait for all three. Arrival, pre-advice, ETA or a waybill alone never release a case. A new generic customs update remains blocking until a strictly later German processing/departure event supersedes its exact standard text. Same-time or foreign movement, extra customs instructions, unknown customs updates and real holds do not resolve it. Existing Shopify and duplicate checks still apply.

The 23:00 slot improves the chance of preparation before the delivery day; neither a full day of lead time nor physical printing while laptops are off is guaranteed. Quota remains 225 total requests per rolling 24 hours across all three slots.

## Release and acceptance gates

1. Confirm exact approved full Ops commit, production resource, repository, branch and environment; run existing predeploy workflow. Apply only the approved Leo migrations, including `20261007224500_dhl_unified_tracking_ingest.sql`, after inspecting the current schema. No migrations have been applied by this preparation.
2. Confirm DHL app activation, production entitlement and a real check response for a known current waybill. Compare exact identity, carrier event timestamps, structured country codes, physical German arrival and explicit German customs release. Unknown/malformed status stays blocked. Development success alone does not prove production allowance.
3. Run plan and reconcile every relevant card. In particular, the known historical mismatched card mapping must remain blocked; never overwrite it to make a test pass.
4. Complete the private Kai notification handoff before sync: current CLI writes `latest-report.json` and exits 2 on issues, but has no WhatsApp sender. Deduplicate meaningful new issues and send only privately to Rahim with the verified Trello link. Fatal startup/lock errors appear as safe stderr codes/exit 1. Monitor those too. Do not assume the timer or report constitutes delivery.
5. Review the existing legacy notifier before sync. The reused `inbound_record_carrier_response` calls `inbound_evaluate_shipment`; successful status updates can create incidents consumed by the old n8n Outlook notifier. Direct DHL API errors deliberately do not enqueue that legacy notification. Cut over that incident path to the verified private Kai transport before enabling sync. Preserve unrelated workflow nodes, credentials and schedules.
6. Enable the existing carrier-release flag only after its exact candidate is deployed and verified. The direct tracking worker itself has no purchase/print call, but stored carrier data can be consumed by the existing scheduler. Confirm fresh Shopify holds, one execution owner, duplicate protection and historical job receipts before releasing that consumer.
7. Accept an end-to-end case with safe approved conditions and verify purchase, correct six-digit PDF references (plus separate `(Tischgerät)` when applicable), exact CUPS completion and physical paper separately. Verify Daniel's worker and Rahim's fallback separately; no current automatic fallback is proven by local manual test jobs. Fabienne follows after those two.
8. Only after verified takeover disable the replaced old trigger branches; do not disable shared finalization, existing print workers or unrelated n8n logic. Record the active commit, timer, known live case and rollback state.

## Recovery

A surviving `poll.lock` means the previous run may have crashed. First prove no worker is running and inspect the last reservation, report and database event keys. Remove only the stale lock after that check; preserve state.json and never clear it to retry an uncertain write. `reserved`/`record_uncertain` entries are not successful checks. Repeated provider payloads deduplicate in the database, but uncertain writes require reconciliation before replay. HTTP 401/403/429/5xx or a network error stops the batch; no rapid retries. Per-waybill invalid/missing histories remain blocked and are reported. Do not repair customer notes, mappings, labels or queue leases automatically.

Tests are network-free fixtures plus an isolated PostgreSQL test for the actual existing ingest functions. They do not establish a live DHL entitlement, print result or WhatsApp delivery.

Official API reference: https://developer.dhl.com/tracking
