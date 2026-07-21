# Initial Production Findings — 2026-07-21

This file contains sanitized findings only. It intentionally excludes request bodies, message content, customer data, tokens, API keys, credential IDs, and resolved secret URLs.

## Critical

- A Trello HTTP failure stored a resolved credential-bearing request URI in n8n execution diagnostics. The affected credential surface requires migration to sanitized error handling and coordinated credential rotation after dependency mapping.

## High

- AI Email Open Inbox Backfill treats an expected duplicate idempotency collision as a hard workflow failure.
- Telegram Approval treats an expected duplicate claim as a hard workflow failure.
- Active AI Email main and retry workflows repeatedly stop with an opaque `Unknown workflow error`, masking the underlying failure class.
- EU Supplier Request reaches a Trello write with an empty card identifier.
- Gemini Mockup Generator v1.2 reaches a Trello cleanup action without a usable credential binding.
- Two active customer-/business-facing Code nodes fail to parse because generated JavaScript contains invalid newline escaping.
- Supplier Shopify Tag Sync retries a 30-second request three times even though the provider outcome is not proven safe to repeat.

## Structural

- 152 active workflows were found.
- 19 active workflows exceed the 30-node production limit.
- Multiple active variants exist for several AI email, mockup, and video capabilities.
- Active names include state contradictions such as `INACTIVE DRAFT` and `LÖSCHEN`.
- Several recovery/watchdog workflows appear to be primary operational recovery rather than secondary reconciliation.
- Trello is still used as an input authority in multiple shipping, quote, customs, and supplier flows.

## Required immediate behavior

- Expected duplicate conflicts must resolve to `already_claimed` or `already_processed`, not workflow failure.
- Opaque terminal errors must include a sanitized failure code, stage, correlation ID, and durable job ID.
- Missing entity identifiers must fail before any external request is constructed.
- Credential-aware provider nodes or sanitized proxy endpoints must replace HTTP requests that expose resolved credentials in error diagnostics.
- Syntax-generating builders require parse/compile regression tests before publication.
- Unknown provider outcomes must enter reconciliation, not automatic repeat.
