# Öffentliche Einrichtungen: Vergabe vor Zahlung

Stand: 22.10.2026. Lokal implementiert; Veröffentlichung und produktiver Nachweis offen.

## Vertrag und kritisch geprüfter Plan

- **Ziel:** Öffentliche Einrichtungen und Forschungskunden anhand der Kunden-E-Mail in der Sales-Vergabe kennzeichnen, damit eine Vergabe vor Zahlung bewusst vorgenommen werden kann. Karte und Schnellfilter verwenden dieselbe serverseitig abgeleitete Information.
- **Nachbar:** Zahlung, Bestandskundenhistorie, Sortierung, Supplier-Auswahl, Lieferdatum, Kundenänderungsprüfung und idempotente Vergabe bleiben getrennt. Ein Institutionshinweis ist weder Zahlungsnachweis noch automatische Freigabe.
- **Wirkung:** Beim Lesen keine Speicherung, kein Backfill und kein externer Aufruf für die Erkennung. Erst die vorhandene bestätigte Aktion `assign_supplier` speichert `manual_approved_unpaid` und führt die bisherigen Side Effects aus. Shopify-Zahlung bleibt offen. Keine Schema-, Workflow-, Reminder- oder Trackingänderung.
- **Dateien:** `src/lib/ops/supplier-sales.ts`, `src/app/ops/sales-vergabe/page-client.tsx`, bestehende Supplier-Sales-Tests und UI-Smoke sowie diese Domänendokumentation.

Der kritische Durchgang korrigiert die Annahme, dass ein Wort wie „Institut“, „Uni“ oder „Stadt“ eine öffentliche Einrichtung oder deren Zahlungsbedingungen beweist. Es gibt zwei ausdrücklich getrennte Ergebnisse:

1. `known_domain`: exakt hinterlegte Institutionsdomain oder deren echte Subdomain. Sichtbare Institution, Domain und bei offener Zahlung der Hinweis „Vor Zahlung vergeben“.
2. `domain_pattern`: typische DACH-Präfixe für Hochschulen, Kommunen und Forschungsinstitute sowie Behördennamensräume. Ausschließlich „Mögliche öffentliche Einrichtung – prüfen“ und „Vergabe vor Zahlung prüfen“. Das Muster bestätigt weder öffentliche Trägerschaft noch eine Zahlungsvereinbarung.

Die Institutionsbestätigung verlangt die Prüfung des institutionellen Auftrags und Zahlungsziels; auch Studierende können eine Hochschuladresse besitzen. Privatadressen werden nicht anhand ihres lokalen E-Mail-Teils oder eines Unternehmensnamens klassifiziert. Unbekannte Domains ohne erkennbares Muster bleiben unmarkiert. Die Liste ist bewusst keine vollständige Behörden-/Hochschuldatenbank.

## Darstellung und vorhandene Sperren

- Der Marker wird bei jedem Read aus `customer_email` berechnet und ist damit auch für bestehende Sales ohne erneuten Sync verfügbar. Kein frei gesetztes Metadatenfeld kann die Erkennung überschreiben.
- Der Schnellfilter „Einrichtungen offen“ bezieht sich wie die anderen Schnellfilter auf geladene Sales; er umfasst bekannte und noch zu prüfende Domains. Bezahlt, bereits vergeben, abgeschlossen, storniert oder erstattet erscheint darin nicht.
- Institutionsidentität bleibt nach Zahlung/Vergabe sichtbar; die Aufforderung zur unbezahlten Vergabe verschwindet.
- „Auf Zahlung warten“ bleibt beim Neuladen ausgewählt. Es muss bewusst auf „Trotz offener Zahlung vergeben“ geändert werden.
- `change_requested` sperrt nun auch den UI-Button entsprechend der bestehenden API-Sperre; der Marker zeigt „Kunden-Änderung zuerst prüfen“. Ein bloß offenes 24h-Fenster bleibt unverändert vergebbar.

## Domainquellen und Pflege

Eigentümernachweise am 22.10.2026 anhand offizieller Seiten geprüft. Diese Quellen bestätigen die Institution und Domain, **keine** konkrete Zahlungsfrist:

| Domain | Quelle |
| --- | --- |
| `memmingen.de` | [Impressum Stadt Memmingen](https://www.memmingen.de/impressum.html) |
| `sandersdorf-brehna.de` | [Impressum Stadt Sandersdorf-Brehna](https://www.sandersdorf-brehna.de/de/impressum.html) |
| `solingen.de` | [Stadt Solingen, Finanzmanagement](https://www.stadtsolingen.de/haushalt-2025/HTML/Impressum.html), nennt städtische E-Mail-Domain |
| `wernigerode.de` | [Stadt Wernigerode, Kontakt](https://www.wernigerode.de/?id=homepage_en&lang=en) |
| `fraunhofer.de` | [Fraunhofer, Impressum](https://www.fraunhofer.de/de/impressum.html); Forschungseinrichtung, nicht als staatliche Behörde bezeichnet |
| `uni-koeln.de` | [Universität zu Köln, Impressum](https://uni-koeln.de/impressum) |
| `hu-berlin.de` | [HU Berlin, Impressum und E-Mail](https://qis.hu-berlin.de/elsa/pages/cs/sys/portal/imprint/imprint.faces) |
| `tu-berlin.de` | [TU Berlin, Impressum und E-Mail](https://www.tu.berlin/footer/impressum) |
| `tum.de` | [TUM, Impressum](https://www.tum.de/ueber-die-tum/kontakt-und-anfahrt/impressum) |

Die lesende Domainaggregation der NEONTRIP-Tabelle `supplier_sales` lieferte unter anderem die vier hinterlegten Städte und eine Fraunhofer-Subdomain. Keine Personenadressen werden in diesem Dokument gespeichert. Weitere bestätigte Domains werden im vorhandenen `PUBLIC_INSTITUTION_DOMAINS`-Verzeichnis in `supplier-sales.ts` mit offizieller Quelle in dieser Tabelle ergänzt; Präfixmuster werden dadurch nicht pauschal freigegeben.

## Verifikation und Release

- Fachtests prüfen exakte Domains, Groß-/Kleinschreibung, echte Subdomains, reine Muster, Privatadressen, ungültige Adressen und angehängte Fremddomains.
- Board-Test prüft Ableitung für bestehende Sales ohne Mutation der Eingabedaten, Zahlungs- oder Vergabestatus.
- Gemockter Vergabetest prüft Ablehnung ohne explizite Freigabe, unveränderte API-Sperre bei Kundenänderung und die bestätigte Vergabe bei weiterhin offener Zahlung.
- Erweiterter bestehender UI-Smoke prüft Filter, Warten, Prüfkandidaten, Änderungsblocker, Abbruch/Bestätigung, vorhandenen Vergabe-Payload sowie Mobil-/Desktopdarstellung. Alle API-Aktionen sind gemockt; keine Kundenmail oder echte Produktionsvergabe.
- Ergebnisse am 22.10.2026: fokussierte Supplier-Sales-/Acceptance-Suite **102/102 grün**; vollständige Quote-Suite **1.572 bestanden, 2 vorhandene Tests übersprungen, 0 fehlgeschlagen**; `npx tsc --noEmit` und `npm run build` erfolgreich. UI-Smoke gegen `next dev` auf `127.0.0.1:3128` erfolgreich bei 390×844 und 1440×1000, keine Konsolen-/Seitenfehler, kein horizontaler Überlauf. Die mobile Karte wurde zusätzlich als Screenshot visuell geprüft.
- Zwei Testvoraussetzungen wurden geklärt: `next start` verlangt auch lokal eine Session (kein Produktfehler; Smoke verwendet den vorhandenen lokalen Dev-Modus). Die neue Vergabeprüfung braucht eine im Mock gespeicherte Vergabe, damit der anschließende GET nicht wieder den ursprünglichen Sale liefert; der neue Institutions-Testfall aktualisiert daher seinen Mock-Zustand. Browser werden auch bei fehlgeschlagenem Smoke geschlossen.
- Belege im Aufgabenworktree unter `output/verification/` und `output/playwright/public-institution-mobile.png`; keine produktiven Mutationen. Produktion erst nach Freigabe der exakten sauberen SHA und `codex-predeploy ops`; anschließend read-only Darstellung prüfen. Rollback durch gezielten Revert der Codeänderung, keine Datenrücknahme erforderlich.
