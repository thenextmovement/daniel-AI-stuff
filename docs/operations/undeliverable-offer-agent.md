# Undeliverable Offer Agent (TICKET-053)

## Plan

The system uses Postgres/Supabase as source of truth. Microsoft Graph/n8n contributes immutable bounce source IDs. AI or public research may only propose structured evidence; deterministic code validates and gates every write and customer-visible action.

## Node structure

1. Outlook trigger: one mailbox message trigger, restricted to non-delivery reports.
2. Validation: require Graph message ID, mailbox, received time, failed recipient and diagnostic text; strip attachments and untrusted HTML.
3. Logic: classify failure, parse A/N, resolve the offer and request, create the case idempotently.
4. Research: inspect existing customer-provided contacts and verified HTTPS company pages. Model output is JSON only.
5. Gate: reject unchanged/invalid candidates, AI-only evidence and ambiguous matches. Queue all uncertainty for human review.
6. Action: atomically claim an approved case, compare-and-set the old Supabase email, call the existing Offers send endpoint with `undeliverable:<case-id>:v1`.
7. Logging: store source event, correlation ID, evidence, approval, old/new address, execution and provider receipt.
8. Error: retry only before an external side effect. An ambiguous provider outcome becomes `unknown` and is never blindly retried.
9. Idempotency: unique source message, proposal key, approval key, execution key and provider send key.

## Threat model and validation

- Email bodies, headers, attachments, websites and model text are untrusted and cannot issue instructions.
- The model returns only candidate email, confidence and evidence references. It cannot update Supabase or send mail.
- Candidate email must differ from the failed address and pass syntax/domain checks.
- Automatic eligibility requires confidence exactly 1 plus a direct customer-supplied address or an existing internally verified contact.
- Public website, directory and AI research results always require human review, even when an exact HTTPS source is returned.
- A/N 14706 is additionally excluded from automatic approval in the database.
- The correction uses compare-and-set against the exact previous address and request ID.
- A/N 14706 remains blocked until the target address and source are visibly reviewed.

## JSON contract

```json
{
  "caseId": "uuid",
  "proposedEmail": "name@example.de",
  "confidence": 1,
  "evidence": [{
    "type": "verified_company_website",
    "value": "mailto:name@example.de",
    "sourceUrl": "https://example.de/impressum",
    "observedAt": "2026-07-27T08:00:00.000Z"
  }]
}
```

No extra properties are accepted by the n8n schema validator. Prompt text, promises, discounts, deadlines, URLs invented by the model and customer-message instructions are blocked.

## Tests

- Outlook 5.4.310 domain missing, 5.1.1 mailbox missing, temporary and policy cases.
- Duplicate Graph delivery notification returns the existing case.
- Wrong A/N or multiple offer matches goes to manual review.
- AI-only, directory-only, invalid HTTPS source, same email and malformed email never auto execute.
- Compare-and-set failure leaves customer data untouched and records conflict.
- Duplicate approval/claim/send returns the durable prior result.
- Timeout after provider dispatch becomes unknown; no second send.
- Prompt injection in bounce body, website and attachment has no effect.

## Rollout and rollback

1. Apply the additive migration in an isolated Supabase database and run SQL plus application tests.
2. Import n8n workflows disabled and run fixtures with synthetic addresses.
3. Deploy the Ops review queue in preview.
4. Activate intake in shadow mode: detection, audit and review only.
5. After sampled review, enable manual approvals. Automatic execution stays feature-disabled until separately witnessed.
6. Stop by disabling the n8n trigger and executor. Existing cases remain readable.
7. Use the rollback only before real case data exists or after an approved export; it deletes TICKET-053 audit data.

## Safety scorecard

| Dimension | Score | Notes |
|---|---:|---|
| correctness | 4 | Deterministic gates; production schema and Graph payload still require canary verification. |
| reliability | 4 | Durable state machine; external provider reconciliation must be witnessed. |
| idempotency | 5 | Unique source, operation and send keys. |
| observability | 5 | Correlation, source, case, actor, evidence and provider receipt. |
| security | 4 | Fail-closed and service-role only; production grants require advisor check. |
| tracking impact | 5 | Existing Offers ledger remains authoritative for customer sends. |
| cost risk | 5 | Bounded research and one permitted send per case. |
