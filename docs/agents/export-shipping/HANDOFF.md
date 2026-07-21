# Exportversand/Schweiz Agent Handoff

Stand: 2026-07-21, verifiziert gegen Ops `origin/main` auf Commit `a063f216692e97639da36492d9e025f7615665fe`.

Parent-Agent: `logistics-fulfillment-agent`

## Evidenzstatus

- `[verifiziert]`: durch aktuellen Repository-, Git- oder Teststand beziehungsweise einen ausdrücklich genannten Read-only-Check belegt.
- `[historischer Prototyp]`: im uncommittierten Exportversand-Worktree vorhanden und dort les- oder testbar, aber nicht Teil von `origin/main`.
- `[historisch aus Thread]`: im ursprünglichen Arbeitschat als ausgeführt berichtet, in dieser Wissensmigration aber nicht erneut vollständig reproduziert.
- `[aus Code abgeleitet]`: Schlussfolgerung aus Code oder statischem Entwurf; kein Beleg für einen produktiven Lauf.
- `[offen]`: nicht entschieden, nicht implementiert oder ohne ausreichende Live-Evidenz.

## Übergabeergebnis

- `[verifiziert]` Dieses Verzeichnis ist das kanonische Wissenspaket für Exportversand in die Schweiz und andere spätere Nicht-EU-Ziele.
- `[verifiziert]` Die Exportversand-Funktion ist **nicht** in `origin/main`, nicht deployt und nicht aktiviert.
- `[verifiziert]` Der bisherige Implementierungsstand liegt ausschließlich als uncommittierte Änderung im Worktree `/Users/danielklesse/codex-worktrees/neontrip-ops-dpd-export-shipping-20260717-120022` auf Basis `cc2e19944b8142c68f8e27ec7b857181e3efa409`. Diese Basis liegt 48 Commits hinter dem verifizierten `origin/main`.
- `[verifiziert]` Im aktuellen `main` existiert ein separater fail-closed EasyDPD-Browser-Worker für Arrival-Labels. Er ist nicht der Schweiz-Exportagent, arbeitet mit einer anderen fachlichen Identität und blockiert Schweiz ausdrücklich.
- `[verifiziert]` Keine Produktion, kein DPD-/EasyDPD-Auftrag, kein Shopify-Fulfillment, keine Kundenmail, keine Workflow-Aktivierung und kein Deploy wurden für dieses Handoff ausgelöst.
- `[offen]` Vor jeder Umsetzung muss entschieden werden, ob der Exportpfad den offiziellen DPD-Cloud-Webservice oder eine eigens qualifizierte EasyDPD-Browserautomation verwendet. Beide Pfade dürfen nicht stillschweigend kombiniert werden.

## Fachliches Ziel

Der freigegebene Mitarbeiterablauf soll später:

1. eine Shopify-Bestellung eindeutig laden;
2. feste Versenderdaten einmalig verwalten;
3. Kunden-UID/USt-ID, Warenbeschreibung, Warentarifnummer, Ursprung, Nettogewicht, Paketmaße, Bruttogewicht, Verpackungs- und Frachtwert erfassen;
4. einen überprüften, unveränderlichen Export-Snapshot bilden;
5. erst nach ausdrücklicher Bestätigung ein DPD-Label erzeugen;
6. Label und Handelsrechnung getrennt sowie gemeinsam zum Download bereitstellen;
7. erst nach separater Freigabe DPD-Tracking in Shopify hinterlegen;
8. erst nach einer weiteren separaten Freigabe die Shopify-Kundenbenachrichtigung auslösen.

`[historischer Prototyp]` Phase 1 war auf Schweiz, genau ein Paket, eine offene Fulfillment Order und alle noch offenen Positionen dieser Fulfillment Order begrenzt.

## Zentrale Übergabeaussagen

- `[verifiziert]` Die offizielle DPD-Entwicklerseite verweist myDPD-Business-Kunden auf den DPD Cloud Webservice.
- `[verifiziert]` Die am 2026-07-21 erneut gelesene offizielle DPD-Cloud-Dokumentation beschreibt `setOrder`, Sandbox-Credentials und eine gesonderte Live-Freischaltung mit eigenen Live-Credentials und Live-URLs.
- `[verifiziert]` Dieselbe Dokumentation weist für internationalen Express ausdrücklich darauf hin, dass Zollangaben nicht unterstützt werden. Im gelesenen Cloud-Vertrag wurde kein belastbarer myDPD-interner Handelsrechnungs-Upload nachgewiesen.
- `[historischer Prototyp]` Deshalb erzeugte der Entwurf das Label über DPD Cloud und die Handelsrechnung lokal als deterministisches PDF. Er behauptete nicht, die Rechnung in myDPD gespeichert zu haben.
- `[verifiziert]` Der aktuelle EasyDPD-Arrival-Worker in `main` darf nicht für Schweiz wiederverwendet werden: Route, Shop, Produkte, Format, Gewicht und Preisgrenze sind auf seinen Arrival-Label-Scope fest verdrahtet; die Arrival-Domäne routet `CH` in manuelle Prüfung.
- `[offen]` Es gibt keine echte DPD-Sandbox-Antwort, kein produktives Exportlabel, keine bestätigte Exportprodukt-/Tarifzuordnung, keinen visuellen Rechts-/Zollcheck der Handelsrechnung und keinen kontrollierten Shopify-E2E-Beleg.

## Einstieg

1. Architektur, Zustandsgrenzen und angrenzende Systeme: [SYSTEM-MAP.md](./SYSTEM-MAP.md)
2. Historische und weiterhin bindende Entscheidungen: [DECISIONS.md](./DECISIONS.md)
3. sichere Arbeitsweise, Freigabegates und Rollback: [OPERATIONS.md](./OPERATIONS.md)
4. priorisierte Blocker und offene Risiken: [KNOWN-ISSUES.md](./KNOWN-ISSUES.md)
5. reproduzierbare Evidenz und Safety-Scorecard: [VERIFICATION.md](./VERIFICATION.md)
6. maschinenlesbares Manifest: [agent.json](./agent.json)

## Nicht verhandelbare Grenzen

- Neue Ops-Arbeit beginnt in einem dedizierten Worktree mit `codex-new-worktree ops <topic>`.
- Vor jedem Deploy ist `codex-predeploy ops` Pflicht; nur der exakt ausgegebene Commit darf deployt werden.
- Ein Merge/Deploy der deaktivierten Fähigkeit und die Erzeugung eines echten Labels sind getrennte Freigabegates.
- Shopify-Fulfillment und Kundenbenachrichtigung sind zwei weitere getrennte Freigabegates.
- Keine Secrets lesen, ausgeben, dokumentieren oder committen; Runbooks nennen ausschließlich Variablennamen.
- Keine Carrier-, Shopify-, Storage-, Mail-, Druck- oder Workflow-Side-Effects ohne explizite Freigabe, deterministische Validierung und Idempotenz.
- Kein automatischer Retry nach einem unklaren DPD-/EasyDPD-Kauf, Shopify-Fulfillment oder Druck.
- Supabase/Postgres ist für Jobs, Zustände, Idempotenz und Audit die vorgesehene Source of Truth. Trello bleibt Projektion.
- Keine KI und keine frei formulierte Kundenkommunikation im kritischen Pfad.

## Scope dieses Handoffs

- Enthalten sind Anforderungen, Systemgrenzen, Prototypinventar, aktuelle Main-Abgrenzung, Providerentscheidung, Datenmodell, Zustandsmodell, Tests, Aktivierungsplan, bekannte Risiken und Rollback.
- Nicht enthalten sind Produktlogik, Migrationen, Zugangsdaten, Live-Konfigurationen, Workflow-Importe oder Deployments.
- Das Paket autorisiert keine Aktivierung und keine reale Label-Erzeugung.
