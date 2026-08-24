# Treatment Shadow: provider-added off-domain sources

## Contract

- Ziel: A domain-research response may contain provider-added URLs outside the customer domain without failing the whole shadow job.
- Nachbar: Only the exact authorized domain or its subdomains can become classifier evidence. Invalid URLs and an invalid authorized domain still fail closed; an all-off-domain response remains provenance-missing.
- Wirkung: Only `Prepare Treatment Classification.parameters.jsCode` changes. Connections, settings, credentials, activation, classification policy and disabled customer-action nodes stay unchanged.

## Production evidence

- Failing retained execution: `5436605`.
- Exact cause: the research response contained valid customer-domain sources plus an extra Google Maps source; the old code threw `treatment_shadow_research_domain_scope_invalid`, which n8n exposed through Continue Error Output as `Unknown error [line 10]`.
- Prepared workflow version: `f333c2b1-6114-4aaa-8f7d-b18d9e4999b7`, Counter 137, draft and active graphs equal.
- Live workflow version after the one-field patch: `f1ec1810-60db-42fa-805c-b935a114ca40`, Counter 138, draft and active graphs equal.
- Natural-runtime result: all four previously exhausted jobs recovered; two completed and two safely became `needs_review`. The v7 queue is terminal with 37 classifications and no failed, pending, processing or locked jobs.

## Files

- `forward-patch.json`: one exact field-fragment replacement.
- `reverse-patch.json`: exact inverse replacement.
- `full-diff.json` and `expected-diff.json`: bounded full-graph contract.
- `offdomain-source.mjs`: canonical before/after source.
- `offdomain-source.test.mjs`: exact-domain, all-off-domain, malformed-input and round-trip checks.

No manual workflow execution is part of the proof. Existing failed shadow jobs are requeued one at a time and processed by the natural one-minute scheduler.
