# Kundenakte und Calls Review - Decisions

## Dauerhafte Entscheidungen

| Entscheidung | Status | Konsequenz |
| --- | --- | --- |
| Postgres ist Source of Truth; Trello ist Projektion. | `[verifiziert]` | Fehlende oder widersprüchliche Karten dürfen keine Kunden-, Segment- oder Call-Wahrheit erzeugen. |
| Eine Kundenakte bündelt mehrere Requests, behält aber einen aktuellen Request-Zeiger. | `[verifiziert]` | Alte Request-IDs müssen über `master_requests.customer_id` weiter ladbar bleiben. |
| KI segmentiert als Vorschlag; deterministische Regeln akzeptieren oder verlangen Review. | `[verifiziert]` | Firmen-/Domain-Recherche darf nur Evidenz liefern. Manuelle Bestätigung bleibt kanonisch und auditiert. |
| Segmentierung ist Anfrage-bezogen. | `[verifiziert]` | Ein Segment gehört in `master_requests`, nicht nur in Trello oder den Customer-Row. |
| Call-Tageslisten sind Views, nicht alleinige Wahrheit. | `[verifiziert]` | Offene Arbeit bleibt in `sales_tasks`, Cadence und Ergebnissen erhalten, auch wenn ein Tageslauf neu erzeugt wird. |
| Angebot gesendet startet die zweite Call-Stufe. | `[verifiziert]` | `ops_record_offer_sent` schließt offene Inquiry-Aufgaben und legt idempotent `call_quote_sent`/`quote_call` an. |
| Call-Guards werden beim Speichern neu aus Live-Kontext berechnet. | `[verifiziert]` | Ein veralteter Browserzustand darf Kontaktstopp, Abschluss, Antwortlage oder fehlende Telefonnummer nicht umgehen. |
| Neuere Call-Ergebnisse dürfen nicht still überschrieben werden. | `[verifiziert]` | Der Normalpfad nutzt eine atomare RPC mit Advisory Lock und `expectedLatestResultId`. |
| Ein Call-Ergebnis erzeugt den nächsten Task deterministisch. | `[verifiziert]` | Preset, Cadence und Aufgaben-Engine entscheiden; AI oder Freitext lösen keinen ungeprüften Side Effect aus. |
| Terminale Call-Ergebnisse müssen künftig in kanonische Customer-Ops-Zustände überführt werden. | `[offen, aktueller Bruch verifiziert]` | `do-not-call`, `not-interested` und `bought` dürfen nicht nur die Call-Liste beenden; Kontaktstopp, Follow-ups und Fallausgang müssen konsistent und atomar folgen. |
| Kontaktänderungen brauchen Preview, Audit und Rückfall. | `[verifiziert]` | Kunden-, Follow-up-, Plan- und Dokumentdaten werden zusammen geplant und bei Teilfehlern kompensiert. |
| Kontaktstopp ist fachlich stärker als Follow-up. | `[verifiziert]` | Offene Follow-ups werden beendet, Plan wird blockiert und die E-Mail wird in `followup_blacklist` aufgenommen. |
| Massenaktionen brauchen Fallvorschau und Eligibility-Filter. | `[verifiziert]` | Aktuell werden höchstens fünf Fälle gezeigt; Kontaktstopp und Urlaub werden automatisch übersprungen. |
| Eine Trello-Duplizierung ist eine neue Anfrage, keine zweite ID für denselben Request. | `[verifiziert]` | Neue UUID, neue `master_requests`-Zeile, neuer aktueller Kundenzeiger und neue Call-Aufgabe. |
| Trello-Duplizierung muss replay-sicher sein. | `[verifiziert]` | Browser-Schlüssel, Audit-Metadaten und `attribution_raw.idempotency_key` verhindern denselben Replay. |
| Kundenkommunikation wird nicht automatisch aus dem Review-Agenten gesendet. | `[verifiziert]` | Outlook-Links, Offers-Send und sonstige Versandpfade brauchen eigene menschliche Freigabe und separate Verträge. Der aktuelle Offers-Button besitzt noch kein finales Bestätigungs-Gate. |
| Read-Fehler dürfen Calls nicht in endlosem Ladezustand halten. | `[verifiziert]` | API liefert begrenzte Timeouts und einen expliziten degraded State; dessen Stale-State-Semantik ist noch zu schärfen. |

## Historische Entscheidungen aus dem Arbeitsverlauf

- `[historisch, im Code bestätigt]` Die leere Spalte `Angebot gesendet` führte zu einem Offer-Sent-Bridge- und Runtime-Reconcile-Fix. Aktuelle Tests decken veraltete Inquiry-Cadence nach späterem Angebotsversand ab.
- `[historisch, im Code bestätigt]` Dauerhaftes `Lade Status ...` führte zu 35-Sekunden-Grenzen, initialem 30er-Preview, schlankeren Customer-Reads und degraded Responses.
- `[historisch, im Code bestätigt]` Segmentierung soll bei nicht privaten Domains Firmenkontext recherchieren und unsichere Fälle menschlich bestätigen lassen. Die UI- und Persistenzseite ist vorhanden; der heutige Live-Workflow ist nicht belegt.
- `[historisch, im Code bestätigt]` Suche nach Kundinnen/Kunden ohne aktuellen Request-Zeiger wurde gehärtet. Ein konkreter damals gemeldeter Produktionsdatensatz wurde in dieser Übergabe aus Datenschutz- und Live-Grenzen nicht erneut geprüft.
- `[historisch, im Code bestätigt]` Einheitliche Ops-Navigation und kürzere Labels wurden in früheren Commits umgesetzt; dieses Paket besitzt nur die Kundenakte-/Calls-Funktion, nicht das globale Menü.
- `[historisch, im Code bestätigt]` `Karte duplizieren` wurde mit Commit `c5ca78881e596c6ed67e80b22b143e3cba1b3f38` eingeführt und durch GitHub Actions erfolgreich gebaut/deployt.

## Relevante Git-Historie

| Commit | Wirkung |
| --- | --- |
| `c5ca788` | Trello-Karte als neue Anfrage neu einspielen, Idempotenz und fokussierter Test. |
| `c06683d` / `afb65c9` / `879ff45` | Outlook-/Offer-Kontext-Fallbacks und Call-Kontext-Härtung. |
| `954cb6f` / `b5d8aec` | Kundenakte ohne aktuellen Request-Zeiger rendern/laden. |
| `0d098db` | Angebot-Nachfassfälle in Calls sichtbar machen. |
| `370844c` | Call-Status schneller und mit degraded Fallback laden. |
| `c18da73` | Letzten KI-Segmentvorschlag in der Kundenakte zeigen. |
| `919c389` / `f833a80` | Call-UI-Aktionen und Callback-Preset-Vertrag härten. |
| `3741c03` / `1be0455` | Call-Abschlussworkflow und Offer-Call-Task-Exports reparieren. |
| `53a8a5c` | RLS für `sales_tasks`/`ops_offer_events` und Managementzugriffe härten. |

Alle aufgeführten Commits sind im verifizierten `origin/main` enthalten.

## Noch offene Entscheidungen

- Sollen destruktive Einzelaktionen immer eine sichtbare zweite Bestätigung mit Folgenvorschau verlangen?
- Muss jeder Kundenversand Empfänger, CC, Betreff und Wirkung in einem finalen Confirm-Schritt erneut zeigen und serverseitig an einen kurzlebigen Prüfbeleg binden?
- Soll jeder zusammengesetzte Fallausgang als atomare Datenbank-RPC beziehungsweise Action-Run mit Resume/Rollback modelliert werden?
- Welche Trello-Eigenschaften müssen für „identische Karte“ zwingend geprüft werden: Binärinhalt der Anhänge, Labels, Checklisten, Mitglieder, Fälligkeit, Kommentare?
- Darf Calls bei Datenquellenfehlern einen serverseitig gespeicherten letzten guten Zustand zeigen, oder muss die UI bewusst leer und rot sein?
- Werden fehlende Call-Basismigrationen aus dem historischen Projekt in dieses Repository überführt und mit RLS/Rollbacks versioniert?
