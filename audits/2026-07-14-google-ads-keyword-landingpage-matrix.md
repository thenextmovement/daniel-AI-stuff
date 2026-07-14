# NEONTRIP Google Ads → Landingpage-Matrix

Stand: 14. Juli 2026
Primäres Datenfenster des ursprünglichen Exports: gesamte Zeit, aber nur aktive Kampagnen und aktive Anzeigengruppen
Trendfenster: 13. Juni bis 12. Juli 2026
Status: Routing- und Content-Spezifikation; die numerische Priorisierung dieses Dokuments ist durch die Vollhistorie ersetzt

> Korrektur vom 14. Juli 2026: Beim ursprünglichen Export waren `Kampagnenstatus: Aktiviert` und `Anzeigengruppenstatus: Aktiviert` gesetzt. Er enthielt nur drei aktive Kampagnen. Die vollständige Auswertung mit beiden Filtern auf `Alle`, 48 Kampagnen und 348.175 ausgewiesenen Suchbegriffszeilen steht in `audits/2026-07-14-google-ads-full-history-budget-lp-strategy.md`. Die Routing-, DKI- und QA-Regeln unten bleiben verwendbar; die alten Mengen- und CPA-Tabellen sind nicht mehr budgetentscheidend.

Rohdatenexport: `/Users/danielklesse/Downloads/Bericht zu Suchbegriffen (1).csv`, 1,5 MB, 9.376 CSV-Zeilen inklusive Kopf- und Summenzeilen, SHA-256 `03579320d49e5f8f967ce9da5622c61c8f62995d41915228d1ba66435afe3b01`.

## Ergebnis

NEONTRIP sollte nicht für jedes einzelne Keyword eine neue Landingpage bauen. Empfohlen werden zehn klar abgegrenzte Intent-Routen plus eine separate Brand-Entscheidung. Innerhalb jeder Route darf eine kuratierte DKI-Allowlist die Formulierung präzisieren. Produkttyp, Bilder, Proof und Formularmodus werden jedoch immer von der stabilen Intent-ID bestimmt und niemals von einem ungeprüften Query-Parameter.

Der ursprüngliche, statusgefilterte Google-Ads-Suchbegriffsbericht enthält 9.367 einzeln sichtbare Suchbegriffe. Auf diese entfallen 4.410 Klicks, 367,76 Conversions und 25.511,32 Euro Kosten. Die vollständige, ungefilterte Historie ist im oben verlinkten Nachfolgedokument ausgewertet.

Innerhalb des Suchbegriffsberichts sind damit nur 7,3 Prozent der Klicks, 11,0 Prozent der Conversions und 12,2 Prozent der Kosten auf konkrete Suchbegriffe zurückführbar. Die Matrix nutzt alle offengelegten Suchbegriffe, darf aber nicht behaupten, die nicht offengelegten Suchanfragen zu kennen. Die letzten 30 Tage werden nur als Trendkontrolle verwendet.

## Hohe Risiken im aktuellen Ads-Aufbau

1. Die aktuellen Anzeigengruppen vermischen mehrere Seitenintentionen. `NT·Champ·Logo & Firmen` enthält unter anderem Logo-, Firmenlogo-, Firmenschild- und personalisierte Neon-Suchen. Eine einzige Final URL kann diese Absichten nicht sauber erfüllen.
2. `Firmenschilder & Leuchtkästen` verbindet zwei unterschiedliche Produkttypen. Firmenschilder benötigen Fassaden-, Sichtabstands- und Montagekontext; Leuchtkästen benötigen Bauform, ein-/doppelseitig und Wand-/Auslegerkontext.
3. `NT·Champ·Schriftzüge & Personalisiert` verbindet Texteingabe mit Datei-/Logo-Upload. Der passende erste Formschritt ist deshalb nicht eindeutig.
4. Der gleiche Suchauftrag ist historisch über viele Anzeigengruppen verteilt. `neonschild personalisiert` lief mit 58 Klicks und 5 Conversions in acht Anzeigengruppen; `led schild personalisiert` mit 75 Klicks und 5 Conversions in sechs Anzeigengruppen. Anzeigenversprechen, Zielseite und Gebotsdaten lernen dadurch nicht auf einer stabilen Intent-Struktur.
5. Auch starke Begriffe sind verstreut: `led logo` erzielte zusammen 83 Klicks und 10 Conversions in drei Anzeigengruppen. `leuchtschild` lief in sieben, `led schriftzug` in sechs und `leuchtreklame schild` in sieben Anzeigengruppen.
6. DKI darf diese strukturellen Probleme nicht kaschieren. Ein ausgetauschtes H1 macht aus einer Logo-Seite keine belastbare Außenwerbe- oder Leuchtkasten-Seite.

## Alte Priorisierung aus dem Aktiv-Filter

Die folgende Priorisierung ist eine regelbasierte Zuordnung aller 9.367 offengelegten Suchbegriffe. Überschneidungen werden nach der später dokumentierten Prioritätslogik aufgelöst.

| Priorität | Intent-Familie | Klicks | Conversions | Kosten | sichtbarer CPA | Zielroute |
|---:|---|---:|---:|---:|---:|---|
| 1a | Logo allgemein | 812 | 113,52 | 7.337,93 € | 64,64 € | `/logo/` |
| 1b | Firmenlogo / CI | 101 | 14,00 | 837,68 € | 59,83 € | `/firmenlogo-beleuchtet/` |
| 2 | Neon personalisiert | 671 | 56,00 | 4.084,77 € | 72,94 € | `/neon-schild-personalisieren/` |
| 3 | Firmenschild / Außen | 436 | 37,49 | 2.228,90 € | 59,45 € | `/firmenschilder/` |
| 4 | Schriftzug / Text | 545 | 33,00 | 2.618,83 € | 79,36 € | `/led-schriftzuege/` |
| 5 | Neon-/LED-Schild allgemein | 517 | 32,09 | 2.925,69 € | 91,17 € | `/neon-schilder/` |
| 6 | Leuchtreklame breit | 294 | 21,67 | 1.762,26 € | 81,32 € | `/leuchtreklame/` |
| 7 | 3D- / Leuchtbuchstaben | 137 | 12,50 | 677,29 € | 54,18 € | `/leuchtbuchstaben/` |
| 8 | Leuchtkasten | 81 | 3,44 | 402,82 € | 117,10 € | `/leuchtkaesten/` |
| 9 | Messe / Event | 0 | 0 | 0 € | – | `/messe-event/` |
| separat | NEONTRIP Brand | 458 | 43,05 | 1.355,63 € | 31,49 € | Homepage oder Brand-Hub; nicht mit generischen Produktkampagnen mischen |
| prüfen | noch nicht eindeutig klassifiziert | 329 | 1,00 | 1.184,31 € | 1.184,31 € | manuelle Prüfung, kein automatisches Routing |
| negativ prüfen | Komponenten / DIY | 29 | 0 | 95,22 € | – | Negativkeyword-Prüfung |

Die Langzeitdaten ändern die Reihenfolge gegenüber dem 30-Tage-Fenster: Logo/CI bleibt klar führend. Danach folgen personalisierte Neon-Schilder, Firmenschilder, Schriftzüge und generische Neon-/LED-Schilder. Leuchtbuchstaben haben weniger Volumen, aber mit 54,18 Euro den besten sichtbaren Non-Brand-CPA der klaren Produktfamilien.

### Langfristige Basis versus aktueller 30-Tage-Trend

| Intent-Familie | gesamte Zeit: Conversions / CPA | letzte 30 Tage: Conversions / CPA | Einordnung |
|---|---:|---:|---|
| Logo allgemein | 113,52 / 64,64 € | 16,50 / 87,96 € | größter dauerhafter Hebel; zuletzt teurer, aber weiter volumenstark |
| Firmenlogo / CI | 14,00 / 59,83 € | 3,00 / 60,96 € | bemerkenswert stabil |
| Neon personalisiert | 56,00 / 72,94 € | 5,00 / 108,29 € | dauerhaft wichtig; aktuelle Effizienz schwächer |
| Firmenschild / Außen | 37,49 / 59,45 € | 8,00 / 59,26 € | langfristig und aktuell stabil stark |
| Schriftzug / Text | 33,00 / 79,36 € | 3,50 / 96,96 € | relevant, aber zuletzt schwächer |
| Neon-/LED-Schild allgemein | 32,09 / 91,17 € | 2,50 / 119,47 € | breite Intention und schwächere Effizienz; früher Produkt-Router nötig |
| Leuchtreklame breit | 21,67 / 81,32 € | 2,00 / 106,24 € | relevant, aber generische Suchabsicht kostet zuletzt mehr |
| 3D- / Leuchtbuchstaben | 12,50 / 54,18 € | 2,00 / 48,36 € | kleineres Volumen, dafür starke und stabile Effizienz |
| Leuchtkasten | 3,44 / 117,10 € | 1,00 / 70,12 € | Datenbasis zu klein für aggressive Entscheidungen |

Produkt- und Routingentscheidungen werden auf die gesamte Historie gestützt. Budget-, Gebots- und Anzeigeneingriffe müssen zusätzlich aktuelle Zeitfenster berücksichtigen, damit alte Kampagnen- und Trackingzustände nicht ungeprüft fortgeschrieben werden.

## Verbindliche Keyword-zu-Landingpage-Matrix

| Intent-ID | Keyword-Signale und beobachtete Gewinner | Ziel-URL | statisches Hero-Versprechen | Formularmodus | Hero-Bildfolge | Proof-Schwerpunkt |
|---|---|---|---|---|---|---|
| `logo_general` | `led logo`, `logo für die wand`, `led logo wand`, `3d logo wand`, `logo aus acrylglas`, `logo an die wand`, `leuchtlogo`, `lichtlogo`, `wandlogo` | `https://anfrage.neontrip.de/logo/` | Ihr Logo als Leuchtschild | Datei hochladen oder später senden | Logodatei → Mockup im passenden Setting → reales Logo-Schild | CI-Treue, Visualisierung, verschiedene Bauarten |
| `company_logo` | `firmenlogo beleuchtet innen`, `beleuchtetes firmenlogo`, `3d firmenlogo`, `firmenlogo led schild`, `led firmenlogo`, `unternehmenslogo beleuchtet` | `https://anfrage.neontrip.de/firmenlogo-beleuchtet/` | Ihr Firmenlogo als beleuchtetes Wandschild | Logo plus Einsatzort; optional Standortfoto | Firmenlogo → Büro-/Empfangs-/Fassadenmockup → installiertes Firmenlogo | CI-Umsetzung, Beratung, B2B-Projekte |
| `company_sign_outdoor` | `firmenschild außen`, `firmenschild mit logo`, `werbeschilder außen`, `werbung schild für draußen`, `reklametafel beleuchtet`, `außenwerbung`, `fassadenschild`, `ladenschild`, `praxisschild` | `https://anfrage.neontrip.de/firmenschilder/` | Beleuchtete Firmenschilder für Fassade und Eingang | Logo plus Fassade/Standort; Foto optional | Gebäude vorher → maßstäbliches Fassadenmockup → montierte Außenanlage | Außenbeständigkeit, Sichtabstand, Montage und Genehmigung |
| `neon_custom` | `led schild personalisiert`, `neonschild personalisiert`, `neon schild personalisiert`, `led neon schild personalisiert`, `eigenes neonschild`, `neonschild anfertigen lassen` | `https://anfrage.neontrip.de/neon-schild-personalisieren/` | Ihr individuelles Neon-Schild kostenlos visualisiert | Text eingeben oder Design hochladen | Wunschtext/Design → Neon-Visualisierung → reales individuelles Schild | Individualisierung, Farben, Größe, unkomplizierter Einstieg |
| `text_sign` | `led schriftzug`, `led schriftzüge`, `neon schriftzug`, `led schriftzug wand`, `leuchtschrift`, `neonschrift`, `beleuchteter schriftzug` | `https://anfrage.neontrip.de/led-schriftzuege/` | Ihr LED-Schriftzug nach Wunsch | Texteingabe zuerst; Datei optional | Text/Schrift → Farb- und Größenvisualisierung → realer Schriftzug | Lesbarkeit, Schriftwahl, Farbe und Montage |
| `illuminated_letters` | `3d buchstaben beleuchtet`, `leuchtbuchstaben led außen`, `leuchtbuchstaben`, `profilbuchstaben`, `3d buchstaben logo` | `https://anfrage.neontrip.de/leuchtbuchstaben/` | 3D-Leuchtbuchstaben für Fassade und Innenraum | Logo/Schriftzug hochladen | Vektordatei → Beleuchtungsprofil/Mockup → installierte Buchstaben | Front-, Rück- und Seitenlicht; Material und Profil |
| `lightbox` | `leuchtkasten`, `leuchtkasten led`, `leuchtkasten alu`, `leuchtkasten reklame`, `leuchtkasten außenwerbung`, `lightbox logo` | `https://anfrage.neontrip.de/leuchtkaesten/` | Individuelle Leuchtkästen für Logo und Werbung | Motiv/Logo plus Format und Einsatzort | Artwork → Tag-/Nacht-Mockup → Wand-/Auslegermontage | ein-/doppelseitig, Innen/Außen, Wartung und Motivwechsel |
| `illuminated_advertising` | `lichtwerbung`, `leuchtreklame außen`, `leuchtreklame`, `leuchtwerbung`, `werbeanlage`, `außenreklame beleuchtung` | `https://anfrage.neontrip.de/leuchtreklame/` | Leuchtreklame passend zu Standort und Marke | Logo/Design plus Einsatzort | Marke/Standort → geeignete Produktvarianten → empfohlenes Ergebnis | Produktauswahl, Standortberatung und Werbewirkung |
| `neon_general` | `neon schild`, `neonschild`, `neon schilder`, `led schild`, `leuchtschild`, `leuchtschilder`, `led leuchtschilder` ohne Personalisierungs-, Logo- oder Außen-Signal | `https://anfrage.neontrip.de/neon-schilder/` | Individuelle Neon-Schilder für Marke, Raum und Event | Text oder Datei; früher Mini-Router | Idee → passende Neon-Ausführung → reales Schild | Produktüberblick, Anwendungsbeispiele und schneller Weg zur passenden Variante |
| `event_signage` | `messestand leuchtreklame`, `messe logo beleuchtet`, `event leuchtschild`, `bühnenlogo`, `markenfläche event` | `https://anfrage.neontrip.de/messe-event/` | Leuchtreklame für Messe, Event und Markenfläche | Design, Termin und optional Standansicht | Standplan → Event-Mockup → realer Einsatz | Termin, Montagefenster, Transport und Agentur-/Kundenprojekt |
| `brand` | `neontrip`, `neon trip`, eindeutige Schreibvarianten | Entscheidung bis zur Migration: `https://www.neontrip.de/` oder neuer Brand-Hub | NEONTRIP und direkter Einstieg in Produkte, Projekte und Kontakt | Produkt-Router statt vorgewähltem Produkttyp | Markenprojekte und Sortiment | Marke, Showroom, Beratung und bestehende Kundenbeziehung |

## Auflösungsregeln für Überschneidungen

Die spezifischste kaufentscheidende Intention gewinnt. Die Regeln werden in dieser Reihenfolge ausgewertet:

1. Brand
2. Messe/Event
3. Leuchtkasten
4. Leuchtbuchstaben/Profilbuchstaben
5. Firmenschild/Fassade/Außenwerbung
6. Schriftzug/Text
7. personalisiert/custom/anfertigen
8. Firmenlogo/Unternehmenslogo
9. Logo allgemein
10. Leuchtreklame/Lichtwerbung
11. Neon-/LED-Schild allgemein

Beispiele:

| Suchbegriff | Ziel | Begründung |
|---|---|---|
| `firmenschild mit logo` | `/firmenschilder/` | Das Schild und sein Einsatzort bestimmen Beratung, Bilder und Montagefragen; `logo` ist hier nur das Motiv. |
| `firmenlogo beleuchtet innen` | `/firmenlogo-beleuchtet/` | Unternehmenslogo und Innenraum-/Empfangskontext sind explizit. |
| `neon schild personalisiert logo` | `/neon-schild-personalisieren/` | Die konkrete Custom-Neon-Absicht ist stärker als der allgemeine Logo-Begriff. |
| `3d buchstaben logo` | `/leuchtbuchstaben/` | Der Produkttyp ist bereits festgelegt. |
| `leuchtkasten logo` | `/leuchtkaesten/` | Der Produkttyp ist bereits festgelegt. |
| `led logo wand` | `/logo/` | Logo-Wandschild ohne expliziten Firmen-, Fassaden- oder Leuchtbuchstabenauftrag. |
| `leuchtschild` | `/neon-schilder/` | Generische Produktsuche; die Seite muss früh zur passenden Ausführung führen. |

## DKI-Allowlist

DKI verändert nur eine freigegebene Formulierung innerhalb der bereits richtigen Route. Der Query-Parameter wird niemals direkt als HTML ausgegeben.

| Route | erlaubte Keyword-Variante | H1-Ausgabe |
|---|---|---|
| `/logo/` | `led logo` | Ihr Logo als LED-Leuchtschild |
| `/logo/` | `logo für die wand`, `logo an die wand`, `led logo wand` | Ihr Logo als beleuchtetes Wandschild |
| `/logo/` | `3d logo wand` | Ihr 3D-Logo als beleuchtetes Wandschild |
| `/logo/` | `logo aus acrylglas`, `acrylglas logo` | Ihr Logo als Leuchtschild auf Acrylglas |
| `/firmenlogo-beleuchtet/` | `firmenlogo beleuchtet innen` | Ihr beleuchtetes Firmenlogo für Büro und Empfang |
| `/firmenlogo-beleuchtet/` | `3d firmenlogo` | Ihr Firmenlogo als beleuchtetes 3D-Wandlogo |
| `/firmenschilder/` | `firmenschild außen`, `werbeschilder außen` | Beleuchtete Firmenschilder für den Außenbereich |
| `/firmenschilder/` | `firmenschild mit logo` | Ihr Firmenschild mit individuellem Logo |
| `/neon-schild-personalisieren/` | `neonschild personalisiert`, `led schild personalisiert` | Ihr personalisiertes LED-Neonschild |
| `/led-schriftzuege/` | `led schriftzug wand` | Ihr LED-Schriftzug für die Wand |
| `/leuchtbuchstaben/` | `leuchtbuchstaben led außen` | LED-Leuchtbuchstaben für Ihre Fassade |
| `/leuchtbuchstaben/` | `3d buchstaben beleuchtet` | Beleuchtete 3D-Buchstaben nach Maß |
| `/leuchtkaesten/` | `leuchtkasten außenwerbung` | Ihr Leuchtkasten für Außenwerbung |
| `/leuchtreklame/` | `leuchtreklame außen`, `lichtwerbung` | Individuelle Lichtwerbung für Ihren Standort |

Unbekannte, grammatikalisch ungeeignete oder route-fremde Parameter verwenden immer das statische Standard-H1.

## Empfohlener Ads-Neuaufbau

| heutige Anzeigengruppe | Problem | neue Intent-Gruppen |
|---|---|---|
| `Logo & Branding` | Logo, Firmenlogo, Firmenschild, Außenwerbung und Leuchtreklame gemischt | `Logo allgemein`, `Firmenlogo/CI`, `Firmenschild Außen`, `Leuchtreklame breit` |
| `NT·Champ·Logo & Firmen` | Logo, Firmenkontext und personalisierte Neon-Suchen gemischt | `Logo Winner`, `Firmenlogo Winner`, `Neon personalisiert Winner` |
| `Firmenschilder & Leuchtkästen` | zwei Produkttypen mit unterschiedlicher Beratung | `Firmenschilder Außen`, `Leuchtkästen` |
| `NT·Champ·LED & Neon Schilder` | generische und personalisierte Suchen gemischt | `Neon allgemein`, `Neon personalisiert` |
| `NT·Champ·Schriftzüge & Personalisiert` | Texteingabe und Datei-/Design-Upload gemischt | `LED Schriftzüge`, `Neon personalisiert` |
| `Leuchtbuchstaben & 3D` | grundsätzlich passend; Logo- und Außenvarianten noch trennen/kennzeichnen | `Leuchtbuchstaben`, optional `Leuchtbuchstaben Außen` |
| `Leuchtreklame` | grundsätzlich passend; spezifische Produktbegriffe ausschließen | `Leuchtreklame breit` |
| `Brand NEONTRIP` | eigene Aufgabe und anderes Nutzerwissen | unverändert separat halten |

Für die Übergangsphase können eindeutige Exact-/Phrase-Winner auf Keyword-Ebene eine passende Final URL erhalten. Dauerhaft ist eine saubere Anzeigengruppentrennung besser, weil Anzeige, Zielseite, Gebot und Auswertung dann dieselbe Intent-ID verwenden.

## Final URLs und Parameter

Alle zehn vorgesehenen `https://anfrage.neontrip.de/.../`-Routen antworteten am 14. Juli 2026 mit HTTP 200. Gemessene Abrufzeiten ohne Rendering lagen zwischen 0,17 und 0,31 Sekunden. Das ist nur eine Erreichbarkeitsprüfung, kein Core-Web-Vitals- oder Google-Ads-Landingpage-Experience-Test.

Empfohlener gemeinsamer Final-URL-Suffix:

```text
kw={keyword}&utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}&device={device}&matchtype={matchtype}&network={network}&lp_intent={_intent}&lp_variant={_lpvariant}
```

Empfohlene Custom Parameters pro neuer Anzeigengruppe:

```text
{_intent}=logo_general
{_lpvariant}=photo_upload_v3
```

`{keyword}` ist das gematchte Google-Ads-Keyword, nicht der tatsächliche Suchbegriff. Es dient nur als Signal für die kuratierte DKI-Allowlist. GCLID, GBRAID und WBRAID bleiben über Auto-Tagging erhalten und dürfen nicht überschrieben werden.

Vor einer Ads-Änderung müssen direkte und geerbte Final URLs, Tracking Templates, Final-URL-Suffixe und Custom Parameters auf Konto-, Kampagnen-, Anzeigengruppen-, Anzeigen- und Keyword-Ebene auf Konflikte geprüft werden.

## Conversion-Payload

Jede Anfrage muss zusätzlich zum eigentlichen Formularinhalt folgende unveränderliche Routingdaten enthalten:

- `landing_page`
- `lp_intent`
- `lp_variant`
- `hero_variant`
- `visual_variant`
- `matched_keyword`
- `campaign_id`
- `creative_id`
- `device`
- `matchtype`
- `gclid`, `gbraid` oder `wbraid`
- ursprüngliche Landingpage-URL und Referrer

Der technische Webhook bleibt gemeinsam. Trello bleibt Projektion; Datenbank und Lead-ID sind Source of Truth. Ads-Conversion wird erst nach erfolgreicher fachlicher Annahme einmalig ausgelöst.

## Negativkeyword-Kandidaten

Nicht automatisch ausschließen. Erst Suchbegriffe, Auftragsmöglichkeit und Marken-/Rechtskontext prüfen.

Hohe Prüfpriorität:

- Komponenten und DIY: `neon leuchtband`, `flexible led neon tube`, `led flex neon`, `neon stripe`, Ersatzteile, reine Röhren-/Band-Suchen
- offensichtlich fremdsprachige oder geografisch irrelevante Suchen ohne deutsche Kaufabsicht
- reine Vorlagen-, Download-, Anleitung- oder Selberbauen-Suchen
- konkrete Fremdmarken-/Motivkopien wie Nike, Twitch oder bekannte Getränkemarken, sofern keine legitime B2B-Projektabsicht erkennbar ist

Nicht pauschal negativ setzen: privat, Geschenk, Hochzeit, Gastronomie oder Vereinslokal. Diese können echte Anfragen sein; sie gehören jedoch nicht in rein B2B formulierte Anzeigen und Landingpages.

## QA-Plan vor Aktivierung

1. Jede neue Anzeigengruppe erhält genau eine Intent-ID und eine primäre Landingpage.
2. Keyword-zu-Route-Matrix gegen Exact, Phrase, Broad und Close Variants testen.
3. Jede Final URL inklusive Suffix, DKI-Fallback und Auto-Tagging öffnen.
4. Desktop und Mobile prüfen: H1, drei Bilder, Proof, Eingabemodus und CTA müssen dieselbe Intention bestätigen.
5. Upload-, Texteingabe-, `Design später senden`- und Fehlerpfad testen.
6. Hidden Fields und Attribution am angenommenen Lead prüfen.
7. Genau eine Google-Ads-Conversion je Lead-ID nach erfolgreicher Annahme nachweisen.
8. Negative Keywords nur nach manueller Freigabe anwenden.
9. Nach Veröffentlichung Search Terms täglich in der Lernphase, danach mindestens wöchentlich gegen die Matrix prüfen.
10. Google-Ads-Landingpage-Erfahrung und echte Feldwerte getrennt von Lighthouse-Laborwerten beobachten.

## Rollback

- Vor Ads-Änderungen Kampagnen-, Anzeigengruppen-, Anzeigen-, Keyword- und URL-Zustand exportieren.
- Neue Struktur zunächst als Entwurf beziehungsweise mit begrenztem Budget aktivieren.
- Bei Routing-, Tracking- oder Conversionfehlern auf die dokumentierten vorherigen Final URLs zurückstellen.
- Landingpage-Routing nur gemeinsam mit getesteter Pfadliste und Cloudflare-Rollback ändern.
- Keine Veröffentlichung aus dem alten Offers-Checkout; vor jeder Veröffentlichung `codex-predeploy offers` ausführen und ausschließlich den ausgegebenen Commit deployen.
