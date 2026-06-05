# Inbound Shipping Agent

## Purpose

The inbound shipping agent monitors China inbound shipments that suppliers add to Trello in the `sign shipped` list. Trello is only the intake/projection source. Postgres stores the operational truth for shipments, carrier events, incidents, and notification state.

The agent warns the team when:

- DHL Express or FedEx reports a clearance event that needs action.
- A shipment is out for delivery and documents/tracking labels should be prepared.
- A tracking number exists for 72 hours without tendering or real movement.
- A carrier exception, missing tracking result, or stale movement pattern appears.

## Data Model

- `inbound_shipments`: one row per carrier/tracking number, linked back to the Trello card.
- `inbound_tracking_events`: idempotent carrier event log.
- `inbound_incidents`: deterministic alerts generated from shipment state.
- `inbound_notifications`: durable Outlook notification queue for internal alerts.

All tables have RLS enabled. Dashboard/API access uses server-side service-role requests only.

## Workflows

The n8n implementation is split by responsibility:

- Discovery: reads Trello board/list/custom field and records candidates through `inbound_record_trello_candidates`.
- Tracker: claims due shipments, fetches DHL Express/FedEx tracking, records events through `inbound_record_carrier_response`, and enqueues notifications.
- Notifier: claims pending internal notifications, sends Outlook email, and marks the notification sent or failed.

Each workflow has one trigger, bounded batch sizes, and idempotent writes before side effects.

Production workflow:

- Name: `NEONTRIP Inbound Shipping Agent v0.1`
- n8n ID: `rYmSl4D0nNmEEU0M`
- Status after creation on 2026-06-05: created and validated; activation must be checked in n8n because the MCP partial-update endpoint rejected activation requests with an API schema error.

## Dashboard

Dashboard path:

`/ops/customer-records/inbound-shipping`

The dashboard supports carrier/scope filters and incident actions:

- create internal task
- acknowledge
- resolve
- ignore

## Carrier Credentials

Expected runtime configuration:

- Trello credential in n8n for board/list/card reads.
- Supabase REST credential in n8n for RPC calls.
- Outlook credential in n8n for internal emails.
- DHL Express tracking API key as runtime env/credential.
- FedEx client id/secret as runtime env/credential.

Secrets must stay in n8n credentials or environment variables, never in workflow JSON or code.

## QA

Required checks before/after deployment:

- Unit tests: `npm run test:quotes`
- Type check: `npx tsc --noEmit`
- Production build: `npm run build`
- Supabase smoke:
  - record Trello candidates
  - claim due shipments
  - record a clearance response
  - enqueue and claim a notification
  - verify idempotent replay does not duplicate incidents/notifications
- n8n validation before activation.
- Route smoke:
  - dashboard page returns 200 with ops session/local bypass
  - API returns 401 without session

## Rollback

Database rollback:

`supabase/rollbacks/20260605201640_create_inbound_shipping_ops_rollback.sql`

n8n rollback:

- deactivate the three `NEONTRIP Inbound Shipping Agent v0.1` workflows
- delete them only after confirming no executions are in flight

Application rollback:

- revert the commit that added the inbound dashboard/API/lib files
- redeploy the previous app revision
