# Email facts package safety review

## Findings

### Medium

- Order selection across an organization can still produce multiple candidates.
  The resolver deliberately returns `ambiguous` and no selected order unless an
  explicit order/offer number, exact amount, or a single exact customer email match
  resolves it.
- Attachment content extraction remains model-assisted. The facts package records
  those summaries as `model_extracted_unverified`; only Graph-confirmed file
  presence is authoritative. Filename-based document typing is distinguished from
  model typing.
- Corrected price text is corroborating evidence, not a system of record. A customer-
  facing reconciliation is allowed only when one unique explicit net price matches
  the signed snapshot, paid Shopify order, and invoice/additional-order evidence.

### Low

- The facts package is stored in an existing service-role-only email log snapshot.
  It contains bounded order, offer, address, and attachment metadata. Address facts
  are explicitly `customer_safe: false` and cannot be claimed by the model.
- Live Shopify and offer reads add bounded latency and API cost. Calls are limited,
  timed out, retried three times, and fail closed into the existing observable error
  path.

## Threat model

- Email bodies, subjects, Outlook organization history, attachment content, Shopify
  notes, offer notes, and custom fields can contain prompt injection or misleading
  text.
- A domain match can refer to another person or project.
- An order note can contain an arbitrary URL.
- Multiple historical corrected prices can produce a wrong calculation.
- A model can return malformed JSON, fabricated fact references, prices, dates,
  order numbers, offer numbers, or URLs.
- Workflow replay must not create duplicate customer-visible side effects.

## JSON schema

The drafting model must return exactly these keys:

```json
{
  "category": "shipping | returns | invoice | product | complaint | general",
  "confidence": 0,
  "language": "de | en",
  "risk_level": "low | medium | high",
  "needs_human_approval": true,
  "greeting": "string",
  "paragraphs": ["string"],
  "closing": "Viele Grüße | Beste Grüße | Best regards",
  "facts_used": [{ "fact_id": "allowed.id" }],
  "blocked_reasons": ["string"],
  "missing_information": ["string"]
}
```

Unknown/missing keys and unknown fact IDs are rejected.

## Validation and blocked content

- Customer-safe fact IDs are a deterministic allowlist.
- Shopify note text is never passed through as a fact; only trusted NEONTRIP offer
  and snapshot references are extracted.
- Domain-only identity never selects a cross-contact order.
- Conflicting corrected prices block reconciliation.
- Unverified money, dates, URLs, order numbers, and offer numbers force the existing
  safe fallback.
- Address claims, automatic sending, discounts, refunds, promises, production
  release, delivery commitments, and internal read/view telemetry remain blocked.
- Attachment claims are checked against actual Outlook attachment presence and
  missing claimed documents must be requested again.

## Escalation path

All output remains an Outlook draft for human review. Ambiguous identity, missing
evidence, conflicting prices, prompt injection, unsafe model output, and high-risk
non-financial cases produce a safe fallback or observable failure rather than a
customer commitment.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 5 | Signed snapshots, live Shopify verification, explicit selection and deterministic equations. |
| reliability | 4 | External reads can fail; retries, timeouts and the existing error path fail closed. |
| idempotency | 5 | Existing message lock and draft completion RPC remain unchanged. |
| observability | 5 | Package version, source coverage, conflicts, missing evidence and used fact IDs are logged. |
| security | 5 | Read-only sources, trusted URL allowlist, bounded data, prompt separation and claim allowlist. |
| tracking impact | 5 | No ads, analytics, routing or conversion changes. |
| cost risk | 4 | One indexed lookup, one live Shopify read and at most one offer read per processed case. |

## QA plan

- Unit and structural tests for every deterministic transform and patch anchor.
- Shopify Admin GraphQL schema validation.
- Strict n8n validation of the 9-node resolver and patched 30-node draft agent.
- Isolated live read-only test before production wiring.
- Active-graph verification and real execution inspection after rollout.
- Check that no resolver or patch adds an Outlook send action.

## Rollback

- Keep resolver v1 unchanged and active.
- Restore the exact inactive draft-agent backup or point the subworkflow reference
  back to v1 and reverse the surgical patches.
- Deactivate/delete v2 only after the draft agent no longer references it.
- No schema change is introduced in this phase.
