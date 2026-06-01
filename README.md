# gh-pulse-scout

A small Node.js + TypeScript CLI that fetches **GitHub Issues** (PRs excluded) from a target repository over a lookback window (default: last 30 days), aggregates several health metrics, and uses an **OpenAI-compatible** LLM to generate a human-friendly project status report.

It can also run as a **GitHub Action** on a schedule and expose the rendered report as a step **output**, so you can chain it into any notification action (DingTalk, Slack, Lark, Telegram, email, ...) of your choice.

## Features

- 🔎 Fetches all issues created/updated in the last *N* days via `@octokit/rest` pagination (PRs filtered out).
- 📊 Aggregates **activity**, **response efficiency**, **participation**, **top labels** and **hot issues** with plain `map`/`filter`/`reduce`.
- 🤖 Sends the aggregated stats **plus a prioritized, budgeted dump of issue titles, metadata and bodies** to an OpenAI-compatible chat completions endpoint, and always writes the full untruncated corpus to a sidecar Markdown file for traceability or manual attachment.
- 💾 Two-layer (memory + file) cache with configurable TTL to spare the GitHub API.
- 🎨 Colorful terminal output via `chalk` + `cli-table3`, or `--json` for machine-readable output.
- 🤝 Ships as a composite GitHub Action that exposes the report as a step output, decoupled from any specific notification channel.

## Install & build

Requires **Node.js >= 18**.

```bash
npm install
npm run build
```

For development you can run directly from TypeScript:

```bash
npm run dev -- --repo nodejs/node --days 30
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

| Variable                | Required                | Description                                                                                        |
| ----------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`          | Recommended             | GitHub personal access token. `public_repo` scope is enough for public repos.                      |
| `OPENAI_API_KEY`        | Required for AI summary | API key of your OpenAI-compatible provider.                                                        |
| `OPENAI_BASE_URL`       | Optional                | Base URL, e.g. `https://api.openai.com/v1` or a compatible vendor.                                 |
| `OPENAI_MODEL`          | Optional                | Model name. Defaults to `gpt-4o-mini`.                                                             |
| `OPENAI_UPLOAD_CONTEXT` | Optional                | Set to `1` to also upload the corpus file via the OpenAI Files API (best-effort, silent fallback). |

## CLI usage

```bash
gh-pulse-scout --repo <owner/repo> [options]
```

### Options

| Flag                          | Description                                                                        | Default |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------- |
| `-r, --repo <owner/repo>`     | Target repository. **Required.**                                                   | —       |
| `-d, --days <n>`              | Lookback window in days.                                                           | `30`    |
| `--no-ai`                     | Skip AI summary generation.                                                        | off     |
| `--no-cache`                  | Disable local cache.                                                               | off     |
| `--cache-ttl <seconds>`       | Cache TTL in seconds.                                                              | `3600`  |
| `--json`                      | Print analysis as JSON only (no tables, no AI).                                    | off     |
| `-o, --output <file>`         | Write rendered report (plain text) to a file.                                      | —       |
| `--max-context-chars <n>`     | Max chars of inlined issue corpus passed to the model.                             | `60000` |
| `--max-issue-body-chars <n>`  | Max chars retained per issue body in the inlined corpus.                           | `1200`  |
| `--max-issues-in-context <n>` | Hard cap on the number of issues inlined.                                          | `80`    |
| `--context-file <file>`       | Path to write the **full**, untruncated issue corpus (defaults to `.cache/...md`). | —       |

### Feeding richer context to the model

When AI is enabled, the prompt contains both the **aggregated statistics** and a **prioritized, budgeted dump of issue titles, metadata and bodies**. Issues are ordered by `open first → comment count → recency`, per-issue body is truncated to `--max-issue-body-chars`, and the whole inlined block is capped at `--max-context-chars`.

The **full, untruncated** corpus is always written to a Markdown file (defaults to `.cache/gh-pulse-scout/<repo>-issues-<days>d.md`, override with `--context-file`). Its path is also mentioned in the prompt, so reviewers can trace exactly what the model saw and you can attach the file by hand to any LLM client that supports uploads.

When `OPENAI_UPLOAD_CONTEXT=1` is set and your provider implements the `/files` endpoint, the corpus file is additionally uploaded via the OpenAI Files API and referenced from the prompt. Failures are silently ignored and the run falls back to inline-only context.

### Examples

```bash
# Quick local scan
gh-pulse-scout --repo octocat/Hello-World

# 14-day window, skip AI, JSON output
gh-pulse-scout --repo nodejs/node --days 14 --no-ai --json

# Generate report and write it to a file (then pipe it wherever you like)
gh-pulse-scout --repo my-org/my-repo -o pulse-report.md
```

## GitHub Action usage

This repository also ships an `action.yml`. A scheduled workflow is included in [.github/workflows/pulse.yml](.github/workflows/pulse.yml).

### Inputs

| Input             | Required | Default                     |
| ----------------- | -------- | --------------------------- |
| `repo`            | no       | `${{ github.repository }}`  |
| `days`            | no       | `30`                        |
| `github-token`    | yes      | —                           |
| `openai-api-key`  | no       | — (skips AI if empty)       |
| `openai-base-url` | no       | `https://api.openai.com/v1` |
| `openai-model`    | no       | `gpt-4o-mini`               |
| `output-file`     | no       | `pulse-report.md`           |

### Outputs

| Output        | Description                                               |
| ------------- | --------------------------------------------------------- |
| `report`      | The rendered Markdown report content (text + AI summary). |
| `report-file` | Path to the rendered Markdown report file.                |

The action does **not** send notifications itself. Instead it exposes the report
as a step output so you can forward it to **any** notification action — DingTalk,
Slack, Lark, Telegram, email, etc. — keeping the report generation fully
decoupled from delivery.

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
      - id: pulse
        uses: your-org/gh-pulse-scout@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}

      # Forward the report to any notification action you prefer.
      # Example: send to a DingTalk robot via a dedicated action.
      - name: Notify DingTalk
        uses: ghostket/dingtalk-action@v1
        with:
          webhook: ${{ secrets.DINGTALK_WEBHOOK }}
          secret: ${{ secrets.DINGTALK_SECRET }}
          msgtype: markdown
          title: "GH Pulse Scout"
          text: ${{ steps.pulse.outputs.report }}
```

Swap the `Notify DingTalk` step for a Slack, Lark, Telegram or email action as
needed — just feed it `steps.pulse.outputs.report` (the content) or
`steps.pulse.outputs.report-file` (the file path).

The rendered report is also appended to `$GITHUB_STEP_SUMMARY`, so you can read it directly from the Actions run page.

## Output dimensions

Generated by [src/analyzer.ts](src/analyzer.ts):

- **Activity** — `created` / `closed` / `open` counts in the window.
- **Response efficiency** — `avgCloseHours`, `avgCloseDays`, `closedSampleSize`.
- **Participation** — `uniqueAuthors` count + author list.
- **Top labels** — top 5 labels by frequency.
- **Hot issues** — top 5 issues sorted by comment count.

> Per the original brief, *first-response time* is intentionally **not** computed to avoid extra `comments` API requests. Comment count is used as the heat proxy.

## Project layout

```
src/
  ai.ts          # OpenAI-compatible client, prompt builder, optional Files upload
  analyzer.ts    # map / filter / reduce aggregations
  cache.ts       # in-memory + on-disk cache (node-cache backed)
  cli.ts         # commander entry point
  corpus.ts      # prioritized + budgeted issue corpus builder
  github.ts      # Octokit fetcher + PR filtering
  reporter.ts    # chalk + cli-table3 console rendering
  types.ts       # shared TypeScript types (strict mode)
action.yml                   # GitHub Action composite definition
.github/workflows/pulse.yml  # example scheduled workflow
```

## License

This project is under MIT license, see the [LICENSE](LICENSE) file for details.