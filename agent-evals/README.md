# Agent Evaluation Suite

Test AI coding agents to measure what actually works.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your API keys:
   - `CLAUDE_CODE_OAUTH_TOKEN` - Claud Code OAuth Token AI Gateway API key (`claude setup-token`)

## Running Evals

### Preview (no cost)

See what will run without making API calls:

```bash
npx @pleaseai/agent-eval cc --dry
```

### Run Experiments

Run the Claude Code experiment:

```bash
npx @pleaseai/agent-eval cc
```

Run the Codex experiment:

```bash
npx @pleaseai/agent-eval codex
```

### View Results

Launch the web-based results viewer:

```bash
npx @pleaseai/agent-eval playground
```

Open [http://localhost:3000](http://localhost:3000) to browse results.

