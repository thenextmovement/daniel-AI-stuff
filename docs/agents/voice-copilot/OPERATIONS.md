# Voice Copilot Operations

## Sicherer Start

```bash
codex-new-worktree ops <topic>
cd <ausgegebener-worktree>
git status --short --branch
git fetch origin main
git rebase origin/main
```

- Nie im alten Checkout `/Users/danielklesse/Desktop/neontrip-ops-coolify` arbeiten.
- Vor Aenderungen dieses Handoff, die Betriebsdokumente und das Repo-Regelwerk lesen.
- Secret-Werte weder lesen noch in Shell-Ausgaben, Screenshots, Dokumentation oder Commits uebernehmen.
- `schedule_supported=false`: Keine autonomen Control-Tower-Zeitplaene fuer Calls, Evals, Workflow-Aktivierung oder Kommunikation anlegen.

## Schnelle lokale Verifikation

```bash
npm ci
node --import tsx --test \
  tests/quotes/voice-copilot.test.ts \
  tests/quotes/voice-knowledge.test.ts \
  tests/quotes/voice-platform.test.ts \
  tests/quotes/offer-call-context.test.ts
npm run eval:voice
npm run build:voice-runtime
npx tsc --noEmit
```

- `npm run eval:voice` ist statisch und kostenfrei. `npm run eval:voice:live` ruft OpenAI auf, kann Kosten verursachen und benoetigt eine separate Freigabe.
- `tests/sql/voice-platform.integration.sql` benoetigt eine isolierte PostgreSQL-17-Testdatenbank. Niemals gegen Produktion ausfuehren.
- Vor Release mit Produktcodeaenderung zusaetzlich die breitere Quote-Suite und den normalen Build ausfuehren. Fuer eine reine Handoff-Dokumentation ist ein erneuter Vollbuild ohne Codeaenderung nicht erforderlich.

## Konfigurationsnamen

Ops/Browser:

- `OPS_OPENAI_API_KEY`, `OPENAI_API_KEY`
- `OPS_COPILOT_OPENAI_MODEL`
- `VOICE_COPILOT_KNOWLEDGE_ENABLED`
- `VOICE_LIVE_COPILOT_ENABLED`
- `VOICE_COPILOT_SUGGESTION_MODEL`
- `VOICE_COPILOT_EXTRACTION_MODEL`
- `VOICE_COPILOT_TRANSCRIPTION_MODEL`
- `VOICE_CALL_PLATFORM_ENABLED`
- `VOICE_RUNTIME_BASE_URL`, `VOICE_RUNTIME_API_TOKEN`, `VOICE_DISPATCH_TOKEN`
- `VOICE_CONSENT_INGEST_SECRET`, `VOICE_HUMAN_HANDOFF_URI`

Voice-Runtime:

- `VOICE_RUNTIME_PUBLIC_URL`, `VOICE_OPS_BASE_URL`, `VOICE_RUNTIME_WORKER_ID`
- `OPENAI_API_KEY`, `OPENAI_WEBHOOK_SECRET`, `OPENAI_PROJECT_ID`
- `VOICE_SIP_BINDING_SECRET`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- `VOICE_N8N_OUTCOME_URL`, `VOICE_N8N_WEBHOOK_TOKEN`
- `SOURCE_COMMIT`

Nur Namen dokumentieren. Werte gehoeren in den freigegebenen Secret-Store.

## Freigabematrix

| Aktion | Ohne neue explizite Freigabe | Zusaetzliche Bedingungen |
| --- | --- | --- |
| Repo/Git/Dokumentation read-only pruefen | erlaubt | Keine Secrets/PII, keine externe Mutation. |
| Lokale statische Tests und Typecheck | erlaubt | Keine Live-Eval, kein externes API-Ziel. |
| Handoff lokal committen | erlaubt im beauftragten Scope | Nur `docs/agents/voice-copilot/**`. |
| Push auf `main` | verboten | Eigene Push-Freigabe, sauberer Scope, `codex-safe-push-main`. |
| Ops-/Runtime-Deploy | verboten | Deploy-Freigabe, `codex-predeploy ops`, exakt ausgegebener Commit, Health-/Commit-Pruefung. |
| Migration oder Runtime-Flag aendern | verboten | Backup, Diff, Rollback, Change-Freigabe. |
| n8n importieren, aendern oder aktivieren | verboten | Export/Backup, semantischer Diff, Rollback, explizite Workflow-Freigabe. |
| Modell registrieren oder Sandbox-Vertrag freigeben | verboten | Offizielle API-ID/Contract-Pruefung und dokumentierter Reviewer. |
| Live-Modell-Eval | verboten | Kostenfreigabe, Testscope, keine Kundendaten, Ergebnisartefakt. |
| Interner Browser-/Live-Copilot-Test | verboten | Beteiligten-Einwilligung, Testfreigabe, Kostenfreigabe, keine Kundenkommunikation. |
| Outbound-Testcall | verboten | Exakte Allowlist-Nummer, `internal-test:<uuid>`, dokumentierte Testeinwilligung und separate Call-Freigabe unmittelbar vor dem Call. |
| Kundenanruf | verboten | Vollstaendige Gates aus [HANDOFF.md](./HANDOFF.md), Rechts-/Datenschutzfreigabe und neue operative Kundenanruf-Freigabe. |
| E-Mail/Nachricht/Angebot/Bestellung | verboten | Voice hat keinen Sendepfad; separater Parent-Agent-Prozess mit Validierung und Human Approval. |

## Diagnose

### "Wissenssystem nicht aktiviert" oder "Migration nicht live"

1. Repository-Migrationen und Rollbacks identifizieren, aber nicht blind anwenden.
2. `VOICE_COPILOT_KNOWLEDGE_ENABLED` nur als Namen/Zustand pruefen; keinen Wert ausgeben.
3. Ein ausgeschaltetes Flag ist von einer fehlenden Tabelle/RPC zu unterscheiden. Die UI zeigt `feature_flag_disabled`, `storage_unavailable` oder einen Ladefehler getrennt.
4. Aktivierungsreihenfolge: Migration reviewen/anwenden, RLS/RPC als `service_role` testen, dann Flag freigeben und eine interne Draft-/Review-/Retrieval-Pruefung ausfuehren.
5. Rollback zuerst ueber Flag; das SQL-Rollback loescht Wissensdaten und braucht Backup plus Datenaufbewahrungsentscheidung.

### `openai_not_configured`

1. Nur pruefen, ob `OPS_OPENAI_API_KEY` oder `OPENAI_API_KEY` im korrekten Ops-Service gesetzt ist; Wert nie anzeigen.
2. Fuer Vorschlaege/Post-Call muss zusaetzlich ein erlaubtes Responses-Modell konfiguriert sein.
3. Runtime und Ops sind getrennte Services. Ein Ops-Key beweist nicht, dass `OPENAI_WEBHOOK_SECRET`, `OPENAI_PROJECT_ID` und Runtime-Key vorhanden sind.
4. Nach freigegebener Konfigurationsaenderung den jeweiligen Health-/UI-Pfad pruefen; keinen Call als Healthcheck verwenden.

### Angebot `nicht verknuepft` oder `nicht erreichbar`

1. Exakte Request-ID und Kundenakte pruefen.
2. Gespeicherte Offer-ID, kanonische Trello-Karte und requestgebundene `trello_card_aliases` read-only vergleichen.
3. Konfligierende Offer-Request-ID nicht ueberschreiben. `unavailable` bedeutet Provider/Binding-Fehler; `not_linked` bedeutet kein belastbarer Link.
4. Legacy-PandaDoc ist nur letzter gebundener Fallback. Keine Namens- oder Firmenaehnlichkeit fuer Offer-Bindung verwenden.

### Outlook `0` oder `nicht erreichbar`

1. `sourceStatus.outlook` unterscheiden: `empty` ist ein erfolgreicher leerer Lookup, `unavailable` ein Integrationsfehler.
2. Dedizierten `customer_email_messages`-Spiegel und optional Graph read-only anhand Request, exakter E-Mail und Offer-Nummer pruefen.
3. Nur wenn direkte Nachrichten fehlen, kann die Kundenakte eine nicht persoenliche Organisationsdomain verwenden. Solche Treffer muessen `organization` bleiben und duerfen nicht dem Kontakt zugeschrieben werden.
4. n8n-Sync/Backfill ist eine externe Mutation und darf nur mit eigener Freigabe, Backup und idempotentem Backfill-Plan erfolgen.

### Live-Copilot hat kein Kunden-Audio

1. In Chrome den richtigen Tab/das richtige Fenster beziehungsweise den gesamten Bildschirm mit aktiviertem Systemaudio teilen.
2. Headset verwenden, um Echo und doppelte Kundenspur zu vermeiden.
3. Pruefen, ob der geteilte Stream eine Audio-Track liefert; ohne Track muss der Start fehlschlagen.
4. Placetel stellt in diesem Repository keinen direkten Live-Media-Stream bereit. Die Browserfreigabe ist die aktuelle Bruecke.

### Runtime meldet `ready:false`

1. `/health` darf nur fehlende Variablennamen zeigen, keine Werte.
2. `providers.openAi`, `providers.telephony` und `missing` auswerten.
3. Keine Dispatch-Freigabe, bis `ready:true` und der `SOURCE_COMMIT` dem freigegebenen Runtime-Commit entspricht.
4. Health ist kein Beleg fuer Modellfreigabe, Consent, Kampagne oder einen erfolgreichen Call.

### Unsicherer oder haengender Provider-Call

1. Globalen beziehungsweise kampagnen-/modellbezogenen Kill Switch setzen, sofern dafuer Incident-Freigabe besteht.
2. Providerdatensatz read-only pruefen. Twilio-Create niemals blind wiederholen.
3. In Ops nur `confirmed_no_call` requeueen, wenn der Provider sicher belegt, dass kein Call erfolgte; sonst `close_without_retry`.
4. Stop/Handoff-Fehler und strukturierte Events sichern. Keine Rohtranskription als Incident-Abkuerzung aktivieren.

## n8n-Aenderungsablauf

1. Aktiven Workflow exportieren und unveraendert als datierten Backup-Nachweis sichern.
2. Secret-Werte entfernen beziehungsweise nur Credential-Referenzen behalten.
3. Strukturellen und semantischen Diff erstellen: Trigger, Auth, Ziel-URLs, Idempotenz, Error-Workflow, Retry und Aktivstatus.
4. Rollback vor der Mutation festlegen und den geschuetzten Payment-Reminder explizit als unveraendert pruefen.
5. Erst nach Freigabe importieren/aendern; standardmaessig inaktiv lassen.
6. Aktivierung benoetigt eine weitere ausdrueckliche Freigabe und einen begrenzten internen Test.

## Rollback und Incident-Reihenfolge

1. Neue Claims stoppen: `global_enabled=false`; bei isoliertem Fehler Kampagne pausieren oder Modell sperren.
2. Aktive Calls ueber Stop/Handoff beenden und Providerstatus pruefen.
3. Kundenanrufschalter aus lassen; bei Rueckkehr zuerst ausschliesslich interne Allowlist-Tests.
4. Modell ueber den auditierten Rollback-RPC wechseln; ein deaktiviertes, ungeprueftes oder prompt-unvollstaendiges Release ist nicht zulaessig.
5. Code nur als gezielten Revert in neuem Worktree zurueckrollen; danach Tests, freigegebener Push und `codex-predeploy ops`.
6. Datenbank-Rollbacks koennen Daten loeschen. Nur nach Backup, Impact-Pruefung und ausdruecklicher DB-Freigabe anwenden.
7. Bereits erfolgte Calls oder Kommunikation sind nicht durch Code-Rollback rueckgaengig und brauchen einen separaten, protokollierten Korrekturprozess.
