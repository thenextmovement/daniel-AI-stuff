# Company Brain Verification

## Verifizierter Stand

- Repository: `neontrip-ops`
- Branch waehrend der Pruefung: `codex/handoff-company-brain-20260721-201459`
- Basis: `origin/main`
- Letzter verifizierter Code-Commit: `a063f216692e97639da36492d9e025f7615665fe`
- Zeitpunkt: `2026-07-21T20:24:42+02:00`
- Scope: read-only Code-/Git-Pruefung, lokale fokussierte Tests und Typecheck; keine Live-Mutation

## Gepruefte Artefakte

- Company-Brain-UI und Governance-UI
- Resolve-, Action-, Incident-, Decision-, Identity- und Foundation-Routen
- Resolver, AI-Brief, Audit-Normalisierung, Identity, Action Governance und Operational Intelligence
- Company-Brain-Foundation-, Decision-, Governance-, Incident-, Reconciliation- und Closed-Loop-Migrationen samt Rollbacks
- relevante Betriebsdokumente und Git-Historie bis `origin/main`
- uebergebener Chatverlauf mit den historischen Trello-/Offer-/Outlook-/n8n-Anforderungen

## Ausgefuehrte Pruefungen

### Worktree und Git

```bash
git fetch origin
git rebase origin/main
git status --short --branch
git log -5 --oneline --decorate
```

Ergebnis: `[verifiziert]` sauber auf `origin/main` bei `a063f216692e97639da36492d9e025f7615665fe` vor finaler Verifikation des Dokumentpakets.

### Dependencies

```bash
npm ci --ignore-scripts
```

Ergebnis: `[verifiziert]` 390 Pakete reproduzierbar aus dem Lockfile installiert; npm meldete `0 vulnerabilities`. Es wurde kein automatisches `npm audit fix` ausgefuehrt und kein Lockfile durch diese Uebergabe veraendert.

Der allererste Testaufruf vor `npm ci` scheiterte ausschliesslich an fehlendem lokalem Paket `tsx`. Nach reproduzierbarer Installation lief derselbe fachliche Testscope gruen.

### Fokussierte Tests

```bash
node --import tsx --test \
  tests/quotes/company-brain.test.ts \
  tests/quotes/company-brain-routes.test.ts \
  tests/quotes/company-brain-governance.test.ts \
  tests/quotes/company-brain-operational-intelligence.test.ts \
  tests/quotes/company-brain-foundation.test.ts \
  tests/quotes/workflow-audit.test.ts \
  tests/quotes/workflow-audit-route.test.ts
```

Ergebnis: `[verifiziert]` 143 Tests, 143 bestanden, 0 fehlgeschlagen.

Abgedeckte Schwerpunkte:

- konkrete Automationsursachen wie ungueltige E-Mail, Send-Guard, Graph-Auth, Offer-API, Source Mapping, Asset-/Preview-/Video-QC und harte Workflowfehler;
- spaeterer Versandbeleg, Bounce-Prioritaet, Retry-Erschoepfung und stale Trello-Projektion;
- kopierte Karten/Aliasgruppen, Konflikt-Review und manuelle Alias-Reparatur;
- genau ein governed Medien-Queue-Job, Block bei aktivem Job und kein Direktversand;
- Frozen Action Input, Idempotenz, Vier-Augen-Regel und private API-Fehler;
- eventgetriebene Attempts/Incidents, reversible Migrationen, Rollen und beleggebundene KI-Kurzfassung;
- Workflow-Audit v2, Legacy-Toleranz, stabile Event-Keys und interne Bearer-Auth.

Die im Test absichtlich simulierte Meldung `company brain trello projection changed but audit confirmation failed` gehoert zu einem gruennen Testfall: Er belegt, dass eine bereits erfolgte Trello-Aenderung nicht durch blindes Wiederholen dupliziert wird, wenn nur der nachgelagerte Audit ausfaellt.

### TypeScript

```bash
npx tsc --noEmit
```

Ergebnis: `[verifiziert]` Exit 0.

### CI/Build

```bash
gh run list --commit a063f21 --limit 10 --json ...
```

Ergebnis: `[nicht live verifiziert]` Fuer den aktuellen Commit wurde kein GitHub-Actions-Lauf zurueckgegeben. Ein lokaler Full Build wurde gemaess Auftrag nicht unnoetig gestartet; diese Uebergabe veraendert nur Dokumentation. Vor einer spaeteren Produktfreigabe gelten Full Suite, Voice Build, Next Build und UI-Smokes aus [OPERATIONS.md](OPERATIONS.md).

## Befundmatrix

| Aussage | Status | Nachweis |
| --- | --- | --- |
| Erste UI-Ebene priorisiert Ursache und Aktion | `[verifiziert]` | `page-client.tsx` zeigt `Ursache und naechster Schritt`, primaere Aktion und Nicht-tun-Regel vor den Details. |
| Trello ist keine Source of Truth | `[verifiziert]` | Code, Operations-Dokumente, Project Rules und Tests. |
| Kopierte Karten koennen ueber harte Aliase korreliert werden | `[verifiziert]` | Identity-/Alias-Code und Tests; keine automatische E-Mail-Zusammenfuehrung. |
| Exakte Fehlerursachen werden klassifiziert | `[verifiziert]` | 143er Testscope und Root-Cause-/Audit-Code. |
| Medien-Recovery sendet nicht direkt | `[verifiziert]` | Action-Route enqueued genau einen Job; Route-Test bestaetigt dies. |
| Recovery braucht vier Augen | `[verifiziert]` | Policy `critical`, `requires_four_eyes = true`, Approval-Tests. |
| Stale Scanner startet keinen Retry | `[verifiziert]` | Closed-Loop-Migration und Governance-Test. |
| Spaeterer Erfolg kann Incident schliessen | `[verifiziert]` | Reconcile-Migrationen und Diagnose-/Route-Tests. |
| Aktive produktive n8n-/Supabase-/Coolify-/Graph-Version stimmt mit Repo ueberein | `[nicht live verifiziert]` | Kein externer Live-Zugriff in dieser Wissensmigration. |
| Echte Queue-zu-Mail-Recovery funktioniert heute Ende-zu-Ende | `[nicht live verifiziert]` | Kein freigegebener interner E2E-Test in diesem Scope. |

## Nicht ausgefuehrt

- kein Deploy und kein Push;
- keine Supabase-Migration oder Datenabfrage;
- keine n8n-Aktivierung, Execution oder Workflow-Aenderung;
- kein Coolify-Redeploy und keine Runtime-Env-Aenderung;
- keine Outlook-/Graph-Mailabfrage und keine Kundenkommunikation;
- keine Trello-Mutation und kein echter Recovery-Job;
- kein kostenpflichtiger Modell- oder Providerlauf;
- kein Lesen oder Dokumentieren von Secret-Werten.

## Dokumentpaket-Validierung

Ausgefuehrt vor dem Commit:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("docs/agents/company-brain/agent.json", "utf8"))'
find docs/agents/company-brain -maxdepth 1 -type f | sort
git diff --check
git status --short
```

Ergebnis: `[verifiziert]` exakt sieben beauftragte Dateien, gueltiges JSON mit allen Pflichtfeldern, gueltige relative Markdown-Links, keine Whitespace-Fehler und keine Aenderung ausserhalb `docs/agents/company-brain/`.
