# EU Supplier 3D Schilder

TICKET-045 splits the integration into four workflows, each with one trigger and fewer than 30 nodes. Importable, inactive definitions are generated under `generated/` by `node generate-workflows.mjs`.

## Trello intake

1. Trello move trigger; validate board/list/card.
2. Fetch the complete card and attachments.
3. Signed upsert_request creates the durable request.
4. Signed queue_deliveries creates one ledger row per configured recipient.
5. Trello receives only a projection of database state.

## Delivery worker

1. Schedule every minute and atomically claim at most one due delivery.
2. Download the authoritative Trello attachments through the configured credential, allowlist the host, and enforce 10 MB per file / 20 MB total before Graph.
3. Create a Graph draft and persist its message and conversation IDs before sending that exact draft once.
4. Signed `delivery_outcome` stores success or the bounded error summary.
5. A retryable pre-draft first failure receives exactly one delayed retry. The second failed attempt or any terminal error sets the delivery to failed.
6. An expired lease before draft creation follows that bounded rule. An expired lease after a draft exists is treated as uncertain and terminally alerted, never blindly resent.
7. No n8n mail node has its own automatic retry; the database state machine is the only retry authority.

No success label is written before every requested delivery is sent. The idempotency key is request plus normalized recipient.

## Reply intake and extraction

1. Microsoft Graph mailbox subscription; validate the fixed `clientState` and fetch by immutable message ID.
2. Correlate only through a Graph conversation ID stored from a successfully sent supplier draft; an inbound payload cannot choose its own request ID.
3. Normalize sender and match the exact configured domain after @.
4. Unknown, duplicated and free-mail domains remain unmatched or ambiguous.
5. Fetch Graph attachments, reject inline/unsupported/oversized files, cap each file at 10 MB and the message at 20 MB, and never execute macros or embedded content.
6. Reserve the immutable internet-message ID before any AI call; duplicate Graph deliveries return successfully without a second extraction.
7. Pass allowlisted PDF, image and text content to the Responses API as untrusted file/image input; attachment bytes are not persisted in the OPS API.
8. Treat body and attachments as untrusted data and request strict JSON only.
9. Deterministically validate all fields and evidence.
10. Signed ingest_reply idempotently updates the reserved reply and upserts one offer per reply.
11. Low confidence or uncertain matching requires manual review.

## Alert delivery

1. Schedule every two minutes and atomically claim one pending alert.
2. Send an internal email with subject EU Supplier Mail fehlgeschlagen.
3. Include Trello link, supplier, recipient, attempts, correlation ID and redacted error.
4. Mark sent only after Graph confirms. The alert is attempted exactly once and is never put into an automatic retry loop.
5. Never retry a terminal supplier delivery without manual reset.

Required configuration: EU_SUPPLIER_WEBHOOK_SECRET, Ops API URL, Trello IDs, Microsoft Graph credentials and a fixed internal alert recipient. Production activation and replacement of the existing workflow require a separate approved rollout.
