# Power-Landingpages: freigegebene Umsetzung 20.10.2026

Ziel: Firmen finden eine klare Anfrage für ein individuelles LED-Neonlogo; Text-Schriftzüge können unmittelbar in den bestehenden Konfigurator wechseln.
Nachbar: Bestehende Logo-Anfragen, Firmen-E-Mail-Prüfung, Formularfelder, /api/c, Fehlerbehandlung, Consent und Conversion-Ereignisse unverändert.
Wirkung: Anfrage bleibt erst nach bestehender bestätigter Annahme erfolgreich; der Konfigurator-Link erzeugt keine Anfrage oder Kaufconversion.
Scope: Nur /neon-schilder/ und /neon-schild-personalisieren/, ihre gepflegten Configs/Abschnittsvorlagen sowie eng begrenzte Linkdekoration für die neuen Links. Keine Google-Ads-Mutation.

Basis: Cloudflare Produktion 683b3f66-d5be-4693-ac60-495397e4af52, Source a9496e705cd1fd8cbf1f76d7dee2f15f17195b1e. Beide Seiten und Konfigurator bytegleich mit verifiziertem vollständigem Release-Artefakt. Neues origin/main ist enthalten. Nie das unvollständige rohe deploy-Verzeichnis veröffentlichen.

## Conversion Blueprint
1. Intent: Neon-/LED-Schild, Acryl/Wand/Logo -> B2B-Maßanfertigung; Schriftzug/erstellen/personalisieren -> Auswahl zwischen eigener Textgestaltung und Firmenlogo.
2. Anzeigenabgleich: Individuelles Design, 3D-Vorschau und Anfrage erhalten. Keine Online-Sofortangebote für Logos behaupten.
3. Angebot: kostenlose 3D-Vorschau und individuelles Angebot; vorhandener Konfigurator für Text. 189 EUR ausschließlich dort bestätigt; ohne neue Preisangabe auf den B2B-Seiten.
4. Besucher: überwiegend lösungsbewusste Suchende; sofort Produkt und nächsten Schritt zeigen.
5. Einwände: richtige Produktart, Gestaltung ohne fertige Datei, Montage/Acryl/Innen-Außen, Preis/Termin, Firmenqualifikation. Frühe knappe Antworten, vorhandene Details weiter unten.
6. Proof: vorhandene echte Produkt-/Projektbilder wiederverwenden. Unbelegte Preis-, Liefer-, Lebensdauer- und Gesamtprojektzahlen entfernen/qualitativ eingrenzen. Vorhandene Bewertung nicht neu erhöhen.
7. Form: vorhandene dreistufige Anfrage, Upload optional, Firmen-E-Mail verpflichtend. Keine zusätzlichen Felder oder Backend-Veränderungen; Text und Größe werden im bestehenden Konfigurator eingegeben.
8. Reihenfolge: Hero mit Firmenangebot und klar bezeichnetem Konfigurator-Link; kompakte Produkt-/Montageinformationen und passende Beispiele; vorhandene Referenzen; Vorteile; weitere Produktalternativen/Events weiter unten; FAQ/Kontakt.
9. Mobil: gleiche Wege direkt am Einstieg, ausreichend große Buttons, keine neue Überlagerung. 320/390/768/1440 prüfen.
10. Messung: bestehende Anfrage-/Kauf- und Offline-Stufen getrennt. Vorhandenen Tracking-Parameter-Helfer für markierte interne Konfigurator-Links wiederverwenden; kein neues Ereignis. Keine realen Formulare/Bestellungen testen.

## Kritische Selbstprüfung
Ein pauschaler Redirect würde funktionierende Logo-Anfragen verlieren; deshalb beide Wege klar benennen und den Anfrageweg erhalten. Keine neuen Preis-/Produktversprechen zur Füllung von Lücken. Ein kompletter Neubuild würde unabhängig veröffentlichte Laufzeitkorrekturen überschreiben: nur geänderte Abschnitte und Metadaten mit aktuellen Vorlagen synchronisieren, Submit-/Consent-Code bytegleich erhalten. Kein neues Formularfeld, da Text/Größe im bestehenden Konfigurator verfügbar sind. Live-Veröffentlichung erst nach genauer SHA-Freigabe.


## Verifikation und Release-Artefakt

- 269 bestehende Tests bestanden: Business-E-Mail, Submit-Recovery, Anfrage-Einstieg, Submit-Handler. Keine produktive Anfrage oder Bestellung erzeugt.
- Beide Seiten bei 320, 390, 768 und 1440 px: kein horizontaler Überlauf; beide Auswahlwege und alle acht FAQ erreichbar. Desktop-/Mobilanker öffnen das jeweils vorhandene Logoformular; mobil beide bis Kontaktdaten ohne Datei durchgegangen.
- Private Gmail-Adresse lokal abgewiesen, Firmenadresse akzeptiert. Neuer Konfigurator-Link lokal angeklickt; UTM-Parameter bleiben erhalten. Konfigurator selbst unverändert.
- Alle Attribute und Felder der drei Formulare je Seite identisch mit dem Live-Basisstand. Gemeinsames Laufzeitskript nach Abzug ausschließlich der markierten Linkdekoration und Preisbeschriftungen bytegleich; Submit, Consent und Conversion-Callbacks unverändert.
- Vollständige aktuelle Basis: `/Users/danielklesse/Documents/Codex/2026-10-14/neontrip-landingpage-weiterarbeit/work/form-entry-20261020/release-candidate`. Auch die beiden zuletzt veröffentlichten allgemeinen Anfrage-Seiten sind darin erhalten.
- Kandidat: `/Users/danielklesse/Documents/Codex/2026-10-16/bernimm-diesen-neontrip-google-ads-auftrag/work/power-landingpage-clarity-20261020/release-candidate`. 1872 Dateien in site-release/functions verglichen; ausschließlich die beiden beauftragten HTML-Seiten unterscheiden sich. Weiterleitungen, Assets und Functions bytegleich.
- Nachweise und vier Vorschau-Bilder liegen eine Ebene über dem Kandidaten. Die SHA im release-info.json wird nach Commit/Predeploy ergänzt. Noch nicht veröffentlicht.
