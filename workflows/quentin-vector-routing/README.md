# Quentin Vector Routing v1

Dedicated n8n workflow for one event only: a card entering `Vector file uploaded`
on `Quentin Neon Signs`.

n8n workflow ID: `zcISVxD82uagME9g` (created inactive; activation is the controlled cutover step).

It reads `image.png`, proposes up to four variants in visual reading order, validates
and translates backboard values deterministically, checks supplier totals against
`Price_1..4`, then copies the normalized source card exactly once:

- LED Neon / Neon Flex -> Abdul Neontrip / Mockup - to do
- explicit specialist products -> Anfrage Management Neontrip / Quote Ready
- every other title defaults to LED Neon Flex -> Abdul Neontrip / Mockup - to do

Unknown image values never stop routing. The field is cleared and one `❗` comment
records the uncertainty. No unrelated workflow is modified.

TICKET-105 adds two isolated guards:

- an Error Trigger workflow emails `support@neontrip.de` with subject
  `Quentin Board Vector file uploaded fehlgeschlagen`;
- a two-minute watchdog correlates Quentin list moves with destination copy
  actions. After a five-minute grace period it creates one fallback copy when
  the expected target card is missing, comments the source card and emails both
  source and destination links.

Run focused tests with `node --test workflows/quentin-vector-routing/test-*.mjs`.
Generate the import artifact with `node workflows/quentin-vector-routing/build-workflow.mjs`.
Generate both guard artifacts with
`node workflows/quentin-vector-routing/build-guard-workflows.mjs`.
