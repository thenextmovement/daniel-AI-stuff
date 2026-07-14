# `/logo/` Photo Hero Pilot — Implementation and QA

Date: 2026-07-13
Scope: local pilot only; no Cloudflare deploy, Google Ads mutation, routing change, n8n change, or production submission.

## Source and rollback

- Isolated worktree: `/Users/danielklesse/codex-worktrees/neontrip-logo-photo-hero-pilot-20260713`
- Baseline commit: `b32e5ba403cec22571aa972ab523ad65a02bd390`
- Page-specific source: `deploy/_source/sections/overrides/logo/02-hero.html`
- Generated output: `deploy/logo/index.html`
- Rollback before any future release: remove the `/logo/` Hero override, revert the related `logo.json`, `build.js`, and `base.html` diff, rebuild `/logo/`, run the release gate, and deploy only the approved commit.

## What changed

- Replaced the video Hero on `/logo/` with the approved Claude photo direction.
- Preserved the shared NEONTRIP header/menu.
- Added a responsive photo composition, product-specific three-step image strip, platform trust proof, animated customer-logo marquee, and a two-step lead form.
- Removed the mock's rotating fake activity messages and invented testimonial rotation.
- Restored the Claude visual system: 1fr/520 layout, 96 px audience badge, centered NEONTRIP watermark, two rotating neon beams, CTA breathing/shine, pulsing status indicators, and a continuous 22-item logo marquee.
- Reduced-motion mode stops the spatial logo marquee but retains slower light, CTA-shadow, shine, and opacity effects, so the interface still communicates activity without the full motion load.
- Reused the original Claude marquee SVG files and their per-logo optical scale values. This fixes the visibly inconsistent source assets in the previous pilot.
- Restored the real Google and Trustpilot platform icons below the primary form CTA. The current Trustpilot value is shown as 3.6/5 from 51 reviews rather than the unsupported 4.8 value in the Claude mock. No unsupported ProvenExpert score was added.
- Kept the form on same-origin `POST /api/c` with multipart upload, honeypot, existing field names, click attribution, and failure reporting.
- Added a stable client submit ID (`request_id` and `nt_client_submit_id`) for future correlation and qualification updates.
- The success UI and conversion helper now run only after `/api/c` returns an accepted JSON response.
- Added page-configurable Hero image, process images/titles, proof, review, preloads, form copy, and optional DKI accent terms.
- Removed the obsolete `VideoObject` structured data from the photo-only `/logo/` page.

## DKI and paid-search mapping

The final URL remains `/logo/`; no routing or Ads account changes were made.

| Search intent / keyword pattern | Landing page | Dynamic headline |
|---|---|---|
| `eigenes logo beleuchtet` | `/logo/` | Ihr eigenes Logo als Leuchtschild |
| `3d logo mit led beleuchtung` | `/logo/` | Ihr 3D Logo mit LED-Beleuchtung |
| `firmenlogo wand`, `wandlogo firma` | `/logo/` | Ihr Firmenlogo als beleuchtetes Wandschild |
| `leuchtschild eigenes logo`, `leuchtschild mit logo` | `/logo/` | Logo-specific Leuchtschild headline |
| `neon schild eigenes logo` | `/logo/` | Ihr eigenes Logo als Neon Schild |
| `logo acrylglas` | `/logo/` | Ihr Logo als Leuchtschild auf Acrylglas |
| `led schild anfertigen lassen` | `/logo/` | LED Schild mit Ihrem Logo anfertigen lassen |
| `leuchtwerbeschild` | `/logo/` | Ihr Logo als individuelles Leuchtwerbeschild |

Final URL suffix remains unchanged:

```text
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_term={keyword}&kw={keyword}
```

Before a future Ads change:

- Recheck negative-list conflicts for `fassade`, `restaurant`, `gastronomie`, `günstig`, and `firmenschild`.
- Do not remove negatives without query-level cost and intent review.
- Verify all active ad and keyword final URLs after the page rollout decision.

## Tracking inventory

| Event / signal | Trigger | Tool / destination | Expected payload | Duplicate control |
|---|---|---|---|---|
| `form_start` | First real form focus | GA4 via existing `gtag` helper | `event_category=engagement`, form ID | Existing per-form guard |
| `file_upload` | File selected | GA4 via existing `gtag` helper | form ID, `value=1` | One event per file-change interaction |
| Lead request | User submits valid step 2 and `/api/c` accepts JSON | Cloudflare `/api/c` → n8n | Existing contact/project fields, click IDs, UTMs, landing/referrer fields, client submit ID | Stable client submit ID |
| `conversion` | Only after accepted `/api/c` response | Google Ads | Existing conversion action, EUR 280 value, enhanced conversion fields | Hero-local `conversionFired` guard |
| `generate_lead` | Same accepted response | GA4 | EUR 280 | Same helper and guard |
| `nerdy form submitted` | Same accepted response | Existing analytics path | Hero label, EUR 280 | Same helper and guard |
| Failure report | Network, HTTP, or invalid JSON response | `/api/r` | Form label, error, URL, referrer, UA, timestamp | Existing fail-loud helper |

Attribution checked before form interaction:

- `gbraid`
- `utm_source`
- `utm_medium`
- `landing_page_url`
- `current_page_url`

The DOMContentLoaded attribution listener was corrected so it calls the injector without accidentally passing the DOM event as a form object.

## Local QA completed

- `node deploy/_source/build.js logo`
- `npm run verify:lp-release` — passed for all 17 generated pages.
- `git diff --check` — passed.
- Desktop runtime check at 1440 × 1000:
  - DKI headline rendered.
  - Pink accent rendered.
  - Hero and form fit above the section boundary.
  - No horizontal overflow.
  - Form measured 520 × 866 px; the Claude reference measured 520 × 830 px in the same browser engine.
  - Content width is 1240 px with a 1fr/520 grid and 56 px gap, matching the Claude layout.
  - Two neon beams, audience badge, two platform items, and 22 marquee logo elements are present.
  - The marquee uses the same measured render sizes as the Claude source (Amazon 60 × 18 px; remaining logos use the source-specific optical scale factors).
- Mobile runtime check at 390 × 844:
  - H1 rendered at responsive size.
  - Three process cards remained in one readable row.
  - Form followed the visual story without horizontal overflow.
  - H1 width 362 px, form width 362 px, document scroll width 390 px.
  - Forward and back navigation of the two-step form remained functional.
- DKI runtime checks:
  - `eigenes logo beleuchtet`
  - `3d logo mit led beleuchtung`
- Form failure path:
  - Visible fail-loud fallback rendered.
  - No success state rendered first.
- Form accepted-response path with a local no-side-effect endpoint:
  - Success state rendered only after JSON `{ok:true}`.
  - Stable client request ID was present.
  - Conversion helper was called once after acceptance.
- No unresolved template variables and no duplicate element IDs in the generated page.

## Visual comparison note

Both the Claude standalone and the local `/logo/` build were opened in the in-app browser and compared through DOM snapshots plus rendered bounding-box measurements. Direct image capture repeatedly timed out in the browser's `Page.captureScreenshot` command, including at a 390 × 844 viewport. The geometry, asset set, visible copy, component counts, responsive overflow, and form interaction were therefore checked directly in the rendered DOM; a release screenshot is still required at the preview-domain gate.

## Required before any deploy

- Visual screenshot QA at a tablet viewport (approximately 820 × 1180); the in-app viewport override did not remain applied during this run.
- Cookiebot/Consent Mode validation on an authorized preview domain.
- Controlled preview submission through the real Cloudflare Function with `nt_dry_run=1`.
- Production-like controlled lead with explicit approval, followed by n8n execution and Supabase row verification.
- Full paid-path validation for all known landing pages and unknown-path/redirect checks.
- `codex-predeploy`/project-equivalent clean deploy gate and exact-commit verification.

## Known backend limitation

`/api/c` currently returns `{ok:true, queued:true}` after Cloudflare accepts the request and starts the n8n forward. It does not yet prove that the lead was durably inserted into the database. The new Hero therefore says “Anfrage entgegengenommen”, not “gespeichert”.

To meet the later qualification-flow requirement safely, the backend should acknowledge only after the database lead row exists, then run Trello, CRM, email, and AI side effects asynchronously. The optional qualification form should update that database row by the stable client request ID. Trello remains a projection, not the source of truth.
