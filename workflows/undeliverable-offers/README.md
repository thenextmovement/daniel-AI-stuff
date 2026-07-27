# TICKET-053 n8n workflows

Generate and validate:

```bash
node workflows/undeliverable-offers/build-workflows.mjs
node workflows/undeliverable-offers/test-workflows.mjs
```

Both workflows are generated inactive. Intake reads bounded Outlook NDR batches and posts normalized data to the guarded Ops API. The executor never talks directly to Supabase, Outlook or Offers: the guarded API owns claim, compare-and-set correction, send idempotency, provider receipt and unknown-outcome handling.

Required n8n environment references:

- `UNDLVR_MAILBOX`
- `OPS_INTERNAL_BASE_URL`
- `OPS_INTERNAL_API_KEY`
- `OPENAI_API_KEY` (research workflow only)
- `UNDLVR_RESEARCH_MODEL` (optional; defaults to `gpt-5-mini`)

Required Ops runtime references:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEONTRIP_OFFERS_INTERNAL_URL`
- `NEONTRIP_OFFERS_INTERNAL_API_KEY`

No value is stored in workflow JSON. Production intake and automatic execution remain disabled in `undeliverable_offer_settings` after migration.
