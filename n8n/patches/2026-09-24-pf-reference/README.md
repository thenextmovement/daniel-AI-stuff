# NEONTRIP PF reference recognition

Localized patch for Qonto workflow 2fRdyqdyVDMWwH4O. Accept PFNEONT4703 as the same strict reference as PF-NEONT4703. Preserve four-digit bounds, customer/amount checks, all other nodes, credentials, settings and connections.

Three parsers must agree: Validate & Extract, Collective: Route, Collective: Verify Bank. The latter two prevent mixed PF spellings in a collective payment from being treated as one order.

Run patch.mjs with a fresh workflow JSON and an output path. It only transforms local JSON and refuses an unexpected parser state. Apply only the three changed jsCode fields through n8n after checking the original version is still current. The platform version history supplies rollback; no extra workflow backup is required.

Verification: FIXTURE=/path/to/targeted-fixture.json node --test reference.test.mjs. Fixture shape: nodes (the four named code nodes, including unchanged Validate Order), tx (sanitized Qonto credit), order (sanitized matching Shopify order). Generate the candidate fixture with patch.mjs first. The current live parser failed 8 of 29 assertions; the patched parser passes all 29. No application runtime files change and no application deployment is needed.
