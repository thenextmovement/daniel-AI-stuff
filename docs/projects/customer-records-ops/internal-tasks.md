# Interne Aufgaben

Stand: 2026-06-02

## Zweck

Das Aufgabenmodul ist die interne Arbeitsliste fuer NEONTRIP Ops. Es ist fuer Aufgaben gedacht, die nicht direkt ein Sales-Call-Ergebnis sind:

- Problemfaelle klaeren
- Produkte oder Material nachbestellen
- Angebot/Design intern nachziehen
- Kundenfall einem Mitarbeiter zuweisen
- administrative Team-Aufgaben mit Deadline festhalten

Trello bleibt Projektion. Die Aufgaben werden serverseitig ueber die Ops-App geschrieben.

## Oberflaechen

- `/ops/tasks`: eigenes Aufgabenboard mit Spalten Offen, In Arbeit, Wartet, Erledigt.
- `/ops/customer-records/calls`: zeigt oben einen kompakten Block "Interne Aufgaben" mit den wichtigsten offenen Aufgaben.
- Der App-Switcher enthaelt jetzt Customer Records, Call-Zentrale und Aufgaben.

## Datenmodell

Primaere Tabelle, wenn Migration angewendet ist:

- `public.ops_internal_tasks`

Wichtige Felder:

- `title`, `description`
- `status`: `open`, `in_progress`, `waiting`, `done`, `archived`
- `priority`: `low`, `normal`, `high`, `urgent`
- `category`: `customer`, `call`, `problem`, `product_restock`, `offer`, `admin`, `other`
- `assignee_label`
- `due_at`
- optionale Verknuepfungen: `request_id`, `customer_name`, `customer_email`, `trello_card_id`
- Auditfelder: `created_by`, `updated_by`, `completed_by`, `completed_at`

## Fallback

Die Supabase-Migration konnte am 2026-06-02 nicht ueber das MCP angewendet werden, weil die Verbindung DDL nur read-only erlaubt hat.

Damit das Modul trotzdem produktiv nutzbar ist, verwendet der Code automatisch einen Fallback auf die bestehende Tabelle:

- `public.sales_tasks`
- nur Rows mit `source = 'ops_internal'`
- interne Zusatzfelder liegen in `payload`

Sobald `ops_internal_tasks` in Supabase existiert, nutzt die App automatisch die neue Tabelle. Der Fallback bleibt nur als Uebergangspfad.

## API

- `GET /api/ops/tasks`
- `POST /api/ops/tasks`
- `PATCH /api/ops/tasks/[taskId]`

Alle Routen nutzen denselben Ops-Zugang wie Customer Records und Calls. Es gibt keine direkten Trello-Writes und keine Mail-/n8n-Side-Effects.

## Betrieb

Normale Nutzung:

1. In `/ops/tasks` Aufgabe erfassen.
2. Kategorie, Prioritaet, Zuständigen und Deadline setzen.
3. Optional Request-ID oder Kundennamen eintragen.
4. Aufgaben in den Status `In Arbeit`, `Wartet` oder `Erledigt` schieben.

In der Call-Zentrale werden offene interne Aufgaben nur als Sichtbarkeit angezeigt. Sie veraendern nicht die Sales-Call-Cadence.

## Migration

Migration:

```text
supabase/migrations/202606020001_create_ops_internal_tasks.sql
```

Wenn Supabase wieder DDL-Zugriff erlaubt, diese Migration auf dem Ops-Projekt anwenden. Danach optional die Fallback-Rows mit `source = 'ops_internal'` aus `sales_tasks` in `ops_internal_tasks` migrieren.

## Rollback

Code-Rollback:

- Commit mit Aufgabenmodul revertieren.

DB-Rollback, falls die neue Tabelle schon existiert:

```sql
drop table if exists public.ops_internal_tasks;
```

Wenn nur der Fallback genutzt wurde, gibt es keine neue Tabelle. Fallback-Aufgaben koennen gezielt entfernt werden mit:

```sql
delete from public.sales_tasks where source = 'ops_internal';
```

Nur nach vorherigem Export/Backup ausfuehren.
