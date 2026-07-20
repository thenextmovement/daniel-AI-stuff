# Local NEONTRIP label print worker

Run this worker on one always-on machine inside the NEONTRIP office WLAN. It makes outbound HTTPS calls to Ops and talks to a CUPS/IPP printer locally. Do not expose CUPS, IPP or the printer to the public internet.

## Prerequisites

- Node.js version compatible with the Ops repository
- CUPS client commands `lp` and `lpstat`
- one configured A6-capable printer queue
- a dedicated unprivileged OS user such as `neontrip-print`
- the reviewed Ops commit checked out below `/opt/neontrip-ops/current`

Discover configured queues without printing:

```bash
lpstat -e
lpstat -p -d
lpoptions -p PRINTER_QUEUE -l
```

Confirm the exact CUPS media keyword shown by `lpoptions`; do not guess it. The worker never applies `fit-to-page` or a scaling option.

## Configuration

Copy `arrival-label-print.env.example` to `/etc/neontrip/arrival-label-print.env`, set owner/root permissions to `0600`, and provide a dedicated `ARRIVAL_LABEL_PRINT_API_TOKEN`. If Ops is protected by Cloudflare Access, provision a least-privilege service token for this exact API path and set both `ARRIVAL_LABEL_PRINT_CF_ACCESS_*` values. The logical `ARRIVAL_LABEL_PRINTER_KEY` must match the approved product configuration; `ARRIVAL_LABEL_CUPS_PRINTER` is the local queue name.

Read-only local readiness check (prints no page):

```bash
npm run arrival-labels:print-worker -- --self-test
```

One polling cycle:

```bash
npm run arrival-labels:print-worker -- --once
```

Only after a real A6 test label has been visually and scan-checked should the supplied systemd unit be installed and enabled. Installation requires explicit local administrator approval and is intentionally not performed by this repository.

## Exactly-once boundary

The worker downloads and verifies the audited PDF before entering `dispatching`. It then records `dispatching` durably before calling CUPS. A crash or uncertain state after that point is routed to manual review and is never automatically printed again. `printed` is recorded only when CUPS lists the exact job ID as completed.

## Rollback

Stop and disable the local service, then revoke its print API token. Existing `dispatching`, `submitted` or `manual_review` jobs must be reconciled physically; do not reset them to queued automatically.
