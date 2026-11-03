# NEONTRIP 17TRACK stillgelegt – 03.11.2026

Daniel hat bestaetigt, dass 17TRACK nicht mehr genutzt wird, und die vollstaendige
Abschaltung seiner Aufrufe und Fehlermeldungen beauftragt. Keine Kontingent-Aufladung.

Ziel: keine automatischen 17TRACK-Abfragen oder providerbezogenen Alarme.
Nachbar: Shopify, direkte Carrier-Abfragen, Kundenunterlagen und echte Versandprobleme
bleiben unveraendert. Wirkung: nur 17TRACK stilllegen; keine Sendung als zugestellt markieren.

## Bereits live

- Outbound `QtG2XHw7DsvOEPtQ`: Verbindung von Every Hour zum 17TRACK-Gate entfernt;
  Register Outbound Shipments und Sync Outbound Tracking deaktiviert.
  Vorher aktiv `185b606b-606c-475d-841f-73e8f7b107dc`, danach aktiv
  `30cab56f-d0f7-44a6-9c51-84b24873984d`.
- Inbound `rYmSl4D0nNmEEU0M`: die bereits unerreichbaren Register/Sync-Nodes
  deaktiviert. Vorher aktiv `e8181750-066d-4615-9584-d07fa727e05e`, danach aktiv
  `b16e3924-7af0-4b80-8223-21b1b5fdd61f`.
- Vollstaendiger Vergleich der aktiven Nodes, Verbindungen und Settings: exakt diese
  fuenf Aenderungen, keine andere Abweichung. Beide Workflows bleiben aktiv.
  Draft und aktive Version waren unmittelbar vor jedem Schreiben identisch.
- 58 Outbound- und 127 Inbound-Incidents des Typs tracking_error mit nachgewiesenem
  Provider 17track als ignored markiert. Status-/Metadaten-Backup je Incident im
  bestehenden shipping_audit_log, Schluessel `retire-17track:20261103:<area>:<id>`.
  Keine zugehoerigen offenen Benachrichtigungsdatensaetze gefunden; kein Send-Reset.
  Readback: keine offenen 17TRACK-Incidents mehr.
- Die freigegebene Shipping-Monitor-Migration ist angewandt. Funktionsrumpf und
  service_role-Berechtigung exakt zurueckgelesen; SECURITY INVOKER und fester search_path.
  Noch kein neuer natuerlicher Monitor-Lauf beobachtet.

Vollstaendige Workflow-Backups liegen im bestehenden Aufgabenordner
`/Users/danielklesse/Documents/Codex/2026-11-02/gab-2/17track-before-outbound.json`
und `17track-before-inbound.json`. Keine Credentials geaendert oder geloescht.

## Anwendungskandidat

Vier Register-/Sync-Routen und der 17TRACK-Webhook quittieren nach der bestehenden
Authentifizierung mit `disabled: true, reason: provider_retired`. Sie reservieren
keine Daten, rufen keinen Anbieter auf und schreiben keine Carrier-Ereignisse.
Die erfolgreiche Quittung verhindert Wiederholungen eines eventuell noch sendenden
Legacy-Clients. Parsing-Helfer fuer historische Daten bleiben erhalten.
Dieser Teil muss mit dem geprueften Ops-Commit veroeffentlicht werden.

Gezielter Route-Test: alle fuenf Eintrittspunkte mit und ohne Authentifizierung;
keine Netzaufrufe, einschliesslich eines Webhook-Payloads, der zuvor einen
gettrackinfo-Fallback ausgeloest haette. Vorhandene Carrier- und Installationstests
pruefen das unveraenderte Nachbarverhalten.

## Veroeffentlichungsstand

Die Freigabe fuer `508565e680dfb1bd3f6fb808279979f8c28b475a` lag vor.
Predeploy verweigerte den Push, weil main inzwischen
`908da7382988c38d1413885678dbc61937375ef6` enthielt. Die bestehende Reparatur wurde
konfliktfrei uebernommen; range-diff bestaetigte denselben Patch. Danach kam die hier
explizit beauftragte Stilllegung der fuenf Eintrittspunkte hinzu.
Kein Push unter alter SHA-Freigabe; neue exakte SHA nach Tests freigeben lassen.

Rollback der Stilllegung nur auf ausdruecklichen Wiederinbetriebnahmeauftrag:
zuerst aktiven Zustand abgleichen; genau die beiden Node-Deaktivierungen pro
Workflow und eine Outbound-Verbindung aus dem Backup wiederherstellen.
Incidentstatus nur aus den betroffenen Audit-Backups und ohne Ueberschreiben neuerer
Bearbeitung zuruecksetzen. Anwendung ueber gezielten, freigegebenen Revert.
Historische Sendungsereignisse und Kundenfaelle wurden nicht geloescht.
