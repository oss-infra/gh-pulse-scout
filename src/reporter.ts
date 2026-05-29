import chalk from 'chalk';
import Table from 'cli-table3';
import type { AnalysisResult } from './types.js';

export function renderConsoleReport(result: AnalysisResult, aiReport?: string): string {
    const lines: string[] = [];
    lines.push(chalk.bold.cyan(`\n📊 GitHub Pulse Scout — ${result.repo}`));
    lines.push(
        chalk.gray(
            `Window: ${result.sinceISO} → ${result.untilISO}    Issues fetched: ${result.totalFetched}`,
        ),
    );

    const activity = new Table({
        head: [chalk.bold('Activity'), chalk.bold('Count')],
        colWidths: [30, 12],
    });
    activity.push(
        ['🆕 New issues', String(result.activity.created)],
        ['✅ Closed issues', String(result.activity.closed)],
        ['📂 Currently open', String(result.activity.open)],
    );
    lines.push(activity.toString());

    const eff = result.responseEfficiency;
    const effTable = new Table({
        head: [chalk.bold('Response efficiency'), chalk.bold('Value')],
        colWidths: [30, 30],
    });
    effTable.push(
        [
            'Avg close time (hours)',
            eff.avgCloseHours != null ? eff.avgCloseHours.toFixed(1) : 'N/A',
        ],
        [
            'Avg close time (days)',
            eff.avgCloseDays != null ? eff.avgCloseDays.toFixed(2) : 'N/A',
        ],
        ['Closed sample size', String(eff.closedSampleSize)],
        ['Unique issue authors', String(result.participation.uniqueAuthors)],
    );
    lines.push(effTable.toString());

    if (result.topLabels.length > 0) {
        const labelTable = new Table({
            head: [chalk.bold('Top labels'), chalk.bold('Count')],
            colWidths: [40, 10],
        });
        for (const l of result.topLabels) {
            labelTable.push([l.name, String(l.count)]);
        }
        lines.push(labelTable.toString());
    }

    if (result.topHotIssues.length > 0) {
        const hotTable = new Table({
            head: [chalk.bold('#'), chalk.bold('Title'), chalk.bold('💬'), chalk.bold('URL')],
            colWidths: [8, 50, 6, 60],
            wordWrap: true,
        });
        for (const i of result.topHotIssues) {
            hotTable.push([String(i.number), i.title, String(i.comments), i.url]);
        }
        lines.push(chalk.bold('\n🔥 Hottest issues'));
        lines.push(hotTable.toString());
    }

    if (aiReport) {
        lines.push(chalk.bold.magenta('\n🤖 AI Summary\n'));
        lines.push(aiReport);
    }

    return lines.join('\n');
}
