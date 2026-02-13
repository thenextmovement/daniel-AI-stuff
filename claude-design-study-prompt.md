# NEONTRIP Website Rebuild – Design-Studium für Cursor

## Deine Rolle

Du bist ein Senior Landing Page Designer mit 15 Jahren Erfahrung im Premium-Webdesign für B2B-Unternehmen. Du baust keine Templates nach – du designst Erlebnisse.

Dein Auftrag: Baue `landing.html` komplett neu. Eine kohärente, conversion-optimierte Premium-Website, die sich anfühlt als hätte EIN Designer sie in einem Guss entworfen.

---

## PHASE 1: Design-Patterns Bibliothek

Diese Patterns stammen aus 6 preisgekrönten Framer-Websites (Palmer, Calisto, Quantum, Pandawa, Sadewa, Fabrica). Sie sind dein Werkzeugkasten. Kopiere sie nicht 1:1 – verstehe die Prinzipien und wende sie kreativ an.

### Pattern A: Sektions-Label-System
Jede Sektion bekommt ein kleines Label oben links. Das schafft visuellen Rhythmus und Orientierung.

```html
<!-- Light Section -->
<div class="flex items-center gap-2 mb-6">
  <div class="w-4 h-4 bg-[#0A0A0A] rounded-full flex items-center justify-center">
    <span class="w-[2px] h-2 bg-white block"></span>
  </div>
  <span class="text-sm font-medium tracking-[0.04em] text-[#0A0A0A]/60">Ausgewählte Projekte</span>
</div>

<!-- Dark Section (invertiert) -->
<div class="flex items-center gap-2 mb-6">
  <div class="w-4 h-4 bg-white rounded-full flex items-center justify-center">
    <span class="w-[2px] h-2 bg-[#0A0A0A] block"></span>
  </div>
  <span class="text-sm font-medium tracking-[0.04em] text-white/60">Was wir anbieten</span>
</div>
```

**Prinzip:** Jede Sektion hat eine klare Identität. Der Label gibt dem User Kontext bevor er die Headline liest.


### Pattern B: Typografische Hierarchie
Die Kraft liegt im Kontrast: RIESIGE Headlines neben winzigen Labels.

```html
<!-- Mega-Headline -->
<h2 class="text-[62px] md:text-[144px] font-semibold leading-[0.92] tracking-[-0.06em] text-[#0A0A0A]">Projekte.</h2>

<!-- Sub-Headline mit Zwei-Farben-Trick -->
<h2 class="text-[32px] md:text-[60px] font-semibold leading-[1.1] tracking-[-0.04em] text-[#0A0A0A] max-w-[830px]">
  Premium LED Schriftzüge, <span class="text-[#0A0A0A]/60">für Marken, Events & Messen.</span>
</h2>

<!-- Body Text mit Zwei-Farben-Trick -->
<p class="text-lg md:text-[22px] font-medium leading-[1.2] tracking-[-0.03em] text-[#0A0A0A]/60 max-w-[550px]">
  <span class="text-[#0A0A0A]">Erster Satz dunkel.</span> Rest heller – lenkt den Blick.
</p>

<!-- Stat-Zahl -->
<div class="text-[48px] md:text-[64px] font-semibold tracking-[-0.07em] leading-none" data-count="240" data-suffix="+">0</div>
<p class="text-sm font-semibold tracking-[-0.03em] uppercase">Label</p>
<p class="text-xs font-medium tracking-[-0.03em] text-[#0A0A0A]/50 mt-1">Beschreibung</p>
```

**Prinzipien:**
- Headline-Sizes: 144px → 60px → 22px – krasse Unterschiede
- Zwei-Farben-Text: Erster Satz `text-dark`, Rest `text-dark/60`
- Tracking enger je grösser: -0.03em (Body) → -0.07em (Mega)
- MAXIMAL font-weight 600, NIEMALS 700/800


### Pattern C: Card-System

```html
<!-- Standard Card -->
<div class="bg-white rounded-[18px] p-6 md:p-8 border border-black/5">...</div>

<!-- Image Card (Projekte) -->
<div class="group rounded-[14px] overflow-hidden bg-white">
  <div class="flex items-center justify-between px-5 py-4">
    <div class="flex items-end gap-4">
      <span class="text-lg font-semibold tracking-[-0.03em]">Kategorie</span>
      <span class="text-xs font-medium text-[#0A0A0A]/60">/ Kunde</span>
    </div>
    <div class="flex gap-[3px]">
      <span class="w-2 h-2 rounded-full bg-gray-200"></span>
      <span class="w-2 h-2 rounded-full bg-gray-200"></span>
      <span class="w-2 h-2 rounded-full bg-gray-200"></span>
    </div>
  </div>
  <div class="relative aspect-[4/3] rounded-[14px] overflow-hidden">
    <div class="absolute inset-0 bg-[#0A0A0A]/15 z-10"></div>
    <img src="..." class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy">
  </div>
</div>
```

**Prinzipien:**
- Radius: `rounded-[18px]` für Cards, `rounded-[14px]` für Bilder darin
- Border statt Shadow: `border border-black/5`
- Three-Dot-Ornament oben rechts = UI-Feeling
- Hover-Zoom: `group-hover:scale-105 duration-700` – langsam und elegant
- Dark Overlay auf Bildern: `bg-dark/15` – unified look


### Pattern D: Dark Section "Card in Card"

```html
<section class="relative bg-[#F0F0F1] py-16 md:py-24 px-6 md:px-9">
  <div class="absolute inset-[6px] bg-[#0A0A0A] rounded-[25px] z-0">
    <div class="absolute inset-0 rounded-[25px] opacity-[0.05]"
         style="background-image: url('https://framerusercontent.com/images/rR6HYXBrMmX4cRpXfXUOvpvpB0.png'); 
                background-size: 256px; background-repeat: repeat;"></div>
  </div>
  <div class="relative z-10 max-w-[1520px] mx-auto">
    <!-- Weisser Text hier -->
  </div>
</section>
```

**Prinzip:** 6px Inset zeigt hellen Rand = "Floating Card"-Effekt. Noise-Texture gibt dem Schwarz Materialität.


### Pattern E: USP/Feature Grid

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <div class="bg-white rounded-[18px] p-6 md:p-8 border border-black/5">
    <svg class="w-6 h-6 text-[#0A0A0A] mb-4" viewBox="0 0 24 24" fill="none" 
         stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <!-- Pfad -->
    </svg>
    <h3 class="text-lg font-semibold tracking-[-0.03em] mb-2">Titel</h3>
    <p class="text-sm font-medium text-[#0A0A0A]/60">Beschreibung</p>
  </div>
</div>
```

**Prinzipien:** Icons IMMER SVG stroke-only (1.5), 24x24. KEINE Emojis, KEINE Font-Icons.


### Pattern F: Testimonial Card

```html
<div class="bg-white rounded-[18px] overflow-hidden">
  <div class="p-6">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-[46px] h-[46px] rounded-[7px] bg-[#0A0A0A]/10 flex items-center justify-center">
        <span class="text-sm font-semibold text-[#0A0A0A]/60">JT</span>
      </div>
      <div>
        <p class="text-lg font-semibold tracking-[-0.03em]">Name</p>
        <p class="text-xs font-medium text-[#0A0A0A]/60">Firma</p>
      </div>
    </div>
  </div>
  <div class="p-6 pt-0">
    <!-- SVG Sterne -->
    <p class="text-[15px] font-medium tracking-[-0.03em] leading-[1.4]">"Zitat..."</p>
  </div>
</div>
```


### Pattern G: Filter-Tabs

```html
<div class="flex flex-wrap gap-2 mb-8">
  <button class="filter-tab active px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 
                 bg-[#0A0A0A] text-white" data-filter="all">Alle</button>
  <button class="filter-tab px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 
                 bg-white text-[#0A0A0A]/60 hover:text-[#0A0A0A]" data-filter="events">Events</button>
</div>
```


### Pattern H: Personal Contact Card

```html
<div class="flex items-center gap-4 bg-white rounded-2xl p-1.5">
  <div class="w-[113px] h-[161px] rounded-xl overflow-hidden shrink-0">
    <img src="..." class="w-full h-full object-cover" alt="">
  </div>
  <div class="py-4 pr-4">
    <p class="text-sm font-semibold tracking-[-0.03em]">Customer Support</p>
    <p class="text-xs font-semibold text-[#0A0A0A]/60 mb-3">bei NEONTRIP</p>
    <p class="text-[22px] font-semibold tracking-[-0.03em] leading-tight mb-4">Fabienne Trapp</p>
    <a href="mailto:support@neontrip.de" class="inline-flex items-center gap-2 bg-[#0A0A0A] text-white text-xs font-semibold px-3 py-2 rounded-full">
      Jetzt Anfragen <span class="w-2 h-2 bg-white rounded-full"></span>
    </a>
  </div>
</div>
```


### Pattern I: Marquee / Infinite Scroll

```css
.marquee-track { display: inline-flex; animation: marquee 30s linear infinite; }
.marquee-track:hover { animation-play-state: paused; }
.marquee-mask { 
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%); 
  mask-image: linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%); 
}
@keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
```

**Prinzip:** Duplikate für nahtlosen Loop. Fade-Mask an Rändern. Pause bei Hover.


### Pattern J: Scroll Reveal

```css
.reveal { opacity: 0; transform: translateY(40px); 
  transition: opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1), transform 0.9s cubic-bezier(0.16, 1, 0.3, 1); }
.reveal.visible { opacity: 1; transform: translateY(0); }
```

```javascript
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObserver.unobserve(entry.target); }
  });
}, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
```

Staggered delays: `style="transition-delay: 0.1s"` auf aufeinanderfolgenden Elementen.


### Pattern K: Splash Screen

```css
.splash { position: fixed; inset: 0; z-index: 9999; background: #0A0A0A; display: flex; align-items: center; justify-content: center; }
.splash.exit { animation: splash-exit 0.7s cubic-bezier(0.76, 0, 0.24, 1) forwards; }
.splash.hidden { display: none; }
.splash-letter { display: inline-block; opacity: 0; filter: blur(5px); transform: translateY(60px); }
.splash-letter.visible { animation: splash-text 0.6s cubic-bezier(0.56, 0.22, 0.05, 0.99) forwards; }

@keyframes splash-text { 0% { opacity: 0; filter: blur(5px); transform: translateY(60px); } 100% { opacity: 1; filter: blur(0); transform: translateY(0); } }
@keyframes splash-exit { 0% { transform: translateY(0); } 100% { transform: translateY(-100vh); } }
```

Timing: Buchstaben nach 200ms + 80ms/Buchstabe. Exit nach 1800ms. Hidden nach 2500ms.

---

## PHASE 2: Farben, Typo, Spacing

### Farben
```
Primär:        #0A0A0A
Hintergrund:   #F0F0F1
Cards:         #FFFFFF + border: 1px solid rgba(0,0,0,0.05)
Text dunkel:   #0A0A0A
Text mittel:   rgba(10,10,10,0.6)
Text hell:     rgba(10,10,10,0.4)
```
**VERBOTEN: Lila, Blau, Grün, Rot, Orange.** Monochrom. Schwarz, Weiss, Grau. Punkt.

### Typo
- **NUR Inter** (Google Fonts: 400, 500, 600). KEIN Sora. KEIN zweiter Font.
- **MAXIMAL font-weight 600.** NIEMALS 700/800.

### Spacing
- Sektionen: `py-16 md:py-24`
- Container: `max-w-[1520px] mx-auto px-6 md:px-9`
- Headline→Content: `mb-12`
- Card-Gaps tight: `gap-1` | loose: `gap-4`

---

## PHASE 3: Kompletter Content & Architektur

Baue ALLES in eine Datei: `landing.html`. Tailwind CSS via CDN. JS inline am Ende.

---

### 1. SPLASH SCREEN
N-E-O-N-T-R-I-P einzeln einfliegen (blur+translateY). Font: `font-inter font-semibold italic text-4xl md:text-5xl tracking-[-0.05em] text-white`

### 2. HERO (Dark, min-h-screen)
- Video: `https://framerusercontent.com/assets/WhJOogHlaNXHRzlzRWUyNpmLgB8.mp4` (gedimmt)
- Badge: "Premium LED Neon · Düsseldorf"
- H1: **DEIN LOGO ALS LEUCHTSCHILD.**
- Sub: Premium LED Neon Leuchtreklame nach Maß für Unternehmen, Events, Messen und Gastronomie. Vertraut von Google, Porsche, Telekom und über 35 weiteren Top-Marken.
- CTAs: "Jetzt anfragen" (primary) + "Projekte ansehen" (ghost)
- Unten: Logo-Marquee "Unsere Kunden"

**Logos (Shopify CDN, brightness-200 opacity-80 auf Dark):**
```
Google:        https://cdn.shopify.com/s/files/1/0534/7819/5350/files/8_f6b1e195-5c9d-4fc7-8a70-ecdeb3821b8d.svg?v=1688462911
Porsche:       https://cdn.shopify.com/s/files/1/0534/7819/5350/files/22.svg?v=1688465348
Telekom:       https://cdn.shopify.com/s/files/1/0534/7819/5350/files/16.svg?v=1688465349
Vapiano:       https://cdn.shopify.com/s/files/1/0534/7819/5350/files/vapiano_c5d93e00-9aa9-4ca5-be26-1617d76c4819.svg?v=1690203832
Asbach:        https://cdn.shopify.com/s/files/1/0534/7819/5350/files/asbach.svg?v=1690204082
Absolut:       https://cdn.shopify.com/s/files/1/0534/7819/5350/files/absolut.svg?v=1691763651
PS:            https://cdn.shopify.com/s/files/1/0534/7819/5350/files/ps_logo.svg?v=1691764079
Staatstheater: https://cdn.shopify.com/s/files/1/0534/7819/5350/files/deutsche_staatsheater.svg?v=1691762848
```

### 3. STATS (Light)
| data-count | data-suffix | Label |
|------------|-------------|-------|
| 21000 | + | Bestellungen |
| 99 | % | Pünktliche Lieferung |
| 4.9 | /5 | Google Bewertung |
| 7 | Tage | Express Lieferung |

**Deine Design-Entscheidung:** 4 Spalten? 2x2? Asymmetrisch?

### 4. PROJEKTE (Light)
Label: "Ausgewählte Projekte" | Headline: **Projekte.** | Sub: Wir realisieren Neonschilder, Neonlampen und beleuchtete Firmenlogos für Unternehmen aus verschiedenen Branchen.

Filter-Tabs (Pattern G): Alle | Events | Gastronomie | Messen | Büros | TV & Podcasts

| Kategorie | filter | Kunde | Bild |
|-----------|--------|-------|------|
| Events | events | Asbach Uralt | `https://framerusercontent.com/images/CTyO7V6hj1gF7dmT4RqKZKULE.png?width=588&height=351` |
| Gastronomie | gastro | Fave Fusion | `https://framerusercontent.com/images/8APo9u3MNpN0V7xSGkXKpFUm9rs.jpeg?width=1322&height=1000` |
| Ladenbau | gastro | Kiehl's | `https://framerusercontent.com/images/hydT9E9GNvvos3edCemzFUw6yk4.jpg?width=2153&height=1587` |
| TV & Podcasts | tv | Wahr & Klar | `https://framerusercontent.com/images/vDFpcSxvuMN1dWhrmMP5QMtd0.png?width=2560&height=1434` |
| XXL-Schilder | events | Contact Gym | `https://framerusercontent.com/images/kB23JL9fB0OD84X1VxTA2NafQE.jpg?width=1360&height=907` |
| TV | tv | RTL | `https://framerusercontent.com/images/WLZ7w6AT08W32y9a6UIdZ97h4.jpg?width=1284&height=722` |
| Messen | messe | Smart | `https://framerusercontent.com/images/mA5WwE7zzMV2EaQshUQyPsbz4SA.jpg?width=1200&height=958` |
| Büros | office | AOK Rheinland | `https://framerusercontent.com/images/7AexYZM9lcbqD1Ud3Q3DnOnsDA.png?width=1024&height=1536` |

Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1`. Jede Card: `class="project-card" data-category="..."`

### 5. WARUM NEONTRIP (Light)
Label: "Warum NEONTRIP" | Headline: **Premium LED Schriftzüge, <span>für Marken, Events & Messen.</span>**

Layout: `lg:grid-cols-[400px_1px_1fr]`
- Links: Video-Card (Video: `https://framerusercontent.com/assets/XV8Q2CqZy57dS7z89N8f9aPGhY.mp4`, Hover: Text+CTA "Jetzt anfragen")
- Mitte: 1px Divider
- Rechts: Text + 2 Stat-Cards (240+ Projekte, 99% Pünktlich)

### 6. USPs (Light)
6 Cards (Pattern E), jede mit SVG-Stroke-Icon (24x24, stroke-width 1.5):

| Icon | Titel | Text |
|------|-------|------|
| Truck | Express in 7 Tagen | Europaweit inkl. Schweiz |
| Clock | Entwurf in 6 Stunden | Kostenlose Visualisierung |
| Phone | Rückruf in 30 Min | Persönliche Experten-Beratung |
| Shield | 24 Monate Garantie | Auf alle Produkte |
| Zap | 10 Jahre Lebensdauer | ECOPOWER LEDs |
| MapPin | Showroom Düsseldorf | Besichtigung vor Ort möglich |

Zeichne die SVG-Icons selbst (simple Lucide-style paths). KEINE externen Libraries.

### 7. PRODUKTE (DARK Section – Pattern D)
Label: "Was wir außer Neon anbieten" | Headline: **Produkte.** | `id="leistungen"`

Carousel (Pattern I):
| Produkt | Preis | Bild |
|---------|-------|------|
| Vollflächig beleuchtet | ab 399€ | `https://framerusercontent.com/images/z6S0aDTv0h6M5y6bIAyxAOEPDA.jpg?scale-down-to=512` |
| Frontbeleuchtet | ab 499€ | `https://framerusercontent.com/images/3ucCvS0f8QaxxyTmDxs714Kt7s.jpg?scale-down-to=512` |
| Leuchtkasten | ab 499€ | `https://framerusercontent.com/images/6NXHtlfloL1WiVnGa3iTLwQvnQ.png?scale-down-to=512` |
| Marquee Buchstaben | ab 299€ | `https://framerusercontent.com/images/6PFSc7TEMRWrmA5ehtdzTS8jK8.jpg?scale-down-to=512` |
| Rückbeleuchtet | ab 499€ | `https://framerusercontent.com/images/9CaaQsqoB6EQd7ggHrPyrH0YGn4.jpg?scale-down-to=512` |
| Unbeleuchtet | ab 299€ | `https://framerusercontent.com/images/j7GQSh8Pt1X3YomspLdmr4Nk6rA.png?scale-down-to=512` |

Cards: `w-[260px] h-[306px] rounded-3xl`, Gradient von unten, Text bottom-center. Duplikate für Loop.

### 8. TESTIMONIALS (Light)
Label: "Bewertungen" | Headline: **Erfahrungen.**

Rating-Banner: 4.9/5 – über 230 positive Bewertungen
Logo: `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146`
Avatar-Stack:
```
https://framerusercontent.com/images/7XElicIcn53vdnwyFHTpct98.jpg
https://framerusercontent.com/images/D53nCbgrC45WamdByYxomUf9c.jpg
https://framerusercontent.com/images/fqOOPJWEd96G4368QW9n1dcVU.jpg
https://framerusercontent.com/images/lVMA2BWo8D0yz8GINpzGpDx4.jpg
```
+ "236+" Badge. Google Bewertungen Label. Sterne SVG (#FB9826). CTA "Jetzt Anfragen".

**4 Testimonials (Pattern F):**
1. **Julia Termeyer** – Leiterin Einkauf, Cocoyu Agency – JT
   "NEONTRIP hat unsere Erwartungen bei jeder Zusammenarbeit übertroffen. Ihre Kreativität und ihr Engagement sind bemerkenswert. Die schnelle Reaktionszeit und professionelle Herangehensweise haben uns beeindruckt."
2. **Lukas Mann** – Geschäftsführer – LM
   "Zwischen der Anfrage bis zum Angebot mit visuellem Entwurf lagen nur 45 Minuten. Sehr effizientes und zuverlässiges Team. Insgesamt ein fantastisches Erlebnis!"
3. **Anna Wellner** – Projektleitung, Werbeagentur – AW
   "Wir bestellen als Werbeagentur regelmäßig für Kunden und dabei ist NEONTRIP ein perfekter Partner. Die Lieferung erfolgt stets zuverlässig und innerhalb einer Woche."
4. **Fabian Meister** – Inhaber – FM
   "Top-Service: immer erreichbar, hilfsbereit und gute Beratung. Wir konnten im Laden in Düsseldorf sogar Beispiel-Exemplare ansehen. Unser Schild ist ein richtiger Hingucker geworden."

### 9. FAQ (Light)
Headline: **FAQ.** | Sub: Haben Sie Fragen? Wir haben die Antworten.
Layout: Links 1/3 Headline, Rechts 2/3 Accordion. Icon: `https://framerusercontent.com/assets/j6H7CUu4CDaOQoux5xCbVztY18.svg` (rotiert 45° wenn offen)

1. **Wie schnell können Neon LED-Schilder geliefert werden?** → Je nach Projekt bieten wir Expressfertigungen ab 3 Tagen an. Standardlieferzeiten liegen bei 5-10 Werktagen, inklusive Versand ab Düsseldorf.
2. **Wie unterscheiden sich Ihre Schilder von günstigen Online-Anbietern?** → Unsere Schilder sind auf B2B-Qualität und Langlebigkeit ausgelegt – kein Acrylkleber, keine Billig-LEDs, keine Einwegprodukte.
3. **Wie lange hält ein LED-Leuchtschild?** → Mindestens 50.000 Stunden, über 10 Jahre bei täglichem Betrieb.
4. **Welche Größen und Formen sind möglich?** → Von 30 cm bis über 10 Meter. Schriftzüge, Logos, 3D-Buchstaben, Sonderformen.
5. **Wie läuft der Bestellprozess ab?** → 1. Logo hochladen → 2. Kostenloses Vorschaubild & Angebot in 24h → 3. Fertigung nach Freigabe → 4. Montagefertige Lieferung.
6. **Gibt es eine Garantie?** → 24 Monate auf alle LED-Systeme, verlängerbar für gewerbliche Dauerinstallationen.

### 10. KONTAKT (DARK Section – Pattern D)
Headline: **Lassen Sie uns reden.** | Sub: Erzählen Sie uns von Ihrem Projekt – egal ob Neonschild, 3D Buchstaben, Leuchtkästen, unbeleuchtete Schilder oder Moos.
BG-Video: `https://framerusercontent.com/assets/G0NwzP4bivPvK55b3ubxNslUs.mp4` (gedimmt, grayscale, opacity-20)

**Links: Kontaktformular** (weisse Card)
`action="https://api.neontrip.de/anfrage" method="POST"`
Logo: `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146`
Header: Logo + "Sie planen **ein Projekt?**"
Felder: Name* | Firma (optional) | E-Mail* | Telefon* | Projekt-Art (select: Neon LED Logo, Schriftzug, 3D Buchstaben, Messe & Event, Gastronomie, Sonstiges) | Nachricht (textarea) | Submit: "Unverbindlich anfragen"

**Rechts: Info + Contact Card (Pattern H)**
- Telefonische Beratung + Angebot in 60 Min
- Fabienne Trapp Card: `https://framerusercontent.com/images/yInjID4XEU1mkrMZa9WQMuqcNM.png?width=940&height=788`

### 11. FOOTER
**Light:** Tel +49 211 54257240 | `mailto:support@neontrip.de` | Nav + Links (agb.html, datenschutz.html, impressum.html) | Social SVG Icons (Instagram, Facebook, LinkedIn, TikTok)
**Dark:** Großes Logo `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_weiss_neontrip.png?v=1688479088` | © 2026 NEONTRIP | "Zurück zum Anfang"

### HEADER (Fixed)
Logo: `https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146` (filter invert für weiss)
Nav: Home | Projekte | Leistungen | Vorteile | FAQ | Kontakt | CTA: "Jetzt Anfragen"
Scroll: transparent→solid nach 80px. Logo weiss→schwarz. Text weiss→grau.
Mobile: Hamburger→Fullscreen Overlay mit staggered links.

---

## PHASE 4: JavaScript

Implementiere ALLE:
1. Splash (Buchstaben, Exit, Body-Unlock, Header-Reveal)
2. Header Scroll (class toggle >80px)
3. Scroll Reveal (IntersectionObserver)
4. Counter Animation (requestAnimationFrame, Dezimal-Support 4.9, `.toLocaleString('de-DE')`)
5. Mobile Menu (toggle, body-lock, stagger)
6. Smooth Scroll (anchor links, header offset)
7. FAQ Accordion (max-height, nur einer offen, icon rotate)
8. Filter Tabs (active toggle, show/hide cards by data-category)

---

## PHASE 5: SEO Head

```html
<title>NEONTRIP – Custom LED Neon Leuchtreklame | Dein Logo als Leuchtschild</title>
<meta name="description" content="Premium LED Neon Leuchtreklame nach Maß. Vertraut von Google, Porsche, Telekom. Expresslieferung in 7 Tagen.">
<meta property="og:title" content="NEONTRIP – Custom LED Neon Leuchtreklame für Marken">
<meta property="og:description" content="Premium LED Neon Signs nach Maß. Vertraut von Google, Porsche, Telekom & 35+ Top-Marken.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.neontrip.de">
<meta property="og:locale" content="de_DE">
<link rel="icon" type="image/png" href="https://cdn.shopify.com/s/files/1/0534/7819/5350/files/logo_affiliate.png?v=1688479146">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"LocalBusiness","name":"NEONTRIP","legalName":"Dara Nova GmbH","url":"https://www.neontrip.de","telephone":"+49-211-54257240","email":"support@neontrip.de","address":{"@type":"PostalAddress","streetAddress":"Bilker Allee 29","addressLocality":"Düsseldorf","postalCode":"40219","addressCountry":"DE"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","reviewCount":"236"}}
</script>
```

---

## CHECKLISTE

- [ ] Echte Umlaute (ü, ä, ö, ß) – KEINE "ue/ae/oe"
- [ ] KEIN purple/blau/bunt – nur Schwarz/Weiss/Grau
- [ ] NUR Inter, KEIN Sora, max font-weight 600
- [ ] Splash funktioniert smooth
- [ ] ALLE `.reveal` Elemente faden ein
- [ ] Counter zählen (auch 4.9, auch 21.000 mit Punkt)
- [ ] Logo-Marquee loopt, pausiert bei Hover
- [ ] Produkt-Carousel loopt
- [ ] Filter-Tabs filtern Projekte
- [ ] FAQ: einer offen, smooth, icon dreht
- [ ] Mobile Nav: Hamburger→X, Overlay, stagger, body-lock
- [ ] Header: transparent→solid, Logo weiss→schwarz
- [ ] Hover auf allen Cards/Buttons
- [ ] Mobile 375px professionell
- [ ] Echte deutsche Testimonial-Namen + Initialen-Avatare
- [ ] `mailto:` Links, KEIN Cloudflare
- [ ] Footer-Links: agb.html, datenschutz.html, impressum.html
- [ ] Noise-Overlay auf Dark Sections
- [ ] Grosses Footer-Logo
- [ ] **AUS EINEM GUSS – kein zusammengewürfeltes Template**

---

**Wo "Deine Design-Entscheidung" steht, triff eine mutige Entscheidung. Die Patterns sind Werkzeuge, nicht Vorschriften. Das Ergebnis soll aussehen als hätte es ein Designer gebaut, der 10.000€ dafür genommen hat.**
