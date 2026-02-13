---
name: build-landing
description: Baut die NEONTRIP Landing Page komplett neu basierend auf dem Design-Study-Prompt
---

## Phase 1: Kontext laden

Lies zuerst diese Dateien:
1. `claude-design-study-prompt.md` im Projekt-Root – kompletter Auftrag mit allen Sektionen, Inhalten, Bild-URLs
2. `PROJECT-CONTEXT.md` – Referenzkunden, Shopify CDN URLs, Testimonials, FAQ

## Phase 2: Skills aktivieren

Nutze diese Skills aktiv beim Build:
- **premium-webdesign** – Design-Patterns (Cards, Dark Sections, Typografie, Animationen, Marquee)
- **frontend-design** – Verhindert generisches AI-Design, sorgt für Premium-Ästhetik
- **web-design-guidelines** – Allgemeine Web-Design Best Practices
- **ui-ux-pro-max** – Professionelles UI/UX, kein AI-Slop
- **page-cro** – Conversion-Optimierung der Landing Page
- **form-cro** – Optimierung des Kontaktformulars
- **seo-audit** – SEO Best Practices direkt beim Bauen einhalten
- **schema-markup** – LocalBusiness strukturierte Daten einbauen

## Phase 3: Bauen

Baue `landing.html` komplett neu als eine einzige Datei (HTML + Tailwind CSS + Vanilla JS inline).

Wo im Auftrag "Deine Design-Entscheidung" steht, triff eine mutige Entscheidung.
Das Ergebnis soll aussehen als hätte ein Designer 10.000 Euro dafür genommen.

## Phase 4: Qualitätsprüfung

Nach dem Build: Prüfe mit dem **audit-website** Skill ob alles sauber ist.
