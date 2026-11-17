# BANK-ALERT-20261117 / Issue 274

## Pflichtangaben
| Feld | Wert |
|---|---|
| Projekt-ID | PROJ-001 / NEONTRIP |
| Ticket | BANK-ALERT-20261117 / 274 |
| Verantwortliche Person | Rahim |
| Zugewiesener Agent | Codex |
| Repository | thenextmovement/daniel-AI-stuff |
| Produktionsbranch | main |
| Aufgabenbranch | codex/bank-alert-details-20261117 |
| Worktree | /home/rahim/worktrees/neontrip-ops/bank-alert-details-20261117 |
| Ausgangscommit | 46144b06e14acc47a71ad286e914eccf1db2a7d8 |
| Betroffene Komponenten | ArT3LN25Mb1PAuBE / Format Error Data, nur Bankspiegel; workflows/bank-alert-details |
| Pull Request | ausstehend |
| Preview | deterministischer Node-Replay plus begrenzter interner Alarmtest |
| Status | Prüfung |

## Ziel und Abgrenzung
Fehlerursache und betroffenen Schritt in bestehender Supabase-Vorfallsablage und interner E-Mail erhalten. Redigierte, begrenzte Texte, HTML-Escaping, expliziter Fallback. Bankspiegel-Synchronisierung, Shopify- und Configurator-Alarmzweige unverändert. Keine Appveröffentlichung, Bankbuchung oder Kundenmail.

## Kontext und Freigabe
Rahims ausdrücklicher Auftrag im aktuellen Chat vom 17.11.2026 autorisiert Umsetzung und Prüfung des Alarmwegs. n8n fuajob.online / Ownerprojekt JauOm7m3X0at6YVL, support@neontrip.de; Supabase klibiejfisijpagzkxls; persönlicher Account rahim@neontrip-dev-01 und GitHub thenextmovement technisch bestätigt. Code und Tests ausschließlich im persönlichen Dev-Worktree. Aktuelle Liveversion vor Änderung 6780f20f-3e6a-4e10-9c7a-124a5defd22e.
PR234 betrifft den bereits vorhandenen separaten Configurator-Zweig desselben Formatters. Dieser wird bytegleich erhalten; dessen Quelldateien bleiben unangetastet. Vor Publikation Versions- und Gesamtdiffprüfung.

## Prüfung
Fünf Verhaltenstests zuerst rot gegen den Livecode; acht Tests nach Korrektur grün, einschließlich echter Adapter-/Router-/Bündelungslogik. Syntaxprüfung erfolgreich. Live-Test und dauerhafte Rücklesung ausstehend.
