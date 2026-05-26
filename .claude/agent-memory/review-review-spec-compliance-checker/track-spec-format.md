---
name: track-spec-format
description: How .please track specs/plans encode requirements (SC-N) and task→SC traceability for compliance checks
metadata:
  type: reference
---

This project (soop please) tracks live under `.please/docs/tracks/active/<track-id>/` with `spec.md` + `plan.md`.

- **spec.md** uses `SC-N:` numbered Success Criteria (checkbox list under `## Success Criteria`), plus `## Constraints`, `## Out of Scope`, `## Risks`. No FR-/US- IDs — Success Criteria are the primary traceable unit.
- **plan.md** uses `T001..TNNN` tasks, each often tagged with the SC it satisfies (e.g. `— **SC-1, SC-5**`) and a `(file: ...)` hint + `(depends on TNNN)`. A `## Progress` section logs per-task completion with dates and a `## Decision Log` / `## Surprises & Discoveries` section.

For compliance: map each `SC-N` to the tasks tagged with it, then verify the task's `(file: ...)` against the actual diff. The plan's Progress/Surprises sections are reliable pointers to where the load-bearing logic landed (e.g. adapter sibling computation).

Verification command convention: `bun run test packages/<pkg>`; behavior-preservation is the usual acceptance bar for refactor-type tracks.
