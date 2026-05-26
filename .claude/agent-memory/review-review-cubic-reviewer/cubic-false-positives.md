---
name: cubic-false-positives
description: Cubic P2 issues about mtime-only reload in requireRpg are low-priority theoretical edge cases in this project
metadata:
  type: feedback
---

Cubic flags mtime-only reload (P2) as "can miss rapid graph updates if soop encode runs twice within the same filesystem timestamp resolution." In practice, `soop encode` on any realistic repo takes seconds, making sub-millisecond double-writes essentially impossible. Treat this as a low-priority deferred finding rather than a blocking fix.

**Why:** The RPG encode pipeline (semantic lifting, AST parsing, LLM calls) takes much longer than 1ms, so the theoretical window where two writes share the same mtime never occurs in practice.

**How to apply:** When cubic reports mtime-based reload issues in requireRpg, note the theoretical concern but defer unless there's evidence of a real incident.

## Round 3 — namu/src/parser.ts isAvailable() hasLanguage probe

Cubic flagged two valid P1s: `hasLanguage('typescript')` inside `isAvailable()` memoizes grammar-download state (not binding health). If called before grammars are fetched, it caches `false` permanently, disabling the backend for the whole process. Fix: use `typeof getParser === 'function'` alone — the binding loaded successfully if the import didn't throw. `hasLanguage` must NOT be used as a backend health check.

**Why:** `hasLanguage` returns true only when a grammar is statically compiled or dynamically available in the registry; it is not the same as "the NAPI module loaded." Grammars are fetched lazily, so early calls would give false negatives.

**How to apply:** In `isAvailable()` for native backends, check the minimal signal (exported function exists), not grammar-level availability.

## Round 2 (PR #296, commit 2d2d8f5) — .mcp.json SonarQube removal

Cubic reported one P1 finding: "Removed the SonarQube MCP server from project config" on `.mcp.json:2`. This is entirely outside the `server.ts` diff scope (PR #296 is about last-known-good fallback in `requireRpg`). The `.mcp.json` change (intentional SonarQube removal) was already present in the diff but unrelated to the review target. **Deferred as out-of-scope** — the finding is about a deliberate config change, not a bug introduced by the server.ts fix. No auto-fix applied.
