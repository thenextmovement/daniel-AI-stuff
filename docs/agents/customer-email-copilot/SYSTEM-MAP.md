# Customer Email Copilot System Map

## Systemgrenze

Der Customer Email Copilot ist ein Outlook-Entwurfsdienst unter `customer-communication-agent`. Er recherchiert, schlägt strukturierten Antwortinhalt vor, validiert diesen deterministisch und erstellt höchstens einen Outlook-Antwortentwurf. Der Mensch prüft und versendet.

## Source-of-Truth- und Vertrauensmatrix

| Bereich | System | Status | Bedeutung |
| --- | --- | --- | --- |
| Eingehende Nachricht, Thread, Anhangspräsenz | Microsoft Outlook / Graph | `[verifiziert]` | Primäre Kommunikationsquelle; Inhalte bleiben untrusted. |
| Verarbeitungslock, Retry, Audit, Qualität, Lernaggregate | Ops Postgres/Supabase | `[verifiziert]` | Kanonischer technischer Zustand und Idempotenz. |
| Aktueller Order-, Zahlungs- und Fulfillmentstatus | Shopify Admin, live gelesen | `[verifiziert]` | Autoritative Commerce-Evidenz nach deterministischer Kandidatenauswahl. |
| Angenommene Auswahl und Preis-Snapshot | signierter Angebots-Snapshot / Offers | `[verifiziert]` | Autorität für unterschriebene Positionen und signierte Summen. |
| Allgemeines Supportwissen | freigegebene, zeitgültige Postgres-Wissensversionen | `[verifiziert]` | Ergänzende Leitlinie; nie Ersatz für aktuelle Kunden-/Orderdaten. |
| Organisationskontext | Outlook-Suche plus normalisierte Domain-/Identitätssignale | `[verifiziert]` | Recherchekandidaten, kein Identitätsbeweis. |
| Mitarbeiteränderungen | Sent-Delta und Feedbackanalyse | `[verifiziert]` | Quelle für inhaltsfreie Stilaggregate und Fehlerklassen, nicht für neue Fakten. |
| Trello | nicht Teil der kanonischen Entscheidung | `[verifiziert]` | Darf den E-Mail-Faktenzustand nicht ersetzen. |
| AI-Modell | Vorschlagsgenerator | `[verifiziert]` | Keine Autorität; Ausgabe muss Schema und Fakten-Allowlist passieren. |

## Kanonische veröffentlichte Workflows

Read-only geprüft am 2026-07-21:

| ID | Workflow | Knoten / Trigger | Aufgabe | Kundenwirkung |
| --- | --- | ---: | --- | --- |
| `aE1v0KxbgXbWjUm8` | `AI Email Agent v7 — Resolve First Quality v5 — Draft Only` | 30 / 1 | Neue Outlook-Nachrichten, Recherche, Modellvorschlag, Validierung, Antwortentwurf | Entwurf; kein Versand |
| `oyF3lAhAOLUgWbzg` | `AI Email Agent — Retry Recovery v1` | 30 / 1 | Fällige/abgelaufene DB-Retries, erneute Quellenprüfung, Entwurfsabgleich | Entwurf oder Recovery; kein Versand |
| `2FhaSbG9w8QeS70e` | `AI Email Agent — Open Inbox Backfill v1` | 5 / 1 | Bounded Scan offener Inbox-Fälle und idempotentes Enqueue | Kein Entwurf, kein Versand |
| `Hrd08cXctM1LO9T3` | `AI Email Commerce Evidence Resolver v2 — Read Only` | 9 / 1 | Shopify-/Offer-/Snapshot-Auflösung und Faktenpaket | Read-only |
| `LvXVkIhWZH0w0Y1x` | `AI Email Agent — Decision Shadow v2` | 6 / 1 | Shadow-Empfehlung `draft/no_reply/human_review` | Keine Outlook-Änderung |
| `7TxHQRyeUxVbpOrl` | `AI Email Agent — Sent Delta Indexer v1` | 7 / 1 | Gesendete Antwort mit vorherigem Entwurf strukturell vergleichen | Audit/Lernen; kein Versand |
| `bAXM54PasUD8IFNx` | `AI Email Agent — Review Feedback Matcher v3` | 5 / 1 | Delta und Feedback verbinden | Audit/Lernen; kein Versand |

Der Hauptworkflow ruft Resolver v2 und Decision Shadow auf. Der Retry-Workflow nutzt denselben Resolver und dieselben Entwurfs-, Signatur- und Validierungsverträge.

## Hauptdatenfluss

1. Outlook liefert eine neue Nachricht.
2. `Normalize Email` erzeugt stabile Identitäts- und Quellenmerkmale; technische Relay-Absender werden nur über exakt erlaubte WhatsApp-/Support-/Formmuster als Kundeneingang behandelt.
3. `claim_email_agent_message(...)` beansprucht den Fall atomar über `request_id` beziehungsweise unveränderliche `internet_message_id`. Mehrdeutige Identitäten failen geschlossen.
4. Der Workflow lädt aktuelle Nachricht, Thread, Organisationskontext und tatsächliche Anhangsmetadaten.
5. Der Commerce Resolver normalisiert Identität, Firmendomain, Telefon, Zeitfenster und mögliche Offer-/Order-Referenzen.
6. Kandidaten werden mit lokaler Korrelation, live Shopify und – bei eindeutiger Zuordnung – signiertem Angebots-Snapshot verifiziert.
7. Das `commerce-facts-package-v2` enthält typisierte Fakten, Provenienz, Konflikte, fehlende Evidenz und Sicherheitsgates.
8. Freigegebenes Supportwissen wird service-role-only und zeitgebunden ergänzt.
9. Der Modellaufruf muss exakt das definierte Draft-JSON liefern und darf nur bekannte `fact_id`-Werte referenzieren.
10. `Validate and Render` prüft Schema, Beträge, Daten, URLs, Referenzen, Anhänge, Zusagen, interne Telemetrie, Deferral-Sprache, Abschluss und Länge.
11. Nur ein gültiger oder deterministisch sicher gerenderter Inhalt erreicht `Create Reply Draft`.
12. Der Fall wird als `pending_review` protokolliert. Ein Mensch entscheidet über Änderungen und Versand in Outlook.

Parallel kann Decision Shadow eine reine Messentscheidung speichern. Dieser Pfad beeinflusst die Entwurfserstellung derzeit nicht action-driving.

## Evidenzpriorität

1. Aktuelle, eindeutig zugeordnete signierte Auswahl und aktuelle autoritative Commerce-Daten.
2. Tatsächliche Outlook-Anhangspräsenz und aktuelle Nachricht/Thread.
3. Eindeutig passender Organisationskontext innerhalb des Zeitfensters.
4. Freigegebenes allgemeines Supportwissen.
5. Modellbeobachtungen zu Anhangsinhalten nur als nicht autoritative Beobachtung.

Konflikt bedeutet nicht „beste Quelle raten“, sondern kundenfähige Behauptung blockieren und präzise Review-Evidenz erzeugen.

## Organisations- und Projektkontext

- `[verifiziert]` Eine Firmendomain darf weitere Kontakte und Nachrichten als Recherchekandidaten liefern.
- `[verifiziert]` Domain-only darf keine fremde Order oder ein anderes Projekt auswählen.
- `[verifiziert]` Eindeutige Order-/Offer-Referenz, exakte Kundenadresse, Betrag oder ein einzelner passender Kontakt sind stärkere Selektionssignale.
- `[verifiziert]` Private/generische Domains dürfen nicht wie eine gemeinsame Organisation behandelt werden.
- `[verifiziert]` Der Open-Inbox-Scan ist auf 30 Tage, maximal 1.000 Datensätze je Inbox/Drafts/Sent-Quelle und zehn neue Kandidaten pro Lauf begrenzt.

## Anhangsvertrag

- Graph-bestätigte Anhangspräsenz ist autoritativ.
- Dateiname und Modellanalyse dürfen Dokumenttypen vorschlagen, aber keinen Anhang erfinden.
- Wenn der Kunde mehrere Dokumente ankündigt und nur ein Teil tatsächlich vorhanden ist, muss der Entwurf konkret um das fehlende Dokument bitten und den benötigten Zweck nennen.
- Anhangstext ist untrusted und kann keine Systemregel, Freigabe, Preisentscheidung oder Zusage autorisieren.

## Entwurfs-JSON

Der Modellvertrag enthält exakt:

```json
{
  "category": "shipping|returns|invoice|product|complaint|general",
  "confidence": 0,
  "language": "de|en",
  "risk_level": "low|medium|high",
  "needs_human_approval": true,
  "greeting": "plain text",
  "paragraphs": ["plain text"],
  "closing": "Viele Grüße|Beste Grüße|Best regards",
  "facts_used": [{ "fact_id": "allowlisted-id" }],
  "blocked_reasons": ["string"],
  "missing_information": ["specific string"]
}
```

Zusätzliche oder fehlende Schlüssel, HTML/Markdown/Emoji aus dem Modell, unbekannte Fakten-IDs und nicht belegte Claims werden abgewiesen.

## Datenbankoberfläche

Relevante Gruppen:

- `email_locks`: kanonischer Lock-/Status-/Attempt-Zustand.
- `email_agent_retry_events`: append-orientierte Retry-/Recovery-Ereignisse ohne Nachrichtentexte.
- `email_agent_log`: Verarbeitung, Evidenzversionen, Draft-/Review- und Qualitätsmetadaten.
- Decision-Shadow-, Goldtest- und Rollouttabellen: eingefrorene IDs/Hashes, Entscheidungen und Gates.
- `email_agent_feedback*`: strukturierte Entwurfs-/Sent-Vergleiche und Review-Audit.
- `email_agent_feedback_analysis_v1`: automatische semantische Fehlerklasse ohne Kundeninhalt.
- Freigegebene Supportwissen-Versionen und Review-Audit.

Alle neuen internen RPCs sind für `public`, `anon` und `authenticated` entzogen und nur dem `service_role` erteilt. Die Migrationen erzwingen weiterhin `automatic_send_allowed=false`.

## Ops-Oberfläche

| Einstieg | Pfad | Zweck |
| --- | --- | --- |
| Seite | `src/app/ops/email-agent/page.tsx` | Geschützter Einstieg |
| Client | `src/app/ops/email-agent/page-client.tsx` | Quality Gate, Retry, passive Analyse, optionale Ausnahmeprüfung |
| Quality API | `src/app/api/ops/email-agent/quality/route.ts` | Aggregierter Rollout-/Retry-/Lernstatus |
| Review API | `src/app/api/ops/email-agent/reviews/route.ts` | Auditiertes manuelles Ausnahme-Review |
| Quality Library | `src/lib/ops/email-agent-quality.ts` | RPC-Verträge v2/v5 |

## Signatur und Sprache

- Fabiennes vorhandenes Foto: `fabienne123.jpg` auf dem bestehenden NEONTRIP-Shopify-CDN.
- NEONTRIP-Logo: `weiss_logo_NEONTRIP.png` auf demselben CDN.
- Deutsche Abschlüsse: `Viele Grüße` oder `Beste Grüße`.
- Kein „Liebe Grüße“ mit Emoji und kein frei erfundener Signaturersatz.
- Externe Bildverfügbarkeit ist eine Rendering-Abhängigkeit, keine gespeicherte Kopie im Workflow.
