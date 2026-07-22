# Local NEONTRIP label print worker

Run this worker on one always-on machine inside the NEONTRIP office WLAN. It makes outbound HTTPS calls to Ops and talks to a CUPS/IPP printer locally. Do not expose CUPS, IPP or the printer to the public internet. The Mac may use any working internet connection for Ops; the configured printers themselves must remain reachable from that Mac.

## Prerequisites

- Node.js version compatible with the Ops repository
- CUPS client commands `lp` and `lpstat`
- one configured A6-capable label queue and, for EU delivery notes, a separate A4 office-printer queue
- a dedicated unprivileged OS user such as `neontrip-print`
- the reviewed Ops commit checked out below `/opt/neontrip-ops/current`

Discover configured queues without printing:

```bash
lpstat -e
lpstat -p -d
lpoptions -p PRINTER_QUEUE -l
```

Confirm the exact CUPS media keyword shown by `lpoptions`; do not guess it. The worker never applies `fit-to-page` or a scaling option.

The approved local queue split recorded on 2026-07-20 is:

- A6/4x6 shipping labels: `Brother_QL_1110NWB`, logical key `shipping-a6`
- A4 delivery notes: `HP_Color_LaserJet_Pro_MFP_3302`, logical key `shipping-a4-delivery-note`

The two logical keys and CUPS queue names must remain different. The system default printer is irrelevant because every submission uses an explicit CUPS destination. Any change to either physical queue requires a new witnessed two-printer QA before the active product configuration may be approved.

## Configuration

Copy `arrival-label-print.env.example` to `/etc/neontrip/arrival-label-print.env`, set owner/root permissions to `0600`, and provide a dedicated `ARRIVAL_LABEL_PRINT_API_TOKEN`. For EU delivery notes, copy `arrival-delivery-note-print.env.example` to `/etc/neontrip/arrival-delivery-note-print.env` and use a different worker ID plus the separately approved A4 logical/CUPS queue. If Ops is protected by Cloudflare Access, provision least-privilege service tokens for this exact API path and set both `ARRIVAL_LABEL_PRINT_CF_ACCESS_*` values. Each logical `ARRIVAL_LABEL_PRINTER_KEY` must match the approved product configuration; `ARRIVAL_LABEL_CUPS_PRINTER` is the corresponding local queue name.

Read-only local readiness check (prints no page):

```bash
npm run arrival-labels:print-worker -- --self-test
```

One polling cycle:

```bash
npm run arrival-labels:print-worker -- --once
```

Run the no-page self-test once with each environment file. Only after a real A6 test label and a separate A4 delivery note have been visually checked should the matching systemd units be installed and enabled. The A6 unit uses `/etc/neontrip/arrival-label-print.env`; the A4 unit uses `/etc/neontrip/arrival-delivery-note-print.env`. Installation requires explicit local administrator approval and is intentionally not performed by this repository.

### Managed macOS installation

The office Mac uses two LaunchAgents and a versioned immutable runtime. Store the dedicated print token and the shared Cloudflare Access client secret in Keychain; the plists contain no secret values. Export only the non-secret Cloudflare client ID before running the manager.

```bash
npm run arrival-labels:print-workers:manage -- self-test
npm run arrival-labels:print-workers:manage -- install --acknowledge-production-write
npm run arrival-labels:print-workers:manage -- status
```

`self-test` verifies both exact CUPS queue names and their approved media without printing. `install` is accepted only from a clean checkout at the exact `origin/main` commit and installs both queues together. A failed replacement restores the prior plists or leaves newly created plists disabled and recoverable.

## Exactly-once boundary

The worker downloads and verifies the audited PDF before entering `dispatching`. It then records `dispatching` durably before calling CUPS. A crash or uncertain state after that point is routed to manual review and is never automatically printed again. `printed` is recorded only when CUPS lists the exact job ID as completed.

## Rollback

On macOS, run `npm run arrival-labels:print-workers:manage -- uninstall`; this unloads both LaunchAgents and preserves recoverable plist copies. `rollback` restores both prior plists only when both backups exist. Then revoke the print API token. Existing `dispatching`, `submitted` or `manual_review` jobs must be reconciled physically; do not reset them to queued automatically.
