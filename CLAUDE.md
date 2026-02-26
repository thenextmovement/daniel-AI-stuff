# NEONTRIP B2B Website

## Projekt
Premium B2B Landing Page für NEONTRIP (Dara Nova GmbH) – Custom LED Neon Leuchtreklame aus Düsseldorf.
Zielgruppe: Agenturen, Messebauer, Ladenbauer, Marken, Gastronomie. Sprache: Deutsch.

### Produktfokus nach Landing Page
- **Haupt-LP (landing-new.html)**: Fokus auf Neon/LED Schriftzüge (beste Ads-Performance)
- **Anfrageformular**: Alle Produkte wählbar (Neon, 3D Buchstaben, Leuchtkästen, etc.)
- **Spätere LPs**: Eigene Pages für 3D Buchstaben, Leuchtkästen, B2B-Branchen

## Hauptdatei
- `index.html` ist DIE Seite – Ausgangspunkt für alles
- `landing-new.html` – aktuelle Entwicklung der neuen Lead-Gen LP
- Neue Versionen als Kopie (index2.html etc.), index.html nie überschreiben
- Tailwind CSS via CDN, Vanilla JS inline, Google Fonts Inter

## Design-Richtung
Die index.html zeigt bereits den richtigen Stil. Das Grundgefühl beibehalten:
- Clean, minimalistisch, viel Weißraum
- Farbschema: Schwarz (#0A0A0A), Weiß (#FFFFFF), Grautöne + Akzentfarbe (#6D28D9 Deep Violet)
- Font: Inter, schlank gehalten (max semibold/600)
- Große Typografie mit engem Tracking bei Headlines
- Subtile Animationen, nichts Überladenes

Das sind Leitlinien, keine starren Pixel-Vorgaben. Eigene kreative Entscheidungen sind erw√ºnscht, solange das Premium-Gef√ºhl erhalten bleibt.

## Referenz-Websites f√ºr den Stil
Diese Seiten zeigen die Richtung (nicht kopieren, nur als Inspiration):
- palmer-template.framer.website
- calisto.framer.website
- sadewa.framer.website

## Harte Regeln (diese IMMER einhalten)
- Umlaute: Echtes UTF-8 (ü, ä, ö, ß) – niemals ue, ae, oe
- Schreibweise: NEONTRIP (Großbuchstaben)
- Testimonials: Nur echte Namen (Julia Termeyer, Lukas Mann, Anna Wellner, Fabian Meister) – keine erfundenen
- E-Mail: mailto:support@neontrip.de
- Telefon: +49-211-54257240
- Keine Emojis als Icons, SVGs verwenden

## Footer (auf allen Seiten außer anfrage.html)
Der Footer ist zweigeteilt:
1. **Grauer Bereich (bg-light)**: Menü-Spalten (Produkte, Seiten, Rechtliches, Kontakt)
2. **Schwarzer Bereich (bg-dark)**: Stats-Zahlen, großes Logo, Copyright

### Kontakt-Spalte
- Telefon: In Accent-Farbe, verlinkt (`tel:+4921154257240`)
- E-Mail: In Accent-Farbe, verlinkt (`mailto:support@neontrip.de`)
- Öffnungszeiten: Untereinander formatiert (Montag – Freitag / 9:00 – 17:00 Uhr)
- Firmenname: "NEONTRIP" (nicht "Dara Nova GmbH")
- Adresse: Bilker Allee 29, 40219 Düsseldorf

### Schwarzer Bereich
- Stats mit animierten Countern (21.000+ Bestellungen, 4.9/5 Google, 99% Pünktlich, 3 Tage Express)
- Großes weißes NEONTRIP Logo (volle Breite)
- Copyright: "© NEONTRIP 2026"
- Legal Links: AGB, Datenschutz, Impressum

## Logo-Assets (Shopify CDN)
- Favicon: https://cdn.shopify.com/s/files/1/0534/7819/5350/files/neontrip-logo.svg?v=1765972594
- Logo Weiß: https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_weiss_neontrip.png?v=1688479088
- Logo Schwarz: https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146

## Ressourcen
- Design-Patterns (optional): Skill premium-webdesign – als Werkzeugkasten, nicht als Vorlage
- Content und Bild-URLs: claude-design-study-prompt.md und PROJECT-CONTEXT.md


## 21st.dev als Design-Referenz
- Nutze 21st_magic_component_builder um Komponenten als Vorlage zu finden
- Übernimm NUR Layout, Spacing und Animation-Patterns
- Übersetze ALLES in plain HTML + Tailwind CSS – kein React, kein JSX, keine npm Dependencies
- Passe Farben, Fonts und Content auf den NEONTRIP-Stil an
- Die Komponente ist Inspiration, nicht Copy-Paste

## Qualitätsregel
- Performance beachten: Animationen sollten flüssig laufen (60fps)
- Mobile: Komplexe Effekte ggf. reduzieren oder deaktivieren
- Premium-Gefühl im Vordergrund – nicht überladen

## Qualitätsmerkmale (bei jedem Build beachten)
- Micro-Interactions: Hover-Skalierung auf Buttons, subtiler Schatten auf Karten, animierte Underlines auf Links
- Scroll-Color-Theme: Sections wechseln zwischen hell und dunkel, Header/Logo passt sich automatisch an
- Hero: Visueller Hook – nicht nur Text, sondern Produktfoto oder subtile Animation die sofort fesselt
- Social Proof: Client-Logos groß und prominent, Case Studies mit echten Installationsfotos
- Mobile First: Touch-Targets min 44px, responsive auf allen Geräten
- Performance: Lazy Loading für Bilder (loading="lazy"), Font Preload, optimierte Assets
- CTA: Sticky Button beim Scrollen sichtbar, mehrere Kontaktwege (Formular, WhatsApp, Calendly)

## Conversion-Ziele
Hauptziel: Lead-Generierung – Besucher soll Angebotsanfrage stellen (Logo/Design hochladen)
- Primär: Anfrageformular ausfüllen (geht direkt ins System, alle relevanten Infos werden abgefragt)
- Sekundär: E-Mail schreiben, Anrufen, WhatsApp
- Tertiär: Lookbook oder Technische Daten PDF downloaden (Lead-Capture für noch nicht kaufbereite Besucher)

### Umsetzung
- Sticky WhatsApp-Button (immer sichtbar beim Scrollen)
- Anfrageformular mit Datei-Upload prominent platziert
- Mehrere CTA-Punkte über die Seite verteilt (nicht nur am Ende)
- Telefonnummer und E-Mail immer sichtbar im Header/Footer
- Lookbook + Technische Daten als Download-Bereich (optional mit E-Mail-Abfrage für Lead-Capture)
- Jede Section soll Richtung Anfrage führen – die gesamte Seite existiert für Lead-Generierung

## SEO-Optimierung & Google Ads Strategie
Validiert mit Google Keyword Planner (Feb 2026) + historische Ads-Daten (302k€ Spend, 3.011 Leads, Feb 2024–2026).

### Produktportfolio NEONTRIP (alles anbietbar)
Neon Flex, LED Schriftzüge, 3D Buchstaben (front-/rückbeleuchtet), Unbeleuchtet, Sonderanfertigung, Leuchtkästen, Nasenschilder, Leuchtboxen, Profilbuchstaben, LED Firmenschilder, Werbeschilder, Neonlampen

### Historische Ads-Benchmarks (Zielwerte für neue LPs)
- Ø Conversion Rate: 3–4% (Ziel neue LP: 5–6%)
- Ø CPC Search: 3–4€
- Ø Cost/Lead Search: 95–115€
- Ø CTR Search: 6–7%
- Brand Cost/Lead: 29€ | Remarketing: 31€ | PMax: 79€
- Primäres Conversion-Event: nerdy form submitted

### Keyword-Gruppen mit Suchvolumen + historischer Ads-Performance

#### Gruppe 1: Leuchtreklame – 4.060 Suchen/Monat | 655 hist. Leads | 110–169€/Lead
Haupt-Keyword-Gruppe, höchstes Suchvolumen, solide Lead-Kosten.
- leuchtreklame (3.600) → H1, Title Tag, Meta Description
- led leuchtreklame (210) → H2, Fließtext
- leuchtreklame kaufen (110) → CTA-Buttons
- leuchtreklame individuell (50) → H2/H3, USP-Text
- leuchtreklame hersteller (30) → About/USP Sektion
- leuchtreklame firma (30) → B2B-Sektion, Case Studies
- leuchtreklame düsseldorf (30) → Footer, LocalBusiness Schema

#### Gruppe 2: Neon Schilder – 5.910 Suchen/Monat | 295 hist. Leads | 109€/Lead
Größtes Suchvolumen, starke Conversion.
- neon sign (2.400) → H2, Alt-Tags (DE-Markt sucht auch englisch!)
- neon schild (1.900) → H1 alternativ, H2, Fließtext
- neon schild personalisiert (720) → Konfigurator-CTA, H2
- neon leuchtschrift (390) → H2, Fließtext
- led neon schild (260) → Fließtext
- neon schild selbst gestalten (170) → Konfigurator-Link
- neon schild logo (70, CPC 3–12€!) → B2B-Upload-CTA
- neon schild bar (70) → Branchen-Sektion Gastro

#### Gruppe 3: LED Schriftzüge – BESTER SEARCH-PERFORMER | 424 hist. Leads | 95€/Lead
Niedrigster Cost/Lead im Search! Unbedingt eigene Sektion.
- led schriftzug → H2, Konfigurator (Ad-Group #2 nach Leads!)
- led schriftzug individuell → Konfigurator, H2
- led leuchtschriften → Fließtext
- led neon schriftzug → Alt-Tags
- neon schriftzug personalisiert → CTA-Text

#### Gruppe 4: Leuchtbuchstaben / 3D – 1.730 Suchen/Monat
- leuchtbuchstaben (1.600) → Eigene Sektion/H2
- 3d logo beleuchtet (70) → B2B-Sektion
- 3d buchstaben beleuchtet (50) → Produktkategorie
- profilbuchstaben beleuchtet (10) → Fließtext

#### Gruppe 5: Leuchtkästen – 2.920 Suchen/Monat
- leuchtkasten (2.900) → Eigene Sektion/H2
- leuchtkasten mit logo (20) → Fließtext

#### Gruppe 6: Firmenschilder / Werbeschilder – 730 Suchen/Monat
- werbeschild beleuchtet (480) → H2, Alt-Tags
- firmenschild beleuchtet (90) → B2B-Sektion
- ladenschild beleuchtet (90) → Branchen-Sektion Retail
- firmenschild led (70) → Fließtext
- firmenlogo beleuchtet → B2B-Sektion (historisch gute Ads-Performance)

#### Gruppe 7: Neonlampen / Neonlicht – 248 hist. Leads | 114€/Lead
Gutes Volumen im Ads-Account, eher B2C aber konvertiert.
- neonlampe / neon lampe → Fließtext, Alt-Tags
- neonlicht → Fließtext
- neon wandleuchte → Alt-Tags

#### Gruppe 8: Branchen & Informational (für spätere LPs + Content)
- leuchtreklame gastronomie (30) → Branchen-LP
- leuchtreklame kosten (20) → FAQ
- leuchtreklame preise (10) → FAQ/Pricing
- neon schild express → Express-Sektion (82 Leads bei 115€/Lead!)

### Suchintention-Mapping
- Transaktional (kaufbereit): kaufen, bestellen, hersteller, personalisiert, express → direkt zu CTA
- Kommerziell (vergleicht): individuell, selbst gestalten, mit logo, kosten → Konfigurator/Showcase
- Informational (recherchiert): kosten, preise, genehmigung → FAQ/Content
- Navigational (sucht Anbieter): düsseldorf, hersteller, neontrip → Trust/About
- B2B (hohes Ticket): firma, firmenlogo, logo, messe, laden → B2B-Sektion mit Cases

### Ad-Gruppen-Struktur (für Google Ads Kampagnen)
1. BRAND NEONTRIP → Haupt-LP (29€/Lead – immer aktiv!)
2. LEUCHTREKLAME → Haupt-LP (Gruppe 1)
3. NEON SCHILDER → Haupt-LP oder eigene LP (Gruppe 2)
4. LED SCHRIFTZÜGE → Haupt-LP mit eigener Sektion (Gruppe 3, bester Performer!)
5. LEUCHTBUCHSTABEN & 3D → eigene LP mit 3D-Fokus (Gruppe 4)
6. LEUCHTKÄSTEN → eigene LP (Gruppe 5, hohes Volumen!)
7. FIRMENSCHILDER B2B → eigene LP mit B2B-Cases (Gruppe 6)
8. NEONLAMPEN → optional, eher B2C (Gruppe 7)
9. GEO BERLIN → eigene LP oder Haupt-LP mit Berlin-Bezug (142 Leads, 102€)
10. GEO MÜNCHEN → Haupt-LP (56 Leads, 106€)
11. REMARKETING → Display, alle LPs (31€/Lead!)
12. PERFORMANCE MAX → alle LPs (79€/Lead, Volumen-Bringer)

### Trust-Elemente & Siegel (auf LP und Formular-Seite)

#### Externe Siegel (einbinden)
- Google Bewertungen Widget (kostenlos, stärkster Trust-Signal, Rich Snippets in Ads)
- ProvenExpert Siegel (Free oder Plus-Plan, bündelt alle Bewertungen, DACH-Standard für B2B/KMU)
- Optional: Trusted Shops (für Shopify-Shop, ab 99€/Monat)
- SSL/HTTPS Badge neben Formularen ("Sichere Verbindung")

#### Eigene Trust-Badges (selbst erstellen, SVG-Icons)
- "Über 2.000 Projekte realisiert" (echte Zahl verwenden)
- "Bekannt aus:" + Client-Logo-Leiste (Campari, Schwarzkopf, New Balance, Smart, Aperol, immowelt etc.)
- "Made in Düsseldorf · Seit 2020"
- "24h Angebot · Kostenlose Beratung"
- "DSGVO-konform" (wichtig neben Formularen)
- "Express-Produktion möglich"

#### Platzierung
- Hero-Section: Client-Logos als Marquee/Leiste
- Formular-Seite: Google-Sterne + ProvenExpert-Siegel + "DSGVO" + "Sichere Verbindung" neben Submit
- Footer: Alle Siegel gesammelt (ProvenExpert, Google, SSL, Made in Düsseldorf)
- CTA-Bereiche: "Über 2.000 Projekte" + "24h Angebot" als Micro-Trust direkt neben Buttons

### AI-Search & Bing-Optimierung
Neben Google auch für Bing, ChatGPT, Copilot, Perplexity und andere AI-Suchsysteme optimieren.

#### Technische Basis
- Bing Webmaster Tools verifizieren (DNS oder Meta-Tag)
- IndexNow implementieren: API-Key als JSON-File im Root (/indexnow-key.json), bei jedem Content-Update Bing aktiv pingen
- Meta-Tag: <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
- Bing-spezifische Meta-Tags: <meta name="msvalidate.01" content="[KEY]"> nach Verifizierung

#### Structured Data (erweitert für AI-Parsing)
- LocalBusiness Schema (Dara Nova GmbH, Düsseldorf) – Pflicht
- Product Schema für jede Produktkategorie (Neonschild, 3D-Buchstaben, Leuchtkasten etc.)
- FAQ Schema für Kosten/Preis/Ablauf-Fragen – wird direkt in AI-Antworten gezogen
- Organization Schema mit Logo, Gründungsjahr, Standort
- Review/AggregateRating Schema (wenn Google/ProvenExpert Bewertungen vorhanden)

#### AI-zitierbarer Content
AI-Systeme suchen klare, faktische Sätze die sie direkt zitieren können. Auf der LP diese Fakten-Sätze einbauen:
- "NEONTRIP ist ein Hersteller für individuelle Leuchtreklame, LED Schriftzüge und Neon Schilder aus Düsseldorf."
- "Über 2.000 Projekte realisiert für Marken wie Campari, Schwarzkopf, New Balance, Smart und Aperol."
- "Produkte: Neon Flex Schilder, 3D-Buchstaben (front-/rückbeleuchtet), Leuchtkästen, Profilbuchstaben, Sonderanfertigungen."
- "Kostenlose Beratung und unverbindliches Angebot innerhalb von 24 Stunden."
- "Firmensitz: Dara Nova GmbH, Düsseldorf. Produktion und Versand deutschlandweit."

Diese Sätze in semantischem HTML platzieren (nicht in Bildern oder JS-generiert), damit Crawler und AI-Parser sie lesen können.

#### FAQ-Section (für Featured Snippets + AI-Antworten)
Folgende Fragen als FAQ-Schema + sichtbare Section auf der LP:
- "Was kostet eine individuelle Leuchtreklame?" → Preisrahmen, Faktoren, CTA
- "Wie lange dauert die Produktion?" → Standardlieferzeit + Express-Option
- "Welche Materialien werden verwendet?" → LED Neon Flex, Acryl, Aluminium etc.
- "Kann ich mein eigenes Logo als Neonschild bekommen?" → Ja + Upload-CTA
- "Liefert NEONTRIP deutschlandweit?" → Ja, Produktion in Düsseldorf, Versand überall
- "Brauche ich eine Genehmigung für Außenwerbung?" → Kurze Info + Beratungsangebot

#### Open Graph & Social
- og:title, og:description, og:image auf jeder Seite (wird von AI-Systemen als Zusammenfassung genutzt)
- Twitter Card Tags (summary_large_image)
- Canonical URL immer setzen

### Technische SEO-Anforderungen
- Title Tag: Max 60 Zeichen, Haupt-Keyword vorne
- Meta Description: Max 155 Zeichen, mit CTA und Keyword
- H1: Nur EINE pro Seite, enthält Haupt-Keyword der jeweiligen Ad-Gruppe
- H2s: Jede Section bekommt eine H2 mit relevantem Keyword
- Alt-Tags: Jedes Bild bekommt beschreibenden Alt-Tag mit Keyword
- Structured Data: LocalBusiness Schema (Dara Nova GmbH, Düsseldorf) + Product Schema
- Canonical URL, Open Graph Tags, Semantisches HTML
- Ladezeit: Bilder komprimiert, Fonts preloaded, CSS/JS minimiert
- Mobile First: Google indexiert mobile Version zuerst
