# NEONTRIP Auto-Reply: language and relationship context

Prepared 2026-09-17. Not published. Scope: workflow `L6SqGZLnu3ia07x1` and the existing `get_request_autoreply_relationship_context(text,text)` RPC.

## Contract

- Ziel: short personal German/English acknowledgements; corroborated customer/company history; the actual author's clear sign-off takes precedence over a conflicting stored first name.
- Nachbar: existing product/attachment routes, NEONTRIP signature assets, recipient validation, schedule, claim/lease, send-once behavior, unknown-delivery handling and completion receipts.
- Wirkung: this preparation makes no database/workflow production writes and sends no email. Live-effect proof remains open until publication and a natural request.

## Changes

Only `BuildAIPrompt`, `OpenAICopyProposal` and `ValidateAndRender` parameters change in the active workflow. Use parameter patches, not a full generated-workflow import: the existing source layout differs from live positions and has an extra empty IF output. Keep the live connections, positions, credentials and Outlook webhook ID.

The model proposes `{language, detail}` under a strict JSON schema. Greeting, relationship sentence, next step, subject, URL and signature remain deterministic. The customer message is untrusted; the model has no tools or authority to choose recipients or send. A strong language hint from the author's message excludes generated form sections and signatures. Model failure or rejected text uses a fallback in that language. The renderer rejects unsafe claims, URLs, prices, dates, invented history, unsupported numeric details, language mismatches and contradictions with unlit products and unsupported freestanding product descriptions. Semantic paraphrase accuracy still needs observation; these checks are not a general proof of truth.

The selected model is `gpt-5.6-luna`, `reasoning_effort=none`, maximum 300 completion tokens, `store=false`. The existing n8n OpenAI credential is preserved; its model catalogue was checked successfully. Eight old/new comparisons used the already available local API credential and sent no emails. After prompt revision and final renderer replay, seven cases used the individual model detail and one used the safe unlit fallback: the model had incorrectly described a wall-mounted sign as an Aufsteller. Both English requests stayed English. An eight-case comparison with GPT-5.6 Terra did not show a consistent quality advantage, so the lower-cost Luna candidate was retained. Saved model outputs were replayed through the final renderer without further API calls or sends.

The existing RPC retains exact-email history and adds company-only summary fields. Company matching requires a normalized company name plus either the same non-shared business domain, or matching first and last names against exactly one business domain. It reuses `neontrip_request_segmentation_domain_facts(text)`. Tenant `organization_id` limits scope but never identifies a customer company. Shared providers, same-name-only matches, email/request mismatches, multiple matching domains and different tenants do not authorize company history. No customer records are merged or rewritten. A conflicting sign-off suppresses a personal history claim.

## Verification

```sh
node workflows/request-autoreply/build-workflow.mjs
node workflows/request-autoreply/test-workflow.mjs
node workflows/request-autoreply/test-context.mjs
git diff --check
```

The context test uses a disposable network-isolated PostgreSQL 16 container and removes it afterwards. It verifies exact-email behavior, private-address company corroboration, freemail/name/tenant/ambiguous-domain negatives, cancelled orders, attachment/product preservation, execution grants and rollback. The copy test covers bilingual AI/fallback paths, design exceptions, unlit products, sign-offs/quoted history, schema/content rejection and unchanged send authorization.

n8n validation of a candidate made by patching the active graph: 14 nodes, 13 valid connections, 0 errors, 0 warnings. Full comparison permits only the three named parameter objects; all other live fields are unchanged.

Eight-case measurements (small sample, not a general quality benchmark): new 5,608 input + 323 output tokens, 0 reasoning tokens; old 4,231 input + 566 output tokens. The new instruction context is larger, the output is shorter. At current standard rates this is about USD 0.19 per 1,000 new replies at the sample's average length, excluding infrastructure/tax.

## Publication and rollback

Publication requires the exact clean commit approval under the project AGENTS.md. Before publishing, read the complete live draft, active graph/version and RPC again and capture rollback. The inspected active version was `98de7d7b-abbd-41b7-be85-142e4bd70ab9`; reject a changed baseline until reconciled. Apply the RPC migration, then only the three node parameter patches; validate and compare the complete result before publishing. The old worker tolerates the additional RPC fields, and the new worker tolerates an old/failed lookup by omitting company claims.

Rollback uses `supabase/rollbacks/20260917074500_extend_request_autoreply_company_context_rollback.sql` plus the captured pre-change parameters for those three nodes. Do not change runtime mode, enqueue jobs, replay customer requests or retry uncertain sends as part of this release.

After publication, inspect a natural request's language/context, rendered email, provider receipt and canonical job status. A successful provider submission does not prove inbox receipt.
