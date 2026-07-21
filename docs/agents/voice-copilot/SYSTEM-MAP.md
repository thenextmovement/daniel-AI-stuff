# Voice Copilot System Map

## Source-of-Truth-Grenzen

| Bereich | Autoritaet | Status | Bedeutung |
| --- | --- | --- | --- |
| Kundenanfrage und Request-Bindung | Ops Postgres/Supabase-Kundenakte | `[verifiziert]` | Jeder Kundenkontext wird auf eine exakte `request_id` gebunden. |
| Angebot | Interne Offers-API / Offers-Datenbank | `[verifiziert]` | Voice liest einen gebundenen Snapshot ohne Preis-, Rabatt- oder Summenfelder. |
| Outlook-Evidenz | Postgres-Spiegel, optional Microsoft Graph read-only | `[verifiziert]` | Nachrichten sind Evidenz und untrusted input, keine Handlungsanweisung. |
| Voice-Wissen | Ops Postgres `voice_knowledge_*` | `[verifiziert]` | Nur freigegebene Versionen duerfen in Prompts oder Suche gelangen. |
| Anrufberechtigung und Call-Zustand | Ops Postgres `voice_*` | `[verifiziert]` | Einwilligung, DNC, Kampagne, Target, Attempt, Ergebnis und Modell-/Prompt-Snapshot. |
| Audio-/Realtime-Verbindung | langlebiger Voice-Runtime-Service | `[verifiziert]` | Twilio/SIP und OpenAI Sideband; kein dauerhafter Next.js- oder n8n-Audiokanal. |
| Zeittrigger und Ergebnisprojektion | n8n | `[verifiziert]` | Dispatcher/Outcome/Error-Transport, nie Auswahl- oder Berechtigungsautoritaet. |
| Trello | Projektion/Alias-Hilfe | `[verifiziert]` | Darf weder Kundenzuordnung noch Anrufberechtigung oder Wissen entscheiden. |

## Drei getrennte Laufzeitpfade

### 1. Browser-Sprachagent

1. `[verifiziert]` `/ops/voice-copilot` erstellt im Browser eine WebRTC-Verbindung und sendet SDP an `POST /api/ops/voice-copilot/realtime-session`.
2. `[verifiziert]` Der Server verwendet `OPS_OPENAI_API_KEY` oder `OPENAI_API_KEY`, erzeugt die Realtime-Session und gibt nur das SDP zurueck; der API-Key gelangt nicht in den Browser.
3. `[verifiziert]` Das Modell ist in diesem aelteren Pfad direkt als `gpt-realtime-2.1` mit Stimme `marin` festgelegt und nicht an die Call-Plattform-Registry gekoppelt.
4. `[verifiziert]` Bei aktivem Wissensflag werden Request-Kontext, freigegebenes Wissen und Session-Audit gebunden. Bei deaktiviertem Wissensflag faellt die UI auf manuell eingegebenen Testkontext zurueck.
5. `[aus Git/Code abgeleitet]` Dieser Pfad ist ein interner Test-/WebRTC-Pfad und kein freigegebener Outbound-Kundenanrufpfad; siehe [KNOWN-ISSUES.md](./KNOWN-ISSUES.md).

### 2. Live-Copilot fuer Mitarbeiter

1. `[verifiziert]` Der Operator teilt im Browser das Kunden-Audio der Placetel/Webex-Desktopquelle und separat sein Mikrofon.
2. `[verifiziert]` `POST /api/ops/voice-copilot/transcription-session` verlangt Ops-Session, `VOICE_LIVE_COPILOT_ENABLED`, `VOICE_COPILOT_KNOWLEDGE_ENABLED`, zwei SDP-Angebote, eine gebundene Request-ID fuer Kundenmodi und bestaetigte Einwilligung.
3. `[verifiziert]` Zwei OpenAI-Realtime-Transkriptionssessions halten Sprecher getrennt. Das Browser-UI verwaltet hoechstens die letzten 20 Turns und sendet sie begrenzt an `POST /api/ops/voice-copilot/suggestions`.
4. `[verifiziert]` Der Suggestions-Pfad laedt Sessionbindung, Request-Kontext und freigegebenes Wissen erneut, verwendet `store:false`, validiert striktes JSON und filtert Quellenbezeichnungen gegen eine serverseitige Allowlist.
5. `[verifiziert]` Ein deterministischer Guard entfernt Antworttexte mit Preisen, Rabatten, Liefer-/Produktions- oder Bestellzusagen. Der Copilot hat keine Tools und keine Side Effects.
6. `[verifiziert]` Rohtranskript und Audio bleiben im Browser beziehungsweise bei der transienten Verarbeitung; Postgres erhaelt nur Sessionstatus und Kontext-/Wissensmetadaten.

### 3. Outbound-Call-Plattform

1. `[verifiziert]` Ein inaktiver n8n-Dispatcher ruft den Runtime-Endpunkt `/dispatch` auf. Die Runtime laesst Ops atomar genau ein Target claimen.
2. `[verifiziert]` `claim_next_voice_call` serialisiert Kapazitaet ueber die Settings-Zeile, verwendet `FOR UPDATE SKIP LOCKED` und prueft Kampagne, Zeitfenster, Versuche, Consent, DNC, Allowlist/Kundenfreigabe, Modell und Prompt.
3. `[verifiziert]` Der Attempt speichert unveraenderliche Context-, Model- und Prompt-Snapshots sowie `voice-attempt:<target-id>:<attempt-number>` als Idempotenzschluessel.
4. `[verifiziert]` Die Runtime prueft den Attempt vor dem Waehlen erneut. Der Twilio-Adapter waehlt einmal und verbindet per SIP mit OpenAI; ein unsicherer Create-Ausgang wird nicht blind wiederholt.
5. `[verifiziert]` Der signierte OpenAI-Incoming-Webhook muss Attempt-ID und HMAC-Bindung tragen. Die Runtime registriert die Webhook-ID idempotent, prueft die Berechtigung erneut und akzeptiert erst dann den Call.
6. `[verifiziert]` Der Sideband-WebSocket fuehrt ausschliesslich die sieben erlaubten Tools aus, erzwingt die Erstzug-Offenlegung, steuert Stop/Handoff und finalisiert strukturierte Outcomes in Ops.
7. `[verifiziert]` Ops ist zuerst dauerhaft. Ein optionales n8n-Outcome-Mirror verwendet `voice-outcome:<attempt-id>`; sein Fehler wird als Event protokolliert und verwirft das Postgres-Ergebnis nicht.
8. `[verifiziert]` Beim Neustart laedt eine stabile Worker-ID aktive Attempts. Calls mit gueltigem `openai_call_id` werden verbunden; unklare Providerfaelle werden gestoppt/finalisiert oder fuer manuelle Reconciliation gesperrt.

## Einstiegspunkte

| Zweck | Pfad | Status |
| --- | --- | --- |
| Voice-Seite und Tabs | `src/app/ops/voice-copilot/page.tsx`, `page-client.tsx` | `[verifiziert]` |
| Globales Ops-Menue | `src/app/ops/ops-app-switcher.tsx`, `ops-page-header.tsx` | `[verifiziert]` |
| Kundenkontext | `src/lib/ops/voice-knowledge.ts`, `src/app/api/ops/voice-copilot/context/route.ts` | `[verifiziert]` |
| Wissen/Review | `src/app/api/ops/voice-copilot/knowledge/**`, `candidates/**` | `[verifiziert]` |
| Browser-Realtime | `src/app/api/ops/voice-copilot/realtime-session/route.ts` | `[verifiziert]` |
| Live-Transkription/Vorschlaege | `transcription-session/route.ts`, `suggestions/route.ts`, `live-call-copilot.tsx` | `[verifiziert]` |
| Plattform-Admin | `src/app/api/ops/voice-platform/route.ts`, `voice-platform-panel.tsx` | `[verifiziert]` |
| Call-Domain | `src/lib/ops/voice-platform-data.ts`, `voice-platform-contract.ts` | `[verifiziert]` |
| Interne Runtime-APIs | `src/app/api/internal/voice-platform/**` | `[verifiziert]` |
| Langlebige Runtime | `services/voice-runtime/**`, `Dockerfile.voice-runtime` | `[verifiziert]` |
| Call-Migration/Rollback | `supabase/migrations/20260713130606_create_voice_call_platform.sql`, passender Rollback | `[verifiziert]` |
| Wissensmigration/Rollback | `supabase/migrations/20260713105150_create_voice_copilot_knowledge.sql`, spaetere Knowledge-Hardening-Migrationen und Rollbacks | `[verifiziert]` |
| Evals | `src/lib/ops/voice-platform-evals.ts`, `scripts/run_voice_platform_*`, `artifacts/voice-evals/**` | `[verifiziert]` |
| n8n | `n8n/workflows/voice-*.json`, Manifest und Prechange-Backup | `[verifiziert]` |

## Kontextaufloesung

- `[verifiziert]` Kundenakte: Suche liefert nur Rows mit Request-ID; ein einzelner Kontext-Read verwirft jede abweichende Rueckgabe als `request_binding_mismatch`.
- `[verifiziert]` Offer: zuerst gespeicherte Offer-ID, danach kanonische Trello-Karte und requestgebundene `trello_card_aliases`, zuletzt gebundener PandaDoc-Legacy-Snapshot. Ein widersprechender Offer-Request wird auch bei Alias-Treffer abgelehnt.
- `[verifiziert]` Outlook: bevorzugt der dedizierte `outlookCommunications`-Spiegel, sonst `customer_email_messages`; optional kommt begrenzte Graph-Evidenz anhand Request, gebundener E-Mail und Angebotsnummer hinzu.
- `[verifiziert]` Wenn keine direkte E-Mail vorliegt, darf die Kundenakte bei nicht persoenlichen und nicht internen Domains Organisationsnachrichten laden. Voice kennzeichnet sie als `scope=organization` und verbietet, Aussagen dem ausgewaehlten Ansprechpartner zuzuschreiben.
- `[verifiziert]` Voice gibt maximal sechs zusammengefuehrte Outlook-Treffer und bis zu zwoelf Offer-Positionen in den Kontext. Preise, Summen und Rabatte sind nicht Teil des Voice-Offer-Typs.

## Persistenz

- Wissenssystem: `voice_knowledge_articles`, `voice_knowledge_versions`, `voice_knowledge_chunks`, `voice_knowledge_candidates`, `voice_call_sessions`.
- Call-Plattform: `voice_prompt_versions`, `voice_model_releases`, `voice_model_evaluations`, `voice_runtime_settings`, `voice_contact_consents`, `voice_do_not_call`, `voice_test_allowlist`, `voice_call_campaigns`, `voice_call_targets`, `voice_call_attempts`, `voice_call_events`, `voice_call_outcomes`, `voice_call_actions`, `voice_platform_audit_log`.
- `[verifiziert]` RLS ist aktiv; `public`, `anon` und `authenticated` werden entzogen, `service_role` erhaelt den vorgesehenen Zugriff.
- `[verifiziert]` `recording_enabled` und `transcript_storage_enabled` stehen im Plattform-Schema standardmaessig auf `false`; Voice-Session-Audit setzt Transkriptspeicherung explizit auf `false`.

## Erlaubte Sideband-Tools

`get_customer_context`, `get_offer_summary`, `get_outlook_context`, `search_approved_knowledge`, `schedule_callback`, `record_qualification`, `request_human_handoff`.

- `[verifiziert]` Lese-Tools bleiben an die Attempt-Request-ID gebunden.
- `[verifiziert]` Schreibende Tools sind ueber Attempt plus OpenAI-Tool-Call-ID idempotent.
- `[verifiziert]` Kein Tool kann Angebot, Preis, Termin, Bestellung oder E-Mail aendern beziehungsweise senden.

## Abgrenzung zu angrenzenden Systemen

- `[verifiziert]` `NEONTRIP Payment Reminder Processor v1.1` ist geschuetzt und nicht Teil dieser Plattform.
- `[verifiziert]` `/ops/customer-records/calls` und `customer-call-module.ts` verwalten menschliche Calllisten, Rueckrufe und Ergebnisse. Sie sind nicht die Outbound-Voice-Runtime.
- `[verifiziert]` Placetel/Webex ist aktuell nur die vom Mitarbeiter geteilte Desktop-Audioquelle des Live-Copiloten. Der Repository-Code enthaelt keinen direkten Placetel-Live-Media-Adapter.
- `[verifiziert]` Das Ops-Menue fuehrt `Voice Copilot`, `Angebote`, `Anrufe`, `Schildgroessen & Preise` und die weiteren Hauptmodule in einer gemeinsamen Switcher-Komponente; die zentralen Seiten binden `OpsPageHeader` ein.
