# Company Brain Foundation - 2026-07-15

## Purpose

The Company Brain is a governed read and decision layer over operational systems. Postgres and the relevant domain systems remain the systems of record. Trello remains a projection. AI may explain and propose; deterministic services execute side effects.

This release implements the approved foundation phases 0 through 3:

1. source, workflow and correlation registries
2. canonical entities and aliases
3. immutable events, evidence and temporal relationships
4. actionable data-quality issues and evaluation cases
5. a versioned Decision Logbook with review and outcome tracking

It does not add autonomous customer communication, offer retries, workflow changes or deployment actions.

## Baseline observed before implementation

The read-only production audit on 2026-07-15 found:

- 234 public tables and 169 tables without comments
- 10,000 mirrored Outlook messages; 9,700 had neither a linked request nor a linked customer
- 6,271 requests; 4,071 had no Trello card ID and 5,574 had no segment
- 4,895 workflow audit rows; 4,744 had no execution ID
- 481 n8n workflows; 133 were active
- the active Quote Ready workflow had 70 nodes and 18 validator warnings
- the active video and offer-send workflow had 114 nodes and 37 validator warnings

The migration records the three critical linkage/correlation baselines as `company_data_quality_issues`. It does not repair or backfill production data automatically.

## Tables

### Control plane

- `company_source_registry`: authority, owner, freshness and sensitivity per source
- `company_workflow_registry`: n8n lifecycle, ownership, size and runbook state
- `company_correlation_contracts`: required identifiers and payload fields per event
- `company_brain_evaluation_cases`: privacy-aware reviewed golden cases

### Identity and evidence

- `company_entity_registry`: canonical cross-system entities
- `company_entity_aliases`: deterministic or reviewed aliases
- `company_identity_resolution_log`: append-only resolver outcomes using hashed identifiers
- `company_events`: append-only correlated business events
- `company_evidence`: append-only source references and metadata
- `company_entity_relations`: typed temporal relationships
- `company_entity_state`: current state derived from events
- `company_data_quality_issues`: actionable missing, stale or conflicting data

### Decisions

- `company_decisions`: versioned decisions, policies, architecture and incident resolutions
- `company_decision_evidence`: supporting, opposing, constraint or outcome evidence
- `company_decision_outcomes`: target versus actual results and lessons learned
- `company_decision_audit_log`: append-only lifecycle history

## Identifier convention

Canonical keys are stable business keys, not UI IDs. Recommended forms:

```text
request:<request-id>
offer:<offer-id>
order:<shopify-order-id>
workflow:<n8n-workflow-id>
workflow-run:<n8n-execution-id>
communication:<internet-message-id>
```

Aliases use a source plus a typed value, for example:

```text
trello / card_id / 6a4b53ee91f140e2ecd67e2f
trello / short_link / BiP93WuG
supabase / request_id / b514ed9c-368d-4c37-9b33-f45534a0677e
offers / offer_number / 14427
outlook_mirror / email / praxis@example.de
```

Automatic inferred aliases must never receive confidence `1.0` without review. Conflicting aliases are rejected by the unique source/type/value constraint and must enter a manual review queue.

## Decision lifecycle

1. Create a `draft` with objective, problem, context, alternatives, expected outcomes, risks and review date.
2. Submit through `submit_company_decision`; this creates an immutable audit entry.
3. Approve through `approve_company_decision`; the function atomically supersedes the prior active version and emits `decision.approved`.
4. Request changes through `request_company_decision_changes`; a reason is mandatory.
5. Record measured effects in `company_decision_outcomes`.
6. Replace decisions with a new version. Never edit the meaning of an approved version in place.

The Company Brain resolver loads global decisions plus exact process, request, offer and workflow scopes. Failure to read the Decision Logbook is fail-open for the existing read-only diagnosis and visible in source health; it must not break current case resolution.

## Scope convention

```text
global:*                         applies everywhere
process:company-brain            Company Brain behavior
process:offer_not_sent           problem-type behavior
entity:request:<request-id>      one canonical request
entity:offer:<offer-id>          one offer
workflow:<workflow-name>         one named workflow
team:sales                       one team
metric:quote_send_success_rate   one governed metric
```

Decision retrieval is exact and temporal. Semantic search may later find explanatory material, but it must not decide policy applicability.

## API routes

- `GET /api/ops/company-brain/foundation`: sources, contracts, workflow registry and open quality issues
- `POST /api/ops/company-brain/foundation`: resolve a canonical entity alias
- `POST /api/ops/company-brain/foundation/workflows/sync`: confirmed read-only n8n inventory sync into Postgres
- `GET /api/ops/company-brain/decisions`: list decisions, optionally filtered by status
- `POST /api/ops/company-brain/decisions`: create a draft
- `POST /api/ops/company-brain/decisions/context`: retrieve active decisions for exact scopes
- `POST /api/ops/company-brain/decisions/:id/review`: submit, approve or request changes
- `GET /api/ops/company-brain/decisions/:id/outcomes`: list recorded outcome checks
- `POST /api/ops/company-brain/decisions/:id/outcomes`: record an outcome

All routes require the existing Ops session, derive the audit actor from Cloudflare Access, return private `no-store` responses and use the server-side Supabase service role. Client-provided actor fields are ignored. Decision writes and workflow-registry sync fail closed when no individual actor identity is available. Local development uses the explicit `local_ops` actor. No table is granted to `anon` or `authenticated`.

## Workflow registry sync

The sync requires `N8N_API_URL` or `N8N_BASE_URL` plus `N8N_API_KEY`. It requires explicit `confirmed: true`, only reads the n8n workflow API and preserves reviewed owner/lifecycle fields during upsert.

Example request body:

```json
{
  "confirmed": true,
  "actor": "daniel"
}
```

The sync does not activate, deactivate or change any n8n workflow.

## Employee interface

`/ops/company-brain/governance` exposes the governed knowledge layer as an employee workflow instead of a raw data dump:

1. `Entscheidungen` shows concise cards with status, scope, owner and review date.
2. Employees can create drafts, prepare a new version, submit a draft and request changes.
3. Approval requires an explicit `FREIGABE` confirmation and atomically replaces the previous active version.
4. Approved decisions can receive measured outcomes and lessons learned.
5. `Systemwissen` shows critical data-quality gaps, the n8n workflow inventory and source authority.
6. The n8n inventory action is explicitly confirmed and read-only. It never changes workflow state.

The interface is available as `Wissen` in the Ops application menu and from the Company Brain case screen. It does not send customer communication, retry offers, modify production workflows or deploy code.

## Evaluation gates

Before using foundation data for employee actions:

- approve at least 75 real evaluation cases without copying unnecessary personal content
- prove at least 98% correct canonical entity resolution
- prove 100% source references for material claims
- prove at least 95% of new critical workflow events contain their required correlation identifiers
- prove zero duplicate customer-visible side effects in replay tests
- verify that unavailable foundation tables do not break existing Company Brain cases

## Deployment and rollback

1. Run all application and Company Brain tests.
2. Validate both migrations in isolated PostgreSQL.
3. Create a database backup and capture current schema state.
4. Run `codex-predeploy ops` and deploy only the printed commit.
5. Apply `20260715193000_create_company_brain_foundation.sql` first.
6. Apply `20260715194500_create_company_decision_logbook.sql` second.
7. Verify seeded sources, contracts, baseline issues and the active foundation decision.
8. Sync the n8n workflow registry with explicit confirmation.
9. Run one known Company Brain case and confirm `Decision Logbook` source health.

Rollback in reverse order:

1. `20260715194500_create_company_decision_logbook_rollback.sql`
2. `20260715193000_create_company_brain_foundation_rollback.sql`

Rollback deletes only the new Company Brain control-plane tables and their generated decision events. Operational source tables are not changed.
