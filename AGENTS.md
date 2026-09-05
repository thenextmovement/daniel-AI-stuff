# AGENTS.md — Shared Ops Repository

Scope: This file applies only to the current Ops repository `thenextmovement/daniel-AI-stuff`, which contains business-owned paths for both NEONTRIP and RIESENOBJEKTE.

## Canonical workflow

- Bind every task to one business and its owned paths before editing; follow the global business-isolation rule even though the repository is shared.
- Start new work with `codex-new-worktree ops <topic>` and reuse a matching unfinished worktree. Never edit the old main checkout or a deploy worktree.
- For Sales-Vergabe work, read `docs/agents/sales-vergabe/HANDOFF.md` and the task-relevant files it links. For other scopes, use their nearest maintained domain documentation.
- Commit only the files in the approved task scope and complete the applicable verification before release. A push to `main` may deploy production and requires approval of the exact scope and full commit SHA; existing approval remains valid while both are unchanged.
- From that same clean task worktree, run `codex-predeploy ops` before any potentially deploying push. Its printed `Full commit`, the approved SHA and current `HEAD` must match; only then run `codex-safe-push-main` from that worktree instead of raw `git push`. Predeploy checks the Git candidate; it does not replace tests or runtime verification.
- If the candidate changes, including after a rebase, review the new diff, repeat affected checks and obtain approval for the new exact SHA. If `origin/main` advances, reconcile it first. Run predeploy again before pushing; never reuse approval or preflight for a different commit.
- Never deploy a different commit or bypass a missing or failing helper.
