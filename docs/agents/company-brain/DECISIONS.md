# Company Brain Decisions

## Statuskonvention

- `active`: im aktuellen Code und durch Tests belegt.
- `historical`: fuer die Entstehung wichtig, aber kein aktueller Live-Nachweis.
- `open`: noch nicht abschliessend entschieden oder belegt.

## Bindende Entscheidungen

### CB-001: Postgres und Fachsysteme sind Source of Truth

- Status: `active`
- Entscheidung: Trello ist ausschliesslich Projektion. Angebotsinhalt kommt aus Offers; Kundenfall und Governance-Zustand kommen aus Ops-Postgres; Versand braucht einen belastbaren Mail-/Auditbeleg.
- Grund: Kopierte Karten, stale Titel und Labels duerfen weder Identitaet noch Versand beweisen.
- Konsequenz: Eine Trello-Karte allein darf Diagnose liefern, aber keinen Kundenkontakt oder Datenfix freischalten.
- Beleg: `[verifiziert]` Resolver, Trello-Projektionsrepair und Tests zu Versandlabeln/Send-Proof.

### CB-002: KI erklaert, deterministische Logik entscheidet und handelt

- Status: `active`
- Entscheidung: KI darf nur einen begrenzten, bereinigten Fallkontext zusammenfassen und muss bekannte Evidence-IDs zitieren. Next Action, Kontaktregel und Side Effects stammen aus Code/Policies.
- Grund: Quelltexte und Mails sind untrusted input; halluciniertes Handeln ist bei Kundenkontakt nicht akzeptabel.
- Konsequenz: Bei fehlendem Modell, Timeout oder ungueltiger Ausgabe bleibt die deterministische Diagnose funktionsfaehig.
- Beleg: `[verifiziert]` `company-brain-ai-brief.ts`, Resolve-Fallback und Operational-Intelligence-Tests.

### CB-003: Kanonische Identitaet basiert auf harten IDs

- Status: `active`
- Entscheidung: `request:<request_id>` ist der Fallanker. Automatische Aliase nutzen harte technische IDs, nie E-Mail oder Namen als Merge-Key.
- Grund: Karten werden kopiert; Namen und E-Mail-Adressen koennen wechseln oder mehrfach vorkommen.
- Konsequenz: Widersprueche erzeugen Identity Review statt stiller Zusammenfuehrung. Alias-Umschreibung ist hochriskant und braucht vier Augen.
- Beleg: `[verifiziert]` Identity-Code, Governance-Migration und Konflikttests.

### CB-004: Jeder relevante Workflow braucht einen Attempt-Lifecycle

- Status: `active`
- Entscheidung: Neue Workflow-Audits nutzen Contract v2 mit Workflow-/Case-ID, Stage, Attempt-Key, Versuch/Limit, Safe-Action-Key und Terminal-Flag. Queue und Audit reconciliieren in einen kanonischen Attempt.
- Grund: Freitext-Trello-Kommentare und isolierte n8n-Executions reichen fuer Ursachen- und Retry-Entscheidungen nicht aus.
- Konsequenz: Legacy-Events bleiben lesbar, werden aber als unvollstaendig markiert. Fehlende Terminal-Events werden nach 30 Minuten als Incident sichtbar.
- Beleg: `[verifiziert]` `workflow-audit.ts`, Statusmigration, Closed-Loop-Migration und Tests.

### CB-005: Recovery ist idempotent, begrenzt und neu zu validieren

- Status: `active`
- Entscheidung: `retry_media_pipeline` legt nach Freigabe hoechstens einen Queue-Job mit `max_attempts = 1` an. Vorher werden Identitaet, Empfaenger, Duplicate, Bounce, Queue, Trello-Zustand und je nach Fehler geaenderte Quellen neu geprueft.
- Grund: Ein blinder Retry kann doppelte E-Mails senden oder unveraenderte fehlerhafte Medien erneut verarbeiten.
- Konsequenz: Permanent wirkende Medien-/QC-Fehler brauchen einen belegten neuen Asset-/Offer-Stand. Ein bestehender Erfolg, Bounce oder aktiver Job blockiert.
- Beleg: `[verifiziert]` Action-Route und fokussierte Route-/Governance-Tests.

### CB-006: Kritische Aktionen brauchen vier Augen und Frozen Input

- Status: `active`
- Entscheidung: Customer-Data-Aenderung, guarded Resend, Alias-Reparatur und Medien-Recovery werden als Action-Run mit serverseitigem Payload-Hash gespeichert. Eine andere berechtigte Person muss genehmigen.
- Grund: Freigaben muessen sich auf exakt den geprueften Zustand beziehen und duerfen nicht durch einen UI-Payload ausgetauscht werden.
- Konsequenz: Gleicher Proposer/Approver, stale Run oder paralleler Case-Run wird atomar abgewiesen.
- Beleg: `[verifiziert]` Action-Governance-Code, RPCs und Tests.

### CB-007: Scanner erkennen, aber heilen nicht automatisch

- Status: `active`
- Entscheidung: Zeitbasierte Scanner duerfen stale Attempts und Incidents markieren, aber keinen Kundenkontakt und keinen Retry ausloesen.
- Grund: Polling kann fehlende Events erkennen, aber keine Identitaet, Korrektur oder Duplicate-Sicherheit garantieren.
- Konsequenz: Recovery bleibt ein expliziter, beleggebundener Action-Run.
- Beleg: `[verifiziert]` Closed-Loop-Kommentar, `scan_company_brain_workflow_attempt_gaps()` und Incident-Migration.

### CB-008: Ein spaeterer Erfolg muss fruehere Fehler kontextualisieren

- Status: `active`
- Entscheidung: Ein passender, zeitlich spaeterer Terminal-/Versandbeleg loest den Fall und verhindert, dass Scanner oder alte Fehler erneut einen offenen Incident vortaeuschen.
- Grund: Historische Fehler duerfen Mitarbeiter nicht zu einem zweiten Versand verleiten.
- Konsequenz: Trello-Projektion kann erst nach Send-Proof repariert werden; ein Outlook-Bounce bleibt staerker als ein generischer Workflow-Erfolg.
- Beleg: `[verifiziert]` Incident-Reconciliation-Migrationen, Diagnose- und Projektionsrepair-Tests.

### CB-009: Decision Logbook statt stiller Wissensaenderung

- Status: `active`
- Entscheidung: Richtlinien, Architekturentscheidungen und Incident-Resolutionen werden versioniert mit Ziel, Problem, Kontext, Optionen, Begruendung, Risiken, Guardrails, Konsequenzen, Rollback und Review-Datum erfasst.
- Grund: Das Company Brain soll nicht nur wissen, was gilt, sondern warum und bis wann.
- Konsequenz: Genehmigte Versionen werden nicht inhaltlich ueberschrieben; eine neue Version superseded die alte. Policy-Anwendbarkeit wird exakt und temporal, nicht rein semantisch, ermittelt.
- Beleg: `[verifiziert]` Foundation-/Decision-Migrationen, Governance-UI und Tests.

## Historische Entwicklung

| Commit | Historische Entscheidung | Einordnung |
| --- | --- | --- |
| `1ab2f72` bis `c60a959` | Automationsfehler klassifizieren, UI strukturieren, Action-Routen haerten | `[verifiziert]` Git-Historie; Grundlage der Fallpruefung. |
| `17fa7ff`, `1913033` | direkte n8n-Audit-Payloads und harte Workflowfehler aufnehmen | `[verifiziert]` Git-Historie; heutiger Audit-Contract baut darauf auf. |
| `4ceb65b`, `aae26c9`, `2d2cb7b` | Trello-Alias-Aufloesung und Repair Center | `[verifiziert]` Git-Historie; Reaktion auf kopierte Karten. |
| `7efc719`, `a47e2b4` | Mitarbeiter-Cockpit einfuehren und vereinfachen | `[verifiziert]` Git-Historie; heutige erste Ergebnisansicht setzt dies fort. |
| `0cbf591` bis `1497933` | Video-QC, Retry-Erschoepfung und historische Erfolge kontextualisieren | `[verifiziert]` Git-Historie und Tests. |
| `01e62de`, `178252f`, `86f7d44` | Foundation, Governance und proaktive Incidents | `[verifiziert]` Git-Historie und Migrationen. |
| `2b0d515` | Closed Loop mit Attempts und governed Medien-Recovery | `[verifiziert]` im aktuellen Main enthalten. |
| `114c8c2` | Preview-Delivery-Queue vor Incident-Verweisen als Quelle registrieren | `[verifiziert]` im aktuellen Main enthalten. |

## Historische Live-Aussagen ohne aktuellen Nachweis

- `[historisch aus Thread]` Der n8n-Workflow `9FoJMH6OUdsi36FB` wurde als aktiv, mit strukturiertem Audit v2 und einer gesicherten Vorversion beschrieben.
- `[historisch aus Thread]` Die Closed-Loop-Migrationen und ein transaktionaler Supabase-Smoke wurden als produktiv erfolgreich gemeldet.
- `[historisch aus Thread]` Ein Deploy des Closed-Loop-Commits und ein Live-Falltest wurden als erfolgreich gemeldet.
- `[nicht live verifiziert]` Keine dieser Aussagen wurde in dieser reinen Wissensmigration erneut gegen n8n, Supabase oder Coolify geprueft.

## Offene Entscheidungen

### CB-O01: Legacy-Attempt-Backfill

- Status: `open`
- Frage: Sollen historische `workflow_audit_log`- und `preview_delivery_jobs`-Zeilen kontrolliert in `company_brain_workflow_attempts` nachgezogen werden?
- Risiko: Ein pauschaler Backfill kann mehrere Legacy-Ereignisse falsch zu einem Attempt verdichten.
- Mindestanforderung: Dry Run, Kollisionsbericht, begrenzter Zeitraum, deterministischer Key, Transaktion, Rollback und Stichprobe mit Golden Cases.

### CB-O02: Release-Gate fuer echten Recovery-E2E

- Status: `open`
- Frage: Welcher interne Testfall und welche interne Empfaengeradresse duerfen fuer einen vollstaendigen Queue-zu-Terminal-Test verwendet werden?
- Risiko: Ohne kontrollierten End-to-End-Test bleiben Queue-Worker, n8n-Publish-Zustand und Mailprovider ausserhalb des Repository-Belegs.
- Mindestanforderung: keine echte Kundenadresse, eindeutiger Testmarker, Duplicate-Guard, Kostenlimit, manuelle Freigabe und Cleanup-Protokoll.

### CB-O03: Scheduling durch den Agent Control Tower

- Status: `open`
- Entscheidung fuer dieses Manifest: `schedule_supported = true` ausschliesslich fuer read-only Audits, Incident-Queue-Zusammenfassungen und Nachweispruefungen.
- Verbot: Geplante Jobs duerfen keine Recovery freigeben, keine Mails senden, keine Daten korrigieren und keine Workflows aktivieren.

## Aenderungsprotokoll fuer neue Entscheidungen

Jede neue bindende Company-Brain-Entscheidung muss mindestens enthalten:

```text
Decision Key / Version
Owner / Scope / Review-Datum
Ziel und Problem
Belegte Ausgangslage
Alternativen
Gewaehlte Option und Begruendung
Annahmen
Erwartete Outcomes und Messgroessen
Risiken und Guardrails
Konsequenzen
Rollback
Supporting und opposing evidence
Spaeteres Outcome / Lessons learned
```

`[verifiziert]` Das produktnahe Decision Logbook bildet diese Felder und einen Review-/Outcome-Lifecycle bereits ab. Dieses Markdown ist die Uebergabe der Architekturentscheidungen, nicht der Ersatz fuer kuenftige versionierte Eintraege.
