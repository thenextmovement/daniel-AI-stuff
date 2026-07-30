# Rollback: KI-Modell-Update-Monitor v1.1

- Workflow ID: `vseFp5GZU975CeOM`
- Pre-change name: `NEONTRIP KI-Modell-Update-Monitor v1.0`
- Pre-change active version: `88f7b602-703b-49b5-a10a-3a3d232f22fb`
- Pre-change node count: 13
- Draft backup: `vseFp5GZU975CeOM.draft-before.json`
- Active backup: `vseFp5GZU975CeOM.active-before.json`

If the published workflow regresses, first deactivate it to stop scheduled runs. Restore or publish active version `88f7b602-703b-49b5-a10a-3a3d232f22fb`; if version restore is unavailable, update the workflow from `vseFp5GZU975CeOM.active-before.json` and reactivate it. Confirm that the restored graph has 13 nodes and the workflow name ends in `v1.0`.

The workflow has no external database writes. A notification email already sent before rollback cannot be recalled.
