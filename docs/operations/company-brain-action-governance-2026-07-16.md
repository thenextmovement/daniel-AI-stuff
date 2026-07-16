# Company Brain Action Governance

Stand: 2026-07-16

## Ziel

Das Company Brain darf operative Probleme erklären und risikoarme interne Aktionen direkt ausführen. Kundendatenänderungen und Kundenkontakt brauchen dagegen einen unveränderlichen Auftrag, eine zweite berechtigte Person und eine erneute deterministische Prüfung direkt vor dem Side Effect.

## Rollen

- `viewer`: Fälle und Governance lesen.
- `operator`: Fälle bearbeiten, interne Notizen und Aufgaben anlegen, sichere Projektionen reparieren.
- `approver`: Zusätzlich sensible Action-Runs und Identitätskonflikte freigeben.
- `automation_admin`: Zusätzlich das n8n-Inventar synchronisieren.
- `company_admin`: Enthält alle Rollen.

Verifizierte Cloudflare-Access-Nutzer erhalten standardmäßig nur `operator`. `approver`, `automation_admin` und `company_admin` werden ausschließlich über `company_brain_actor_roles` vergeben. Der initiale Governance-Owner ist `daniel@neontrip.de`.

## Vier-Augen-Ablauf

1. Ein Operator löst `correct_customer_email` oder `guarded_offer_resend` aus.
2. Der Server entfernt clientseitige Actor-Felder, normalisiert den Payload, bildet einen Hash und speichert einen idempotenten Action-Run mit Status `awaiting_approval`.
3. Eine andere Person mit `approver` oder `company_admin` prüft den eingefrorenen Auftrag unter `/ops/company-brain/governance`.
4. Postgres sperrt den Auftrag und übernimmt Freigabe plus Claim atomar. Dieselbe Person und parallele Freigaben werden abgewiesen.
5. Die bestehende deterministische Action-Logik prüft Empfänger, Angebot, Request, Trello-Alias, Duplicate-Belege und Bounces erneut.
6. Ergebnis und Verifikation werden im Action-Run gespeichert. Ein Auditfehler nach erfolgreichem Side Effect wird separat gemeldet und darf den fachlichen Erfolg nicht verdecken.

## Kanonische Fallidentität

Der kanonische Schlüssel ist `request:<request_id>`. Automatisch verknüpft werden nur harte Identifier:

- Request-ID
- Trello Card-ID oder Shortlink
- Offer-ID und Angebotsnummer
- n8n Execution-ID
- Shopify Order-ID

E-Mail und Name werden nicht als automatische Merge-Schlüssel verwendet. Mehrere Request-IDs oder ein Alias, der bereits auf einen anderen Fall zeigt, erzeugen einen Eintrag in `company_identity_review_queue`. Eine bestätigte Alias-Umschreibung prüft den eingefrorenen Vorher-Zustand und schreibt einen Resolution-Audit.

## Rollback

Die Migration besitzt ein vollständiges Rollback unter:

`supabase/rollbacks/20260716133401_company_brain_action_governance_identity_review_rollback.sql`

Ein App-Rollback entfernt die UI und API-Nutzung. Ein Datenbank-Rollback darf erst erfolgen, wenn keine App-Version mehr auf die neuen Tabellen oder die Funktion `approve_company_brain_action_run` zugreift.

## Bekannte nächste Ausbaustufen

- Festhängende Action-Runs automatisch erkennen und eskalieren.
- Rollenverwaltung mit eigener Admin-Oberfläche und Ablaufdatum.
- Verifikations-Worker für asynchrone Zustellbelege.
- Evaluationsfälle für falsche Alias-Merges, Replay und parallele Freigaben erweitern.
