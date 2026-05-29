import dayjs from 'dayjs';
import type { AnalysisResult, IssueData, LabelStat, TopIssue } from './types.js';

export function analyzeIssues(repo: string, days: number, issues: IssueData[]): AnalysisResult {
    const untilISO = dayjs().toISOString();
    const sinceISO = dayjs().subtract(days, 'day').toISOString();
    const sinceMs = dayjs(sinceISO).valueOf();

    // Activity — only count issues *created* within window for "created"
    const createdInWindow = issues.filter((i) => dayjs(i.created_at).valueOf() >= sinceMs);
    const closedInWindow = issues.filter(
        (i) => i.closed_at != null && dayjs(i.closed_at).valueOf() >= sinceMs,
    );
    const stillOpen = issues.filter((i) => i.state === 'open');

    // Response efficiency — average close duration for issues closed in window
    const closeDurationsHours = closedInWindow
        .map((i) => {
            const created = dayjs(i.created_at).valueOf();
            const closed = dayjs(i.closed_at!).valueOf();
            return (closed - created) / (1000 * 60 * 60);
        })
        .filter((h) => Number.isFinite(h) && h >= 0);

    const avgCloseHours =
        closeDurationsHours.length > 0
            ? closeDurationsHours.reduce((a, b) => a + b, 0) / closeDurationsHours.length
            : null;

    // Participation
    const authorSet = new Set<string>();
    for (const i of issues) {
        if (i.user?.login) authorSet.add(i.user.login);
    }

    // Top labels
    const labelCounts = issues.reduce<Map<string, number>>((acc, i) => {
        for (const l of i.labels) {
            acc.set(l.name, (acc.get(l.name) ?? 0) + 1);
        }
        return acc;
    }, new Map());
    const topLabels: LabelStat[] = [...labelCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Hot issues by comment count
    const topHotIssues: TopIssue[] = [...issues]
        .sort((a, b) => b.comments - a.comments)
        .slice(0, 5)
        .map((i) => ({
            number: i.number,
            title: i.title,
            comments: i.comments,
            url: i.html_url,
        }));

    return {
        repo,
        sinceISO,
        untilISO,
        totalFetched: issues.length,
        activity: {
            created: createdInWindow.length,
            closed: closedInWindow.length,
            open: stillOpen.length,
        },
        responseEfficiency: {
            avgCloseHours: avgCloseHours,
            avgCloseDays: avgCloseHours != null ? avgCloseHours / 24 : null,
            closedSampleSize: closeDurationsHours.length,
        },
        participation: {
            uniqueAuthors: authorSet.size,
            authors: [...authorSet].sort(),
        },
        topLabels,
        topHotIssues,
    };
}
