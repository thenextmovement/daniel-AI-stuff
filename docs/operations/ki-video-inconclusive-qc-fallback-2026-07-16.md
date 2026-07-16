# KI video inconclusive QC fallback

## Incident

Trello card `HpxNTJd2` produced two technically valid videos. The content checker returned:

- attempt 1: `approved=true`, `confidence=0.5`, no issues, no evidence
- attempt 2: `approved=true`, `confidence=0.6`, no issues, no evidence

The workflow treated both low-confidence approvals as evidence-backed content defects. The second result moved the card back to Quote Ready although no concrete defect had been detected.

## Decision policy

- `pass`: approved, confidence at least `0.7`, and no recognized issues
- `reject`: rejected with a recognized issue and concrete timestamped evidence
- `inconclusive`: malformed output, low confidence, contradictory output, or an unsupported rejection without timestamped evidence

The first inconclusive result uses the existing locked-static retry. A second inconclusive result omits the rejected video and sends the complete offer with a customer-safe AI mockup. Evidence-backed content defects still block delivery and return the card to Quote Ready.

The offer-only fallback:

- never uploads or attaches the inconclusive video
- removes a rejected reusable Trello video before continuing without video
- never sets the Trello label `Video gesendet`
- still requires a successful customer email before setting `Angebot gesendet`
- uses the normal Fabienne signature
- records the omission reason and QC result in the workflow audit
- leaves the WhatsApp offer link and mockup delivery intact

## Production workflow backups

Backups are stored outside the repository with mode `0600`:

- `/Users/danielklesse/claude-scratch/n8n-video-qc-inconclusive-fallback-20260716/before-9FoJMH6OUdsi36FB.json`
- `/Users/danielklesse/claude-scratch/n8n-video-qc-inconclusive-fallback-20260716/preview-delivery-TqzCGpwfuJDBS86b.json`

## Rollback

Restore the exact backup payload for each workflow through the n8n workflow API, preserving its current credentials and activation state:

1. Restore preview delivery workflow `TqzCGpwfuJDBS86b`.
2. Restore video workflow `9FoJMH6OUdsi36FB`.
3. Confirm both workflows are active.
4. Run a no-customer-send contract test before processing another card.

Do not print or commit the n8n API key. Do not restore only one workflow because the producer and delivery payload contracts change together.
