# NEONTRIP Quote Price Learning

This document defines the safe learning layer for supplier quote images from Trello.

## Goal

Use historic Trello `Image.PNG` supplier quote images as a structured training source. Each image can contain multiple designs, sizes, production prices, and shipping prices. The system must extract those rows, validate them, review uncertain data, and only then use approved rows to estimate supplier prices for new signs.

The first model targets Neonflex-style signs. Special categories such as `3-D`, `3D`, `Full Glow`, front-lit, back-lit, halo, marquee, or lightbox must be stored but excluded from the Neonflex model.

## Customer Auto Quote Boundary

Customer-visible automatic Neonflex size ladders are capped at 200 cm longest side. Any requested sign above 200 cm longest side must become a customer request/manual supplier quote path instead of an automatic customer price.

The learning layer may still score 220 cm and 300 cm cases for shadow backtests, diagnostics, and manual supplier-review support. Those internal predictions must not be surfaced as automatic customer prices.

## Source Of Truth

Postgres/Supabase is the source of truth.

Trello is an import source and optional projection only. Labels, comments, list names, and card title text must not be treated as authoritative pricing data.

## Data Flow

1. Import Trello card attachment metadata for candidate `Image.PNG` files.
2. Store the original image and checksum under a stable source key.
3. Run OCR/Vision extraction into strict JSON.
4. Split the image into design-level groups when multiple designs are present.
5. Normalize every extracted row into:
   - design index
   - detected model family
   - size label
   - width and height in cm
   - production price
   - shipping price
   - total supplier cost
   - currency
   - product type, LED color, backboard when available
   - confidence and source text
6. Deterministic validation marks rows as `usable`, `needs_review`, or `rejected`.
7. Special-category detection excludes `3-D`, `Full Glow`, and similar rows from Neonflex training.
8. Human review approves only trustworthy rows for training.
9. Model candidates run in shadow mode against known quotes.
10. Only after backtest approval can a model be marked active.

## Why Production And Shipping Stay Separate

Production and shipping scale differently:

- production tends to scale with area, max side, LED/neon length, complexity, colors, and backing;
- shipping tends to scale with package size, weight, longest side, destination, and supplier freight rules.

The model must estimate both separately. A combined total is stored only as a derived field.

## Minimum Training Row

A row is usable only when it has:

- width and height in centimeters
- production price greater than zero
- shipping price zero or greater
- currency
- source image reference
- extraction run reference

Low-confidence rows are reviewable, not automatically training-ready. Rows from `3-D`, `Full Glow`, or other special categories can still be valid data, but they are not eligible for the first Neonflex model.

## Model Stages

- `candidate`: trained locally or in a branch, never used for quote decisions.
- `shadow`: generates estimates next to real supplier quotes.
- `active`: can prefill internal quote calculations after approval.
- `retired`: kept for audit and rollback.
- `rejected`: failed backtest or review.

Current production status, 2026-06-04:

- Shadow schema and training candidate view are deployed in Supabase project `klibiejfisijpagzkxls`.
- `neonflex_supplier_area_baseline` version `2026_06_04_v2` is stored as `shadow`.
- The stored model is not customer-visible and must not write Trello/customer quote prices.
- Production-price error is still too high for activation; shipping is suitable for shadow comparison.

Current preferred Shadow model, 2026-06-05:

- `neonflex_supplier_anchored_scaling` version `2026_06_05_v1`.
- Supabase model id: `139fcffd-6401-40f9-8f76-ef79f82a007c`.
- Artifact: `docs/quote-learning/neonflex-supplier-anchored-scaling-2026_06_05_v1.json`.
- It uses the known smallest supplier quote as anchor and scales larger sizes:
  - production median APE: 3.05 percent
  - production p90 APE: 16.38 percent
  - shipping median APE: 7.85 percent
  - shipping p90 APE: 26.07 percent

The previous `neonflex_supplier_feature_group_area` model remains useful as fallback when no real smallest supplier anchor exists.

Current preferred Shadow model after shipping-specific update:

- `neonflex_supplier_anchored_scaling` version `2026_06_05_v2`.
- Supabase model id: `860c2227-bca7-4481-82a4-9e0f897d99c5`.
- Artifact: `docs/quote-learning/neonflex-supplier-anchored-scaling-2026_06_05_v2.json`.
- It keeps anchored production scaling and uses piecewise shipping by target longest side:
  - production median APE: 3.05 percent
  - production p90 APE: 16.38 percent
  - shipping median APE: 7.52 percent
  - shipping p90 APE: 16.95 percent
  - total supplier cost median APE: 4.88 percent
  - total supplier cost p90 APE: 13.27 percent

Current preferred Shadow model after large-sign shipping update:

- `neonflex_supplier_anchored_scaling` version `2026_06_05_v3`.
- Supabase model id: `4065eb38-6529-4035-b6cc-33aa0352d633`.
- Artifact: `docs/quote-learning/neonflex-supplier-anchored-scaling-2026_06_05_v3.json`.
- It keeps the anchored production formula from v2, expands training filters up to 300 cm and higher supplier costs, groups anchors by `trello_card_id + model_code`, and trains the `220cm+` shipping bucket instead of using the old global fallback.
- Expanded-holdout metrics:
  - shipping median APE: 5.78 percent
  - shipping p90 APE: 16.19 percent
  - total supplier cost median APE: 5.12 percent
  - total supplier cost p90 APE: 14.31 percent
- Large-sign `220cm+` holdout metrics:
  - shipping median APE: 8.21 percent
  - shipping p90 APE: 13.68 percent
  - total supplier cost median APE: 5.73 percent
  - total supplier cost p90 APE: 10.75 percent
- `220cm+` predictions remain review-required because the bucket has only 10 training rows and 5 holdout rows.

Current preferred Shadow model after large base-anchor hybrid update:

- `neonflex_supplier_anchored_scaling` version `2026_06_05_v5`.
- Artifact: `docs/quote-learning/neonflex-supplier-anchored-scaling-2026_06_05_v5.json`.
- It keeps the v4 segmented shipping rule by default, but for `220cm+` targets with a base anchor below 180 cm it uses the exact current large-fit parameters.
- Large-sign validation:
  - runtime `220cm+` shipping median APE improves from 7.47 percent to 4.88 percent;
  - runtime `220cm+` shipping p90 APE improves from 12.77 percent to 11.96 percent;
  - exact-split `220cm+` holdout shipping p90 APE improves from 12.77 percent to 11.17 percent;
  - runtime `220cm+` total p90 APE improves from 9.70 percent to 7.78 percent.
- `220cm+` predictions remain review-required because the exact current bucket has only 12 training rows and 3 holdout rows.

## First Validation Targets

Before training anything:

- at least 100 extracted image quotes manually reviewed in the first sample;
- at least 80 percent row-level extraction precision for size, production price, and shipping price;
- explicit exclusion count for `3-D`, `Full Glow`, and other special categories;
- separate error metrics for production and shipping;
- median absolute percentage error tracked by product type;
- outlier review for the 20 worst predictions.

## n8n Shape

Keep workflows small:

- `Trello Supplier Quote Image Import`
  Trigger -> Load candidates -> Validate attachment -> Upsert image source -> Log
- `Supplier Quote Image Extraction`
  DB queue trigger -> Download image -> OCR/Vision -> JSON schema validate -> Upsert extraction run -> Log
- `Supplier Quote Training Review`
  Manual/Ops trigger -> Load pending rows -> Approve/reject -> Log reviewer and reason
- `Supplier Price Shadow Prediction`
  New design trigger -> Generate customer size ladder up to 200 cm -> Predict production/shipping -> Store shadow predictions

Internal diagnostic/review runs may explicitly generate ladders above 200 cm, but those rows must stay review-only and must not become customer-visible automatic prices.

Every external call needs retry/error handling. Every write needs an idempotency key.

## Category Policy

Because Neonflex is often not explicitly written in the image, the first model treats a row as `neonflex_candidate` unless an exclusion keyword is found.

Hard exclusions for the Neonflex model:

- `3-D`, `3D`, `3 D`
- `Full Glow`, `Full-Glow`, `FullGlow`
- front-lit or back-lit letter systems
- halo systems
- marquee
- lightbox / Leuchtkasten

These rows should be retained for future separate models, not deleted.

## Integration With Existing Quote Engine

The existing Quote Engine currently turns Trello `Price_1..4` into customer-facing quote items using `NT-Number` as the sales factor.

The learning layer should sit before that:

1. estimate supplier `production_price` and `shipping_price`;
2. let humans approve or compare in shadow mode;
3. only then map approved supplier totals into existing `Price_1..4` style inputs or a future quote item source.

No customer-visible quote should be generated directly from an unreviewed model prediction.

## Customer Ops Price Review

Model-generated size and price suggestions are reviewed in Customer Ops before any quote workflow can use them.

- Every incoming supplier/design code gets a stable `prediction_key`.
- Suggested sizes are stored in `supplier_price_predictions` with `decision_status = 'shadow'`.
- Sizes above the 200 cm customer auto-quote boundary are stored with `customer_auto_quote_eligible = false` and must stay `needs_supplier_check` or manual request.
- Customer Ops can approve, reject, or mark a row for supplier check.
- Approval only means "approved for quote workflow"; it must still pass deterministic quote validation before becoming customer-visible.
- OCR/Supplier-image anchors from `supplier_quote_training_items` have their own human gate in the same screen. Ops can correct size, production, and shipping before approving the anchor.
- Approving an anchor creates Shadow/Internal Review price suggestions only; it does not update Trello, quotes, PandaDoc, or customer-visible prices.

The Customer Ops review surface is `/ops/customer-records/price-review`.

### n8n Review Queue Entry Point

Local import draft:

- `workflows/supplier-price-prediction-review-queue-v0.1.inactive-draft.json`

n8n imported inactive draft:

- Workflow ID: `6X1kz9ibVo3JKwU5`
- Name: `NEONTRIP Supplier Price Prediction Review Queue v0.1 (INACTIVE DRAFT)`
- Status: inactive as of 2026-06-08

Preferred workflow action:

```json
{
  "action": "create_from_training_item",
  "operatorName": "n8n",
  "trainingItem": {
    "trainingItemId": "supplier_quote_training_items.id",
    "sourceCode": "optional supplier/design code",
    "stepCm": 20
  }
}
```

The endpoint loads the approved `supplier_quote_training_items` anchor, resolves the current Neonflex anchored Shadow model, builds the size ladder, and upserts rows into `supplier_price_predictions` by stable `prediction_key`.
Customer auto-quote eligibility remains deterministic in the API: max side `<= 200 cm` can remain `shadow`; sizes `> 200 cm` are written as `needs_supplier_check`.

Runtime requirements:

- `SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN` must be configured in the Ops app and n8n.
- Coolify service for `ops.neontrip.de` must have `SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN` as an environment variable.
- n8n sends it as `Authorization: Bearer ...` or `x-supplier-price-review-agent-token`.
- Automation auth is intentionally limited to `create_from_training_item`.
- `review`, `create_from_anchor`, `review_training_item_anchor`, and approval/rejection decisions still require a Customer Ops session.

Required n8n shape:

1. DB trigger or scheduled read of newly approved Neonflex training items.
2. Validate `review_status = approved`, `validation_status = usable`, `product_model_family = neonflex_candidate`, and `excluded_from_neonflex_training = false`.
3. POST to `/api/ops/customer-records/price-predictions` with `action = create_from_training_item`.
4. Log response count and request/training item IDs.
5. Error branch creates an internal Ops task or workflow audit row.

The workflow must not update Trello `Price_*`, `Size_*`, quote items, or customer-visible prices.
The workflow draft uses `maxLongSideCm = 300` for internal review coverage. The API still marks anything above 200 cm as not customer-auto-quote eligible, so larger signs stay on the supplier-check/manual request path.

Activation gate:

1. deploy the Ops app code;
2. set `SUPPLIER_PRICE_REVIEW_AGENT_API_TOKEN` in Coolify and n8n;
3. run `npm run go-live:ops -- https://ops.neontrip.de` or the equivalent protected-mode smoke check;
4. approve at least one Neonflex anchor in Customer Ops;
5. activate workflow `6X1kz9ibVo3JKwU5`.

Rollback for the imported draft is to deactivate workflow `6X1kz9ibVo3JKwU5`. Because it is inactive by default, rollback is currently no-op unless someone activates it.

## Local Training Command

The reproducible training entrypoint is:

```bash
npm run train:quote-learning -- --input tmp/quote-variants.json --output tmp/neonflex-model.json
```

or, for a read-only Supabase REST fetch:

```bash
npm run train:quote-learning -- \
  --supabase-url "$SUPABASE_URL" \
  --supabase-service-role-key "$SUPABASE_SERVICE_ROLE_KEY" \
  --output tmp/neonflex-model.json
```

The command only reads `quote_variants`. It produces a JSON artifact with row counts, filters, feature specification, model coefficients, and holdout metrics. It does not write model versions or predictions back to Supabase.

Current first-pass feature model:

- target: Neonflex supplier production and shipping, predicted separately
- production features: area, max side, LED meters, wattage, pieces, cut parts, RGB, outdoor, UV print, cheap flag, loose letters
- shipping features: area, max side, pieces, cut parts, outdoor, UV print, loose letters
- deterministic split: hash modulo, default 80 percent training / 20 percent holdout
- status: `candidate` unless explicitly run with `--status shadow`

## Rollback

All tables are additive shadow tables. Rollback is:

1. stop extraction/prediction workflows;
2. mark model version `retired` or `rejected`;
3. ignore `supplier_price_predictions` in quote creation;
4. drop shadow tables only after exports/backups if required.

Concrete rollback SQL:

- `supabase/rollbacks/202606040003_supplier_price_model_shadow_rollback.sql` removes only the stored `2026_06_04_v2` model version.
- `supabase/rollbacks/202606050001_supplier_feature_group_model_shadow_rollback.sql` removes only the stored `2026_06_05_v1` feature group model version.
- `supabase/rollbacks/202606050002_supplier_anchored_scaling_model_shadow_rollback.sql` removes only the stored `2026_06_05_v1` anchored scaling model version.
- `supabase/rollbacks/202606050003_supplier_anchored_piecewise_shipping_model_shadow_rollback.sql` removes only the stored `2026_06_05_v2` anchored piecewise-shipping model version.
- `supabase/rollbacks/202606050004_supplier_anchored_large_shipping_model_shadow_rollback.sql` removes only the stored `2026_06_05_v3` large-sign shipping model version.
- `supabase/rollbacks/202606040001_supplier_quote_learning_shadow_rollback.sql` drops the view and all additive shadow tables.
