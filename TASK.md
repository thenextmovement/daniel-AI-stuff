# TICKET-247: Manual-paid alert once
| Feld | Wert |
|---|---|
| Projekt-ID | PROJ-001 / NEONTRIP |
| Ticket | 247 |
| Verantwortliche Person | Rahim |
| Zugewiesener Agent | Codex |
| Repository | thenextmovement/daniel-AI-stuff |
| Produktionsbranch | main |
| Aufgabenbranch | codex/manual-paid-alert-once-20261104 |
| Worktree | /home/rahim/worktrees/neontrip-ops/manual-paid-alert-once-20261104 |
| Ausgangscommit | 3b4ba4e085c801c6ad24fd668995deb2710c5a55 |
| Betroffene Komponenten/Dateien | Manual-paid error handler M4uG1HAtN9Zggxww; dedicated notification-only RPC/table |
| Status | Umsetzung |
User requests permanent repair of concurrent duplicate manual-paid alerts and verification of affected orders. Existing financial workflow and unknown-claim stop remain unchanged. No app deployment or customer message. Existing historical service PR215 is preserved; this patch extends live error handler without replacing unrelated nodes. Standing scoped publication authorization applies.

Completed: six JS tests and isolated concurrent PostgreSQL regression passed; service patch active, live no-send gate verified. Remote origin/main3ade3143da65c44616f3843dda844cc2bf4e8a4b integrated without conflict. No application code/build/deploy. Financial path unchanged; affected four orders verified paid in both providers. Private schema-change workflow snapshot remains untracked.
