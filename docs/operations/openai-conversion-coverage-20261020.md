# OpenAI conversion coverage — 20 October 2026

NEONTRIP only. Goal: one shared Cookiebot-aware OpenAI initializer on all published HTML, plus `lead_created` at the configurator's existing confirmed inquiry boundary. Neighbors: pricing, cart, drafts, form transport, Google/X/Clarity, mail and backend behavior remain unchanged. Effects: only consented OpenAI measurement, with the existing UUID as event_id.

The active source for this patch is Cloudflare Pages production dc64ac35-97a6-441f-a9b5-71d467728ff6 (4355b263), reconciled with the newest Ops origin/main. The raw main deploy directory is incomplete: use the complete verified publication artifact, never upload the raw deploy directory. Tracked page differences against main include already published changes; the effective release diff against production contains only 56 tracking-related files.

Artifact: /Users/danielklesse/Documents/Codex/2026-10-20/bitte-vervollst-ndige-das-openai-conversion/work/release-candidate
Rollback artifact: /Users/danielklesse/Documents/Codex/2026-10-16/bernimm-diesen-neontrip-google-ads-auftrag/work/power-landingpage-audiences-20261020/release-candidate

49 HTML files reference the common helper, including seven configurator entry pages, legal/information pages, blog/lexicon, AR, older publicly reachable extensionless aliases and the embedded offer preview. The audit visited 47 distinct final URLs (two redirects). No routing changes are included; /led-schriftzuege/ continues to redirect to /configurator/ with its query intact. Four Functions remain byte-identical.

The shared helper loads the SDK only after marketing consent, sets consent before the pixel-ID init, handles stored decisions and withdrawal, and cancels pending work if consent changes during SDK loading or hashing. Pixel-ID initialization is once per document; later user-only init calls carry normalized SHA-256 email as before. Lead IDs are deduplicated in memory/session and by the documented event_id. The configurator requires its full matching persistence receipt and excludes already-confirmed historical receipts. No other standard events or CAPI are added; page_viewed, commerce, signup, subscription and appointment events are outside the requested base-plus-B2B-lead scope.

Existing lead success call sites are retained and delegate to the common helper. Same-origin links retain a supplied opaque oppref query value; the SDK owns its first-party attribution cookie. No real click reference was generated or used in QA. The isolated URL unit test uses a clearly non-production fixture and sends no requests.

Verification:
- 59 focused tests passed (16 OpenAI, existing submission recovery and business-email tests). The older VM harness needed the browser AbortController/clearTimeout globals for the already deployed request timeout.
- Consent browser matrix passed on 20 pages, with production hostname/local candidate routing and blocked production side effects.
- Real Cookiebot: initially undecided, consent granted via the actual banner, restored consent after reload, and withdrawal all passed with the OpenAI SDK replaced by a recording stub.
- Real configurator UI: start 0 events; failed intercepted request 0; matching successful receipt 1; retry retained UUID; duplicate callback stayed at 1.
- Existing neon-schilder contact form: failed intercepted request 0 events; confirmed receipt 1. Business-email rejection still prevents submission.
- 446 executable inline scripts parse. All 49 page diffs reduce to the OpenAI loader/helper/asset version changes; all four Functions and unrelated artifact files are unchanged.
- OpenAI skill static validator passed.
- The separate older lp-release-contract suite has the same three failures against production baseline and candidate: hardcoded old business-email asset version (two tests), and retired project_context field counts (one). Six other checks pass. No new failure was introduced; unrelated historical assertions were not broadened into this repair.

No production inquiry, customer mail, real lead event or attribution conversion was generated. Ads Manager connector read is blocked by reauthentication. The prior four reported initializations are user-provided evidence, not newly verified receipt.

Release status: prepared only. Exact full clean SHA approval remains required by AGENTS.md. After approval rerun codex-predeploy ops, ensure the live baseline is unchanged, publish the complete artifact through the existing direct Cloudflare Pages path, then verify provider/public bytes and consent behavior. Publication does not itself prove Ads Manager lead receipt or ad attribution.
