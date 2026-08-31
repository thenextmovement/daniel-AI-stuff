# AGENTS.md — Shared Ops Repository

Scope: This file applies only to the current Ops repository `thenextmovement/daniel-AI-stuff`, which contains business-owned paths for both NEONTRIP and RIESENOBJEKTE.

## Canonical workflow

- Bind every task to one business and its owned paths before editing; follow the global business-isolation rule even though the repository is shared.
- Start new work with `codex-new-worktree ops <topic>` and reuse a matching unfinished worktree. Never edit the old main checkout or a deploy worktree.
- For Sales-Vergabe work, read `docs/agents/sales-vergabe/HANDOFF.md` and the task-relevant files it links. For other scopes, use their nearest maintained domain documentation.
- Commit only the files in the approved task scope. After explicit approval of the exact scope and commit, run `codex-predeploy ops` on that candidate; only if it passes, push exactly that commit with `codex-safe-push-main` instead of raw `git push`.
- Never deploy a different commit or bypass a missing or failing helper.
