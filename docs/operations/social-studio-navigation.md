# NEONTRIP Social Studio in Ops

## Scope und Vertrag

- Ziel: eigener Eintrag „Social Studio“ im gemeinsamen Ops-Menü, Einstieg unter `/ops/social-studio` und Öffnen des bestehenden Dashboards in einem neuen Tab.
- Nachbar: alle bestehenden Menüpunkte, aktiven Markierungen, Ops-Anmeldung und Geschäftsprozesse bleiben unverändert.
- Wirkung: ausschließlich Navigation. Keine Beitragsfreigabe, Terminreservierung, Provider-Aktion oder Berechtigungsänderung beim Öffnen.
- Code: `src/app/ops/ops-app-switcher.tsx` und `src/app/ops/social-studio/page.tsx`.

## Bestehenden Einstieg wiederverwenden

Die Einstiegsseite folgt dem Muster `/ops/offers`: gemeinsamer `OpsPageHeader`, vorhandene `OpsPageIntro`- und Layout-Komponenten, anschließend ein Link zur separaten Anwendung. Der Menüeintrag ist auch im hellen App-Switcher und auf den Ops-Anmeldeseiten verfügbar. Die Ops-Seite behält das Menü sichtbar; das separate Dashboard läuft in einem neuen Tab.

Dashboard: <https://neontrip-social-studio.neontripdach.chatgpt.site>. Seine bestehende ChatGPT-Zugriffsfreigabe bleibt maßgeblich. Ops-Authentifizierung ist kein Social-Studio-Login; keine SSO-, Proxy- oder Datenmigration in diesem Scope. Es werden keine Schlüssel oder Nutzerdaten in URL beziehungsweise Frontend übernommen.

## Verifikation und Veröffentlichung

Vor Veröffentlichung: Menü auf mehreren Ops-Seiten und im hellen/dunklen Layout prüfen, aktive Markierung der neuen Seite, Ziel-URL, `target="_blank"`, `rel="noopener noreferrer"`, mobile Darstellung sowie unveränderte bestehende Links prüfen. Quote-Suite, TypeScript und Produktions-Build gemäß Ops-Release-Gate ausführen.

Der vorhandene `scripts/smoke_ops_menu_ui.mjs` erwartet auf Mobilgeräten einen „Bereiche“-Toggle, den der aktuelle App-Switcher nicht mehr besitzt. Für diesen Scope deshalb die tatsächliche aktuelle Menüoberfläche direkt prüfen; keine fachfremde Smoke-Test-Reparatur.

Lokal geprüft am 01.10.2026:

- Alle 1.282 Quote-Tests bestanden; `npx tsc --noEmit` und `npm run build` erfolgreich. Ein erster Build kollidierte mit einem parallel gestarteten Dev-Server; nach dessen Stop und getrennter Wiederholung erfolgreich.
- React-Renderprüfung für helles und dunkles Menü: 18 Links, nur „Social Studio“ aktiv; alle 17 bisherigen Einträge sind gegenüber dem Ausgangsstand unverändert.
- Browser: `/ops/social-studio`, `/ops/offers` und `/ops/voice-copilot`; Navigation zu und von Social Studio, korrekte aktive Markierung und Öffnen des realen Dashboards in einem neuen Tab bestätigt. Das Dashboard zeigte die bestehenden vier Entwürfe, null geplante/veröffentlichte Beiträge; keine Freigabe ausgelöst.
- Desktop bei 1.512 Pixeln ohne horizontalen Overflow; 390- und 768-Pixel-Ansichten der echten lokalen Route in temporären Vorschau-Frames visuell geprüft, einschließlich vollständigem Menü, Textumbruch und Öffnen-Button. Die Vorschau-Datei anschließend entfernt.
- Die neue Route liegt unter dem vorhandenen `/ops/:path*`-Middleware-Schutz. Auth-Code, Workflow, Datenbank und Dashboard wurden nicht geändert.

Implementierung und lokale Prüfung sind kein Produktionsnachweis. Veröffentlichung erst nach Freigabe des exakten sauberen Commits, `codex-predeploy ops` und `codex-safe-push-main`. Danach Deploy-SHA und den Menüpunkt in der produktiven Ops-Oberfläche prüfen. Rollback durch gezielten Revert mit demselben Release-Gate.
