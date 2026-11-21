# Configurator → Trello internal failure alert (candidate)

NEONTRIP only. This candidate connects rBggMnVkWwiVXXXO to the existing internal alert workflow ArT3LN25Mb1PAuBE. No render, Shopify, Trello, customer-email, WhatsApp or schedule behavior is changed.

The two runtime deltas are:

1. Add one exact-source-ID branch in ArT3LN25Mb1PAuBE / Format Error Data. It emits a fixed support-only template, an allowlisted step name, a bounded error class, and a numeric execution ID with a locally constructed n8n URL. Raw messages, response bodies, descriptions, stacks, names and customer/order payloads are not forwarded.
2. Set rBggMnVkWwiVXXXO.settings.errorWorkflow to ArT3LN25Mb1PAuBE, only after step1 is published and independently read back.

Existing foreign-source formatting remains byte-for-byte in the formatter suffix. Config/default recipients are not changed; the new branch explicitly selects support@neontrip.de. The hyphenated domain is not used.

The fixed subject `N8N Fehler: NEONTRIP Konfigurator-Assets nicht vollständig erstellt` matches the observed Outlook server rule's subject condition for `06_n8n_fehler-meldungen` and none of its subject exclusions. The rule also requires a configured sender; its configuration is not changed here. Tests cover the subject after the existing gate, not end-to-end folder delivery. Confirm the actual destination from a natural future alert; do not send a test alarm.

## Dependencies and boundaries

- Source baseline: da579466-67d3-4ac9-bba9-ef20fa9740a9, active/published,12nodes.
- Alert baseline: df91ad93-d311-4959-a156-3fcb793699fe, active/published,9nodes.
- Shared gate: fhmCa5a1OS9H8ERh /4902418b-677a-4dac-835c-3a4be2b3842b.
- The gate's old “Five-Minute” name is misleading: current code bundles identical recipient/subject/workflow/step/error-class keys for **24hours/1440minutes**. Preserve it exactly. Different approved steps or error classes remain separate. Unknown raw messages share EXECUTION_FAILED; the raw details stay in n8n.
- The existing Send WhatsApp Alert node remains disabled. The existing shadow branch only records an internal Company Brain incident; it sends no email and invokes no model. It receives only the sanitized output of this branch.
- M4uG1HAtN9Zggxww remains unchanged. A simple assignment to either existing generic formatter would not meet this task's support-only/no-raw-payload requirements.
- The error trigger covers failed scheduled/production executions after linking. It is not a retroactive replay and does not prove that every soft failure alerts.
- No test alarm, workflow execution, mail send or production update is part of this candidate.

## Local preparation and verification

Run:

    node --test workflows/configurator-trello-alert/test-alert.mjs

The fixture contains only relevant formatter/gate code, parameters and metadata; it contains no workflow backup, static incident data or credentials.

patch.mjs is a pure plan builder. It performs no network or deployment operations. It requires exact source and alert versionId/activeVersionId, active=true, equal published/top-level nodes/connections, original settings and relevant parameter baselines. It preserves all unrelated node/connection/settings/credential content by emitting only the two targeted operations.

To produce phase1 from freshly read snapshots supplied on stdin:

    node workflows/configurator-trello-alert/patch.mjs formatter

Input: {formatter,gate}. Output: expectedVersionId/expectedActiveVersionId plus exactly one updateNode operation.

To prepare phase2 only after phase1 has been approved, applied, and verified:

    node workflows/configurator-trello-alert/patch.mjs source

Input: {source,formatter,gate,expectedFormatterVersion,formatterBefore}. Keep formatterBefore as the original in-memory phase1 read. expectedFormatterVersion must be the actual newly published formatter version from phase1; that read must contain the exact candidate code, unchanged routes and active/published state. The builder compares all formatter nodes (including credentials), connections, name and pinned data against formatterBefore with only the exact code insertion allowed. Output: exactly one updateSettings operation. The unmodified formatter baseline cannot generate phase2.

## Release and recovery order

This is preparation only; no production approval is implied.

1. Review the exact Git diff and tests, then obtain the required exact-SHA production approval. Freshly read source, formatter and gate. Abort on any version, published-content or relevant parameter drift; reconcile/re-review the candidate instead of overwriting.
2. Validate/apply the formatter operation alone through n8n MCP. Before any write recheck both version IDs. Read it back, verify its new activeVersionId/versionId and the full expected content, including untouched nodes, connections, credentials, settings, disabled WhatsApp and throttle reference.
3. Only then pass that new formatter version to the phase2 builder with fresh source/gate snapshots. Recheck immediately before applying the single source setting. Read back and compare the complete source workflow; only errorWorkflow may differ.
4. Inspect the next real failure/recovery evidence; do not generate a synthetic failure or claim delivery before the Outlook/send evidence exists.

The expected-version fields are client-side comparison guards, **not a claim that the n8n MCP API exposes an atomic server-side compare-and-swap**. These builders cannot eliminate a concurrent edit between read and write. Coordinate publication and stop on any drift or unexpected API response. There is no automatic overwrite or full-update fallback in this code.

If phase1 succeeds but phase2 cannot proceed, leave the scoped formatter branch in place: the source is still unlinked and existing workflows retain their original behavior. Do not link the source to the old generic formatter.

For rollback after linking, first remove only the source's new errorWorkflow setting with fresh version/published-content checks, preserving every other setting. Only after verifying that unlink should the exact inserted formatter branch be removed under fresh guards. Do not restore whole stale workflow snapshots or change gate state. A rollback intentionally restores the old missing-alert condition and must be reported as such.

Neither rollout nor rollback repairs the independent Render 2D PNG failure or reprocesses an order. Root owns that separate fix.
