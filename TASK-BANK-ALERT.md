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

## Abschluss 17.11.2026
Live publiziert und vollständig zurückgelesen: ArT3LN25Mb1PAuBE / ae779380-da08-4e66-bd00-0c209d5cc314, aktiv. Nur Format Error Data um Bank-Zweig ergänzt; alle anderen Nodes, Verbindungen und Einstellungen exakt unverändert. Neun Tests gegen den zurückgelesenen aktiven Code bestanden, vier fremde Formatter-Zweige im Vorher/Nachher-Replay identisch. Lange Texte je 200 Zeichen begrenzt, damit Beschreibung und Code innerhalb der dauerhaften 500-Zeichen-Ablage erhalten bleiben.

Echter Testlauf 12351833: Supabase-Vorfall 46823e70-f99b-40f3-b0ee-754cb252791e mit Schritt, Timeout und Code 57014; Nachricht um 21:32:22 CET im Posteingang support@neontrip.de bestätigt und in Outlook visuell mit Absatzabständen geprüft. Testvorfall über bestehende Transition-Funktion als erledigt markiert; Fehlerdetails danach erneut aus Datenbank gelesen. Temporären Helper PONrwMQMbCo3AFXi entfernt, NOT_FOUND bestätigt. Kein echter Bankfehler ausgelöst.

MCP-Teilupdate/Activation scheitert an bestehender API-Schema-Inkompatibilität. Helper über konfigurierte API aktiviert; Produktionsänderung erfolgreich über MCP-Full-Update nach frischem Versionsvergleich, anschließend vollständiger Inhaltsvergleich. Keine Credentials oder Infrastruktur geändert.

Quellnachweis PR275 https://github.com/thenextmovement/daniel-AI-stuff/pull/275 als Draft erhalten: main-Merge würde ein nicht benötigtes OPS-App-Deployment starten. Servicekorrektur ist unabhängig davon live; eigener sauberer Aufgabenbranch/Worktree bleibt für Nachweis erhalten. Keine Kundennachricht, Bankbuchung oder App-Veröffentlichung.
