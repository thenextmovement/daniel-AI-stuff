# Local NEONTRIP arrival-label scheduler (macOS)

This LaunchAgent supervises a persistent local scheduler that calls the authenticated Ops arrival-label endpoint every five minutes. It replaces a paid external polling trigger, but it does not expose the Mac, CUPS or a local HTTP endpoint to the internet. The request is outbound HTTPS only.

The installed default is `dry_run`. It discovers and audits DHL Express arrivals, applies deterministic Shopify/Trello/country gates, and creates internal review entries. Execute mode remains protected by the explicit local acknowledgement, the local live flag, the scoped scheduler credential, and the independent server-side write gate.

## Secret setup

Store the dedicated API token in the macOS Keychain. The command prompts for the secret; it must not be passed in shell history:

```bash
/usr/bin/security add-generic-password -U \
  -s NEONTRIP_ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN \
  -a "$USER" -w
```

If Cloudflare Access protects the Ops endpoint, also set the non-secret client ID in the installation environment and store the client secret in Keychain:

```bash
export ARRIVAL_LABEL_CF_ACCESS_CLIENT_ID='the-scoped-service-token-id'
/usr/bin/security add-generic-password -U \
  -s NEONTRIP_ARRIVAL_LABEL_CF_ACCESS_CLIENT_SECRET \
  -a "$USER" -w
```

The matching server-side environment key is `ARRIVAL_LABEL_LOCAL_SCHEDULER_API_TOKEN`. Use a least-privilege token restricted to `POST /api/internal/arrival-labels/run`. Rotate it independently from print-worker and n8n tokens.

The repository workflow `Coolify Secret Sync` can copy the same dedicated GitHub Actions secret to the Ops runtime with mode `sync_ops_arrival_label_scheduler_token`. It records only length and a SHA-256 prefix, never the token. Mode `delete_ops_arrival_label_scheduler_token` is the server-side credential rollback.

## Install and inspect

Installation is intentionally accepted only from a clean checkout whose `HEAD` exactly equals `origin/main`. It copies the two runtime files into a versioned directory and points the LaunchAgent at that immutable version.

```bash
npm run arrival-labels:scheduler:manage -- install
npm run arrival-labels:scheduler:manage -- status
```

The schedule defaults to 300 seconds and starts once immediately after loading. `launchd` keeps the scheduler process alive and restarts it after an unexpected exit. A different interval must remain between 60 seconds and one day:

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

For full credential rollback, also run the Coolify secret-sync delete mode and remove the repository secret after the local LaunchAgent has been disabled. The original n8n `ARRIVAL_LABEL_AGENT_API_TOKEN` remains untouched throughout installation and rollback.
