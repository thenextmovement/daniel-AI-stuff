# Mockup Context Pipeline - 2026-06-11

## Scope

This note documents the read-only pipeline review and the local Ops change for AI segmentation, Trello Description, and mockup prompts. Live n8n workflows, offer resend automation, 3D offer logic, shipping tracking, Coolify/RLS, and management dashboards were not changed.

## Current Pipeline

1. Lead intake happens in n8n lead workflows such as `lp-anfrage-webhook-v1`, `rh-v3-anfragen-mail-anfragen-aktiv`, and `rh-unstrukturierte-anfragen-aktiv`. Ops also has manual intake through `src/lib/ops/manual-request-import.ts`.
2. Trello cards are created by n8n `Create Trello Card` nodes for lead workflows and by `createTrelloCard()` in `src/lib/ops/manual-request-import.ts` for Ops manual imports.
3. Segmentation fields already exist on `master_requests`: `segment`, `segment_status`, `segment_confidence`, `segment_source`, `segment_classified_at`, `segment_policy_version`, and `s_kategorie`. Manual portal overrides are handled in `src/lib/ops/customer-records.ts`.
4. Trello Description was previously filled with technical/manual import details in the Ops manual import path. It is now generated as a mockup setting for new manual-import cards.
5. Ready-like Trello triggers are in n8n. Mockup generation was found in the backup workflow `trello-led-neonschild-mockup-generator`, which watches list names such as `KI Mockup erstellen`. Offer sending via email/WhatsApp is in `neontrip-quote-ready-simple-v11` and was not changed.
6. Mockups are generated in n8n from Trello card attachments and prompt markers in the card Description. The checked backup workflow reads `#startprompt`/`#endprompt`.
7. Offer email and WhatsApp delivery are downstream automations and stayed read-only during this change.

## Local Change

`src/lib/ops/mockup-context.ts` is the central deterministic builder for:

- segment inference for mockup context
- source labels: `manual`, `ai`, `fallback`
- Trello mockup setting Description
- image mockup prompt
- video mockup prompt
- storage mapping back to the existing NT segment taxonomy

Manual segment input wins over inferred context. Generic labels such as `kleines Unternehmen`, `Firma`, `Business`, `Unternehmen`, `Kunde`, `Gewerbe`, `Sonstiges`, `allgemein`, and `unbekannt` are blocked as segment values. If no useful context can be inferred, the visual fallback is a modern shop/showroom setting, `segment_source` is stored as `fallback`, and no generic segment is stored in `master_requests`.

## Trello Description

New Ops manual-import Trello cards now receive an auto-generated Description containing:

- `[[NEONTRIP_MOCKUP_SETTING_V1]]` marker
- concrete visual setting
- segment and segment source
- confidence
- usage, light color, backboard, product type
- `#startprompt`/`#endprompt` image prompt block
- `#startvideoprompt`/`#endvideoprompt` video prompt block

Manual Description protection is implemented by `canAutoUpdateTrelloDescription()`: empty descriptions and descriptions with the marker may be auto-updated; unmarked non-empty descriptions are considered manual and protected. The current code path only creates new card descriptions and does not overwrite existing Trello cards.

## Prompt Construction

The image prompt is optimized for a photorealistic still mockup with a clear mounting surface, high-quality lighting, natural shadows, realistic glow, exact artwork preservation, and negative rules for extra text, distorted letters, cables, power supplies, fake logo variations, messy backgrounds, and cheap stock-photo appearance.

The video prompt is separate. It asks for a short premium product video, clean reveal, slow subtle camera movement, realistic light turn-on, stable logo/text preservation, and negative rules against text chaos, logo morphing, unnecessary effects, cables, power supplies, fake variants, faces, characters, and audio.

## Fallbacks

- Manual segment: source `manual`, confidence `1`, mapped into the existing NT taxonomy.
- Inferred segment from company, domain, title, request text, product, customer type, or usage: source `ai`, confidence `0.82`, mapped into the existing NT taxonomy.
- Unknown context: source `fallback`, confidence `0.4`, visual setting `Modernes Ladenlokal / Showroom`, no generic stored segment, `segment_status` remains `needs_review`.

## Ready Trigger Review

Read-only review found that Ready/mockup behavior lives in n8n workflows, not in this Ops code path. The backup mockup generator uses Trello movement to a mockup list and prompt markers in the Description. The offer email/WhatsApp workflow is separate and was not changed.

Remaining production questions for a future n8n-only change with backup, diff, and rollback:

- confirm the exact live Ready list IDs and whether the backup JSON matches production
- confirm idempotency keys or labels for generated mockups
- confirm visible error status when Gemini/mockup generation fails
- confirm whether offer sending blocks if required mockups are missing or failed
- confirm bounded retry behavior and audit records

## Tests

Covered by `tests/quotes/mockup-context.test.ts`:

- cafe context inference with non-generic setting
- manual segment precedence
- neutral showroom fallback without storing a generic segment
- Description auto-update marker behavior
- separate image and video prompt builders
- storage mapping to existing NT taxonomy
