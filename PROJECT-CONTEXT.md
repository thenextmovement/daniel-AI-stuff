# NEONTRIP Website – Projekt-Kontext & Designentscheidungen

> Diese Datei enthält alle Designentscheidungen, die im Planungsprozess getroffen wurden.
> Lies diese Datei zusammen mit `.cursorrules` und `assets/images/IMAGE-REFERENCE.md`.

---

## Marke & Unternehmen

- **Markenname:** NEONTRIP (IMMER Großbuchstaben, niemals "NeonTrip" oder "Neontrip")
- **Firma:** Daranova GmbH
- **Adresse:** Bilker Allee 29, 40219 Düsseldorf
- **Telefon:** +49-211-54257240
- **E-Mail:** info@neontrip.de / support@neontrip.de
- **Website:** www.neontrip.de (existierender Shopify-Store)
- **Google Bewertungen:** 4.9/5 (236 Bewertungen)
- **Social Media:** Facebook, Instagram, Pinterest, YouTube, TikTok, LinkedIn

## Ziel der neuen Website

B2B-Landingpage für Custom LED Neon Leuchtreklame. NICHT der Shopify-Shop, sondern eine separate Lead-Generation-Website mit Multi-Step Formularen. Zielgruppe: Agenturen, Messebauer, Gastronomie, Unternehmen, Marken.

## Design-Referenzen

1. **www.sygns.de** – Clean, hell, minimal, Premium. Aber NUR als Referenz für den cleanen Stil, nicht kopieren.
2. **Eigene Framer-Landingpage** (NEONTRIP LP | Video Hero) – DAS ist das Qualitätslevel das erreicht werden muss. Merkmale:
   - Splash-Screen mit Logo-Animation beim Laden
   - Logo-Karussell (Marquee) statt statischer Logo-Leiste
   - Scrolling Counter Numbers (Zahlen zählen hoch)
   - Projekte-Grid mit Kategorien-Tabs (Events, Gastronomie, Ladenbau, Messen, Büros)
   - Dunkle CTA-Sektion "Lassen Sie uns reden" mit persönlichem Ansprechpartner
   - Dunkler Footer mit riesigem NEONTRIP Logo
   - Abwechselnde Sektionen: Weiß → Grau → Weiß → Dunkel → Weiß
   - FAQ als Accordion

## Farbschema (FINAL)

Schwarz/Weiß/Grau – KEINE bunten Akzentfarben.

```css
:root {
  --bg-primary: #FFFFFF;
  --bg-secondary: #F5F5F5;
  --bg-dark: #0A0A0A;
  --bg-dark-secondary: #141414;
  --text-primary: #0A0A0A;
  --text-secondary: #6B6B6B;
  --text-on-dark: #FFFFFF;
  --text-muted-on-dark: #999999;
  --border: rgba(0,0,0,0.08);
  --border-on-dark: rgba(255,255,255,0.1);
}
```

## Typografie (FINAL)

NUR Google Fonts Inter. Keine andere Schrift.

- Überschriften: Inter Semibold (600)
- Fließtext: Inter Regular (400)
- Labels/Badges: Inter Medium (500), uppercase, letter-spacing 0.1em

## Icons

- SVG Inline-Icons von Lucide (https://lucide.dev/) oder gleichwertig
- Dünne Linienstärke (stroke-width: 1.5), monochrome
- NIEMALS Emojis verwenden

## Produktkategorien (von neontrip.de)

1. Neon LED Logos & Schriftzüge
2. 3D Buchstaben Rückbeleuchtet
3. 3D Buchstaben Frontbeleuchtet
4. 3D Buchstaben Unbeleuchtet
5. Marquee Buchstaben
6. Halo Deckenleuchten
7. Messe & Event Installationen
8. Sonderanfertigungen

## Referenzkunden (35+ bestätigt, aus Lookbook S.102)

Google, Porsche, Telekom, Zalando, Puma, FC Bayern München, EDEKA, Bosch, ERGO, RTL, ARD, NDR, New Balance, Valentino, Sephora, Douglas, Schwarzkopf, Kiehl's, Aperol, DB Schenker, Celonis, Absolut, DFB, XING, Vapiano, FIBO, Köln Bonn Airport, Perwoll, Playmobil, Ploom, Deutsche Telekom

→ Für die Logo-Marquee: Einzelne SVGs/PNGs verwenden, NICHT den Lookbook-Screenshot

## USPs (harte Fakten)

- Expresslieferung in 1-4 Tagen (bei Eil auch schneller)
- Angebot + Visualisierung in 6 Stunden
- Rückruf von Experten in 30 Minuten
- 24 Monate Garantie
- 10 Jahre Lebensdauer (ECOPOWER LEDs)
- Bestpreis-Garantie
- Kostenloser Versand
- Eigenes Ladenlokal in Düsseldorf
- Flackerfrei für Videoaufnahmen
- Einfache Montage (Plug & Play)

## Zahlen für Scrolling Counter

- 21.000+ Bestellungen
- 99% Pünktliche Lieferung
- 4.9/5 Google Bewertung
- 7 Tage Expresslieferung
- 35+ Premium-Referenzen
- 240+ Erfolgreich abgeschlossene B2B-Projekte

## Kundenstimmen

1. Julia Termeyer, Leiterin Einkauf, Cocoyu Agency – Kreativität, schnelle Reaktionszeit
2. Roland Heithorst, KN Events – Eye-Catcher auf Events, kurzfristige Anfragen realisiert
3. Nadja Barowski, Elexier Tattoo – bereits 3. Leuchtschild, schnell und zuverlässig
4. Fabian Meister – Ladenlokal in Düsseldorf besucht, persönliche Beratung
5. Lukas Mann – Angebot mit Entwurf in nur 45 Minuten
6. Anita Hellschmidt – Lieferung in 8 Tagen, App-Steuerung aller Farben

## Bildquellen

### Lokal (assets/images/)
Optimierte JPG + WebP Bilder, sortiert nach Sektionen. Siehe IMAGE-REFERENCE.md für Alt-Tags.

### Shopify CDN (direkt verlinken)
Produktfotos von neontrip.de (Prada, Cartier, Rolex, Omega, Samsonite etc.) – URLs in .cursorrules

### Referenz-Logos (Shopify CDN SVGs)
Für die Logo-Marquee einzelne SVG-Logos verwenden – URLs in .cursorrules

## Logo-Assets

- Favicon: `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/neontrip-logo.svg?v=1765972594`
- Logo Weiß (Header): `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_weiss_neontrip.png?v=1688479088`
- Logo Weiß klein (Mobile): `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/weiss_logo_NEONTRIP.png?v=1764003450`
- Logo Schwarz: `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146`

## Animationen (PFLICHT)

1. **Splash Screen** – Schwarz, Logo faded ein, Overlay gleitet nach oben weg
2. **Logo-Marquee** – Endloser horizontaler Scroll der Kundenlogos
3. **Scrolling Counter** – Zahlen zählen von 0 hoch (Intersection Observer + requestAnimationFrame)
4. **Scroll-Reveal** – Jedes Element faded von unten ein beim Scrollen (staggered delays)
5. **Image Reveals** – Bilder werden mit clip-path aufgedeckt
6. **FAQ Accordion** – Smooth open/close mit Plus→Minus Icon-Rotation
7. **Button Hover** – Subtle fill-Effekt von links nach rechts
8. **Card Hover** – translateY(-4px) + shadow

## Multi-Step Formular (auf den Anfrage-Landingpages)

Psychologie-basiert (Cialdini): Kleine Schritte, Progress Bar, Micro-Conversions.
4 Steps: Was möchten Sie? → Projekt-Details → Kontaktdaten → Bestätigung.
FormData POST an: `https://api.neontrip.de/anfrage` (Platzhalter für n8n Webhook)

## Seitenstruktur

- `index.html` – Startseite (alle Sektionen)
- `anfrage-logo.html` – Landingpage Firmenlogo
- `anfrage-schriftzug.html` – Landingpage Schriftzug/Text
- `anfrage-messe.html` – Landingpage Messe & Event
- `anfrage-gastronomie.html` – Landingpage Gastronomie
- `anfrage-office.html` – Landingpage Büro & Empfang
- `anfrage-sonder.html` – Landingpage Sonderanfertigung
- `impressum.html`, `datenschutz.html`, `agb.html`

## Deployment

Cloudflare (wie bestehende brand-inflatables Seite)
