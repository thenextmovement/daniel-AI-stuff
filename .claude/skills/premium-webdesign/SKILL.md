---
name: premium-webdesign
description: Design-Patterns für Premium B2B Websites. Verwende wenn Landing Pages, Hero Sections, Cards, Dark Sections, Testimonials, FAQ, Kontaktformulare oder Produkt-Carousels gebaut werden. Enthält Tailwind-Code-Patterns für Typografie, Card-Systeme, Scroll-Animationen, Marquees und mehr.
---

# Premium Webdesign Patterns

Diese Patterns stammen aus 6 preisgekrönten Websites (Palmer, Calisto, Quantum, Pandawa, Fabrica, Sadewa).
Kopiere nicht 1:1 – verstehe die Prinzipien und kombiniere kreativ.

---

## Pattern A: Sektions-Label-System

Jede Sektion bekommt ein kleines Label oben links. Schafft visuellen Rhythmus.

```html
<!-- Light Section -->
<div class="flex items-center gap-2 mb-6">
  <div class="w-4 h-4 bg-[#0A0A0A] rounded-full flex items-center justify-center">
    <span class="w-[2px] h-2 bg-white block"></span>
  </div>
  <span class="text-sm font-medium tracking-[0.04em] text-[#0A0A0A]/60">Label</span>
</div>

<!-- Dark Section (invertiert) -->
<div class="flex items-center gap-2 mb-6">
  <div class="w-4 h-4 bg-white rounded-full flex items-center justify-center">
    <span class="w-[2px] h-2 bg-[#0A0A0A] block"></span>
  </div>
  <span class="text-sm font-medium tracking-[0.04em] text-white/60">Label</span>
</div>
```

---

## Pattern B: Typografische Hierarchie

Extreme Kontraste zwischen Mega-Headlines und Body. Tracking wird enger je größer der Text.

```html
<!-- Mega-Headline -->
<h2 class="text-[62px] md:text-[144px] font-semibold leading-[0.92] tracking-[-0.06em]">Projekte.</h2>

<!-- Sub-Headline mit Zwei-Farben-Trick -->
<h2 class="text-[32px] md:text-[60px] font-semibold leading-[1.1] tracking-[-0.04em] max-w-[830px]">
  Starker Teil, <span class="text-[#0A0A0A]/60">schwächerer Teil in Grau.</span>
</h2>

<!-- Body-Text mit Zwei-Farben -->
<p class="text-lg md:text-[22px] font-medium leading-[1.2] tracking-[-0.03em] text-[#0A0A0A]/60">
  <span class="text-[#0A0A0A]">Erster Satz komplett dunkel.</span> Rest der Beschreibung heller.
</p>
```

Regel: Tracking -0.03em (Body) → -0.04em (Sub) → -0.06em (Mega). MAXIMAL font-weight 600.

---

## Pattern C: Card-Design-System

```html
<!-- Standard Card -->
<div class="bg-white rounded-[18px] p-6 md:p-8 border border-black/5">...</div>

<!-- Image Card mit Drei-Punkt-Ornament -->
<div class="group bg-white rounded-[18px] overflow-hidden border border-black/5">
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
  <div class="relative aspect-[4/3] rounded-[14px] overflow-hidden mx-2 mb-2">
    <div class="absolute inset-0 bg-[#0A0A0A]/15 z-10"></div>
    <img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" loading="lazy">
  </div>
</div>
```

---

## Pattern D: Dark Section Card in Card

```html
<section class="relative bg-[#F0F0F1] py-16 md:py-24 px-6 md:px-9">
  <div class="absolute inset-[6px] bg-[#0A0A0A] rounded-[25px] z-0">
    <div class="absolute inset-0 rounded-[25px] opacity-[0.05]"
         style="background-image: url('https://framerusercontent.com/images/rR6HYXBrMmX4cRpXfXUOvpvpB0.png'); background-size: 256px; background-repeat: repeat;"></div>
  </div>
  <div class="relative z-10 max-w-[1520px] mx-auto">...</div>
</section>
```

---

## Pattern E: USP/Feature Grid

SVG Icons: stroke-only, keine Emojis. Gleich große Cards.

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <div class="bg-white rounded-[18px] p-6 md:p-8 border border-black/5">
    <svg class="w-6 h-6 mb-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">...</svg>
    <h3 class="text-lg font-semibold tracking-[-0.03em] mb-2">Feature</h3>
    <p class="text-sm font-medium text-[#0A0A0A]/60 leading-[1.4]">Beschreibung.</p>
  </div>
</div>
```

---

## Pattern F: Testimonial Cards

```html
<div class="bg-white rounded-[18px] p-6 border border-black/5">
  <div class="flex items-center gap-3 mb-4">
    <div class="w-[46px] h-[46px] rounded-[7px] bg-[#0A0A0A]/10 flex items-center justify-center">
      <span class="text-sm font-semibold text-[#0A0A0A]/60">JT</span>
    </div>
    <div>
      <p class="text-lg font-semibold tracking-[-0.03em]">Julia Termeyer</p>
      <p class="text-xs font-medium text-[#0A0A0A]/60">Leiterin Einkauf, Cocoyu Agency</p>
    </div>
  </div>
  <p class="text-[15px] font-medium tracking-[-0.03em] leading-[1.4] text-[#0A0A0A]/80">"Zitat hier."</p>
</div>
```

---

## Pattern G: Filter-Tabs

```html
<div class="flex flex-wrap gap-2 mb-8">
  <button class="px-4 py-2 rounded-full text-sm font-medium bg-[#0A0A0A] text-white">Alle</button>
  <button class="px-4 py-2 rounded-full text-sm font-medium bg-white text-[#0A0A0A]/60 border border-black/5">Office</button>
</div>
```

---

## Pattern H: Personal Contact Card

```html
<div class="flex items-center gap-4 bg-white rounded-2xl p-1.5">
  <div class="w-[113px] h-[161px] rounded-xl overflow-hidden shrink-0">
    <img class="w-full h-full object-cover">
  </div>
  <div class="py-4 pr-4">
    <p class="text-sm font-semibold">Ihre Ansprechpartnerin</p>
    <p class="text-xs font-semibold text-[#0A0A0A]/60 mb-3">bei NEONTRIP</p>
    <p class="text-[22px] font-semibold tracking-[-0.03em] leading-tight mb-4">Fabienne Trapp</p>
    <a href="mailto:support@neontrip.de" class="inline-flex items-center gap-2 bg-[#0A0A0A] text-white text-xs font-semibold px-3 py-2 rounded-full">
      Kontakt aufnehmen <span class="w-2 h-2 bg-white rounded-full"></span>
    </a>
  </div>
</div>
```

---

## Pattern I: Marquee / Infinite Scroll

```css
.marquee-track { animation: marquee 30s linear infinite; }
.marquee-track:hover { animation-play-state: paused; }
.marquee-mask {
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%);
  mask-image: linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%);
}
@keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
```

Immer Elemente duplizieren für nahtlosen Loop.

---

## Pattern J: Scroll Reveal

```css
.reveal { opacity: 0; transform: translateY(40px);
  transition: opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1), transform 0.9s cubic-bezier(0.16, 1, 0.3, 1); }
.reveal.visible { opacity: 1; transform: translateY(0); }
```

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  });
}, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
```

Stagger: transition-delay 0.1s, 0.2s, 0.3s auf aufeinanderfolgenden Elementen.

---

## Pattern K: Splash Screen

```javascript
const letters = document.querySelectorAll('.splash-letter');
letters.forEach((letter, i) => {
  setTimeout(() => {
    letter.style.opacity = '1';
    letter.style.transform = 'translateY(0)';
    letter.style.filter = 'blur(0px)';
  }, 200 + i * 80);
});
setTimeout(() => {
  document.querySelector('.splash-screen').style.transform = 'translateY(-100%)';
  document.body.style.overflow = 'auto';
}, 1800);
```

---

## Kreative Anwendung

Diese Patterns sind Werkzeuge, nicht Vorschriften. Wo im Auftrag "Deine Design-Entscheidung" steht:
- Kombiniere Patterns auf neue Art
- Variiere Proportionen und Abstände
- Das Ergebnis soll aussehen als hätte ein Designer 10.000 Euro dafür genommen
