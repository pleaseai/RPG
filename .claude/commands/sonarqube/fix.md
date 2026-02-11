---
description: "Fix SonarQube/SonarCloud issues automatically. Use when: 'fix sonar issues', 'resolve code smells', 'fix security hotspots', 'sonar PR issues', 'quality gate failed'."
argument-hint: "[project-key] [--pr=<number>] [--severity=BLOCKER|CRITICAL|MAJOR|MINOR|INFO] [--type=BUG|VULNERABILITY|CODE_SMELL|SECURITY_HOTSPOT]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, TaskCreate, TaskUpdate, TaskList, TaskGet, mcp__sonarqube__search_sonar_issues_in_projects, mcp__sonarqube__show_rule, mcp__sonarqube__change_sonar_issue_status, mcp__sonarqube__get_raw_source, mcp__sonarqube__get_project_quality_gate_status, mcp__sonarqube__get_component_measures, mcp__sonarqube__analyze_code_snippet
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Instructions

Safely fix code quality issues detected by SonarQube/SonarCloud.

### Step 0: Initialize TaskList

**Register all steps in TaskList before starting.**

Create the following tasks using `TaskCreate` and set dependencies:

| Task ID | Subject                       | ActiveForm               | BlockedBy    |
|---------|-------------------------------|--------------------------|--------------|
| Step1   | Parse arguments and detect PR | Parsing arguments        | -            |
| Step2   | Search SonarQube issues       | Searching issues         | Step1        |
| Step3   | Check quality gate status     | Checking quality gate    | Step2        |
| Step4   | Review rules for issues       | Reviewing rules          | Step2        |
| Step5   | Register issue tasks          | Registering issues       | Step3, Step4 |
| Step6   | Verify fixes and commit       | Verifying and committing | Step5        |

**Storing Metadata:** Store context information in each Task using `metadata`:

```json
{
  "skill": "sonarqube:fix",
  "stepId": "Step1",
  "projectKey": "<detected>",
  "prNumber": "<detected>"
}
```

**After registration, for each step:**

1. Use `TaskUpdate` to change the task status to `in_progress` when starting
2. Use `TaskUpdate` to change to `completed` when finished
3. Use `TaskList` to check overall progress

### Step 1: Parse Arguments & Detect PR

**Argument parsing:**

- `project-key`: SonarQube project key (e.g., "my-org_my-repo")
- `--pr=<number>`: PR number (optional)
- `--severity=<level>`: Severity filter (BLOCKER, CRITICAL, MAJOR, MINOR, INFO)
- `--type=<type>`: Issue type filter (BUG, VULNERABILITY, CODE_SMELL, SECURITY_HOTSPOT)

**Auto-detect PR (when PR is not in arguments):**

```bash
# Detect PR number from current branch
gh pr view --json number -q '.number' 2>/dev/null
```

**When PR is not detected:**

Use `AskUserQuestion` to ask the user:

- Enter PR number directly, or
- Choose to search all project issues

```
Question: "Could not find a PR. How would you like to proceed?"
Options:
  - "Enter PR number" → Request PR number input
  - "Search all project issues" → Search BLOCKER, CRITICAL issues across the project
```

### Step 2: Search Issues

Search issues using `mcp__sonarqube__search_sonar_issues_in_projects`:

**Parameters:**

- `projectKeys`: Project key
- `pullRequest`: PR number (if detected)
- `severities`: Severity filter (default: BLOCKER,CRITICAL,MAJOR)
- `types`: Type filter
- `statuses`: OPEN,CONFIRMED,REOPENED

**Default behavior:**

- Attempt to detect current PR
- If PR exists, search for BLOCKER, CRITICAL, MAJOR issues in that PR
- If no PR, use AskUserQuestion to request user selection

### Step 3: Check Quality Gate (Optional)

Check gate status using `mcp__sonarqube__get_project_quality_gate_status`:

- Prioritize issues blocking the gate
- Understand gate pass conditions

### Step 4: Review Rules

For each issue, check the rule using `mcp__sonarqube__show_rule`:

- Understand the rule's purpose and rationale
- Identify the correct fix approach
- Prevent incorrect modifications

### Step 5: Register Issue Tasks

Create Issue tasks for each SonarQube issue found, ordered by severity priority:

1. **BLOCKER** - Fix immediately (production-breaking)
2. **CRITICAL** - Fix before merge (security vulnerabilities)
3. **MAJOR** - Fix in current sprint
4. **MINOR** - Fix when convenient
5. **INFO** - Optional improvements

**For each issue, create a task:**

```
TaskCreate({
  subject: "Fix {rule} in {file}:{line}",
  activeForm: "Fixing {rule}",
  metadata: {
    skill: "sonarqube:fix",
    issueKey: "<sonar-issue-key>",
    severity: "CRITICAL",
    type: "BUG",
    file: "src/auth.ts",
    line: 42
  }
})
```

**Set dependencies and update Step6:**

```
// Each Issue is blocked by Step5 (starts after registration):
TaskUpdate({ taskId: "Issue-1", addBlockedBy: ["Step5"] })
TaskUpdate({ taskId: "Issue-2", addBlockedBy: ["Step5"] })

// Step6 waits for all Issues to complete:
TaskUpdate({ taskId: "Step6", addBlockedBy: ["Issue-1", "Issue-2", "Issue-3"] })
```

**Dependency structure:**

```
Step5 (Register issue tasks) - completed
    ↓
Issue-1, Issue-2, Issue-3 → blockedBy: [Step5]
    ↓ (all completed)
Step6 → blockedBy: [Issue-1, Issue-2, Issue-3]
```

**If no issues found:** Mark Step5 as completed → Step6 starts immediately.

### Fixing Issues (Issue-N Tasks)

**Pre-fix checklist:**

- [ ] Do I understand the rule's purpose?
- [ ] Will the fix preserve existing functionality?
- [ ] Will tests pass after the fix?

**Fix guidelines:**

1. **Minimal changes**: Only make changes necessary to resolve the issue
2. **Preserve behavior**: Do not alter existing functionality
3. **Type safety**: Do not introduce TypeScript type errors
4. **Test compatibility**: Do not break existing tests

### Reference: Fix by Issue Type

#### CODE_SMELL

| Rule                           | Common Fix                   |
|--------------------------------|------------------------------|
| unused-import                  | Remove import statement      |
| no-duplicate-string            | Extract to constant          |
| cognitive-complexity           | Split function               |
| no-commented-code              | Remove commented code        |
| no-useless-non-capturing-group | Remove unnecessary `(?:...)` |

#### BUG

| Rule          | Common Fix                     |
|---------------|--------------------------------|
| null-check    | Add null/undefined check       |
| array-bounds  | Add array bounds validation    |
| type-mismatch | Add type casting or validation |

#### VULNERABILITY

**Caution:** Security vulnerabilities require careful handling.

| Rule                  | Common Fix                                |
|-----------------------|-------------------------------------------|
| sql-injection         | Use parameterized queries                 |
| xss                   | Escape input values                       |
| hardcoded-credentials | Move to environment variables             |
| weak-crypto           | Use strong algorithms (AES-256, SHA-256+) |

#### SECURITY_HOTSPOT

Security hotspots require **review only**, not automatic fixes:

1. Analyze security implications of the code
2. Assess risk level (HIGH, MEDIUM, LOW)
3. Determine if code is safe or needs modification
4. Options:
    - **Safe**: Mark as "Safe" with justification
    - **Fixed**: Apply fix and mark as "Fixed"
    - **Needs Review**: Escalate to security team

### Step 6: Verify & Commit

1. Run tests to verify fix doesn't break functionality
2. Commit using conventional commit format:

```bash
git commit -m "fix: Resolve SonarQube issues - {brief description of changes}"
```

### Cases Where Auto-fix is Not Performed

Auto-fix is skipped in the following cases:

1. **Business logic changes required**: Intentional design decisions
2. **Major refactoring required**: Architecture-level changes
3. **External dependencies**: Library updates needed
4. **Test failures**: Fix would break tests
5. **Security hotspots**: Require human review and judgment

In these cases, recommend manual review to the user.

## Usage Examples

```bash
# Auto-detect and fix current PR issues
/sonarqube:fix

# Fix issues for a specific PR
/sonarqube:fix --pr=523

# Fix only CRITICAL issues in a project
/sonarqube:fix my-project --severity=CRITICAL

# Fix specific type only
/sonarqube:fix my-project --type=CODE_SMELL

# Fix CRITICAL issues in a specific PR
/sonarqube:fix my-project --pr=523 --severity=CRITICAL
```

## MCP Tool Reference

| Tool                                              | Purpose                                      |
|---------------------------------------------------|----------------------------------------------|
| `mcp__sonarqube__search_sonar_issues_in_projects` | Search issues by project, PR, severity, type |
| `mcp__sonarqube__show_rule`                       | Get rule details and fix guidance            |
| `mcp__sonarqube__change_sonar_issue_status`       | Update issue status (resolve, reopen, etc.)  |
| `mcp__sonarqube__get_raw_source`                  | Retrieve source code for context             |
| `mcp__sonarqube__get_project_quality_gate_status` | Check quality gate pass/fail status          |
| `mcp__sonarqube__get_component_measures`          | Get project metrics (coverage, bugs, etc.)   |
| `mcp__sonarqube__analyze_code_snippet`            | Analyze code snippet for issues              |

## Resources

- [SonarQube Documentation](https://docs.sonarqube.org/)
- [SonarCloud Documentation](https://docs.sonarcloud.io/)
- [Rules Database](https://rules.sonarsource.com/)
