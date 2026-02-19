# NEONTRIP UI Implementation Guide

Technischer Guide für die Implementierung von NEONTRIP-konformen Interfaces. Für Entwickler und KI-Assistenten.

---

## Grundsetup

### Tailwind Config
```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        dark: '#0A0A0A',
        accent: '#6D28D9',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    }
  }
}
```

### Base Styles
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', system-ui, sans-serif;
  background: #ffffff;
  color: #0A0A0A;
  min-height: 100vh;
}
```

---

## Header

### Desktop: Fixiert, Weiß
```html
<header class="fixed top-0 left-0 right-0 z-50 bg-white border-b border-black/5">
  <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
    <!-- Logo -->
    <a href="/" class="flex items-center">
      <img src="assets/logo_schwarz_neontrip.png" alt="NEONTRIP" class="h-9">
    </a>

    <!-- Navigation / Actions -->
    <div class="flex items-center gap-3">
      <a href="tel:+4921154257240" class="w-9 h-9 rounded-full border border-black/10 flex items-center justify-center hover:bg-black/5 transition-colors">
        <!-- Phone Icon -->
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </a>
      <a href="mailto:support@neontrip.de" class="w-9 h-9 rounded-full border border-black/10 flex items-center justify-center hover:bg-black/5 transition-colors">
        <!-- Mail Icon -->
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="20" height="16" x="2" y="4" rx="2"/>
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
        </svg>
      </a>
    </div>
  </div>
</header>

<!-- Spacer für fixed Header -->
<div class="h-16"></div>
```

### Mobile: Statisch, Dunkel
```html
<header class="bg-dark">
  <div class="px-4 py-5 flex items-center justify-between">
    <!-- Logo Weiß -->
    <a href="/" class="flex items-center">
      <img src="assets/logo_weiss_neontrip.png" alt="NEONTRIP" class="h-8">
    </a>

    <!-- Actions mit weißen Borders -->
    <div class="flex items-center gap-2">
      <a href="tel:+4921154257240" class="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center hover:bg-white/10 transition-colors text-white">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </a>
    </div>
  </div>
</header>
```

### Responsive Header (kombiniert)
```html
<header class="lg:fixed top-0 left-0 right-0 z-50 bg-dark lg:bg-white lg:border-b lg:border-black/5">
  <div class="px-4 lg:px-6 py-5 lg:py-3 flex items-center justify-between">
    <a href="/">
      <img src="assets/logo_weiss_neontrip.png" alt="NEONTRIP" class="h-8 lg:hidden">
      <img src="assets/logo_schwarz_neontrip.png" alt="NEONTRIP" class="hidden lg:block h-9">
    </a>
    <div class="flex items-center gap-2 lg:gap-3">
      <a href="tel:+4921154257240" class="w-8 h-8 lg:w-9 lg:h-9 rounded-full border border-white/20 lg:border-black/10 flex items-center justify-center hover:bg-white/10 lg:hover:bg-black/5 transition-colors text-white lg:text-dark">
        <!-- Icon -->
      </a>
    </div>
  </div>
</header>
```

---

## Footer

### Dark Footer mit Stats
```html
<footer class="bg-dark pt-5 pb-4 px-4">
  <div class="max-w-4xl mx-auto">

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-8 mb-4">
      <div class="text-center">
        <div class="text-2xl sm:text-4xl font-semibold tracking-tight text-white leading-none mb-1">5.000+</div>
        <p class="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wider">Bestellungen</p>
      </div>
      <div class="text-center">
        <div class="text-2xl sm:text-4xl font-semibold tracking-tight text-white leading-none mb-1">4.9/5</div>
        <p class="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wider">Google Bewertung</p>
      </div>
      <div class="text-center">
        <div class="text-2xl sm:text-4xl font-semibold tracking-tight text-white leading-none mb-1">99%</div>
        <p class="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wider">Pünktliche Lieferung</p>
      </div>
      <div class="text-center">
        <div class="text-2xl sm:text-4xl font-semibold tracking-tight text-white leading-none mb-1">3 Tage</div>
        <p class="text-[10px] sm:text-xs font-medium text-gray-500 uppercase tracking-wider">Express Lieferung</p>
      </div>
    </div>

    <!-- Logo groß -->
    <div class="flex items-center justify-center py-5 overflow-hidden">
      <img src="assets/logo_weiss_neontrip.png" class="w-full max-w-2xl opacity-90" alt="NEONTRIP">
    </div>

    <!-- Legal Links (alphabetisch!) -->
    <div class="flex items-center justify-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
      <a href="agb.html" class="hover:text-white transition-colors">AGB</a>
      <span class="text-gray-600">·</span>
      <button class="hover:text-white transition-colors">Cookie-Einstellungen</button>
      <span class="text-gray-600">·</span>
      <a href="datenschutz.html" class="hover:text-white transition-colors">Datenschutz</a>
      <span class="text-gray-600">·</span>
      <a href="impressum.html" class="hover:text-white transition-colors">Impressum</a>
      <span class="text-gray-600">·</span>
      <a href="widerruf.html" class="hover:text-white transition-colors">Widerrufsrecht</a>
    </div>

  </div>
</footer>
```

---

## Buttons

### Primary Button (Accent)
```html
<button class="bg-dark text-white px-6 py-3 rounded-full font-medium hover:bg-dark/90 transition-colors flex items-center gap-2">
  Weiter
  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
</button>
```

### Secondary Button (Outline)
```html
<button class="border-2 border-black/10 text-dark px-6 py-3 rounded-full font-medium hover:border-black/30 hover:bg-black/5 transition-colors flex items-center gap-2">
  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
  Zurück
</button>
```

### Ghost Button (nur Text)
```html
<button class="text-black/50 hover:text-dark font-medium transition-colors">
  Abbrechen
</button>
```

### Icon Button (rund)
```html
<button class="w-10 h-10 rounded-full border border-black/10 flex items-center justify-center hover:bg-black/5 transition-colors">
  <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>
</button>
```

---

## Form Elements

### Text Input
```html
<div>
  <label class="block text-sm font-medium mb-2">E-Mail *</label>
  <input
    type="email"
    class="w-full border-2 border-black/10 rounded-xl px-4 py-3.5 text-base transition-all focus:border-black focus:outline-none focus:ring-0"
    placeholder="max@firma.de"
  >
</div>
```

### Textarea
```html
<div>
  <label class="block text-sm font-medium mb-2">Nachricht</label>
  <textarea
    class="w-full border-2 border-black/10 rounded-xl px-4 py-3.5 text-base resize-none h-32 transition-all focus:border-black focus:outline-none"
    placeholder="Weitere Details..."
  ></textarea>
</div>
```

### Input Focus State (CSS)
```css
.form-input:focus {
  border-color: #0A0A0A;
  outline: none;
  box-shadow: 0 0 0 3px rgba(10, 10, 10, 0.1);
}
```

---

## Selection Cards

### Option Card (nicht ausgewählt)
```html
<div class="border-2 border-black/10 rounded-2xl p-5 cursor-pointer flex items-center gap-4 transition-all hover:border-black/30 hover:bg-black/5">
  <div class="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center flex-shrink-0">
    <!-- Icon -->
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  </div>
  <div>
    <h3 class="font-semibold">Datei hochladen</h3>
    <p class="text-sm text-black/50">Logo, Foto, Skizze – PDF, PNG, JPG</p>
  </div>
</div>
```

### Option Card (ausgewählt)
```html
<div class="border-2 border-accent rounded-2xl p-5 cursor-pointer flex items-center gap-4 bg-accent/5">
  <div class="w-12 h-12 rounded-xl bg-accent flex items-center justify-center flex-shrink-0 text-white">
    <!-- Icon -->
  </div>
  <div>
    <h3 class="font-semibold">Datei hochladen</h3>
    <p class="text-sm text-black/50">Logo, Foto, Skizze – PDF, PNG, JPG</p>
  </div>
</div>
```

### Selection Card CSS
```css
.option-card {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.option-card:hover {
  border-color: #a3a3a3;
  background: #fafafa;
}
.option-card.selected {
  border-color: #6D28D9;
  background: rgba(109, 40, 217, 0.05);
}
.option-card.selected .option-icon {
  background: #6D28D9;
  color: #ffffff;
}
```

---

## Pills / Tags

### Option Pill (nicht ausgewählt)
```html
<button class="border-2 border-black/10 rounded-full px-5 py-2.5 text-sm font-medium hover:border-black/30 transition-all">
  Innenbereich
</button>
```

### Option Pill (ausgewählt)
```html
<button class="border-2 border-accent bg-accent/5 rounded-full px-5 py-2.5 text-sm font-medium text-accent">
  Innenbereich
</button>
```

### Pill CSS
```css
.pill {
  transition: all 0.2s ease;
}
.pill:hover {
  border-color: rgba(0, 0, 0, 0.3);
}
.pill.selected {
  border-color: #6D28D9;
  background: rgba(109, 40, 217, 0.05);
  color: #6D28D9;
}
```

---

## Upload Zone

### Standard
```html
<div class="border-2 border-dashed border-accent rounded-xl p-6 text-center cursor-pointer bg-accent/5 hover:bg-accent/10 transition-all">
  <div class="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-3">
    <svg class="w-6 h-6 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  </div>
  <p class="font-medium mb-1">Dateien hierher ziehen</p>
  <p class="text-sm text-black/50">oder <span class="underline">klicken</span> · PDF, PNG, JPG, AI, SVG</p>
</div>
```

### Mit Datei (Success State)
```html
<div class="border-2 border-green-500 rounded-xl p-6 text-center bg-green-50">
  <div class="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
    <svg class="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  </div>
  <p class="font-medium text-green-700">logo-design.pdf hochgeladen</p>
</div>
```

---

## Tabellen (für Angebote)

### Einfache Tabelle
```html
<div class="border border-black/10 rounded-xl overflow-hidden">
  <table class="w-full">
    <thead class="bg-black/5">
      <tr>
        <th class="text-left px-4 py-3 text-sm font-semibold">Position</th>
        <th class="text-left px-4 py-3 text-sm font-semibold">Beschreibung</th>
        <th class="text-right px-4 py-3 text-sm font-semibold">Preis</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-black/5">
      <tr>
        <td class="px-4 py-3 text-sm">1</td>
        <td class="px-4 py-3 text-sm">LED Neonschild "OPEN" 60cm</td>
        <td class="px-4 py-3 text-sm text-right font-medium">€ 450,00</td>
      </tr>
      <tr>
        <td class="px-4 py-3 text-sm">2</td>
        <td class="px-4 py-3 text-sm">Montage & Installation</td>
        <td class="px-4 py-3 text-sm text-right font-medium">€ 120,00</td>
      </tr>
    </tbody>
    <tfoot class="bg-dark text-white">
      <tr>
        <td colspan="2" class="px-4 py-3 text-sm font-semibold">Gesamt (inkl. MwSt.)</td>
        <td class="px-4 py-3 text-sm text-right font-semibold">€ 570,00</td>
      </tr>
    </tfoot>
  </table>
</div>
```

---

## Modals / Dialogs

### Modal Container
```html
<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
  <div class="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto shadow-2xl">

    <!-- Header -->
    <div class="flex items-center justify-between p-5 border-b border-black/5">
      <h2 class="text-xl font-semibold">Angebot erstellen</h2>
      <button class="w-9 h-9 rounded-full border border-black/10 flex items-center justify-center hover:bg-black/5 transition-colors">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="p-5">
      <!-- Formular etc. -->
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-3 p-5 border-t border-black/5">
      <button class="text-black/50 hover:text-dark font-medium transition-colors px-4 py-2">
        Abbrechen
      </button>
      <button class="bg-dark text-white px-6 py-2.5 rounded-full font-medium hover:bg-dark/90 transition-colors">
        Speichern
      </button>
    </div>

  </div>
</div>
```

---

## Spacing Guidelines

### Konsistente Abstände (Tailwind)
| Verwendung | Mobile | Desktop | Tailwind |
|------------|--------|---------|----------|
| Container Padding | 16px | 24px | `px-4 lg:px-6` |
| Section Spacing | 32px | 48px | `py-8 lg:py-12` |
| Card Padding | 20px | 24px | `p-5 lg:p-6` |
| Element Gap | 12px | 16px | `gap-3 lg:gap-4` |
| Text Margin | 4px | 4px | `mb-1` |

### Max-Width Container
```html
<div class="max-w-4xl mx-auto px-4 lg:px-6">
  <!-- Content -->
</div>
```

---

## Animationen

### Standard Transition
```css
transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
```

### Hover Scale (für Karten)
```css
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}
```

### Fade In (für Modals)
```css
@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.modal-enter {
  animation: fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## Wichtige Regeln

1. **Keine Emojis** in der UI
2. **Immer NEONTRIP** in Großbuchstaben
3. **Echte Umlaute** (ü, ä, ö, ß) – niemals ue, ae, oe
4. **Legal Links alphabetisch:** AGB, Cookie, Datenschutz, Impressum, Widerruf
5. **Accent-Farbe (#6D28D9)** nur für interaktive/ausgewählte Elemente
6. **Rounded-full** für Buttons, **rounded-xl/2xl** für Karten
7. **Mobile-first:** Immer erst Mobile stylen, dann `lg:` für Desktop
