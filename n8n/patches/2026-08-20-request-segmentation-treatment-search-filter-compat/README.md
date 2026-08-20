# NEONTRIP Request Segmenter – Search-Filter-Kompatibilitätsrepair

Status: lokal vorbereitet, getestet und mit n8n `validateOnly` geprüft. Noch
nicht live angewandt.

## Ursache und kleinste Korrektur

Der erste natürliche Treatment-Pilotlauf `5241957` erreichte am
`2026-08-20T19:57:32Z` exakt einen Gold-Job und scheiterte im
`Treatment Domain Research`-Node mit HTTP 400:

`Parameter 'filters' not supported with model 'gpt-4o-mini-2024-07-18'`.

Der Workflow wurde vor dem nächsten Scheduler-Tick exakt auf v3
zurückpubliziert. Der Job blieb entsperrt und retrybar; es entstand keine
Klassifikation, kein Cache- oder Master-Write und keine Kundenaktion.

Der Repair entfernt ausschließlich das nicht unterstützte
`tools[0].filters.allowed_domains` aus dem Stage-1-Responses-Request. Alle
fachlichen und sicherheitsrelevanten Grenzen bleiben erhalten:

- Suchinput weiterhin exakt
  `site:<email-domain> Unternehmen Leistungen Kundenprojekte Standorte Impressum`;
- keine Suche bei Freemail oder Shared Providern;
- kein Firmenname, Personenname, Request-ID oder vollständiger Anfrageinhalt
  im Suchinput;
- Parser akzeptiert Evidence nur von der bereits normalisierten exakten Domain
  oder einer echten Subdomain;
- jede auswärtige, fehlerhafte oder nicht zuordenbare Source beendet den
  technischen Pfad fail-closed;
- Standardfälle dürfen weiterhin minimierte Request-Evidence verwenden;
- besondere Behandlung benötigt weiterhin passend gebundene Web-Evidence;
- Versionen, Modelle, Prompt, Schema, Credentials, Record-RPC, Verbindungen,
  Policy/Gate und alle Kundenaktionssperren bleiben unverändert.

Der OpenAI-Parameter `filters` ist laut API-Schema optional. Der konkrete
Snapshot lehnt ihn in der beobachteten Produktion jedoch ab; deshalb bleibt
die Domainbegrenzung deterministisch in Query und Parser statt im
providerseitigen Optionalfeld.

## Gepinnter Live-Prestate

Read-only gesichert am `2026-08-20T20:02:10.499Z`:

- Workflow `ELpwCfdWOCRZ22gy`
- Draft/Active `22463d9f-e467-45a7-b16e-5892cbbdae31`
- Counter `130`, aktiv und nicht archiviert
- `20` Nodes / `17` Connection-Quellen
- Graph SHA-256
  `4b5a7c2187a05f5c39f62968efeed983e1011ac670b924a15bf7ae9d8f852485`
- Draft-Datei
  `42fb6679e04a6c9d69e7b139c025c5425296154ee7b9ab28906f5e743571eb53`
- Active-Datei
  `35518946e6f71fcae234bd5d7b10c8485a76706cd70fae72f4eb06aa070b974c`

## Artefakte und Prüfung

- Forward 9 atomare Operationen:
  `ef1bee72b421903438f8e118a21946fd4aeb61d212868b2b9b19bd32cdb47e5c`
- Reverse 9 Gegenoperationen:
  `7f662a4326e0d803181a247149fb1d3b6dc01d8a4e3c4f46430e1288e13b4010`
- Candidate-Graph `23/20`:
  `288f0d3f1a80dd86000eef0eb26269a64509965016402cf5071e79ece2dd79a5`
- Source:
  `52057590ddf9eb6c6ce140692ec943c48e44942e00d6129617d3a4f0d1c7f241`
- Test:
  `021a59763cb9dcc445d29beeb2c388d0bf60fc1b0b1da7f297fb17f3b78e7ae2`
- Generator:
  `bca21c59197db3e3d39a0174ff907ab820b95ec18e5203e90fa63268657e9818`
- Fokus: `14/14`
- n8n `validateOnly`: Forward `9/9`, Roundtrip `18/18`,
  `applied=false`
- anschließender Live-Readback weiter exakt v3, Counter 130, `20/17`

## Gehaltener Lauf

1. Exakten v3-Prestate, natürlichen Claim0 und DB-Lane erneut lesen.
2. Exakten Forward unmittelbar nach einem natürlichen Tick anwenden und
   vollständigen Draft/Active-Readback prüfen.
3. Höchstens einen natürlichen v6-Claim zulassen.
4. Beim ersten technischen oder Vertragsfehler vor dem Folgetick exakt
   reversen.
5. Nach einem sauberen terminalen Fall nur weitere natürliche Einzelfälle
   zulassen; spätestens bei leerer Lane exakt reversen.
6. Abschließend v3-Claim0, Jobs/Klassifikationen, Master-Hash, Cache,
   Projection und Kundenaktionsgates read-only belegen.

Keine manuelle Ausführung, kein manueller Claim, Retry oder Reset.
