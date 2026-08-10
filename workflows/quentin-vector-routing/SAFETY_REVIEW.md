# Production safety review

- Scope is restricted by exact Quentin board ID, exact Vector list ID and exact Trello action type.
- Positive LED Neon / Neon Flex title phrases override all negative product phrases.
- Unknown/non-specialist titles default to LED Neon Flex and Abdul; only explicit specialist products use Quote Ready.
- The source card is normalized before copying; the destination receives the corrected values.
- Only `Backboard_1..4`, an idempotent price-warning title suffix and one warning comment may be changed.
- AI output is only a proposal. Code validates the schema and maps allowed customer-facing values.
- Missing/invalid image data clears unsafe backboard values, records a warning and still routes.
- HTTP calls have bounded retries. Advisory field writes may fail independently and are summarized.
- Event IDs are stored after a verified copy to suppress execution replays.
- The independent watchdog scans only the last 24 hours and waits five minutes before recovery.
- A destination copy counts only when its `cardSource.id`, expected list and timestamp match the Quentin move.
- Old or wrongly routed copies never hide a missing offer.
- The watchdog records in-flight events for 15 minutes and verifies every fallback copy.
- Failed recoveries are retried on later schedules.
- Alert emails are internal only and use the existing support Outlook credential.
- All alert emails use the fixed requested subject.
- Rollback: restore the previous main-workflow version and deactivate both
  TICKET-105 guard workflows. The replaced Butler rule remains unchanged.
- No secrets are stored in the repository; only existing n8n credential references are used.
