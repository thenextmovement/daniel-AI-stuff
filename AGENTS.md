# AGENTS.md - NEONTRIP Ops

## Scope

This repo contains the NEONTRIP ops application and Supabase migrations for
customer records, sales calls, offer lifecycle projection, and shipping ops.
It is suitable for Codex Cloud PRs when work is limited to code, tests, docs,
or migration review. Live Supabase/Coolify/n8n operations remain local.

## Source Of Truth

* Supabase/Postgres is the source of truth for customer records and ops state.
* Trello is a projection/integration surface only.
* Offers data must be read or changed through explicit internal APIs. Do not
  introduce direct cross-system writes that bypass idempotency checks.

## Commands

Run these for normal code changes:

```bash
npm run verify
```

`verify` is intentionally offline-safe for Codex Cloud: it runs unit tests and
the production build without requiring live Supabase/Trello/Coolify secrets.

For narrower checks:

```bash
npm run lint
npm run test:quotes
npm run check:ops-schema
npm run build
```

Production smoke/go-live scripts require live env vars and are local-only:

```bash
npm run check:ops-deploy
npm run smoke:ops
npm run go-live:ops
```

Current lint state: `npm run lint` is non-interactive, but the repo has existing
legacy lint debt in large Ops UI files. Do not make unrelated lint-cleanup part
of feature PRs; use a dedicated lint cleanup task.

## Supabase Migration Rules

* Every production migration needs a matching rollback where practical.
* Migrations must be idempotent or safely fail before partial side effects.
* RLS, grants, indexes, and uniqueness constraints must be reviewed together.
* Do not apply migrations from Codex Cloud unless the task explicitly provides
  a staging project and credentials.
* Keep generated/local Supabase CLI state such as `supabase/.temp/` out of git.

## Safety Rules

* Never commit or print secret values from `.env`, Coolify, Supabase service
  role keys, Trello tokens, Cloudflare Access, Placetel, or shipping provider
  credentials.
* Do not let AI-generated text send customer communication without deterministic
  validation.
* External side effects must be replay-safe and keyed by stable IDs.
* Shipping, notification, and lifecycle projections must tolerate duplicate
  webhooks/events.
* Any tracking/routing/customer-status change needs a QA plan.

## Cloud Task Guidance

Good Codex Cloud tasks:

* Review Supabase migrations for rollback, RLS, grants, indexes, and
  idempotency.
* Add unit tests for projection, shipping, and customer-record logic using
  fixtures/mocks.
* Refactor UI components or pure server helpers.
* Improve docs/runbooks and PR review checklists.

Keep local:

* Live Supabase migration apply/rollback.
* Coolify deploys and server health recovery.
* n8n workflow edits and live webhook tests.
* Cloudflare Access, Placetel, Trello, or shipping provider live QA.

## Review Guidelines

Treat these as high priority findings:

* Missing rollback or unsafe migration ordering.
* RLS/grant regressions.
* Non-idempotent webhook or notification handling.
* Direct writes to systems that should be projections.
* Secret leakage or customer PII in logs.
