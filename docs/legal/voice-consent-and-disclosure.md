# Voice Consent And Disclosure Gate

This is an engineering control record, not legal advice. German counsel or the responsible data-protection/legal owner must approve the final form wording and production rollout.

## Human Live Copilot

The human live-copilot path processes both participants' audio for live transcription even though it neither speaks nor stores a raw transcript. Engineering therefore treats active, informed consent as a mandatory gate. The operator must confirm consent before capture starts, stop immediately after withdrawal, and continue the call without the copilot. A passive opt-out or continued speaking is not accepted as consent.

The exact spoken notice, employee participation rules, processor/data-transfer terms, and whether any transient processing is classified as recording must be approved by the legal/privacy owner before customer use.

## Current Primary-Source Constraints

- German UWG section 7 requires prior express consent for consumer telephone advertising and for advertising using an automated calling machine: <https://www.gesetze-im-internet.de/uwg_2004/__7.html>
- UWG section 7a requires appropriate documentation and five-year retention of consumer telephone-advertising consent: <https://www.gesetze-im-internet.de/uwg_2004/__7a.html>
- EU AI Act Article 50 requires clear AI-interaction information no later than the first interaction/exposure: <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689>
- Personal-data processing still needs an applicable GDPR basis and purpose controls: <https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04>

An inquiry alone is not enough for this platform. The form must use a separate, unticked consent control covering NEONTRIP telephone contact and contact by a digital AI telephone assistant for the concrete inquiry/follow-up purpose.

## Proposed Form Wording For Legal Review

> Ich bin einverstanden, dass NEONTRIP mich zu meiner konkreten Anfrage telefonisch kontaktiert. Der Anruf kann durch einen digitalen KI-Telefonassistenten erfolgen. Ich kann diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.

The confirmation email should repeat the scope, time/source reference, and an easy withdrawal channel. The production form integration must send exact wording, form version, submission ID, timestamp, request ID, purpose, and phone through the signed consent endpoint.

## Opening

The implementation does not open with “Ich bin eine KI”. It asks whether the call currently fits after NEONTRIP identity and the concrete inquiry/offer reference, then discloses the AI-supported digital assistant in the same first speaking turn before any qualification or follow-up content:

> Hallo Frau/Herr ..., hier ist Nia von NEONTRIP. Sie hatten bei uns wegen ... angefragt. Passt es gerade kurz? Ich unterstütze Sie dabei als KI-gestützter digitaler Telefonassistent.

The assistant does not wait for the customer's answer before disclosure. If asked whether it is AI or human, the agent answers immediately and truthfully.

An internal telephone test uses a separate, synthetic `internal-test:<uuid>` context. It must be allowlist-only, use a consent record with source `internal_test_authorization`, include a concrete source reference, and never claim that a customer inquiry or offer exists. This exception is only for expressly approved internal sandbox calls; customer calls remain bound to an active inquiry and the full consent gate.

## Privacy Defaults

- no audio recording;
- no durable raw transcript;
- structured qualification/outcome only;
- bounded short human summary;
- model, prompt, consent, event, and tool audit metadata;
- no cross-customer lookup;
- no emotion recognition or biometric categorization.

Any future recording or transcription change requires a separate legal review, new consent/information design, retention/deletion policy, security review, and explicit deployment approval.
