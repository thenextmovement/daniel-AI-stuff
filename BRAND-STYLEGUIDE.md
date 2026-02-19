# NEONTRIP Brand Style Guide

## Schriftart

**Font Family:** Inter (Google Fonts)
```css
font-family: 'Inter', system-ui, sans-serif;
```

**Verwendete Gewichte:**
| Gewicht | Name | Verwendung |
|---------|------|------------|
| `400` | Regular | Fließtext, Beschreibungen |
| `500` | Medium | Labels, kleine Texte, Navigation |
| `600` | Semibold | Headlines, Buttons, wichtige Elemente |
| `700` | Bold | Selten, nur für starke Akzente |

**Einbindung (Google Fonts):**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

## Farbpalette

### Primärfarben
| Name | HEX | RGB | Verwendung |
|------|-----|-----|------------|
| **Dark** | `#0A0A0A` | `10, 10, 10` | Haupthintergrund dunkel, Textfarbe auf weiß |
| **White** | `#FFFFFF` | `255, 255, 255` | Haupthintergrund hell, Textfarbe auf dunkel |
| **Accent (Violet)** | `#6D28D9` | `109, 40, 217` | CTAs, ausgewählte Elemente, Highlights, Links |

### Grautöne
| Name | HEX | Opacity-Variante | Verwendung |
|------|-----|------------------|------------|
| **Gray 600** | `#4B5563` | - | Sekundärer Text (dunkel) |
| **Gray 500** | `#6B7280` | `text-black/50` | Sekundärer Text, Beschreibungen |
| **Gray 400** | `#9CA3AF` | `text-black/40` | Placeholder, deaktivierter Text |
| **Gray 200** | `#E5E7EB` | `border-black/10` | Borders, Divider |
| **Gray 100** | `#F3F4F6` | `bg-black/5` | Subtile Hintergründe |

### Funktionale Farben
| Name | HEX | Verwendung |
|------|-----|------------|
| **Success Green** | `#22C55E` | Erfolgsmeldungen, Upload bestätigt |
| **Success Background** | `#F0FDF4` | Hintergrund für Erfolgszustände |

### Accent-Varianten (für Zustände)
```css
/* Ausgewählt */
background: rgba(109, 40, 217, 0.05);  /* 5% Opacity */
border-color: #6D28D9;

/* Hover auf Accent */
background: rgba(109, 40, 217, 0.08);  /* 8% Opacity */

/* Focus Ring */
box-shadow: 0 0 0 2px #6D28D9;
```

---

## Logo-Assets

Die Logos werden als lokale Dateien mitgeliefert:

| Datei | Verwendung |
|-------|------------|
| `logo_weiss_neontrip.png` | Für dunkle Hintergründe (Footer, Dark Mode, Splash Screen) |
| `logo_schwarz_neontrip.png` | Für helle Hintergründe (Header, Light Mode) |
| `neontrip-favicon.svg` | Favicon für Browser-Tab |

### Logo-Regeln
- **Mindestabstand:** Immer genug Weißraum um das Logo herum lassen
- **Keine Verzerrung:** Logo immer proportional skalieren
- **Keine Farbänderung:** Nur die offiziellen Versionen verwenden

---

## Typografie-Regeln

### Headlines
```css
/* H1 */
font-size: 1.875rem;      /* text-3xl */
font-weight: 600;         /* font-semibold */
letter-spacing: -0.025em; /* tracking-tight */
line-height: 1.2;

/* H2 */
font-size: 1.5rem;        /* text-2xl */
font-weight: 600;         /* font-semibold */
letter-spacing: -0.025em; /* tracking-tight */
```

### Body Text
```css
font-size: 1rem;          /* text-base */
font-weight: 400;         /* font-normal */
line-height: 1.5;
color: #0A0A0A;
```

### Small/Labels
```css
font-size: 0.875rem;      /* text-sm */
font-weight: 500;         /* font-medium */
color: rgba(0, 0, 0, 0.5); /* text-black/50 */
```

---

## Design-Elemente

### Border Radius
| Größe | Tailwind | Verwendung |
|-------|----------|------------|
| `8px` | `rounded-lg` | Inputs, kleine Elemente |
| `12px` | `rounded-xl` | Karten, Upload-Zonen |
| `16px` | `rounded-2xl` | Große Karten, Modals |
| `9999px` | `rounded-full` | Buttons, Pills, Tags |

### Schatten
```css
/* Standard (dezent) */
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

/* Hover */
box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);

/* Focus/Selected */
box-shadow: 0 0 0 2px #6D28D9;
```

### Übergänge/Animationen
```css
/* Standard Transition */
transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

/* Schnelle Transition (Hover) */
transition: all 0.2s ease;
```

---

## Schreibregeln

- **Markenname:** Immer `NEONTRIP` in Großbuchstaben
- **Umlaute:** Echtes UTF-8 verwenden (ü, ä, ö, ß) – niemals ue, ae, oe, ss
- **Ansprache:** "Du" (informell, aber professionell)
- **Keine Emojis** in offiziellen Texten

---

## Kontakt-Informationen

- **E-Mail:** support@neontrip.de
- **Telefon:** +49-211-54257240
- **Firma:** Dara Nova GmbH, Düsseldorf
