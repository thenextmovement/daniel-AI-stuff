# NEONTRIP B2B Website

## Projekt
Premium B2B Landing Page für NEONTRIP (Dara Nova GmbH) – Custom LED Neon Leuchtreklame.
Sitz: Düsseldorf, Bilker Allee 29, 40219. Web: neontrip.de
Zielgruppe: Agenturen, Messebauer, Ladenbauer, Marken, Gastronomie. Sprache: Deutsch.

## Tech Stack
- Single-file: `landing.html` (alles inline – CSS, JS, HTML)
- Tailwind CSS via CDN: `<script src="https://cdn.tailwindcss.com"></script>`
- Vanilla JavaScript (inline `<script>` am Ende der Datei)
- Google Fonts: NUR Inter (400, 500, 600) via CDN

## Design-Regeln – IMMER einhalten

### Farben
- Dark: #0A0A0A
- Background: #F0F0F1
- Cards/White: #FFFFFF
- VERBOTEN: Lila, Blau, Grün, Cream, Off-White, oder jede andere Akzentfarbe

### Typografie
- Font: NUR Inter – KEIN Sora, Montserrat, Space Grotesk oder zweiter Font
- font-weight: MAXIMAL 600 (semibold) – NIEMALS 700, 800 oder bold/extrabold
- Tracking: -0.03em (Body) → -0.04em (Sub-Headlines) → -0.06em (Mega-Headlines)
- Je größer die Schrift, desto enger das Tracking

### Sprache und Encoding
- Umlaute: IMMER echte UTF-8 (ü, ä, ö, ß) – NIEMALS ue, ae, oe, ss
- `<meta charset="UTF-8">` muss in Zeile 1 nach `<head>` stehen
- Schreibweise: NEONTRIP (komplett Großbuchstaben, immer)

### Cards und Komponenten
- Card-Radius: rounded-[18px], Border: border border-black/5
- Bilder in Cards: rounded-[14px] mit overflow-hidden
- Dark Overlay auf Bilder: bg-[#0A0A0A]/15
- Hover: group-hover:scale-105 transition-transform duration-700
- Icons: SVG stroke-only, stroke-width 1.5, 24x24 – KEINE Emojis, KEINE Font-Icons

### Dark Sections
- Card in Card: 6px inset zeigt hellen Hintergrund als Rahmen
- Innerer Container: bg-[#0A0A0A] rounded-[25px]
- Noise-Texture Overlay mit opacity-[0.05]

### Animationen
- Scroll Reveal: opacity 0 + translateY(40px) → visible
- Easing: cubic-bezier(0.16, 1, 0.3, 1)
- Duration: 700-900ms
- IntersectionObserver threshold: 0.05
- Stagger: +100ms pro Element

### Layout
- Container: max-w-[1520px] mx-auto
- Section Padding: py-16 md:py-24
- Breakpoints: 375px (Mobile) → 768px (Tablet) → 1024px (Desktop) → 1520px (Wide)

## Content-Regeln
- Testimonials: NUR echte deutsche Namen (Julia Termeyer, Lukas Mann, Anna Wellner, Fabian Meister)
- KEINE erfundenen Testimonials, KEINE Stockfoto-Avatare → Initialen-Avatare verwenden
- E-Mail: mailto:support@neontrip.de – KEIN Cloudflare Email Protection
- Telefon: +49-211-54257240
- Footer-Links: agb.html, datenschutz.html, impressum.html

## Logo-Assets (Shopify CDN – direkt einbinden)
- Favicon: `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/neontrip-logo.svg?v=1765972594`
- Logo Weiß (Header dark): `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_weiss_neontrip.png?v=1688479088`
- Logo Schwarz (Header light): `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146`

## Verfügbare Ressourcen
- Design-Patterns: Skill `premium-webdesign` enthält Tailwind-Code-Patterns aus 6 Award-Websites
- Kompletter Build-Auftrag: `claude-design-study-prompt.md` im Root
- Alter Kontext: `PROJECT-CONTEXT.md` – Referenzkunden, Shopify CDN URLs, Testimonials, FAQ

## Befehle
- Lokaler Server: `python3 -m http.server 8080`
- Ansehen: http://localhost:8080/landing.html

## Qualitäts-Check vor Abgabe
1. Keine Umlaute-Fehler (ü nicht ue)
2. Kein font-weight über 600
3. Keine Farben außer #0A0A0A, #F0F0F1, #FFFFFF
4. Kein zweiter Font außer Inter
5. Alle Bilder mit loading="lazy"
6. Mobile 375px getestet
7. Alle Links funktional (mailto, tel, Footer)
8. Echte Testimonial-Namen, keine Fakes
9. Noise-Texture auf allen Dark Sections
10. Scroll-Reveal Animationen auf allen Sektionen
