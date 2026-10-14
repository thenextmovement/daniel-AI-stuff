# NEONTRIP Clarity identifiers

Scope: NEONTRIP's 12 existing tracked landing pages plus the German and English
quote wizards under `deploy/`. The shared source is
`deploy/_source/layouts/base.html`; runtime code is
`deploy/assets/js/nt-clarity-identifiers.js`. No Offers/Ops/RIESENOBJEKTE runtime,
form submission, conversion, routing or UI behavior is changed.

## Contract

- Ziel: call Clarity `identify` after explicit Cookiebot statistics consent on
  every existing tracked page, including restored consent and later acceptance.
- Nachbar: preserve the existing Clarity project `vvb78gxiwp`, page/language tags,
  loader, forms, attribution and Google/OpenAI Ads conversion guards.
- Wirkung: Clarity receives a pseudonymous browser visitor ID, an activity-session
  ID and a normalized page path. This is browser continuity, not a logged-in
  customer ID or cross-device identification. No names, emails, form values,
  query strings or fragments are passed by this helper.
- Allowed paths: this helper, its references in the 14 tracked HTML files and
  shared layout, its focused test and this documentation.

| Field | Value and lifetime |
| --- | --- |
| custom-id | `ntv_` plus 128 cryptographically random bits; `nt_clarity_visitor`, 365 days |
| custom-session-id | `nts_` plus 128 random bits; `nt_clarity_session`, 30 minutes |
| custom-page-id | `neontrip:` plus pathname; normalizes `.html`, `index.html`, trailing slash |
| friendly-name | Omitted |

Session expiry is refreshed on page load/consent and at most once per minute of
pointer, keyboard or scroll activity. No field contents are inspected. Cookies
use `Path=/`, `SameSite=Lax`, `Secure` on HTTPS, and `Domain=neontrip.de` on that
registrable domain. Local/preview origins use host-only cookies. Existing IDs can
therefore survive a move from anfrage.neontrip.de to neontrip.de in the same
browser, if the destination includes the same helper and has statistics consent.
A destination with unresolved consent does not read/send IDs or erase the source
IDs. Explicit refusal or withdrawal clears both custom cookies.

The script is loaded with `data-cookieconsent="ignore"` so that it can handle
withdrawal. Its own strict gate controls all identifier creation, reads and
Identify calls. Cookiebot continues to gate the Clarity loader. The helper
synchronizes Clarity Consent V2 using statistics/marketing separately. Repeated
consent events do not duplicate Identify for the same user/session/page. Blocked
storage skips custom identification without breaking the page.

## Verification, 2026-10-13

- All 14 pre-change HTML files matched live anfrage.neontrip.de byte for byte.
- Removing the one added script tag reproduces every pre-change HTML file and
  the layout exactly. The new script is versioned by its SHA-256 prefix.
- 94 tests passed across `lp-clarity-identifiers`, `lp-openai-consent`,
  `lp-confirmed-conversion-static`, and `lp-release-contract`.
- Headless Chrome with the real Cookiebot banner and intercepted Clarity calls:
  no custom ID before acceptance, one Identify per page after acceptance,
  stable visitor/session across `/logo/`, `/`, `/anfrage`, `/en/`, `/en/anfrage`,
  neontrip.de and www.neontrip.de. Root/subdomain cookies and withdrawal verified.
  www required its own consent in the test; stored IDs survived until acceptance.
- All page content used in the browser was routed from this candidate locally;
  Clarity/Ads collectors were intercepted. No real inquiry or conversion sent.
  Appearance/asset loading was outside scope; placeholder font responses caused
  expected decoding warnings. No page JavaScript exceptions were observed.
- A full baseline rebuild already differs from nine checked-in/live pages.
  Preserve that pre-existing drift: this change adds the helper to the source
  and applies only its script reference to the current published HTML. Do not
  publish unrelated full-rebuild differences with this release.

## Release and rollback

Publication is pending exact-commit approval required by AGENTS.md. Use the
existing Ops worktree/predeploy/safe-push flow and existing Cloudflare Pages
project `neontrip-lp`. A main push also triggers the repository's existing Ops
pipeline; successful Git/CI is not proof of the landing-page release. Re-read
provider state and capture its current production deployment ID before an
approved Pages deployment. Preserve Pages Functions and all existing assets.
After publication verify the new script version and Identify in the actual
production runtime; a Clarity dashboard recording has not yet been proven.

Rollback: revert only this change's script references/helper (and source
reference), or return Cloudflare Pages to the captured pre-release deployment.
Cookie IDs left by a rollback are inert and expire; do not clear unrelated
Cookiebot or marketing cookies. In a later rebuilt neontrip.de site, carry this
helper and versioned reference across explicitly; changing DNS alone does not
install tracking into another source tree.

Sources:
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/identify-api
- https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2
