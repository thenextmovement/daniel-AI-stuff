# NEONTRIP Landingpage-Pilot: Hero, Intent-Routing und Lead-Enrichment

Stand: 14. Juli 2026
Status: lokal implementiert und geprüft; n8n-Enrichment inaktiv; nicht veröffentlicht; keine Google-Ads-Änderung

## Ergebnis

Der neue Foto-/Upload-Hero ist als wiederverwendbares Intent-System für drei Routen aufgebaut:

| Route | Intent-ID | Variante | Standardkontext |
|---|---|---|---|
| `/logo/` | `logo_ci` | `photo_upload_v3` | offen |
| `/firmenlogo-beleuchtet/` | `company_logo_ci` | `photo_upload_company_logo_v1` | Büro, Empfang oder Innenwand |
| `/firmenschilder/` | `firm_sign_outdoor` | `photo_upload_firm_sign_v1` | Fassade oder Außenbereich |

Jede Route hat eigene Metadaten, Texte, DKI-Allowlist, Formularquelle, Analytics-Kategorie, FAQs und strukturierte Daten. Ungeprüfte Query-Parameter werden nicht als HTML ausgegeben. Die drei finalen Bildsequenzen `Logo/Entwurf → 3D-Visualisierung → reales Schild` werden erst mit den vom Auftraggeber gelieferten Assets pro Intent ersetzt.

## Hero und Funnel

- Mobile Navigation entspricht der veröffentlichten Grundstruktur und hat 44 × 44 px Touch-Ziel, Fokusführung, Escape-Schließen, Scroll-Lock und zugängliche Zustände.
- Announcement-Bar und Kundenlogos laufen mit zwei gleich breiten Gruppen linear und unendlich; bei `prefers-reduced-motion` werden Bewegungen abgeschaltet.
- Das Formular bleibt im ersten Viewport der visuelle Schwerpunkt und hat einen animierten Leuchtstreifen.
- Auf Mobile sind H1 und Subline vor den drei Prozessbildern sichtbar; das Formular folgt unmittelbar danach.
- Der primäre Submit enthält nur Logo/Entwurf, Kontaktdaten, gewünschte Umsetzung, Größe und Wünsche.
- Erst nach angenommener Anfrage erscheinen optionale Zusatzfragen mit fünf Minuten Zeit:
  - Anfrage für eigenes Unternehmen, Kundenprojekt, Verein/Organisation oder privat
  - konkreter Einsatzort als Grundlage für das KI-Mockup
  - exakt eine von zwei Prioritäten: `Möglichst genaue Umsetzung unserer Marke/CI` oder `Möglichst günstiger Preis`
  - konkretes Mockup-Setting und optionale Referenz-URL
- Nach Erfolg scrollt die Bestätigung vollständig unter den festen Header; die Überschrift wird nicht mehr verdeckt.
- Überspringen, Timeout und `pagehide` werden idempotent als Status übertragen; ein bereits gespeicherter `completed`-Status kann nicht durch ein späteres Abbruchsignal zurückgestuft werden.

## Tracking-Vertrag

Primäre Conversion:

- `lead_accepted` wird genau einmal nach erfolgreicher Annahme von `/api/c` ausgelöst.
- Parameter: stabile `lead_id`, `asset_status`, Intent und LP-Variante aus dem zentralen Tracking-Kontext.
- Optionale Antworten, Freitext und Kontaktdaten werden nicht als Analytics-Parameter gesendet.

Enrichment-Ereignisse:

- `qualification_viewed`
- `qualification_submitted`
- `qualification_skipped`
- `qualification_timed_out`
- `qualification_submit_failed`

Attribution:

- `gclid`, `gbraid`, `wbraid`, UTMs, erste Landingpage, aktuelle URL und Referrer bleiben als versteckte Formularfelder erhalten.
- Der Ads-Suffix ist dokumentiert als `kw={keyword}&utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}&device={device}&matchtype={matchtype}&network={network}&lp_intent={_intent}&lp_variant={_lpvariant}`.
- DKI verwendet ausschließlich `kw` gegen eine kuratierte Allowlist. Unbekannte oder HTML-haltige Werte fallen auf den statischen H1 zurück.

## Backend und Idempotenz

Cloudflare:

- `/api/c` erzwingt eine stabile UUID in `request_id` und `nt_client_submit_id` und gibt diese als Lead-ID zurück.
- `/api/c` erzeugt einen 15 Minuten gültigen HMAC-Token für die optionale Nachqualifizierung.
- `/api/e` validiert Token, Status, Enums, Längen und URLs, begrenzt den Body auf 12 KB und leitet nur normalisierte Daten weiter.
- Signatur-Secret und Shared-Secret sind getrennte Bindings; Secrets liegen nicht im Repository.

Supabase-Projekt `klibiejfisijpagzkxls`:

- Tabelle `public.lead_request_enrichments`
- `request_id` ist eindeutig und verweist auf `master_requests(request_id)`.
- `idempotency_key` ist eindeutig.
- RLS ist aktiv; `anon` und `authenticated` haben keine Rechte; `service_role` besitzt nur `SELECT`, `INSERT`, `UPDATE`.
- Trigger `guard_lead_request_enrichment_update` verhindert das Zurückstufen eines vollständigen Datensatzes.
- Transaktionaler Smoke-Test: `completed` blieb nach einem simulierten späteren `timeout` unverändert; die Transaktion wurde zurückgerollt.

n8n:

- Neuer Workflow: `LP Lead Enrichment v1.0 — INACTIVE QA`
- Workflow-ID: `zR7TlVpNm9p0eemP`
- 11 Nodes, Strict Validation: gültig, 0 Fehler
- Status: inaktiv; der bestehende aktive Intake-Workflow `FQ7lf36yje4B1eE3` wurde nicht verändert.
- Ablauf: Webhook → Secret-/Payload-Validierung → HTTP 202 → idempotenter Supabase-Upsert mit Retries → Laden des Trello-Ziels aus der Datenbank → optionaler Trello-Kommentar.
- Datenbank ist Source of Truth; Trello wird erst nach erfolgreichem DB-Write aktualisiert.
- Fehler führen in den vorhandenen Error-Workflow `M4uG1HAtN9Zggxww`.

Die HTTP-202-Antwort bestätigt die validierte Annahme in n8n, nicht bereits den abgeschlossenen DB-Write. Die n8n-Ausführung ist gespeichert; Upsert und Trello-Projektion laufen anschließend weiter und werden bei Fehlern alarmiert.

## SEO und Crawler

- `robots.txt` und `sitemap.xml` ergänzt.
- `/test/` und `/test2/` sind in `robots.txt` ausgeschlossen und zusätzlich per `noindex, nofollow, noarchive` geschützt.
- Die Sitemap enthält nur reale kanonische Landingpage-Routen, keine Testseiten.
- Die drei Pilotseiten haben sichere Canonicals, route-spezifische Meta-Daten und strukturierte Service-/FAQ-Daten.

## QA

- alle 13 Configs erfolgreich gebaut
- Release-Regeln über alle generierten Seiten geprüft
- keine unaufgelösten Template-Variablen in den drei Pilotseiten
- kein Trustpilot und keine alten Pauschalclaims in den drei Pilotseiten
- Desktop 1.440 × 1.000: kein horizontaler Overflow; Formular 595 px, linker Hero-Inhalt 653 px
- Mobile 390 × 844 und 320 × 800: kein horizontaler Overflow; Eingaben 16 px; Hauptbuttons mindestens 48 px; Menübutton 44 px
- Menü öffnen, Fokus, Scroll-Lock, Escape und Schließen geprüft
- kompletter Formular- und Enrichment-Flow mit lokal abgefangenen Antworten geprüft; keine echte Anfrage erzeugt
- DKI für `firmenlogo wand` und `firmenschild fassade`, Intent-Felder, Varianten, UTMs und XSS-Fallback geprüft
- normale Animationen: Announcement 22 s linear infinite, Kundenlogos 34 s linear infinite, Leuchtstreifen 6 s infinite, Button-Shine 5,6 s infinite

Lighthouse, lokaler Cloudflare-Pages-Build:

| Route/Ansicht | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/logo/` Mobile | 99 | 100 | 100 | 100 | 2,3 s | 0 | 10 ms |
| `/logo/` Desktop | 100 | 100 | 100 | 100 | 0,7 s | 0 | 0 ms |
| `/firmenlogo-beleuchtet/` Mobile | 99 | 100 | 100 | 100 | 2,3 s | 0 | 10 ms |
| `/firmenschilder/` Mobile | 99 | 100 | 100 | 100 | 2,2 s | 0 | 10 ms |

## Produktionskonfiguration vor Aktivierung

Cloudflare Pages Secrets/Variablen:

- `LEAD_ENRICHMENT_SIGNING_SECRET`: eigenes zufälliges Secret nur für Token-Signaturen
- `LEAD_ENRICHMENT_SHARED_SECRET`: eigenes zufälliges Secret für Cloudflare → n8n
- `LEAD_ENRICHMENT_WEBHOOK_URL`: nach Aktivierung `https://fuajob.online/webhook/landing-anfrage-enrichment`

n8n:

- `NEONTRIP_LP_ENRICHMENT_SECRET` muss dem Cloudflare-Shared-Secret entsprechen.
- Signing- und Shared-Secret dürfen nicht identisch sein.

Danach ist ein E2E-Test mit markiertem Testlead erforderlich: primäre DB-Zeile, genau eine Conversion, genau eine Enrichment-Zeile, genau eine Trello-Projektion, Retry ohne Duplikat, Timeout und Rollback.

## Sicherheitsscore

| Bereich | Wert 1–5 | Begründung |
|---|---:|---|
| Datenkorrektheit | 4 | strikte Allowlist, FK und Status-Guard; Live-E2E fehlt noch |
| Idempotenz | 5 | eindeutiger Request- und Idempotency-Key, Upsert, kein zweiter Lead |
| Sicherheit | 4 | HMAC, Secret-Trennung, RLS/Grants; Secrets noch nicht in den Umgebungen gesetzt |
| Beobachtbarkeit | 4 | gespeicherte n8n-Ausführungen, Error-Workflow und Funnel-Events |
| Rollback | 5 | Workflow inaktiv, additive Tabelle, kein Routing-/Ads-Deploy |
| Deployment-Sicherheit | 5 | kein Produktionsdeploy; Predeploy- und Pfadprüfung bleiben Pflicht |

Gesamt: 4,5 / 5 vor Produktions-E2E.

## Offene Sicherheitsfeststellung

Die Supabase-Advisors melden elf bereits vorhandene Public-Tabellen ohne aktiviertes RLS:

- `crm_customer_change_log`
- `social_post_schedule`
- `ops_customer_email_message_link_backfill_20260604`
- `ops_customer_contact_cleanup_20260604`
- `crm_inventory_glossary`
- `crm_inventory_categories`
- `crm_inventory_items`
- `crm_inventory_movements`
- `crm_inventory_lock`
- `_qtx_stage`
- `quote_approvals`

Diese Altlast wurde nicht automatisch verändert, weil dafür je Tabelle fachlich korrekte Policies und ein eigener Regressionstest erforderlich sind.

## Release-Gate und Rollback

Vor einem Deploy:

1. finale drei Bilder pro Intent einbauen und Bildabmessungen/Kompression erneut messen;
2. Cloudflare- und n8n-Secrets setzen;
3. Enrichment-Workflow aktivieren und E2E-Test durchführen;
4. alle Final URLs, Suffixe, DKI-Fallbacks und Auto-Tagging-Pfade prüfen;
5. `codex-predeploy offers` ausführen und nur den exakt ausgegebenen Commit deployen.

Rollback:

- Cloudflare: auf den vorherigen geprüften Commit zurückrollen;
- n8n: Workflow `zR7TlVpNm9p0eemP` deaktivieren;
- Datenbank nur solange keine echten Enrichment-Daten existieren: Trigger entfernen, Guard-Funktion entfernen, Tabelle `lead_request_enrichments` entfernen;
- Ads-Routing bleibt bis nach dem Landingpage-Deploy unverändert und benötigt daher aktuell keinen Rollback.
