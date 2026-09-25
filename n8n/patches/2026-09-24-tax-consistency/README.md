## Shopify tax consistency

Two localized NEONTRIP n8n changes: pass the accepted VAT amount as total_tax when creating an offer order, alongside unchanged tax_lines; mirror current_total_tax with a nullish fallback to total_tax. This preserves a valid current zero after a refund or tax change.

No app runtime change, tax decision, customer message or historical Shopify order mutation. Existing fulfilled legacy orders are not repaired by this patch. The separate tax-only mirror backfill is limited to 68 directly verified Shopify/Billing matches with unchanged gross amounts.

Run patch.mjs INPUT OUTPUT on a fixture containing create (live Validate + Build Shopify Order Context jsCode) and sync (live Supabase: Upsert Order jsonBody). Run FIXTURE=OUTPUT node --test tax.test.mjs. Original: 5/10 pass. Candidate: 10/10 pass. Apply only the two changed parameters after checking the live versions; keep every other field unchanged. No live test order is created. Native workflow history supplies rollback.
