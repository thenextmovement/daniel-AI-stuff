# Company Brain System Map

## Systemgrenze

`[verifiziert]` Company Brain ist eine kontrollierte Lese-, Erklaerungs- und Aktionsschicht innerhalb der Ops-App. Es ersetzt weder die Fachdatenbanken noch deren Autoritaet.

```text
Mitarbeiter / Agent Control Tower
        |
        v
/ops/company-brain  --->  /api/ops/company-brain/resolve
        |                         |
        |                         +--> deterministische Identitaet und Diagnose
        |                         +--> optionale beleggebundene KI-Kurzfassung
        |                         +--> Incident-Persistenz
        |
        +--> /api/ops/company-brain/actions
        |          |
        |          +--> serverseitige Policy + Frozen Input + Idempotenz
        |          +--> ggf. zweite Freigabe
        |          +--> erneute Source-of-Truth-Pruefung
        |          +--> deterministische Aktion
        |
        +--> /ops/company-brain/governance
                   +--> Incidents, Action-Runs, Identity Reviews,
                        Decisions, Source-/Workflow-Registry
```

## Autoritaetskarte

| Gegenstand | Autoritative Quelle | Rolle weiterer Systeme |
| --- | --- | --- |
| Kundenanfrage und Kundenakte | `[verifiziert]` Ops-Postgres ueber Customer-Records-Domain | E-Mail und Trello liefern Belege/Projektionen. |
| Angebotsinhalt und Angebotsstatus | `[verifiziert]` Offers-Service und persistierter Offer-Snapshot | Ops liest ueber die Offers-Bridge/API. |
| Versandbeleg | `[verifiziert]` `quote_email_log`, belastbare `workflow_audit_log`-Terminalereignisse und Mailbelege | Ein Trello-Label ist allein kein Versandbeleg. |
| Automation-Lifecycle | `[verifiziert]` `workflow_audit_log`, `preview_delivery_jobs`, `company_brain_workflow_attempts` | n8n transportiert/arbeitet; Trello-Titel spiegeln nur den Zustand. |
| Kanonische Identitaet | `[verifiziert]` `company_entity_registry`, `company_entity_aliases`, `trello_card_aliases`, Identity-Review | Name und E-Mail werden nicht automatisch als Merge-Key genutzt. |
| Incident-Zustand | `[verifiziert]` `company_brain_operational_incidents` plus append-only `company_brain_incident_events` | Cockpit ist die Bedienoberflaeche. |
| Aktionsfreigabe | `[verifiziert]` `company_brain_action_policies`, `company_brain_action_runs`, `company_brain_action_approvals` | UI uebergibt keinen vertrauenswuerdigen Actor oder ungeprueften Aktionszustand. |
| Firmenentscheidungen | `[verifiziert]` versioniertes Decision Logbook in `company_decisions` samt Evidence, Outcomes und Audit | Semantische Suche darf erklaeren, nicht die Anwendbarkeit einer Policy bestimmen. |
| Trello | `[verifiziert]` keine Source of Truth | Live-Input, sichtbare Projektion, Assets und Mitarbeiterkontext. |

## Aufloesungsfluss

1. `[verifiziert]` `resolveCompanyBrain` extrahiert harte Identifikatoren aus Suche und Frage.
2. `[verifiziert]` Trello-Shortlink/Card-ID wird live aufgeloest, soweit konfiguriert; Beschreibung, Custom Fields, Labels, Anhaenge und Aktionen werden als Evidenz aufgenommen.
3. `[verifiziert]` `trello_card_aliases` und `master_requests` verbinden kopierte Karten ueber Request-/Nerdy-Forms-ID mit der Kundenakte.
4. `[verifiziert]` Customer Records, Offers und Offer-Bridge liefern Fall- und Angebotsdaten.
5. `[verifiziert]` `quote_email_log`, Outlook-Spiegel und optional Microsoft Graph liefern Versand-, Ausgangs- und Bounce-Belege.
6. `[verifiziert]` `workflow_audit_log` und `company_brain_workflow_attempts` liefern Ursache, Stufe, Versuch, Retry-Sicherheit und Terminalstatus. Bei generischem Audit kann ein read-only n8n-Live-Lookup ergaenzen.
7. `[verifiziert]` Regelbasierte Cross-Checks und Retry-Assessment erzeugen `operationalVerdict`, Mitarbeiterfuehrung und Aktionsvorschlaege.
8. `[verifiziert]` Die Resolve-Route versucht danach kanonische Korrelation, Incident-Persistenz und optional eine zitierpflichtige KI-Kurzfassung. Fehler in diesen Enrichments verdecken die deterministische Diagnose nicht.

## Identitaetsmodell

Kanonischer Fall:

```text
request:<request_id>
```

Zulaessige harte Aliase umfassen Request-ID, Trello-Card-ID/Shortlink, Offer-ID/-Nummer, n8n-Execution-ID und Shopify-Order-ID. `[verifiziert]` Automatisch erzeugte E-Mail-Aliase sind ausgeschlossen. Ein Alias, der bereits einem anderen Fall gehoert, wird nicht ueberschrieben; er erzeugt einen manuellen Review.

`[aus Code/Git abgeleitet]` Mehrfach kopierte Trello-Karten sind beherrschbar, wenn jede Projektion die stabile Request-/Nerdy-Forms-ID traegt. Fehlt diese ID oder widersprechen mehrere harte Quellen einander, muss der Fall fail-closed in die Identity-Review-Queue gehen.

## Workflow-Attempt-Modell

`company_brain_workflow_attempts` speichert pro `attempt_key`:

- Workflow, Execution, Request, Trello-Karte, Offer und Korrelation,
- Action und Stage,
- Zustand `queued`, `running`, `retry_scheduled`, `succeeded`, `failed`, `blocked`, `stale` oder `cancelled`,
- Issue-Code, Retry-Sicherheit und erlaubte sichere Aktion,
- Versuch/Limit, Quell-Audit oder Queue-Job sowie Zeitpunkte.

`[verifiziert]` Inserts in `workflow_audit_log` und Inserts/Updates in `preview_delivery_jobs` reconciliieren ereignisgetrieben. Ein Erfolg wird nicht durch ein spaeteres Nicht-Erfolgsereignis zurueckgestuft. Der Gap-Scanner erkennt nach 30 Minuten fehlende Terminal-Ereignisse; er ist Detektor, kein Recovery-Worker.

## Incident-Modell

- `[verifiziert]` Fingerprints verhindern doppelte offene Incidents fuer denselben Problemzustand.
- `[verifiziert]` Status: `open`, `acknowledged`, `resolved`, `ignored`; Abschluss/Ignorieren braucht eine belastbare Notiz.
- `[verifiziert]` Ein neuer Fehler kann einen geloesten Incident kontrolliert wieder oeffnen; ein spaeterer passender Versandbeleg schliesst ihn.
- `[verifiziert]` Genauere Root Causes duerfen durch den Legacy-Scanner nicht wieder zu einem generischen Fehler degradiert werden.
- `[verifiziert]` `pg_cron` plant die allgemeine Incident-Pruefung alle fuenf Minuten. Der Closed-Loop-Gap-Scan bleibt ohne Side Effect ausser Incident-/Attempt-Zustand.

## Recovery-Pfad

```text
aktueller erlaubter Fehlerbeleg
  -> Action-Proposal retry_media_pipeline
  -> Frozen Input + Hash + idempotenter Action-Run
  -> zweite Person genehmigt und claimt atomar
  -> serverseitige Revalidierung
       Identitaet / Empfaenger / Offer-Zuordnung
       neuerer Erfolg / quote_email_log / Outlook-Ausgang / Bounce
       aktive oder bereits gesendete Queue-Jobs
       Trello geschlossen / Versandlabel
       korrigiertes Asset oder Offer bei permanenten Fehlern
  -> genau ein enqueue_preview_delivery_jobs-Aufruf
       max_attempts = 1
       deterministischer idempotency_key
  -> Queue-/Audit-Ereignisse aktualisieren Attempt und Incident
  -> neuer Terminalbeleg entscheidet ueber Erfolg oder weitere Eskalation
```

`[verifiziert]` Zulassbare Issue-Codes fuer diesen Recovery-Pfad sind aktuell `offer_service_unavailable`, `source_changed_after_preflight`, `preview_media_invalid`, `video_content_qc_failed`, `video_content_qc_inconclusive`, `video_content_qc_unavailable` und `asset_processing_failed`.

## Sicherheits- und Rollenmodell

| Rolle | Kernrechte |
| --- | --- |
| `viewer` | Fall- und Governance-Lesen. |
| `operator` | interne Aktionen, Incident-Bearbeitung und sichere Projektionen. Verifizierte Nutzer erhalten standardmaessig hoechstens diese Rolle. |
| `approver` | sensible Action-Runs und Identity-Reviews als zweite Person freigeben. |
| `automation_admin` | zusaetzlich Workflow-Inventar synchronisieren und Incidents ignorieren. |
| `company_admin` | alle Company-Brain-Rechte. |

`[verifiziert]` Ops-Session/Cloudflare-Access bestimmt den Actor serverseitig. API-Antworten sind privat und `no-store`. Neue Governance-Tabellen/RPCs sind nicht fuer `anon` oder `authenticated` freigegeben.

## Relevante Code-Einstiege

- UI: `src/app/ops/company-brain/page-client.tsx`
- Governance UI: `src/app/ops/company-brain/governance/page-client.tsx`
- Resolve API: `src/app/api/ops/company-brain/resolve/route.ts`
- Action API: `src/app/api/ops/company-brain/actions/route.ts`
- Incident APIs: `src/app/api/ops/company-brain/incidents/`
- Decision APIs: `src/app/api/ops/company-brain/decisions/`
- Resolver/Diagnose: `src/lib/ops/company-brain.ts`
- Audit-Normalisierung: `src/lib/ops/workflow-audit.ts`
- Aktionsgovernance: `src/lib/ops/company-brain-action-governance.ts`
- Identitaet: `src/lib/ops/company-brain-identity.ts`
- Incidents/Playbooks: `src/lib/ops/company-brain-operational-intelligence.ts`
- Foundation/Decision Logbook: `src/lib/ops/company-brain-foundation.ts`
- Closed Loop: `supabase/migrations/20260720185649_company_brain_closed_loop_control.sql`
