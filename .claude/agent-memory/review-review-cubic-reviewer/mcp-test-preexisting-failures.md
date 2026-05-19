---
name: mcp-test-preexisting-failures
description: 2 executeEvolve tests in packages/mcp/tests/mcp.test.ts fail on baseline before any server.ts changes
metadata:
  type: project
---

As of branch `amondnet/mcp-improve-rpgkit` (commit 2215067), two tests in `packages/mcp/tests/mcp.test.ts` under `executeEvolve` are pre-existing failures unrelated to the lazy-reload/semantic-search changes:

1. "should throw when rootPath does not exist on filesystem" — expects /Invalid path/ but gets a different error message
2. "should throw when outputPath parent directory does not exist" — TypeError: Cannot set properties of undefined (setting 'rootPath') at line 474

**Why:** The `toJSON`/`fromJSON` round-trip for RPG config doesn't preserve the `config` structure the test expects. These failures existed before PR #296 changes.

**How to apply:** When running MCP tests and seeing these 2 failures, confirm they are pre-existing by checking git stash. Do not count them as regressions from server.ts edits.
