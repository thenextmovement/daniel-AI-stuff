# E-Mail-Agent: Goldtest und Rollout-Gate

Die Datenbank ist die Source of Truth für den 50-Fälle-Referenztest und die
Produktionsstufe. Der Goldsatz speichert nur IDs, Hashes, Reason Codes, Risk Flags
und Referenzentscheidungen; Kundentexte werden nicht kopiert.

## Zwei unabhängige Gates

1. Der Entscheidungstest prüft `draft`, `no_reply` und `human_review`. Ein einziges
   gefährliches `no_reply` blockiert den Rollout.
2. Das Entwurfs-Gate wertet ausschließlich gesendete Vergleiche der aktuellen
   Facts-Package-Version aus. Mindestens 30 Vergleiche sind Pflicht.

## Produktionsstufen

- `shadow`: nur messen.
- `review_only`: Outlook-Entwürfe mit verpflichtender menschlicher Prüfung.
- `routing_gate`: darf nur nach bestandenem Entscheidungs- und Entwurfs-Gate
  aktiviert werden; weiterhin keine automatische Sendung.

Der Datenbank-Constraint setzt `automatic_send_allowed = false` und
`human_send_approval_required = true`. Diese Sperren können nicht über den
Rollout-Schalter gelockert werden.

Als sichere `no_reply`-Referenz gelten ausschließlich überprüfbare automatische
Benachrichtigungen, reine Bestätigungen, abgeschlossene Konversationen oder Spam.
`internal_or_duplicate` ist ausdrücklich ausgeschlossen, weil ein technischer
NEONTRIP-Absender auch eine weitergeleitete WhatsApp- oder Chatnachricht sein kann.

## Test

```bash
createdb email_gold_evaluation_test
psql -v ON_ERROR_STOP=1 -d email_gold_evaluation_test \
  -f tests/sql/email-gold-evaluation-base.sql \
  -f supabase/migrations/20260717111500_email_agent_gold_evaluation_and_rollout_gate.sql \
  -f tests/sql/email-gold-evaluation.test.sql
psql -v ON_ERROR_STOP=1 -d email_gold_evaluation_test \
  -f supabase/rollbacks/20260717111500_email_agent_gold_evaluation_and_rollout_gate_rollback.sql
dropdb email_gold_evaluation_test
```

## Rollback

Die Anwendung kann unabhängig von den Tabellen wieder auf die vorherige Version
zurückgerollt werden. Die SQL-Rollback-Datei entfernt das Evaluationssystem. Die
produktive Draft-Erstellung bleibt dabei unverändert; automatische Sendungen gibt
es nicht.
