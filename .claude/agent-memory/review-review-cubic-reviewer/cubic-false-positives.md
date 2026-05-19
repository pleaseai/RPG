---
name: cubic-false-positives
description: Cubic P2 issues about mtime-only reload in requireRpg are low-priority theoretical edge cases in this project
metadata:
  type: feedback
---

Cubic flags mtime-only reload (P2) as "can miss rapid graph updates if soop encode runs twice within the same filesystem timestamp resolution." In practice, `soop encode` on any realistic repo takes seconds, making sub-millisecond double-writes essentially impossible. Treat this as a low-priority deferred finding rather than a blocking fix.

**Why:** The RPG encode pipeline (semantic lifting, AST parsing, LLM calls) takes much longer than 1ms, so the theoretical window where two writes share the same mtime never occurs in practice.

**How to apply:** When cubic reports mtime-based reload issues in requireRpg, note the theoretical concern but defer unless there's evidence of a real incident.
