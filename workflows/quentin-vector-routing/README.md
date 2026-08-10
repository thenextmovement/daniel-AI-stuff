# Quentin Vector Routing v1

Dedicated n8n workflow for one event only: a card entering `Vector file uploaded`
on `Quentin Neon Signs`.

n8n workflow ID: `zcISVxD82uagME9g` (created inactive; activation is the controlled cutover step).

It reads `image.png`, proposes up to four variants in visual reading order, validates
and translates backboard values deterministically, checks supplier totals against
`Price_1..4`, then copies the normalized source card exactly once:

- LED Neon / Neon Flex -> Abdul Neontrip / Mockup - to do
- all other or unknown product types -> Anfrage Management Neontrip / Quote Ready

Unknown image values never stop routing. The field is cleared and one `❗` comment
records the uncertainty. No unrelated workflow is modified.

Run focused tests with `node --test workflows/quentin-vector-routing/test-routing.mjs`.
Generate the import artifact with `node workflows/quentin-vector-routing/build-workflow.mjs`.
