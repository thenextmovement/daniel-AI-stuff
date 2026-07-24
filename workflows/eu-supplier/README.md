# EU Supplier 3D Schilder

TICKET-045 splits the integration into three workflows, each with one trigger and fewer than 30 nodes.

## Request dispatch

1. Trello move trigger; validate board/list/card.
2. Fetch the complete card and attachments.
3. Signed upsert_request creates the durable request.
4. Signed queue_deliveries creates one ledger row per configured recipient.
5. Claim one due row atomically; send exactly one Microsoft Graph message.
6. Signed delivery_outcome stores the provider message ID.
7. A retryable first failure receives exactly one delayed retry. The second failed attempt or any terminal error sets the delivery to failed.
8. A separate alert reservation sends EU Supplier Mail fehlgeschlagen and stores its result.
9. Trello receives only a projection of database state.

No success label is written before every requested delivery is sent. The idempotency key is request plus normalized recipient.

## Reply intake and extraction

1. Microsoft Graph mailbox subscription; validate and fetch by immutable message ID.
2. Correlate by conversation/message headers and request token.
3. Normalize sender and match the exact configured domain after @.
4. Unknown, duplicated and free-mail domains remain unmatched or ambiguous.
5. Download attachments with size/type limits and upstream malware scanning.
6. Convert supported documents to bounded text; never execute macros or embedded content.
7. Treat body and attachments as untrusted data and request JSON only.
8. Deterministically validate all fields and evidence.
9. Signed ingest_reply stores reply and offer.
10. Low confidence or uncertain matching requires manual review.

## Alert delivery

1. Schedule every two minutes and atomically claim one pending alert.
2. Send an internal email with subject EU Supplier Mail fehlgeschlagen.
3. Include Trello link, supplier, recipient, attempts, correlation ID and redacted error.
4. Mark sent only after Graph confirms. The alert is attempted exactly once and is never put into an automatic retry loop.
5. Never retry a terminal supplier delivery without manual reset.

Required configuration: EU_SUPPLIER_WEBHOOK_SECRET, Ops API URL, Trello IDs, Microsoft Graph credentials and a fixed internal alert recipient. Production activation and replacement of the existing workflow require a separate approved rollout.
