---
name: neontrip-arrival-labels
description: Start and summarize the deterministic NEONTRIP DHL Express arrival to DPD label dry-run automation. Use when an operator asks to inspect today's incoming DHL shipments, preview Trello/Shopify matches, list manual-review cases, verify existing DPD labels, or run the arrival-label workflow without creating labels.
---

# NEONTRIP Arrival Labels

Run only the repository's tested deterministic service. Do not reproduce, infer, or modify matching, shipping-product, EasyDPD, or PDF logic inside the skill.

Treat `docs/operations/dhl-dpd-arrival-labels-operating-standard.md` as the binding operator runbook. The audited 2026-07-20 manual batch is recorded in `docs/operations/dhl-dpd-arrival-labels-manual-batch-2026-07-20.md`.

## Run a dry run

1. Confirm the repository is under `/home/daniel` and no production write was requested.
2. Run `scripts/run-dry-run.sh`. Pass a date as `--date YYYY-MM-DD` only when the operator requests one; otherwise the service computes today in `Europe/Berlin`.
3. Treat exit code `2` as a successful report containing manual-review cases, not as permission to continue automatically.
4. Summarize counts and every non-routine case. Include the generated Markdown and JSON report paths.

For a saved-fixture check, run:

```bash
scripts/run-dry-run.sh --date 2026-07-20 --fixture tests/fixtures/arrival-labels/reference-dry-run.json
```

## Safety boundaries

- Never add `--mode execute`, `--acknowledge-production-write`, or `--persist` from this skill.
- Never activate or deploy the n8n workflow.
- Never create, buy, void, cancel, or download a live EasyDPD label.
- Never guess DPD 09:00, 12:00, Express 12:00, or Express 18:00 mappings.
- Existing Shopify fulfillment or DPD tracking means no second label.
- Existing tracking only blocks a second purchase; it does not authorize download or print. Never reuse an old or already used shipment label.
- Missing or ambiguous Trello/Shopify data, non-standard notes, conflicting shipping instructions, and absent product configuration remain manual review.
- A card in `Problem with Sign`, `Problem mit Schild`, `Manual Review`, `Manuelle Prüfung`, `Sonderfälle`, or an equivalent explicitly manual Trello list remains manual review. Trello can block but cannot grant automation.
- Never expand a handwritten four- or six-digit suffix into a full DHL number by guessing. The complete DHL number must be independently evidenced.
- Switzerland, all other non-EU destinations, missing countries, and known EU VAT/customs special territories remain manual review.
- EU destinations outside Germany require a complete Shopify delivery address, an explicitly approved EU DPD product, and a QA-approved A4 delivery note confirmed printed on the physically separate approved office printer before any label purchase. Never route a delivery note to the A6/4x6 label printer.
- Do not substitute the Sales-Vergabe order confirmation for a delivery note and do not assume an EasyBill API exists.
- `100 pieces single color dimmers` is a reported special case without an expected Shopify order.
- The reference `#NEONT4498` / DHL `2619113486` / DPD `01476817678011` must remain existing-label only.
- Every printable A6 artifact uses exactly the last six DHL digits; four-digit annotations are obsolete and forbidden.

Productive execution requires a separately reviewed EasyDPD adapter, approved versioned product/PDF configuration, explicit dry-run confirmation, database migration, deployment approval, and `codex-predeploy ops`. This skill intentionally provides no productive command.
