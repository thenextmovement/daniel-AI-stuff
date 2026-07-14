# NEONTRIP `/logo/` – Implementierung und Abnahme

Stand: 14. Juli 2026
Status: **lokal umgesetzt und geprüft, nicht veröffentlicht**

## Ziel und Ergebnis

Die Landingpage `/logo/` wurde als eigenständiger Pilot für Google-Ads-Traffic neu aufgebaut. Der Einstieg ist jetzt auf einen einzigen Upload-/Anfragepfad ausgerichtet. Inhalt, Beispiele, FAQ und Dynamic Keyword Injection beziehen sich konsistent auf Logo- und CI-Leuchtschilder.

Die Änderung ist über ein seitenbezogenes Layout isoliert. Andere Landingpages verwenden weiterhin das bestehende Basislayout.

## Wesentliche Änderungen

- Neuer statischer Foto-Hero mit responsiven WebP-Dateien statt Video.
- Ein einziges, zweistufiges Formular oberhalb der Falz: Logo hochladen oder „Design später senden“, danach Kontaktdaten und Projektangaben.
- Ein einziger POST an `/api/c`; kein zweites Formular und keine doppelte Lead-Erfassung.
- Bestehende Google-Ads-Conversion `AW-314675901/MvNdCMPjpIocEL2lhpYB` wird nur nach erfolgreicher Annahme und exakt einmal ausgelöst.
- UTM-, Click-ID-, Landingpage- und Variantenparameter werden für den Anfragepfad vorbereitet.
- Neue Seitenfolge: Hero → Vertrauenssignale → drei Umsetzungen → Bauarten-Entscheidung → Original/3D/Umsetzung → Anfragefortsetzung → CI-/Einsatzort-Erklärung → Preisfaktoren → FAQ → Schluss-CTA.
- Crawlbare FAQ-Inhalte und dazu passendes `FAQPage`-JSON-LD; ungestützte Preis-, Bewertungs- und Lieferzeit-Markups entfernt.
- Logo-Marquee mit normalisierten Logo-Flächen und Animation; Google-Bewertung als echtes, zugängliches UI-Element. Trustpilot ist nicht Bestandteil des Piloten.
- Kritischer Renderpfad reduziert: kleine responsive Hero-Bilder, nachgeladene Prozessbilder und verzögertes externes Tracking-Script bei sofort verfügbarer Event-Queue.

### First-View-Nachschärfung nach Designreview

- Desktop-Formular von 520 auf 460 px reduziert und von rund 820 auf 718 px Höhe verdichtet.
- Kundenlogo-Marquee liegt bei 1440 × 1000 px wieder sichtbar im ersten Viewport.
- Marquee-Dauer auf 34 Sekunden verkürzt; Formrahmen, Statuspunkte und CTA besitzen weiterhin eigene, dezente Animationen.
- `prefers-reduced-motion` wird respektiert: Bei aktivierter Systemoption bleibt die Logozeile bewusst stehen und die übrigen Bewegungen werden verlangsamt.
- Mobile zeigt die drei Bilder „Logo → 3D-Vorschau → Leuchtschild“ als kompakten Orientierungsstreifen direkt vor dem Formular.
- Der redundante mobile Scroll-CTA wurde entfernt. Bei 390 × 844 px beginnt das Formular bei 518 px; Überschrift und Uploadbereich sind bereits im ersten Bildschirm sichtbar.
- Für den neuen mobilen First View wurden die beiden Rasterbilder auf eigene 320-px-WebP-Thumbnails mit zusammen rund 46 KB reduziert.

### Mobile Hero v3 nach zweitem Review

- Trustpilot vollständig aus `/logo/`-Quellcode und generiertem Output entfernt.
- Vollständiges mobiles Menü mit Projekte, Varianten, Ablauf, FAQ und Telefon ergänzt; per Tastatur bedienbar und mit Escape schließbar.
- Mobile Header-CTA entfernt, weil Upload und mobiler Sticky-CTA den Anfrageweg bereits abdecken.
- H1 auf „Ihr Logo als Leuchtschild“ verkürzt und Subline auf CI, Bauarten und kostenlose Visualisierung fokussiert.
- Formular-Badge, internes Logo und Status-Pill auf Mobile entfernt; Uploadbereich dadurch vollständig im ersten 390 × 844-px-Viewport.
- Mobile Messwerte: Formularbeginn 444 px, Uploadbereich 525–669 px, kein horizontaler Overflow.
- Animationen auf Kundenlogo-Marquee und dezenten CTA-Glanz reduziert; rotierender Formularrahmen, CTA-Pulsieren und pulsierende Statuspunkte entfernt.
- Die drei Bildslots sind verbindlich als „Logo-Datei → 3D-Visualisierung → Fertiges Schild“ vorbereitet. Die aktuell verwendeten Dateien sind nur Layout-Platzhalter und werden durch die noch zu liefernde zusammengehörige Bildserie ersetzt.

### Hero v4 nach Abgleich mit veröffentlichten Landingpages und Google Ads

- Headermaße wurden am 14. Juli 2026 direkt gegen die veröffentlichte `/firmenschilder/`-Landingpage vermessen und übernommen: Desktop 56 px Header mit 213 × 40 px Logo; Mobile 48 px Header mit 128 × 24 px Logo, jeweils unter der 28-px-Showroom-Leiste.
- Die separate mobile Burger-Navigation aus v3 wurde wieder entfernt. Wie auf den veröffentlichten mobilen Landingpages steht rechts im Header stattdessen der kompakte Google-Chip mit `4,9` und fünf Sternen.
- Der gemeinsame Offer lautet jetzt „Kostenlose 3D-Vorschau für Ihr Logo“. Subline, Hero-CTA, Formularüberschrift, erster Formular-CTA, finaler Submit und mobiler Sticky-CTA erzählen denselben unverbindlichen Einstieg.
- Google-Bewertung und Risikosenker unter dem Formular-CTA sind zu einer einzigen ruhigen Leiste zusammengeführt: `4,9/5`, Sterne, `236 Bewertungen` und `Kostenlos & unverbindlich`.
- Desktop-Formular auf 430 × 602 px verdichtet. Die Prozessbilder sind quadratisch; dadurch ist das animierte Kundenlogo-Marquee bei 1440 × 900 px vollständig im ersten Viewport sichtbar.
- Mobile Messwerte bei 390 × 844 px: Formularbeginn 441 px, erster CTA endet bei 815 px, alle drei Prozessbilder sichtbar, kein horizontaler Overflow.
- Dezente gestaffelte Reveal-Animation für Hero-Copy, Prozess und Formular ergänzt. Logo-Marquee und CTA-Glanz bleiben aktiv; `prefers-reduced-motion` schaltet alle nicht notwendigen Bewegungen ab.
- Aktuelle Google-Ads-Suchbegriffe wurden ausschließlich lesend geprüft. Das Logo-Cluster wird im sichtbaren 30-Tage-Fenster von `led logo` angeführt (18 Klicks, 3 Conversions). DKI wurde um konkrete Gewinner-/Long-Tail-Intentionen wie `logo für die wand`, `led logo wand`, `3d logo wand`, `firmenlogo schild außen` und `logo aus acrylglas` erweitert.

### Typografie und Formularfokus v5

- Mobile Schriftgrößen im echten 390 × 844-px-Viewport ausgelesen und neu gewichtet. Vorher lagen Eyebrow, Prozesszeile, Prozesslabels, Formularhilfen, Checkbox und Google-Zeile teilweise nur bei 9–11,5 px.
- Kritische mobile Größen jetzt: Hero-Subline 16 px, Trust 12,5 px, Prozesszeile 13 px, Prozesslabels 12 px, Formulartitel 20 px, Formularsubline 14 px, Uploadtitel 16 px, Uploadhilfe 12,5 px, Checkbox 12,5 px, CTA 15 px und Google-/Risikozeile 11,5 px. Nur kurze, nicht-fließende Format-Badges bleiben bei 10 px.
- Texte wurden gleichzeitig verkürzt, damit die größere Typografie den Funnel nicht nach unten schiebt. Der erste CTA endet bei 841 px und bleibt damit vollständig im 844-px-Viewport sichtbar; kein horizontaler Overflow.
- Desktop-Formular um 28 px nach unten gesetzt: Formular 144–746 px, linke Hero-Copy 116–769 px. Dadurch steht der Block nicht mehr oberhalb der linken Eyebrow und passt proportional zu Text und Prozessbildern.
- Um das primäre Conversion-Element visuell zu priorisieren, besitzt die Formularhülle wieder eine umlaufende, langsam wandernde Lichtkante mit zurückhaltendem pink-violetten Glow. Bei `prefers-reduced-motion` bleibt die Kante statisch.

### Mobile-Lesbarkeit und echte Endlosschleifen v6

- Mobile bei 390 × 844 px erneut mit berechneten Browserwerten geprüft: H1 39,78 px, Hero-Text 16 px, Eyebrow 12 px, Prozesslabels 12 px, Formulartitel 20 px, Formulartext 14 px, Uploadtitel 16 px, Uploadhilfe 12,5 px und CTA 15 px. Nur die kompakten Dateiformat-Badges bleiben bei 11 px.
- Relevante Touchflächen: Headerlogo 44 px, Checkboxzeile 44 px, Datumsfeld 44 px, Haupt-CTA 48 px und spätere Formularfelder mindestens 46 px. Der Haupt-CTA endet bei 838,1 px und bleibt vollständig im 844-px-Viewport; horizontaler Overflow ist 0 px.
- Announcement-Bar und Kundenlogos bestehen jeweils aus zwei identischen Gruppen und verschieben die gemeinsame Spur exakt um 50 %. Gemessen wurden 2 × 667,1 px bei 22 s für die Announcement-Bar sowie 2 × 1.848 px bei 34 s für die Kundenlogos; beide laufen `linear infinite` ohne leere Pause oder sichtbaren Reset.
- Das Kundenlogo-Marquee nutzt auf Desktop die kompletten 1.440 px Viewportbreite. Starlink wurde wegen des großen internen SVG-Leerraums auf Faktor 2,1 vergrößert und die Zeilenhöhe auf 60 px erweitert, damit das Logo nicht abgeschnitten wird.
- Der Statushinweis `0 € · unverbindlich · keine Bestellung` und die redundante Nebenzeile am linken CTA wurden vollständig entfernt.
- Desktop-Formular: 430 × 595 px bei y=144,1; die Kundenlogoleiste endet bei y=895,3 und bleibt im 900-px-Viewport sichtbar.
- Screenshots: `audits/2026-07-14-logo-pilot-mobile-hero-v6.png` und `audits/2026-07-14-logo-pilot-desktop-hero-v6.png`.

## Geänderte Kernbestandteile

- `deploy/_source/build.js`: sichere Auswahl eines seitenbezogenen Layouts.
- `deploy/_source/configs/logo.json`: `/logo/`-Konfiguration, DKI, Metadaten, Sektionsfolge und strukturierte Daten.
- `deploy/_source/layouts/logo-pilot.html`: isoliertes Layout mit SEO, Consent, Attribution, Tracking und Performance-Optimierungen.
- `deploy/_source/sections/overrides/logo/`: Hero und alle Pilot-Sektionen.
- `deploy/assets/images/hero/logo-ci-photo-desktop.webp`: 800 × 868 px, 144.438 Byte.
- `deploy/assets/images/hero/logo-ci-photo-mobile.webp`: 520 × 564 px, 47.212 Byte.
- `deploy/assets/images/hero/neontrip-3d-logo-render-thumb.webp`: 320 px breit, 5,9 KB.
- `deploy/assets/images/projekte/aperol-deli-neon-thumb.webp`: 320 px breit, 40 KB.
- `deploy/logo/index.html`: generiertes Ergebnis.

## Tracking-Spezifikation

| Ereignis | Auslöser | Deduplizierung / Bedeutung |
|---|---|---|
| `upload_started` | Dateiauswahl oder Drop beginnt | einmal je Formularlauf |
| `asset_attached` | gültige Datei liegt am Formular | einmal je Formularlauf |
| `asset_send_later_selected` | „Design später senden“ aktiviert | Zustandswechsel |
| `contact_step_viewed` | Schritt 2 wird sichtbar | einmal je Formularlauf |
| `lead_accepted` | `/api/c` antwortet erfolgreich | fachliche Annahme, keine Behauptung einer DB-Speicherung |
| `lead_submit_failed` | Request oder Serverantwort schlägt fehl | sichtbarer Fail-loud-Pfad |
| Google-Ads-Conversion | erst nach `lead_accepted` | Guard verhindert Mehrfachauslösung |

Formidentität: `hero_form_logo_photo_v3`
Intent: `logo_ci`
Variante: `photo_upload_v3`

Consent Mode wird zunächst mit verweigerten Werbe-/Analytics-Zustimmungen initialisiert. Cookiebot und Cloudflare Beacon werden lokal nicht geladen, damit lokale Browserfehler nicht als Produktionsfehler fehlinterpretiert werden.

## Abnahme

| Prüfung | Ergebnis |
|---|---|
| Release-Verifikation | bestanden; 17 generierte Seiten geprüft |
| `/logo/`-Struktur | 1 Formular, 1 H1, 1 `/api/c`, keine doppelten IDs, keine fehlenden Bilder |
| DKI | bekannter Begriff `3d logo beleuchtet` und unbekannter Fallback geprüft |
| Responsivität | 390 px, 768 px und 1440 px ohne horizontalen Overflow |
| First View nach Review | Desktop-Formular 430 × 602 px; Logo-Marquee bei 1440 × 900 px sichtbar; Mobile 3/3 Prozessbilder sichtbar und Formularbeginn bei 441 px |
| Mobile Hero v4 | Veröffentlichte Headermaße übernommen, 390 px ohne horizontalen Overflow, erster CTA im Viewport, 1 H1 und 1 Formular |
| Typografie v5 | mobile Kerntexte 12–20 px, Hero-Subline 16 px, CTA 15 px; CTA-Unterkante 841 px bei 844 px Viewporthöhe |
| Formularproportion v5 | Desktop 430 × 602 px bei y=144; linke Copy endet bei 769 px; umlaufende Lichtkante sichtbar |
| Mobile-Lesbarkeit v6 | Kerntexte 12–20 px, CTA 15 px / 48 px hoch, Checkbox- und Datumsfläche je 44 px, 0 px horizontaler Overflow |
| Endlosschleifen v6 | Announcement 22 s und Kundenlogos 34 s, jeweils zwei gleich breite Gruppen, `linear infinite`, Bewegung im Browser nachgewiesen |
| Desktop-Finalstand v6 | Formular 430 × 595 px bei y=144,1; Logoleiste 1.440 px breit und bis y=895,3 sichtbar; beanstandeter Statushinweis entfernt |
| DKI v4 | `led logo`, `logo für die wand` und `3d logo wand` ergeben die erwarteten query-spezifischen H1-Texte |
| Formular – Erfolgsfall | lokale Mock-Annahme `qa-local-accepted-001`, Erfolgsmeldung sichtbar |
| Formular – Fehlerfall | sichtbare Fehlermeldung mit Telefon-/E-Mail-Fallback |
| Conversion | exakt 1 Event an `AW-314675901/MvNdCMPjpIocEL2lhpYB` nach Annahme |
| Attribution | UTM-Parameter sowie Intent und Variante im Testpfad geprüft |
| `git diff --check` | bestanden |

### Lighthouse, lokale produktionsnahe Gzip-Auslieferung

| Profil | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT |
|---|---:|---:|---:|---:|---:|---:|---:|
| Mobile | 99 | 100 | 100 | 100 | 2,2 s | 0 | 0 ms |
| Desktop | 100 | 100 | 100 | 100 | 0,7 s | 0 | 0 ms |

Diese Werte sind ein Labor-Benchmark und kein Google-Ads-Quality-Score. Nach einer Veröffentlichung müssen Cloudflare-Response, echte Conversionpfade, Google-Ads-Landingpage-Erfahrung und Felddaten erneut geprüft werden.

## Bewusst nicht umgesetzt

- Keine Veröffentlichung, keine Cloudflare-Routingänderung und keine Google-Ads-Änderung.
- Die optionalen Nachfragen nach der Hauptanfrage – „möglichst genaue CI-Umsetzung“ versus „möglichst günstiger Preis“, konkretes Mockup-Setting und Anfrage für eigenen Bedarf oder Kunden – sind Phase 2. Sie werden erst ergänzt, wenn ein langlebiger Enrichment-Endpunkt vorhanden ist; die Angaben werden nicht nur clientseitig vorgespielt.
- `/api/c` bestätigt aktuell die Annahme und stößt die Weiterleitung über `ctx.waitUntil` an. Das ist noch keine datenbank-durable Speicherung. Deshalb lautet UI und Tracking bewusst `lead_accepted`, nicht `lead_saved`. Trello bleibt Projektion, nicht Source of Truth.

## Bekannte QA-Einschränkung

Der echte Browser-Dateiupload konnte automatisiert nicht abgeschlossen werden, weil in der ChatGPT-Chrome-Erweiterung „Allow access to file URLs“ deaktiviert ist. Die Upload-Validierung, Event-Verkabelung und der alternative Pfad „Design später senden“ wurden geprüft. Für den letzten echten Uploadtest muss die Browserberechtigung aktiviert werden.

## Rollback- und Release-Gate

Der Pilot ist durch `layout: "logo-pilot"` nur für `/logo/` aktiviert. Ein Rollback kann die Layout-Auswahl und die neue Sektionskonfiguration zurücknehmen, ohne das Basislayout anderer Seiten anzufassen.

Vor einer Veröffentlichung gelten zwingend:

1. Review der finalen Screenshots und Texte.
2. Echter Datei-Upload gegen die vorgesehene Testumgebung.
3. Prüfung von `/logo/`, `/api/c`, `/api/r`, Consent und Conversion-Deduplizierung auf der Zielumgebung.
4. Sauberer Commit im dedizierten Worktree.
5. `codex-predeploy offers` ausführen und ausschließlich den dort ausgegebenen Commit veröffentlichen.
6. Nach Veröffentlichung Pfad-, Tracking-, Lighthouse- und Google-Ads-Final-URL-QA; bei Abweichungen Rollback auf den vorherigen Commit.
