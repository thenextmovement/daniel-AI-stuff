# RIESENOBJEKTE customer attachments in Trello

The first-party form already forwards customer binaries to n8n. This repair
fixes the service-role header mismatch that prevented Storage persistence and
adds the missing Postgres-outbox projection from each stored attachment to its
RIESENOBJEKTE Trello card.

## Deployment order

1. Apply `20260811110000_riesenobjekte_trello_attachment_projection.sql`.
2. Patch, validate and publish workflow `1sfVyhUafhfUtPoi`.
3. Deploy `ro-first-party-attachment-ingest` with `verify_jwt=true`.
4. Verify the n8n service-role credential reaches the function with a
   side-effect-free unsupported-file probe: expected response `415`, never the
   prior custom `401`.
5. Run one real recovered customer attachment through Storage, database outbox
   and Trello, then verify the attachment object and card directly.

The order prevents new attachment jobs from being claimed by an old worker and
prevents newly stored files from missing their outbox projection.
