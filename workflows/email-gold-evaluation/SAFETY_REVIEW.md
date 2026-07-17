# Safety Review: E-Mail-Goldtest und Rollout-Gate

## Ergebnis

Der produktive Default ist `review_only`. Der neue Code versendet keine Nachricht,
ändert keinen Outlook-Entwurf und aktiviert kein action-driving Routing. Ein
höherer Rollout ist fail-closed und benötigt zwei bestandene Gates.

## Schutzmaßnahmen

- Ein `no_reply` bei einem referenziert antwortpflichtigen Fall blockiert sofort.
- `internal_or_duplicate` darf nie allein eine sichere Gold-Referenz für
  `no_reply` bilden; damit kontaminieren ältere Relay-Fehlklassifikationen den
  50-Fälle-Test nicht.
- Mindestens 50 eingefrorene Referenzfälle sind Pflicht.
- Das Facts-Package benötigt mindestens 30 aktuelle gesendete Vergleiche.
- Fakten-, Anhangs-, Betrags-, Datums-, Zusage- und interne Korrekturen werden als
  Sicherheitskorrekturen gezählt.
- Gold-Vorhersagen sind pro Versionsname unveränderlich.
- Stufenwechsel brauchen Prüfer, Begründung und Idempotency-Key.
- Alle Tabellen verwenden RLS und explizite Service-Role-Grants.
- Der Goldsatz enthält keine Betreffzeilen, Nachrichtentexte oder Antworttexte.
- `automatic_send_allowed = false` und `human_send_approval_required = true` sind
  Datenbank-Constraints.

## Risiko-Score

| Bereich | Score | Begründung |
| --- | ---: | --- |
| Korrektheit | 5 | Getrennte Routing- und Entwurfsmetriken, null tolerierte gefährliche No-Replies. |
| Zuverlässigkeit | 5 | Fail-closed, immutable Vorhersagen, idempotente Reviews und Evaluationsläufe. |
| Beobachtbarkeit | 5 | Goldsatz, Runs, Rollout-Status und Audit dauerhaft in Postgres. |
| Sicherheit | 5 | Kein Versandpfad, RLS, keine Kundentexte im Goldsatz, Human Gate. |
| Rollback | 5 | App- und SQL-Rollback sind getrennt und dokumentiert. |

## Bekannte Grenze

Historische Entwurfsvergleiche dürfen die aktuelle Facts-Package-Version nicht
freischalten. Deshalb beginnt deren Qualitätszähler bewusst bei null und der
Rollout bleibt zunächst bei `review_only`.
