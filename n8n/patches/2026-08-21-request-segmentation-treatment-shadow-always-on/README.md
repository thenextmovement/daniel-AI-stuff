# NEONTRIP Kundeneinordnung – dauerhafter Shadow-Betrieb

Status: lokal vorbereitet, in echtem Postgres innerhalb vollstaendig
zurueckgerollter Transaktionen kompiliert und mit n8n `validateOnly` geprueft.
Noch nicht produktiv angewandt.

## Ziel

Der bestehende Request-Segmenter soll dauerhaft neue Anfragen einordnen, ohne
schon Kundenaktionen auszuloesen:

- Firmen-Maildomain: ausschliesslich die Domain mit
  `site:<domain> Unternehmen Leistungen Kundenprojekte Standorte Impressum`
  recherchieren und die zur Domain gehoerende Website auswerten.
- Freemail/Shared Provider: keine Provider-Suche. Eindeutige geschaeftliche
  Nutzung aus Titel, Beschreibung oder Anwendung als normalen Business-Fall
  behandeln; ohne Business-Signal als privaten Standardfall einordnen.
- `special` nur fuer positiv belegte oeffentliche/institutionelle, Multi-Site-,
  Enterprise- oder grosse Organisationen. Alles andere ist `standard`.
- Ergebnis nur als versionierte Shadow-Klassifikation speichern. Keine
  Aenderung an `master_requests`, Research-Cache, Trello, Angebot, Preis,
  Reminder, E-Mail, WhatsApp oder einer anderen Kundenaktion.

## Vertrag

```text
taxonomy_version  = nt_taxonomy_v2_20260819_cx8
classifier        = segment_classifier_v7_20260821_treatment_shadow
prompt            = segment_prompt_v7_20260821_treatment_shadow
policy            = nt_policy_v6_20260821_treatment_shadow
quality_gate       = nt_quality_gate_v6_20260821_treatment_shadow
research          = segment_research_v2_20260820_domain_filter
treatment          = treatment_focus_v2_20260821_always_on
validator          = n8n_cx8_validator_v4
worker             = n8n-request-segmenter-v7-treatment-shadow
```

Die Policy bleibt `mode=shadow`. Alle acht Regeln bleiben inert:
`automation_enabled=false`, kein Preisfaktor, keine Follow-up-, Call- oder
E-Mail-Sequenz.

## Gepinnter Prestate

- Workflow `ELpwCfdWOCRZ22gy`
- Draft/Active `d42befa7-f6fc-4201-8516-c71c01cf5e17`
- Counter `136`, aktiv und nicht archiviert
- `20` Nodes / `17` Connection-Quellen
- Graph SHA-256
  `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`
- Draft-Datei
  `eaa4510079552bcd80917b8b8b5f0f13a390d13d4909a590d00d81017e0f483a`
- Active-Datei
  `1195d3281f88969140585e7881342bfadd14e2a60f3e63e2870ed3400336d3a3`

## Gepruefte Artefakte

- Forward: `9` atomare Operationen,
  `c8f9465ec5ab55dea36c44b8206919177223164b756b12157e07de70f5320320`
- Reverse: `9` Gegenoperationen,
  `81c433a73cff2b6bd63203b8f98adbfaa4a0acff87a3722108560f3a337148a0`
- Candidate: `23` Nodes / `20` Connection-Quellen, Graph
  `d877f92fdc67bee468998b36e79499aa18235fbabbb25418233ca3b02a1010fe`
- Fokuspruefungen: `23/23`
- Offline-n8n: gueltig, `0` Fehler, `23` gueltige Verbindungen und `11`
  unveraenderte Bestandswarnungen
- n8n `validateOnly`: Forward `9/9`, Roundtrip `18/18`; danach weiterhin
  Draft=Active auf Counter `136`
- Base, Held, operativer Rollback sowie voller Pre-Runtime-Rollback wurden in
  echtem Postgres kompiliert und jeweils innerhalb derselben Transaktion
  vollstaendig zurueckgerollt. Der Produktivzustand blieb dabei unveraendert.

## Rollout

1. Base-Migration anwenden. Sie legt Policy/Gate/Rules inaktiv an, installiert
   die minimierte Payload-RPC und erweitert nur die exakte Record-Allowlist.
2. Repo-Gates, Commit, `codex-predeploy ops`, Safe-Push und exakten
   Produktions-Health-Commit abwarten.
3. Unmittelbar vor n8n-Write den kompletten Draft/Active-v3-Prestate und einen
   natuerlichen leeren v3-Claim erneut belegen.
4. Exakten Forward anwenden. Vollstaendigen Draft/Active-Graph pruefen. Solange
   die Kandidaten-Policy noch inaktiv ist, muss der naechste natuerliche
   v7-Claim leer sein.
5. Erst dann den separaten Held-Flip anwenden. Der v7-Graph bleibt ab diesem
   Zeitpunkt dauerhaft aktiv und verarbeitet nur natuerliche neue Anfragen.
6. Einen natuerlichen Lauf oder, falls noch keine Anfrage eingegangen ist,
   Scheduler, aktive Policy und alle gesperrten Seiteneffekte read-only
   nachweisen. Kein manueller Run, Claim, Retry, Reset oder Backfill.

## Rollback

- Vor erster v7-Runtime darf der volle Pre-Runtime-Rollback den Kandidaten und
  die Payload-RPC entfernen sowie den exakten alten Record-Body wiederherstellen.
- Nach erster v7-Runtime ausschliesslich nicht-destruktiv: erst
  `v7 processing=0`, dann operativer DB-Rollback auf v2, danach leerer exakter
  v7-Claim, anschliessend der gepinnte n8n-Reverse und ein natuerlicher leerer
  v3-Claim. Jobs und Klassifikationen bleiben Audit-Historie.
- Jeder Drift bei Policy, Gate, Versionen, Regeln, Locks oder Funktionshash
  bricht die SQL-Artefakte fail-closed ab.
