# Sales-Vergabe Decisions

## Dauerhafte Entscheidungen

| Entscheidung | Status | Konsequenz |
| --- | --- | --- |
| Offers-Annahme ist der primäre Entstehungspfad eines Sales. | `[verifiziert]` | `offer.completed` wird direkt an Ops gesendet; Pull und Shopify sind Recovery/Fallback. |
| Ops Supabase ist Source of Truth für Vergabe und Idempotenz. | `[verifiziert]` | Shopify, Trello, Aufgaben und n8n dürfen den fachlichen Zustand nicht ersetzen. |
| Shopify ist Autorität für Zahlung, Fulfillment und aktuelle Order-Tags. | `[aus Git/Code abgeleitet]` | Diese Werte werden regelmäßig oder manuell in die Ops-Projektion reconciled. |
| Trello ist ausschließlich Projektion. | `[verifiziert]` | Fehlende oder veraltete Karten dürfen keine Sale-Entscheidung erzeugen. |
| Aktuell bezahlte Sales stehen ganz oben. | `[verifiziert]` | Sie werden grün markiert und sind sofortige Vergabepriorität. |
| Frühere bezahlte Bestellung ist nur Vertrauenssignal, keine aktuelle Zahlung. | `[verifiziert]` | Unbezahlte Wiederkäufer stehen unter den aktuell Bezahlten und benötigen weiter eine bewusste Freigabe. |
| Privat-E-Mail wird nur exakt gematcht; Firmendomain nur bei nicht persönlichen Domains. | `[verifiziert]` | Gmail, GMX, Web.de und ähnliche Domains werden nicht als gemeinsame Organisation behandelt. |
| Das 24-Stunden-Änderungsfenster ist informativ. | `[verifiziert]` | Ein Operator darf während des offenen Fensters vergeben. |
| Eine tatsächlich angeforderte Änderung ist blockierend. | `[verifiziert]` | Die Änderung muss quittiert werden, bevor die API eine Vergabe akzeptiert. |
| Unbezahlte Vergabe erfordert `manual_approved_unpaid`. | `[verifiziert]` | `wait_for_payment` blockiert; die Freigabe muss bestätigt und protokolliert werden. |
| Standard-Supplier-Tags sind exakt festgelegt. | `[verifiziert]` | Quentin: `Quentin (noch bezahlen)`; Saeid: `Saeid (schon bezahlt)`. |
| Bereits extern vergebene, abgeschlossene oder in Shopify stornierte Sales verschwinden nach Shopify-Reconcile aus `active`. | `[verifiziert]` | Der Shopify-Tag-/Fulfillment-/Storno-Abgleich muss regelmäßig und beobachtbar laufen. |
| Kundenkommunikation geschieht nie ungeprüft aus einem Poller. | `[verifiziert]` | Erinnerung und AB werden explizit ausgelöst, validiert und idempotent reserviert. |
| Automatische private Zahlungserinnerung nach fünf Minuten ist nicht beschlossen/implementiert. | `[verifiziert]` | Eine solche Funktion braucht eigene fachliche Freigabe, Opt-out, Timing- und Datenschutzregeln. |
| Supplier-Trello-Projektion ist opt-in. | `[verifiziert]` | Sie bleibt ohne `SUPPLIER_TRELLO_PROJECTION_ENABLED=true` aus. |
| Side Effects sind idempotent und partiell nachvollziehbar. | `[verifiziert]` | Vergabeversuch und Reminder-Reservierung verhindern Doppelversand/-projektion. |

## Relevante Git-Historie

| Gruppe | Verifizierte Commits | Wirkung |
| --- | --- | --- |
| Fundament | `a8e0fc5`, `30a0b9b` | `[verifiziert]` Supplier-Sales-Grundlage und idempotente Vergabe. |
| Offers-Sync | `9ef4d4e`, `c1f54af`, `ce03f4e`, `1332045`, `ae62ac9`, `31cbcc3` | `[verifiziert]` Completed-Offers-Import, Recovery und Aktualität. |
| Zahlung und Tags | `6a5e604`, `0d13539`, `55c2485`, `08eb57b`, `980528b`, `5d198e8`, `685e965` | `[verifiziert]` Zahlungslinks, Supplier-Tags, Reconcile und Auth-Aliase. |
| UI | `9c47697`, `af1decb`, `a707ddd`, `613facb`, `b000da1`, `b399601` | `[verifiziert]` Bedienung, Filter, Grenzen und Kundenauswahl. |
| Auftragsbestätigung | `b28fbf1`, `7fa5c7f`, `9809bac` | `[verifiziert]` Snapshot-basiertes PDF und idempotenter E-Mail-Webhook. |
| Trello | `90813f4`, `cf638c2` | `[verifiziert]` Projektion standardmäßig aus; Shopify-Order-Präfix an Quellkarten. |
| Bestandskunden | `2efe41a`, `a46e37a`, `165f3f0`, `db9441d`, `c36da5e` | `[verifiziert]` Historien-Matching, Beleglink, Priorisierung und Darstellung. |
| Shopify-Reconcile | `132e224`, `ea7ecb8`, `b4a8766`, `8750fe4`, `779cd23` | `[verifiziert]` Order-Verknüpfung, Tags, Fulfillment und aktive Liste. |

- `[verifiziert]` Die kurzen Hashes der Tabelle sind im aktuellen `origin/main` enthalten.
- `[verifiziert]` `dead29867153af7d81d131aff3c82f59d9eaaae6` (`feat: expose accepted offer snapshot in sales assignment`) liegt auf einer nicht gemergten Parallel-Branch und ist kein Bestandteil von `origin/main`. Diese Änderung darf nicht ungeprüft übernommen werden.

## Explizit erwähnte Deploys

| Commit | Git-Nachweis | GitHub-Actions-Nachweis | Status |
| --- | --- | --- | --- |
| `8f576374834181589f32ea0b70782631250f8ce3` | `docs: add supplier sales integration setup` | Run `28369707755`, success | `[verifiziert]` |
| `685e9652711a0f450f6a54204b7cd2a3ef66deeb` | `Accept all configured supplier sales tokens` | Run `28608058887`, success | `[verifiziert]` |
| `606476709ed9ac42f29a47dcff70cb3c3805beef` | `Harden ops company brain checks` | Run `28608193277`, success | `[verifiziert]` |
| `cf638c28ee012c9e9d6e24d1a4504ee9e6e3c9d7` | `Format Shopify order prefix on source Trello cards` | Run `29399777808`, success | `[verifiziert]` |
| `c36da5e38900d8cb539098f6683cd691633d6086` | `Highlight repeat paid customers in supplier sales` | Run `29497838861`, success | `[verifiziert]` |
| `d3e14db4e1da447cf18ec0d328c63827f81bd9f1` | aktuelles `origin/main` | Deploy-Run `29849034207`, success | `[verifiziert]` |

- `[nur aus Thread erinnert]` Im Chat wurden weitere erfolgreiche Deploys ohne eindeutig zuordenbaren Commit-Hash gemeldet. Sie sind kein belastbarer Release-Nachweis.
- `[verifiziert]` Ein erfolgreicher CI-/Coolify-Run belegt Build und Deployment-Workflow, aber nicht die fachliche Vollständigkeit produktiver Sales oder aktive n8n-Zeitpläne.

## Nicht getroffene Entscheidungen

- `[offen]` Ob private Kunden automatisch fünf Minuten nach Annahme einen Shopify-Bezahllink erhalten sollen, ist technisch und fachlich nicht abschließend geregelt.
- `[offen]` Ob `Snapshot` ein eigenes unveränderliches Offers-Artefakt oder die intern generierte AB bleiben soll, ist in der aktuellen UI/API semantisch nicht sauber entschieden.
- `[offen]` Ob Supplier-Trello-Karten produktiv automatisch erstellt werden sollen, ist trotz vorhandener Listen-Konfiguration nicht belegt; der Code-Default ist aus.
- `[offen]` Die gewünschte eindeutige direkte Trello-Kartenauflösung über Nerdyforms-/Request-ID ist nicht als garantiertes End-to-End-Verhalten belegt.
