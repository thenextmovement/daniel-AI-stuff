# VIES-RETRY-20261118
| Feld | Wert |
|---|---|
| Projekt-ID | PROJ-001 / NEONTRIP |
| Ticket | VIES-RETRY-20261118 |
| Verantwortliche Person | Rahim |
| Zugewiesener Agent | Codex |
| Repository | thenextmovement/daniel-AI-stuff |
| Produktionsbranch | main |
| Aufgabenbranch | codex/vies-retry-20261118 |
| Worktree | /home/rahim/worktrees/neontrip-ops/vies-retry-20261118 |
| Ausgangscommit | 9c5d3ec07926a52901a1c55f3108ed479791d6bf |
| Betroffene Komponenten | VAT worker, isolated VAT result/reclaim RPCs |
| Status | implementation |
User authorizes VIES check, two retries spaced five minutes, unambiguous final alerts, exact case #NEONT4867 and archiving its mail only after resolution. Existing publication authorization applies. No customer messages or financial changes. Preserve unrelated holds.

Plan: regression tests for provider failure vs invalid, exact name/address matching, durable three-attempt limit, five-minute retry claim, stale snapshots and replay. Implement additive leased RPC and update only existing VAT nodes plus durable Wait/reclaim branch. Test in isolated Postgres and VM. Compare live workflow before minimal publish; validate and observe real case. Archive only resolved VAT email. Do not mark unrelated intake conflict resolved without authoritative comparison.
