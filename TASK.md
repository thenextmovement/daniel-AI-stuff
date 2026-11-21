# Issue249: Easybill gross rounding
| Feld | Wert |
|---|---|
| Projekt-ID | PROJ-001 / NEONTRIP |
| Ticket | 249 |
| Verantwortliche Person | Rahim |
| Zugewiesener Agent | Codex |
| Repository | thenextmovement/daniel-AI-stuff |
| Produktionsbranch | main |
| Aufgabenbranch | codex/easybill-rounding-20261104 |
| Worktree | /home/rahim/worktrees/neontrip-ops/easybill-rounding-20261104 |
| Ausgangscommit | 3ade3143da65c44616f3843dda844cc2bf4e8a4b |
| Betroffene Komponenten | Document worker draft/final guards/completion evidence plus direct customer-delivery consumer |
| Pull Request | pending |
| Preview | isolated node tests |
| Status | live service repair and recovery verified; source PR pending |
Goal: accept only proven gross-to-net aggregation rounding; keep exact gross/currency/item/tax validation, reuse existing documents, recover cases4831/4832 without test customer messages. User authorized live scoped service repair. App deployment excluded.

Verification:51 tests, exact live readback, both retained documents and deliveries DONE, both paid_amount0/Shopify pending, no open incidents in two cases. Legacy4388 read-only discrepancy recorded in patch README; no historic financial mutation.
