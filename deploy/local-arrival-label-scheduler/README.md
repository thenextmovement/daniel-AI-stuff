# Local NEONTRIP arrival-label scheduler (macOS)

This LaunchAgent calls the authenticated Ops arrival-label endpoint every five minutes from the local Mac. It replaces a paid external polling trigger, but it does not expose the Mac, CUPS or a local HTTP endpoint to the internet. The request is outbound HTTPS only.

The installed default is `dry_run`. It discovers and audits DHL Express arrivals, applies deterministic Shopify/Trello/country gates, and creates internal review entries. The current server still rejects `execute` because no production-approved DPD Cloud write adapter and credentials are installed. Do not weaken that server-side gate.

## Secret setup

Store the dedicated API token in the macOS Keychain. The command prompts for the secret; it must not be passed in shell history:

```bash
/usr/bin/security add-generic-password -U \
  -s NEONTRIP_ARRIVAL_LABEL_AGENT_API_TOKEN \
  -a "$USER" -w
```

If Cloudflare Access protects the Ops endpoint, also set the non-secret client ID in the installation environment and store the client secret in Keychain:

```bash
export ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID='the-scoped-service-token-id'
/usr/bin/security add-generic-password -U \
  -s NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET \
  -a "$USER" -w
```

Use a least-privilege token restricted to `POST /api/internal/arrival-labels/run`. Rotate it independently from print-worker and n8n tokens.

## Install and inspect

Installation is intentionally accepted only from a clean checkout whose `HEAD` exactly equals `origin/main`. It copies the two runtime files into a versioned directory and points the LaunchAgent at that immutable version.

```bash
npm run arrival-labels:scheduler:manage -- install
npm run arrival-labels:scheduler:manage -- status
```

The schedule defaults to 300 seconds and starts once immediately after loading. A different interval must remain between 60 seconds and one day:

```bash
npm run arrival-labels:scheduler:manage -- install --interval-seconds 600
```

Logs contain run IDs and counts, not customer names, addresses, message contents or tokens:

- `~/Library/Logs/NEONTRIP/arrival-label-scheduler/scheduler.log`
- `~/Library/Logs/NEONTRIP/arrival-label-scheduler/scheduler.error.log`

The corresponding database rows use `trigger_type=local_schedule`. A filesystem lock prevents overlapping runs. An ambiguous API failure is recorded as an error and is never retried inside the same invocation; the next schedule is a separate idempotent reconciliation run.

## Execute activation gate

Do not install execute mode until all carrier, PDF, print, Shopify-notification and Outlook-archive release checks in `workflows/arrival-labels/SAFETY_REVIEW.md` are green. Activation requires both controls:

```bash
ARRIVAL_LABEL_SCHEDULER_LIVE_ENABLED=true \
  npm run arrival-labels:scheduler:manage -- install \
  --mode execute --acknowledge-production-write
```

The LaunchAgent persists the non-secret live flag and explicit acknowledgement argument. The Ops server independently retains its own write gate; the local installer cannot override it.

## Rollback and disable

Every replacement backs up the previous plist before `launchctl` changes. Roll back to the newest previous plist:

```bash
npm run arrival-labels:scheduler:manage -- rollback
```

Disable without deleting versioned runtime files or backups:

```bash
npm run arrival-labels:scheduler:manage -- uninstall
```

Revoking the Keychain token is the emergency authentication stop. Disabling the scheduler does not resolve any carrier/print dispatch already marked uncertain; those remain manual-review cases.
