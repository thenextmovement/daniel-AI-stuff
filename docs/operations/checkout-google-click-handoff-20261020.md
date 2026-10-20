# NEONTRIP: gespeicherte Google-Klickdaten beim Checkout

## Auftrag und Vertrag

Am 20.10.2026 autorisiert: vorhandene Checkout-Übergabe für gespeicherte Google-Klickkennungen ergänzen; Kaufabschluss im vorhandenen Shopify-Pixel prüfen. Einwilligung berücksichtigen, keine zusätzlichen Kaufereignisse erzeugen.

- Ziel: Gültige gclid/gbraid/wbraid bleiben auch nach Verlust der URL-Parameter für die bestehende Shopify-Navigation verfügbar.
- Nachbar: Checkout-Erstellung, Zahlung, Preisprüfung, Warenkorbkennung, Formulare, X-/OpenAI-/Clarity-Ereignisse und GA4-Cookies bleiben unverändert.
- Wirkung: Nur erlaubte Trackingparameter werden an die bereits validierte Checkout-URL ergänzt. Kein neuer Pixel, Event-Transport, API-Body, Backend, Kaufimport oder Conversion-Ziel.
- Dateien: `deploy/configurator/checkout-client.js`, daraus erzeugtes Hauptbundle, dessen Versionsreferenzen in sieben bestehenden Einstiegsseiten, wiederverwendeter Build-Helfer und gezielte Tests.

## Implementierung

Die bestehende Funktion `readCheckoutAttribution` erhält einen consentabhängigen Rückgriff auf `sessionStorage`. Der Kontext enthält nur erlaubte Klick- und Kampagnenwerte sowie einen Erfassungszeitpunkt; keine komplette URL, Kundendaten, Entwurfsdaten oder Kaufangaben.

Der Konfigurator erfasst aktuelle Google-Parameter erst nach ausdrücklicher Marketing-Zustimmung. Er reagiert auf die vorhandenen Cookiebot-Ereignisse und `pageshow`. Der Kontext gilt höchstens 30 Minuten ab Erfassung und wird durch Reload oder Consent-Callback nicht verlängert. Nur aktuelle URL-Werte und der unveränderte Google-API-Rückgriff folgen außerhalb dieses zusätzlichen Speicherrückgriffs ihren bisherigen Regeln.

Alte Werte aus `nt_attr_`/`nt_` werden ausschließlich aus dem Sitzungsspeicher übernommen, wenn die unmittelbar vorherige, gleichursprüngliche Landingpage dieselbe Klickkennung in ihrer tatsächlichen Referrer-URL führt. Ein altes Cookie, ein gespeicherter `landing_page_url`-Wert oder unbefristeter localStorage genügen nicht. Bestehende, aber abgelaufene/defekte Kontexte werden nicht erneut aus demselben unveränderten Referrer verjüngt.

Eine abweichende aktuelle Kampagne, ein anderer Plattform-Klick oder eine ungültige aktuelle Google-Kennung verhindert die Übernahme älterer Google-Daten. Eine zeitlich begrenzte Sperrmarke verhindert außerdem die sofortige Wiederaufnahme über `gtag.get` bei anschließender Navigation ohne Parameter. Einwilligungswiderruf entfernt den neuen Kontext; andere Speicher bleiben erhalten. Aktuelle Shopify-Parameter, insbesondere `key` und `_cs`, werden nicht überschrieben.

Die Änderung enthält keinen `purchase`-Sender. Die bestehende Checkout-Anfrage bleibt identisch; ein doppelter Aufruf teilt weiterhin dieselbe laufende Anfrage.

## Ausgangsstand und Release

Während der Vorbereitung wurde die zuvor veröffentlichte Basis `4355b263…` durch den separat freigegebenen OpenAI-Tracking-Release ersetzt. Aktuelle verifizierte Basis:

- veröffentlichter Commit `5996a7c9a7d1f33fdaf705e895c466ac083e39b5`;
- Pages-Deployment `e890f20d-b3a3-47f7-b834-2159be3c3461`;
- vollständiges Artefakt `/Users/danielklesse/Documents/Codex/2026-10-20/bitte-vervollst-ndige-das-openai-conversion/work/release-candidate`.

Checkout-Quelldatei, Hauptquelle, Hauptbundle und HTML wurden frisch vom öffentlichen Host gelesen und bytegleich zu dieser Basis bestätigt. Die bereits veröffentlichte OpenAI-Ergänzung bleibt erhalten. Die Konflikte beim Zusammenführen der beiden veröffentlichten Quellen wurden ausschließlich für Deployment-Dateien auf den aktuellen veröffentlichten Stand aufgelöst.

Kandidat und Nachweise:
`/Users/danielklesse/Documents/Codex/2026-10-16/bernimm-diesen-neontrip-google-ads-auftrag/work/checkout-google-click-handoff-20261020/`.

Das vollständige Paket umfasst 1.873 Dateien. Ausschließlich Checkout-Quelldatei, daraus erzeugtes Bundle und sieben HTML-Versionsreferenzen ändern sich. Alle anderen Bytes einschließlich Cloudflare Functions bleiben identisch. Nicht das unvollständige rohe Repository-Deploy-Verzeichnis veröffentlichen.

Rollback: vorheriges vollständiges Artefakt bzw. Deployment `e890f20d-b3a3-47f7-b834-2159be3c3461`. Keine Datenmigration; der zusätzliche Kontext wird ohne den neuen Code nicht ausgewertet. Veröffentlichung erfordert die Freigabe des endgültigen sauberen Commit nach AGENTS.md.

## Prüfung

19 gezielte Tests prüfen aktuelle und gespeicherte Kennungen, alle drei Google-Arten, bestätigten Legacy-Kontext, Quellenwechsel, ungültige/abgelaufene Daten, Speicherfehler, fehlende/erteilte/widerrufene Zustimmung, doppelte Initialisierung, unveränderte Checkout-Anfrage und doppelte Checkout-Aufrufe. Alle Tests laufen ohne Produktionsnetzwerk.

Der vorhandene esbuild-0.28.1-Builder konnte zuerst das unveränderte Produktionsbundle bytegleich reproduzieren. Derselbe Builder erzeugt den Kandidaten. Der zusätzliche optionale Pfad `NEONTRIP_CONFIGURATOR_ROOT` erlaubt Tests und Builds gegen das vollständige Release-Paket, da origin/main allein nicht alle veröffentlichten Konfigurator-Abhängigkeiten enthält. Die Tests gleichen die verwendete Checkout-Quelle gegen den committed Quelltext ab.

```sh
NEONTRIP_CONFIGURATOR_ROOT=/absolute/path/to/release-candidate/site-release/configurator \
  node --test tests/configurator-checkout-attribution.test.mjs

NEONTRIP_CONFIGURATOR_ROOT=/absolute/path/to/release-candidate/site-release/configurator \
  node scripts/neontrip/build-configurator-runtime.cjs --check
```

## Shopify-Pixel: lesendes Ergebnis

Die aktuelle öffentliche Konfiguration weist weiterhin Google-App-Pixel `1019183371`, Version `a3321ca85cf5aaf6b57585fcd8d67b3a` aus. Der frisch gelesene Code hat SHA256 `88f7c196f563b9a96c167a697712a79faf894f555edc53a5c244273de7df6e9c`.

Zehn isolierte Fälle mit genau diesem Skript und abgefangenen gtag-/Netzwerkaufrufen bestätigen:

- Mollie- und PayPal-Ereignis: ein `checkout_completed`-Listener und ein `purchase`-Aufruf mit dynamischer Shopify-Bestell-ID, Wert und EUR.
- Mehrere identische Consent-Mitteilungen: weiterhin nur ein Checkout-Listener.
- Keine initiale Analytics-/Marketing-Erlaubnis: keine Initialisierung und kein Purchase-Callback.
- Analytics-only sowie Widerruf nach Initialisierung: die entsprechenden Google-Consent-Signale sind denied; ein vorhandener Callback ist nicht mit einem gesendeten erlaubten Netzwerkereignis gleichzusetzen.
- Kein `checkout_completed`: kein Kauf.
- Absichtlich doppelte Offline-Ereigniszustellung: zwei gtag-Aufrufe mit derselben Transaktions-ID, keine neu erzeugte ID. Der Pixel selbst ist keine zusätzliche In-Memory-Deduplizierung. Die Deduplizierung anhand derselben Bestell-ID erfolgt bei Google.

Die Kaufziele bleiben GA4 `G-NEEVFC08VX`, Ads `AW-314675901/7gyaCO_rqOsCEL2lhpYB` und Merchant Center `MC-CXP35YKCLM` in einem vorhandenen Purchase-Aufruf. Keine zweite Google-Kaufintegration wurde hinzugefügt oder geändert. Die ausgelesenen Pixelkonfigurationen enthielten nur bei diesem App-Pixel die betroffenen Google-IDs; daraus wird keine vollständige Prüfung sämtlicher denkbarer anderer Erfassungswege behauptet.

Kein Testereignis erreichte Google, Shopify oder ein anderes Produktionssystem. Es wurde kein Warenkorb, Checkout oder Kauf angelegt und keine alte Kaufbestätigungsseite geöffnet. Ein echter Kauf mit durchgehend korrelierter Browser-Client-ID, Session-ID und Bestell-ID bleibt als Live-Nachweis offen; die Offline-Prüfung ersetzt ihn nicht.

Primärquellen:

- https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_completed
- https://support.google.com/analytics/answer/12313109
- https://support.google.com/google-ads/answer/6386790

## Kritische Selbstprüfung

Ein bloßes Auslesen der alten Cookies würde veraltete Quellen übernehmen und wäre kein ausreichender Fix. Deshalb begrenzter Sitzungsrückgriff mit Herkunftsnachweis und Quellenvorrang. Die bestehende GA4-Cookie-Domain funktioniert laut Browserprüfung und wird nicht geändert. Der gefundene Callback liefert keinen Beleg für die Google-Anzeigenherkunft der drei historischen Käufe; keine Rückdatierung oder pauschale Nachmeldung. Ein zweiter Pixel würde ein unnötiges Doppelzählungsrisiko hinzufügen und ist nicht Bestandteil der Änderung.
