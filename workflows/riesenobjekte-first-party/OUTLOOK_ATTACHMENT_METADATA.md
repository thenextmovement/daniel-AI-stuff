# Outlook attachment metadata repair

Scope: RIESENOBJEKTE only, workflow `rCgjDFQeytL0n5Zl`, node `Normalize Oldest Outlook Inquiry`.

The IMAP downloader supplies `bytes` on filesystem binary descriptors, CID metadata on the corresponding email, and disposition on download metadata. The normalizer previously ignored these fields. Seven signature pictures therefore exceeded the five-customer-attachment limit and blocked the oldest request.

The patch preserves matching download metadata, uses actual numeric byte sizes, and obtains CIDs only from a unique filename/MIME/size match. It falls back to the matching plaintext CID only when IMAP explicitly cleaned HTML. Ambiguous images remain attachments. The five-file and 15 MB limits remain; the latter now works with formatted n8n `fileSize` values.

Verification:

- `node --test workflows/riesenobjekte-first-party/test-outlook-attachment-metadata.mjs`: ten tests, including retained product images, ambiguous metadata, oldest-mail pairing, original limits and baseline drift.
- `TEST_BASELINE=1` reproduces three failures; the patch passes all ten.
- Isolated replay of the two queued inputs produces zero customer files/seven signature files for the oldest email, and preserves both images of the second email. No production execution or customer side effect was triggered.
- n8n partial-update `validateOnly` succeeds. Strict full validation has the same 14 existing catalog/code false-positive errors before and after (unsupported installed IMAP node / HTTP v4.4 and unrelated Code nodes); the changed normalizer has no validation error. Do not change those nodes to satisfy the catalog.

Release needs explicit approval of the exact commit. Re-fetch the live workflow and require the expected active version, node count and exact baseline matches. Apply only the normalizer code through n8n, preserving credentials, connections, schedules and activation. This resumes ordinary processing of the queued requests, including their existing acknowledgement flow after six minutes; do not manually replay customer-facing downstream nodes.

After release, verify durable intake records and attachment rows for the deterministic request IDs, Trello projection and the actual source-mail move; verify acknowledgement evidence independently. Only archive the technical digest after the affected intake cases complete. Use native n8n version history to restore the prior node on regression. No database migration or Coolify application deployment is required.
