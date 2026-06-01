import { markdownTable } from "markdown-table";
import type { AnalysisResult } from "./types.js";

/**
 * Render the report as portable GitHub-Flavored Markdown, using real Markdown
 * tables built with the `markdown-table` package. Safe to paste into chat
 * tools (DingTalk, Slack, Lark, ...) and `$GITHUB_STEP_SUMMARY`.
 *
 * Note: the "Hottest issues" section is intentionally a bullet list rather
 * than a table — DingTalk's markdown message type does not render tables,
 * and the row is too wide for compact table display anyway.
 */
export function renderMarkdownReport(
  result: AnalysisResult,
  aiReport?: string,
): string {
  // Escape `|` (column separator) and collapse newlines so a cell can't
  // break the table.
  const cell = (s: string | number): string =>
    String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

  const eff = result.responseEfficiency;
  const lines: string[] = [];

  lines.push(`# 📊 GitHub Pulse Scout — ${cell(result.repo)}`);
  lines.push("");
  lines.push(`**Window:** ${result.sinceISO} → ${result.untilISO}  `);
  lines.push(`**Issues fetched:** ${result.totalFetched}`);
  lines.push("");

  lines.push("## Activity");
  lines.push("");
  lines.push(
    markdownTable(
      [
        ["Metric", "Count"],
        ["🆕 New issues", cell(result.activity.created)],
        ["✅ Closed issues", cell(result.activity.closed)],
        ["📂 Currently open", cell(result.activity.open)],
      ],
      { align: ["l", "r"] },
    ),
  );
  lines.push("");

  lines.push("## Response efficiency");
  lines.push("");
  lines.push(
    markdownTable(
      [
        ["Metric", "Value"],
        [
          "Avg close time (hours)",
          eff.avgCloseHours != null ? eff.avgCloseHours.toFixed(1) : "N/A",
        ],
        [
          "Avg close time (days)",
          eff.avgCloseDays != null ? eff.avgCloseDays.toFixed(2) : "N/A",
        ],
        ["Closed sample size", cell(eff.closedSampleSize)],
        ["Unique issue authors", cell(result.participation.uniqueAuthors)],
      ],
      { align: ["l", "r"] },
    ),
  );
  lines.push("");

  if (result.topLabels.length > 0) {
    lines.push("## Top labels");
    lines.push("");
    lines.push(
      markdownTable(
        [
          ["Label", "Count"],
          ...result.topLabels.map((l) => [
            `\`${cell(l.name)}\``,
            cell(l.count),
          ]),
        ],
        { align: ["l", "r"] },
      ),
    );
    lines.push("");
  }

  if (result.topHotIssues.length > 0) {
    lines.push("## 🔥 Hottest issues");
    lines.push("");
    // Use a bullet list rather than a Markdown table here. The hot-issues
    // row is wide (link + long title + comment count) and several chat
    // platforms (notably DingTalk's markdown message type) do not render
    // Markdown tables at all — bullets render correctly everywhere.
    for (const i of result.topHotIssues) {
      lines.push(
        `- [#${i.number}](${i.url}) — ${cell(i.title)} (💬 **${i.comments}**)`,
      );
    }
    lines.push("");
  }

  if (aiReport) {
    lines.push("## 🤖 AI Summary");
    lines.push("");
    lines.push(aiReport.trim());
    lines.push("");
  }

  return lines.join("\n");
}
