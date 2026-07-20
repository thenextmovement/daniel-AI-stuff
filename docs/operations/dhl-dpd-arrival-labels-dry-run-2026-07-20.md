# Read-only data review — 2026-07-20 Europe/Berlin

This report records the connector-assisted read-only review performed before implementation. No label, fulfillment, Trello card, Shopify order or production database row was created or changed. Because the EasyDPD product mapping is not approved, every no-label candidate remains manual review.

| DHL | Last 6 | Arrival | Trello / order | Shopify / customer | Relevant notes | Class | DPD product | Existing DPD | PDF | Result |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1454496820 | 496820 | due 2026-07-20 | `#NEONT4499` Fabrice Balko | `#NEONT4499` / Fabrice Balko | No shipping deviation found; supplier-sales evidence names Yasmin and conflicts with the card/order | standard | not approved | `01476817471154` | not downloaded | existing label; mapping conflict for review; never create a second label |
| 1541534665 | 534665 | delivered 2026-07-20 | Angelina Merz | plausible `#NEONT4513` / Wilhelm Merz | no relevant deviation found | standard | not approved | none found | none | manual review: customer-name relationship is not exact |
| 2443803504 | 803504 | delivered 2026-07-20 | Heydemann | plausible `#NEONT4509` / Socialer Dienst B. Heydemann | no relevant deviation found | standard | not approved | none found | none | manual review: customer match needs confirmation |
| 2527991432 | 991432 | delivered 2026-07-20 | no mapping | none | unavailable | unknown | none | none | none | missing data |
| 2619113486 | 113486 | due 2026-07-20 | `#NEONT4498` Alexander Walden | `#NEONT4498` / Alexander Walden | no relevant deviation found | standard | not applicable | `01476817678011` | existing label not accessible through a documented API | protected reference: never create another label |
| 4958167196 | 167196 | due 2026-07-20 | Lilith Engelhardt | no unique match | unavailable | unknown | none | none | none | missing Shopify mapping |
| 5065735500 | 735500 | due 2026-07-20 | no mapping | none | unavailable | unknown | none | none | none | missing data |
| 5538051234 | 051234 | due 2026-07-20 | `100 pieces Single color Dimmers` | normally none | not applicable | special case | none | none | none | special case; no customer label |
| 6957065500 | 065500 | due 2026-07-20 | Thuy Nguyen | `#NEONT4472` / Thuy Nguyen | no relevant deviation found | standard | not approved | none found | none | manual review until product map and match approval |
| 7312514145 | 514145 | due 2026-07-20 | Adrianne Wootton | `#NEONT4525` / Adrianne Wootton | no relevant deviation found | standard | not approved | none found | none | manual review until product map approval |

Totals: 10 arrivals; 2 existing-label blocks; 1 Dimmer special case; 7 manual/missing/ambiguous cases; 0 labels created; 0 PDFs downloaded from EasyDPD; 0 print jobs queued or printed.

Two distinct full DHL numbers ended in the same four digits (`5500`). The implementation therefore prints six digits and continues to use the full inbound number for identity and storage.
