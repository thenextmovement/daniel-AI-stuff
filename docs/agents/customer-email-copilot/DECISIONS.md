# Customer Email Copilot Decisions

## Dauerhafte Entscheidungen

| Entscheidung | Evidenzstatus | Konsequenz |
| --- | --- | --- |
| Nur Entwürfe; niemals autonomer Versand. | `[verifiziert]` | Kein Rollout-Schalter, Prompt, Retry oder Zeitplan darf einen Versandpfad freischalten. |
| Menschliche Versandfreigabe ist verpflichtend. | `[verifiziert]` | Jeder erzeugte Reply-Draft bleibt `pending_review`. |
| Postgres ist Source of Truth für Locks, Retry, Audit und Qualität. | `[verifiziert]` | n8n orchestriert; Trello oder Modellzustand ersetzen keine kanonische DB-Entscheidung. |
| AI schlägt JSON vor, deterministische Logik validiert. | `[verifiziert]` | Unbekannte Felder, Fakten und Claims failen geschlossen. |
| Resolve-first statt „intern klären“. | `[verifiziert]` | Verfügbare Fakten werden sofort genutzt; vage spätere Zusagen werden blockiert. |
| Fehlende kundenseitige Evidenz wird präzise angefragt. | `[verifiziert]` | Dokument/Referenz/Maß/Adresse/Entscheidung und Zweck werden konkret genannt. |
| Fehlende interne Evidenz erzeugt keine Kunden-Zusage. | `[verifiziert]` | Claim auslassen, Lücke in Review-Metadaten festhalten. |
| Tatsächliche Anhangspräsenz schlägt Kundenbehauptung. | `[verifiziert]` | Angekündigte, aber nicht vorhandene Dokumente werden als fehlend behandelt. |
| Interne View-/Read-/Search-Telemetrie bleibt intern. | `[verifiziert]` | „Angebot wurde angesehen“ oder ähnliche Informationen dürfen nicht in den Entwurf. |
| Aktuelle Kunden-/Order-/Offer-Fakten schlagen allgemeines Wissen. | `[verifiziert]` | Wissensbasis darf keine Preise, Termine, Ausnahmen oder Zusagen autorisieren. |
| Firmendomain erweitert nur die Recherche. | `[verifiziert]` | Domain-only darf keine fremde Order oder anderes Projekt auswählen. |
| Backfill ist bounded und idempotent. | `[verifiziert]` | 30 Tage, maximal zehn neue Kandidaten pro Lauf, keine direkte Entwurfs- oder Versandaktion. |
| Retry ist DB-gestützt und begrenzt. | `[verifiziert]` | Lease, maximal fünf Attempts, Draft-Reconciliation und finaler manueller Zustand statt Blind-Retry. |
| Action-driving `no_reply` bleibt aus. | `[Live-Metadaten]` | Decision Shadow misst, unterdrückt aber keine Antwort im Hauptpfad. |
| Stil lernt passiv nur aus semantisch sicheren Struktursignalen. | `[verifiziert]` | Keine Kundenwörter/Fakten; Mindestmenge v5 ist zehn sichere Beispiele. |
| Manuelles Review ist Ausnahme, nicht Voraussetzung für jede Stilprobe. | `[verifiziert]` | Automatische Analyse klassifiziert; manuelle Gründe korrigieren Sonderfälle. |
| Fabiennes echte Signatur wird wiederverwendet. | `[verifiziert]` | Foto/Logo/HTML nicht durch ein frei erfundenes Modell-Snippet ersetzen. |

## Historische Produktentscheidungen aus dem Arbeitsverlauf

| Historische Entscheidung | Heutige Einordnung |
| --- | --- |
| Technische Support-/WhatsApp-/Form-Relays müssen trotz intern wirkendem Absender als möglicher Kundeneingang erkannt werden. | `[verifiziert]` Exakte Relay-Muster; Konflikt failt zu Review statt `no_reply`. |
| Mehrere Personen einer Kundenorganisation können am selben Projekt arbeiten. | `[verifiziert]` Organisationssuche vorhanden; Domain bleibt Kandidatensignal, nicht Beweis. |
| Angebote und Shopify-Order-Notizen sollen zur Antwortrecherche dienen. | `[verifiziert]` Resolver v2 liest live Shopify und vertrauenswürdige Offer-/Snapshot-Referenzen read-only. |
| Mitarbeiter werden keine Review-Gründe für jede Änderung pflegen. | `[verifiziert]` Automatische v5-Analyse und passives, inhaltsfreies Stilprofil; manuelles Review optional. |
| Antworten sollen kurz, normal menschlich und in Absätzen sein. | `[verifiziert]` Stilprofil kann nur bounded Wort-/Absatzlimits und erlaubten Abschluss beeinflussen. |
| „Liebe Grüße“ mit Emoji ist unerwünscht. | `[verifiziert]` Erlaubte deutsche Abschlüsse sind `Viele Grüße` und `Beste Grüße`; generierte Graphen enthalten kein Abschluss-Emoji. |
| Offene Inbox-Nachrichten sollen rückwirkend Entwurfskandidaten werden. | `[verifiziert]` Separater Backfill scannt bounded und enqueued in den kanonischen Retry-Pfad. |

## Rollout-Entscheidungen

- `[verifiziert]` Erlaubte Stufen sind `shadow`, `review_only` und `routing_gate`.
- `[verifiziert]` Selbst `routing_gate` kann den Versand nicht freischalten.
- `[Live-Metadaten]` Angefordert und effektiv ist `review_only`.
- `[Live-Metadaten]` Der 50-Fälle-Entscheidungstest ist bestanden: Routing Accuracy, Actionable Recall und No-Reply Precision jeweils 100 %, null unsafe `no_reply`; Exact Label Accuracy 90 %.
- `[Live-Metadaten]` Der aktuelle Entwurfs-Qualitätstest ist nicht bestanden und blockiert jede Promotion.

## Relevante Git-Historie

| Commit | Entscheidung / Wirkung |
| --- | --- |
| `16295ce` | Basishärtung des E-Mail-Draft-Runtimes. |
| `af3327d` | Decision Shadow eingeführt. |
| `15f1ff2` | Deterministisches Commerce Facts Package. |
| `503269c` | Goldtest und staged Rollout Gate. |
| `cc2e199` | Durable Retry Recovery. |
| `2096b95` | Resolve-first und Open-Inbox-Backfill. |
| `4b00718`, `8992f05` | Interne-only Entwürfe und spätere Deferral-Zusagen blockiert. |
| `81cecfd`, `62a6dda` | Lernloop und passives, sicheres Stil-Lernen. |
| `e782321` | Facts v2, Quality Gate v4, Feedback Analyzer v5, Mindestmenge zehn. |
| `df1faf9` | Race-sichere Open-Inbox-/Claim-Identität und bessere Failure-Envelope-Artefakte. |

## Nicht getroffene Entscheidungen

- `[offen]` Kein autonomer Versand ist geplant oder freigegeben.
- `[offen]` Keine automatische Prompt-Umschreibung aus Mitarbeiterantworten ist freigegeben.
- `[offen]` Kein Domain-only Cross-Contact-Matching ist freigegeben.
- `[offen]` Keine Preis-, Rabatt-, Liefertermin-, Refund-, Kulanz- oder Policy-Entscheidung darf vom Modell getroffen werden.
- `[offen]` Eine Promotion über `review_only` ist erst nach bestandenem aktuellem Qualitäts- und Kategorie-Gate überhaupt bewertbar.
