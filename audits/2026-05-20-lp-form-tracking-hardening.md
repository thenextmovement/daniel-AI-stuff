# LP Form + Tracking Hardening — 2026-05-20

## Objective

Prevent a repeat of the 2026-05-18 to 2026-05-20 landingpage outage where a deploy shipped without Cloudflare Pages Functions and all forms posting to `/api/c` failed. Also prevent tracking loss and silent form failures when landing pages or form sections are changed.

## Incident Summary

- A Cloudflare Pages deploy was made from a clean worktree that did not contain `functions/`.
- Production `/api/c` returned `405`, so LP form submits did not reach n8n/Supabase.
- Production `/api/r` also returned `405`, so the fail-alert webhook could not notify internally.
- Scope: all live LPs/forms posting to `/api/c`.
- Known Clarity SubmitForm candidates during the outage window:
  - `2026-05-19 10:02`, `/`, PaidSearch: https://clarity.microsoft.com/player/vvb78gxiwp/1b5ggcj/p3rvs5
  - `2026-05-19 12:56`, `/logo/`, PaidSearch: https://clarity.microsoft.com/player/vvb78gxiwp/1tp9q3g/1jrcipx
  - `2026-05-20 08:47`, `/logo/`, PaidSearch Mobile: https://clarity.microsoft.com/player/vvb78gxiwp/j0kmxj/1uwaktv

Contact data for failed users is not recoverable from Clarity because inputs are masked and the POST never reached the backend.

## Post-Fix Verification

Verified on 2026-05-20 after production deploy:

- Cloudflare Pages deploy uploaded the Functions bundle.
- `node scripts/post-deploy-smoke.mjs https://anfrage.neontrip.de` passed.
- `node scripts/post-deploy-smoke.mjs https://anfrage.neontrip.de --real-alert` passed at HTTP/API level and sent a real `/api/r` diagnostic event.
- After activating the n8n form-fail receiver, `node scripts/post-deploy-smoke.mjs https://anfrage.neontrip.de --real-alert` created n8n execution `1421076` in `Form Fail Report Receiver v1.0` (`efV72NrTmKx89MSC`). `Send Alert Email` returned `success: true`.
- n8n `LP Anfrage Webhook v1.0` (`FQ7lf36yje4B1eE3`) had successful webhook executions after the fix:
  - `1419867` at `2026-05-20T10:39:42Z`
  - `1419905` at `2026-05-20T10:40:01Z`
  - `1420471` at `2026-05-20T11:28:04Z`
- Microsoft Clarity query for `2026-05-20` on `anfrage.neontrip.de` returned no sessions with recorded JavaScript errors or click errors.

Interpretation: new submits are reaching n8n again. The known failed users from the outage window remain non-recoverable unless they independently contacted NEONTRIP, because the backend never received their form payloads.

## Monitoring Findings

The previous alerting setup did not catch the outage for two reasons:

- `/api/r` was also missing from the Cloudflare deploy and returned `405`, so client-side failure reporting could not reach n8n.
- n8n Error Trigger workflows only fire for n8n executions. The outage happened before n8n, at the Cloudflare Pages Function layer.

Additional findings from n8n review:

- `Error Notification -> info@NeonTrip.de` (`M4uG1HAtN9Zggxww`) is active and did receive n8n-internal errors on 2026-05-20.
- Before hardening, its normal path sent data to `AI Alert Reviewer v1.0` (`SH5HK6TqLCyaitXu`), but that workflow was inactive. The execution therefore recorded `Workflow is not active and cannot be executed.` This weakened the alert path.
- Before hardening, `NEONTRIP Workflow Monitor v2.0` (`QadPKWZ2cmZDCk2W`) received `401 unauthorized` from `Fetch Error Executions`, but because the node continued on error the workflow still reported `HEALTHY`. This was a false-green monitoring condition.
- `Form Fail Report Receiver v1.0` (`efV72NrTmKx89MSC`) existed with webhook path `r`, but it was inactive. This meant `/api/r` could return `200` to the browser while no operational failure email was sent.

## Hardening Implemented

### 1. Functions are release-critical

Required files:

- `functions/api/c.js`
- `functions/api/r.js`

`scripts/verify-lp-release.mjs` now fails if either file is missing or untracked.

### 2. Synthetic endpoint smoke support

`/api/c` accepts `nt_dry_run=1` multipart form data and returns JSON without creating a lead:

```json
{"ok":true,"dry_run":true,"request_id":"..."}
```

`/api/r` accepts `{"nt_dry_run":"1"}` and returns JSON without sending an operational alert.

This allows safe post-deploy endpoint validation.

### 3. Tracking fields are production-critical

All forms must include:

- `gclid`
- `gbraid`
- `wbraid`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `landing_page_url`
- `_landing_page_url`
- `current_page_url`
- `referrer`
- `_referrer`

The central helper `window.ntPrepareSubmit(form, formName)` injects the fields immediately before `FormData` is read. This protects against future section swaps and late DOM changes.

### 4. Client-side silent honeypot abort removed

The previous browser handlers could silently return when the hidden `website` field was filled. That is risky on mobile/password-manager autofill.

New behavior:

- Client-side submit handlers call `window.ntPrepareSubmit`.
- If the honeypot was prefilled, the helper reports `honeypot_prefilled_client` to `/api/r`, removes the field from the browser-submitted `FormData`, and continues.
- Direct non-JS bot posts are still filtered server-side in `/api/c`.
- Server-side `/api/c` forwards contact-bearing honeypot payloads and reports `honeypot_prefilled_forwarded`.

### 5. n8n fail-alert path restored

`Form Fail Report Receiver v1.0` (`efV72NrTmKx89MSC`) is now active.

Changes:

- Activated the workflow with production webhook path `r`.
- Changed the alert email node from `continueOnFail` to fail loudly (`onError: stopWorkflow`) so broken Outlook credentials create a visible n8n error.
- Set `saveDataSuccessExecution: all` and `saveDataErrorExecution: all` so alert delivery can be audited.
- Verified with execution `1421076` that `/api/r -> https://fuajob.online/webhook/r -> Send Alert Email` works end-to-end.

### 6. n8n internal error notification made deterministic

`Error Notification -> info@NeonTrip.de` (`M4uG1HAtN9Zggxww`) now sends a direct prepared error email after `Prepare Alert Data`.

Changes:

- Added `Send Prepared Alert Email`.
- Removed the inactive `AI Alert Reviewer v1.0` path from the active workflow.
- Workflow validation is green after the change.

### 7. n8n monitor false-green fixed

`NEONTRIP Workflow Monitor v2.0` (`QadPKWZ2cmZDCk2W`) now treats upstream n8n API fetch errors as `CRITICAL` instead of silently producing `HEALTHY`.

Change:

- `Analyze Errors` checks for `firstInput.error` and returns a critical alert with `monitor_error` when the `Fetch Error Executions` node returns a 401/HTTP/API error object.
- Workflow validation is green after the change.

## Required Release Gate

Before any Cloudflare Pages deploy:

```bash
cd /Users/danielklesse/Desktop/neontrip-phase0e-visual
node scripts/verify-lp-release.mjs
```

The release must not deploy if this fails.

## Required Post-Deploy Smoke

After deploy:

```bash
cd /Users/danielklesse/Desktop/neontrip-phase0e-visual
node scripts/post-deploy-smoke.mjs https://anfrage.neontrip.de
```

This validates:

- representative LP paths return `200`
- `/api/c` accepts multipart FormData
- `/api/r` accepts JSON
- no real lead is created in dry-run mode

To verify that the n8n fail-alert email path itself fires, run explicitly:

```bash
node scripts/post-deploy-smoke.mjs https://anfrage.neontrip.de --real-alert
```

Only use `--real-alert` intentionally because it sends an operational alert.

## Rollback

If post-deploy smoke fails:

1. Roll back the Cloudflare Pages deployment to the previous known-good deployment.
2. Confirm:
   - `POST /api/c` dry-run returns `200`
   - `POST /api/r` dry-run returns `200`
3. Pause major Google Ads spend if `/api/c` remains broken.
4. Use Clarity SubmitForm sessions during the bad window to estimate lost leads.

## Still Open

- Add the verifier to a real CI/predeploy command once the repository has a package script or CI runner.
- Add scheduled synthetic monitoring outside the deploy flow.
- Add a second independent alert channel outside `/api/r -> n8n`, because a Cloudflare Function outage can break both the form submit and same-origin alert route.
- Backfill estimate only: use Clarity SubmitForm recordings from the outage window to count likely lost leads, but do not expect contact recovery.
