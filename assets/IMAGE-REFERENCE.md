# NEONTRIP Website – Bild-Referenz & Alt-Tags

## Verwendung
- Jedes Bild liegt als `.jpg` (Fallback) und `.webp` (modern) vor
- Im HTML mit `<picture>` Element einbinden für beste Performance:

```html
<picture>
  <source srcset="assets/images/hero/ergo-campus-pflanzenwand.webp" type="image/webp">
  <img src="assets/images/hero/ergo-campus-pflanzenwand.jpg" 
       alt="LED Neon Schriftzug Ready Steady Grow auf Pflanzenwand für ERGO Campus" 
       loading="lazy" width="1528" height="1080">
</picture>
```

## Hero Section
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| hero/neontrip-3d-logo-render | "NEONTRIP 3D LED Logo mit Hintergrundbeleuchtung" | Hero Background oder Marken-Element |
| hero/ergo-campus-pflanzenwand | "LED Neon Schriftzug Ready Steady Grow auf Pflanzenwand für ERGO Campus" | Hero Image – zeigt Premium-Qualität |
| hero/jedes-logo-jede-form | "Custom LED Neon Logo an Holzwand – Jedes Logo jede Schriftart jede Form jede Größe" | Capabilities Section |
| hero/neon-detail-shot | "LED Neon Detailaufnahme – Premium Verarbeitung" | Detail/Qualitäts-Section |

## Office & Empfang
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| office-empfang/it-titans-holzlamellen | "IT Titans LED Leuchtschild auf Holzlamellen-Wand im Büroempfang" | Office Kategorie-Card |
| office-empfang/gwa-studio-logo | "G.W.A. Studio Neon Logo in Blau auf dunkler Wand" | Office Referenz |
| office-empfang/office-branding | "LED Neon Firmenlogo im professionellen Büroumfeld" | Office Landingpage Hero |

## Gastronomie
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| gastronomie/vinos-weinbar | "Vinos Weinbar LED Neon Schild in Warmweiß über Bar mit Weingläsern" | Gastro Kategorie-Card (TOP-FOTO) |
| gastronomie/aperol-spritz-quallen | "Aperol Spritz Neon Leuchtreklame mit dekorativen Quallen-Motiven in Bar" | Gastro/Marken Referenz |
| gastronomie/fitbox-mooswand | "Fitbox Logo als LED Neon auf grüner Mooswand" | Gastro/Fitness Crossover |
| gastronomie/galaxy-kiosk-cafe | "Galaxy Kiosk Café LED Neon Beschilderung" | Gastro Referenz |

## Events & Clubs
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| events-clubs/poas-club-neon | "POAS LED Neon Logo über Tanzfläche im Club mit blauem Nebel" | Event Kategorie-Card (TOP-FOTO) |
| events-clubs/poas-crowd-event | "POAS Neon Schild bei Club-Event mit feierndem Publikum" | Event Referenz |
| events-clubs/keezy-event-targobank | "KEEZY LED Neon auf Konzertbühne – Event-Branding mit Targobank" | Event Landingpage |
| events-clubs/sommerfest-kw-buehne | "Sommerfest KW Neon Schriftzug über Veranstaltungsbühne" | Event Referenz |

## Messe & Messebau
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| messe/billie-messestand | "Billie Payments LED Neon Logo auf komplettem Messestand" | Messe Kategorie-Card (TOP-FOTO) |
| messe/messe-projekt-01 | "LED Neon Branding auf Messestand – individuelles Projekt" | Messe Referenz |
| messe/messe-projekt-02 | "Custom LED Neon Installation auf Messestand" | Messe Referenz |

## Fitness & Sport
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| fitness/contact-gym-stretch | "STRETCH LED Neon Schild im Umkleidebereich von Contact Gym" | Fitness Kategorie-Card |
| fitness/contact-gym-01 bis 05 | "Contact Gym LED Neon Installation – verschiedene Bereiche" | Fitness Galerie |
| fitness/contact-gym-logo | "Contact Gym Neon Logo – Komplettausstattung Fitnessstudio" | Fitness Referenz |

## Marken & Branding
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| marken-branding/bezzer-quizzer-01 bis 04 | "Bezzer Quizzer LED Neon Branding – Custom Markeninstallation" | Marken Galerie |

## Referenzen
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| referenzen/alle-marken-logos | "NEONTRIP Referenzkunden – Google Porsche Telekom Zalando Puma und weitere" | Logo-Bar / Trust Section |
| referenzen/kontakt-footer | "NEONTRIP Kontakt – Bilker Allee 29 Düsseldorf" | Footer |

## USP / Allgemein
| Datei | Alt-Tag | Verwendung |
|-------|---------|------------|
| usp-allgemein/usps-uebersicht | "NEONTRIP Vorteile – Expresslieferung Visualisierung in 6h 24 Monate Garantie" | USP Section |
| usp-allgemein/jedes-logo-capabilities | "Custom LED Neon – Jedes Logo Jede Schriftart Jede Form Jede Größe" | Capabilities Section |

## Technische Hinweise
- Alle Bilder: Progressive JPEG + WebP
- Hero-Bilder: 1528×1080px (first paint wichtig → kein lazy loading!)
- Content-Bilder: 1132×800px (mit loading="lazy")
- Referenzen: 1273×900px
- WebP spart nochmal ~40% gegenüber optimiertem JPEG
- IMMER `width` und `height` Attribute setzen (CLS vermeiden)
- Hero-Bild: `fetchpriority="high"` setzen
