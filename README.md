# gh-pulse-scout

A small Node.js + TypeScript CLI that fetches **GitHub Issues** (PRs excluded) from a repository over a lookback window (default 30 days), aggregates project-health metrics, and optionally asks an **OpenAI-compatible** model for a short, mobile-friendly pulse summary.

Ships as a CLI and as a composite **GitHub Action** that can push the report to a **DingTalk** robot.

---

## Features

- Fetches issues via `@octokit/rest` with two-layer (memory + file) caching.
- Aggregates **activity**, **response efficiency**, **participation**, **top labels**, and **hot issues**.
- Optional AI summary tuned for short chat-friendly output (`总体状态 / 趋势与重点 / 建议`); the full untruncated issue corpus is always written to a sidecar Markdown file for traceability.
- Console (colored tables), JSON, file, and **DingTalk** webhook outputs — the DingTalk layout is compact and optimized for phone screens.

---

## Install & build

Requires **Node.js >= 18**.

```bash
npm install
npm run build
# or run from sources during development:
npm run dev -- --repo nodejs/node --days 30
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable                | Required                | Description                                                                                        |
| ----------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`          | Recommended             | GitHub personal access token. `public_repo` scope is enough for public repos.                      |
| `OPENAI_API_KEY`        | Required for AI summary | API key of your OpenAI-compatible provider.                                                        |
| `OPENAI_BASE_URL`       | Optional                | Base URL, e.g. `https://api.openai.com/v1` or a compatible vendor.                                 |
| `OPENAI_MODEL`          | Optional                | Model name. Defaults to `gpt-4o-mini`.                                                             |
| `OPENAI_UPLOAD_CONTEXT` | Optional                | Set to `1` to also upload the corpus file via the OpenAI Files API (best-effort, silent fallback). |
| `DINGTALK_WEBHOOK`      | Optional                | DingTalk robot incoming webhook URL.                                                               |
| `DINGTALK_SECRET`       | Optional                | DingTalk robot secret (for signed messages).                                                       |

---

## CLI usage

```bash
gh-pulse-scout --repo <owner/repo> [options]
```

### Options

| Flag                          | Description                                                                                   | Default |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| `-r, --repo <owner/repo>`     | Target repository. **Required.**                                                              | —       |
| `-d, --days <n>`              | Lookback window in days.                                                                      | `30`    |
| `--no-ai`                     | Skip the AI call entirely.                                                                    | off     |
| `--no-ai-summary`             | Omit the AI summary from console/file/DingTalk output (AI call is also skipped).              | off     |
| `--no-cache`                  | Disable the local cache.                                                                      | off     |
| `--cache-ttl <seconds>`       | Cache TTL in seconds.                                                                         | `3600`  |
| `--json`                      | Print analysis as JSON only (no tables, no AI).                                               | off     |
| `-o, --output <file>`         | Write the rendered report (plain text) to a file.                                             | —       |
| `--notify <channel>`          | Send report to a channel. Supported: `dingtalk`.                                              | —       |
| `--max-context-chars <n>`     | Max chars of inlined issue corpus passed to the model.                                        | `60000` |
| `--max-issue-body-chars <n>`  | Max chars retained per issue body in the inlined corpus.                                      | `1200`  |
| `--max-issues-in-context <n>` | Hard cap on the number of issues inlined.                                                     | `80`    |
| `--context-file <file>`       | Path to write the full, untruncated issue corpus (defaults to `.cache/gh-pulse-scout/...md`). | —       |
| `--prompt [file]`             | In `--no-ai` mode, dump the prompt that would be sent to the model. Stdout if no path given.  | —       |
| `--model-check`               | Print resolved AI configuration and run a tiny connectivity probe.                            | off     |

### Issue corpus

When AI is enabled, the prompt contains aggregated stats plus a prioritized, budgeted dump of issue titles/metadata/bodies. Issues are ordered by `open first → comment count → recency`; bodies are truncated per `--max-issue-body-chars` and the inlined block is capped by `--max-context-chars`.

The **full, untruncated** corpus is always written to a Markdown file (default `.cache/gh-pulse-scout/<repo>-issues-<days>d.md`, override with `--context-file`) for traceability or manual attachment. When `OPENAI_UPLOAD_CONTEXT=1` and the provider implements `/files`, it is also uploaded and referenced from the prompt; failures fall back to inline-only context.

### Examples

```bash
# Quick local scan
gh-pulse-scout --repo octocat/Hello-World

# 14-day window, skip AI, JSON output
gh-pulse-scout --repo nodejs/node --days 14 --no-ai --json

# Stats only (no AI summary), send to DingTalk
gh-pulse-scout --repo my-org/my-repo --no-ai-summary --notify dingtalk

# Full report (with AI summary) and save to file
gh-pulse-scout --repo my-org/my-repo --notify dingtalk -o pulse-report.md

# Probe the configured AI endpoint
gh-pulse-scout --model-check
```

---

## GitHub Action

This repository also ships an `action.yml`.

### Inputs

| Input              | Required | Default                     |
| ------------------ | -------- | --------------------------- |
| `repo`             | no       | `${{ github.repository }}`  |
| `days`             | no       | `30`                        |
| `github-token`     | yes      | —                           |
| `openai-api-key`   | no       | — (skips AI if empty)       |
| `openai-base-url`  | no       | `https://api.openai.com/v1` |
| `openai-model`     | no       | `gpt-4o-mini`               |
| `dingtalk-webhook` | no       | —                           |
| `dingtalk-secret`  | no       | —                           |
| `output-file`      | no       | `pulse-report.md`           |

### Minimal workflow

```yaml
name: Pulse
on:
  schedule:
    - cron: '0 1 * * 1'
  workflow_dispatch:

jobs:
  pulse:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: read
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/gh-pulse-scout@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          dingtalk-webhook: ${{ secrets.DINGTALK_WEBHOOK }}
```

The rendered report is also appended to `$GITHUB_STEP_SUMMARY`, so you can read it directly from the Actions run page.

---

## Output dimensions

Generated by [src/analyzer.ts](src/analyzer.ts):

- **Activity** — `created` / `closed` / `open` counts in the window.
- **Response efficiency** — `avgCloseHours`, `avgCloseDays`, `closedSampleSize`.
- **Participation** — `uniqueAuthors` count + author list.
- **Top labels** — top 5 labels by frequency.
- **Hot issues** — top 5 issues sorted by comment count.

> Per the original brief, *first-response time* is intentionally **not** computed to avoid extra `comments` API requests. Comment count is used as the heat proxy.

---

## Project layout

```
src/
  ai.ts          # OpenAI-compatible client, prompt builder, optional Files upload
  analyzer.ts    # map / filter / reduce aggregations
  cache.ts       # in-memory + on-disk cache
  cli.ts         # commander entry point
  corpus.ts      # prioritized + budgeted issue corpus builder
  github.ts      # Octokit fetcher + PR filtering
  notifier.ts    # DingTalk webhook sender (compact mobile layout, optional HMAC)
  reporter.ts    # chalk + cli-table3 console rendering
  types.ts       # shared TypeScript types
templates/       # prompt + DingTalk markdown templates
action.yml       # GitHub Action composite definition
```

---

## License

MIT
