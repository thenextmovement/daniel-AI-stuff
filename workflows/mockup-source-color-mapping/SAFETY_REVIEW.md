# Safety review

## Findings

- High: the current per-design color lookup reads the wrong Trello row when
  one design has multiple size rows.
- Medium: the legacy workflows have 119/120 nodes, far beyond the preferred
  30-node limit. This ticket does not broaden into a workflow split.
- Medium: color detection is still a single-source fallback, but it cannot
  override a valid explicit per-slot color. The corrected deterministic mapping
  is therefore the smallest responsible surface.

## Scorecard

| Dimension | Score | Notes |
| --- | ---: | --- |
| correctness | 4 | Regression covers two designs with two sizes each and legacy direct mapping. |
| reliability | 4 | Pure deterministic lookup; no extra API call or retry path. |
| idempotency | 5 | Patch and lookup are side-effect free and repeatable. |
| observability | 4 | Existing slot plan exposes requestedLightColor for every slot. |
| security | 5 | No credential, permission or external input surface changes. |
| tracking impact | 5 | No analytics or attribution behavior changes. |
| cost risk | 4 | No additional generation calls; canary is one bounded human RETRY. |

## Required fixes

- Apply the same node patch to all three active workers.
- Validate all workflows and retain pre-change versions for rollback.
- Verify the live canary has orange results for the orange source and warm
  white results for the warm-white source before closing the ticket.

## QA plan

- Run unit/patch tests.
- Diff the Extract & Validate node before and after; prompts must otherwise
  remain byte-identical.
- Validate all three workflows.
- Re-run only Trello card 6a69e1432e087f39d63eb8b4 and inspect attachments,
  labels, terminal comment, processing removal and queue-lock release.

## Rollback

- Roll each worker back to its immediately captured pre-change version.
- Do not move the card or send any customer communication.

