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
   - `AI_GATEWAY_API_KEY` - Vercel AI Gateway API key ([get yours](https://vercel.com/dashboard))
   - `VERCEL_TOKEN` - Vercel personal access token ([create one](https://vercel.com/account/tokens))

## Running Evals

### Preview (no cost)

See what will run without making API calls:

```bash
npx @vercel/agent-eval cc --dry
```

### Run Experiments

Run the Claude Code experiment:

```bash
npx @vercel/agent-eval cc
```

Run the Codex experiment:

```bash
npx @vercel/agent-eval codex
```

### View Results

Launch the web-based results viewer:

```bash
npx @vercel/agent-eval playground
```

Open [http://localhost:3000](http://localhost:3000) to browse results.

