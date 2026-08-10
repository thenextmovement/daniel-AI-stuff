# Production safety review

- Scope is restricted by exact Quentin board ID, exact Vector list ID and exact Trello action type.
- Positive LED Neon / Neon Flex title phrases override all negative product phrases.
- Unknown titles fail safe to Management Quote Ready, never Abdul.
- The source card is normalized before copying; the destination receives the corrected values.
- Only `Backboard_1..4`, an idempotent price-warning title suffix and one warning comment may be changed.
- AI output is only a proposal. Code validates the schema and maps allowed customer-facing values.
- Missing/invalid image data clears unsafe backboard values, records a warning and still routes.
- HTTP calls have bounded retries. Advisory field writes may fail independently and are summarized.
- Event IDs are stored after a verified copy to suppress execution replays.
- Rollback: deactivate this workflow and re-enable the one replaced Butler rule.
- No secrets are stored in the repository; only existing n8n credential references are used.
