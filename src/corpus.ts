import dayjs from 'dayjs';
import type { IssueData } from './types.js';

export interface CorpusOptions {
    /** Max characters of the inlined corpus injected into the prompt. */
    maxContextChars: number;
    /** Max characters of each issue body kept in the inlined corpus. */
    maxIssueBodyChars: number;
    /** Hard cap on number of issues considered for inlining (still all dumped to file). */
    maxIssuesInContext: number;
}

export interface CorpusResult {
    /** Compact, prompt-ready text. */
    inlineText: string;
    /** Verbose dump of every issue (suitable for file attachment). */
    fullText: string;
    /** How many issues actually made it into the inline corpus. */
    includedCount: number;
    /** How many issues were dropped due to budget. */
    droppedCount: number;
    /** Whether any per-issue body was truncated when inlined. */
    truncated: boolean;
}

const BODY_PLACEHOLDER = '(no description)';

function normalizeBody(body: string | undefined): string {
    if (!body) return BODY_PLACEHOLDER;
    // Strip carriage returns + collapse 3+ blank lines.
    return body.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || BODY_PLACEHOLDER;
}

function truncate(s: string, max: number): { text: string; truncated: boolean } {
    if (s.length <= max) return { text: s, truncated: false };
    return { text: `${s.slice(0, max).trimEnd()}\n…[truncated ${s.length - max} chars]`, truncated: true };
}

/**
 * Sort issues by importance for prompting:
 *   1. Open issues with most comments first.
 *   2. Then recently updated open issues.
 *   3. Then recently closed issues (closed_at desc).
 */
function prioritize(issues: IssueData[]): IssueData[] {
    const open = issues.filter((i) => i.state === 'open');
    const closed = issues.filter((i) => i.state === 'closed');
    open.sort((a, b) => {
        if (b.comments !== a.comments) return b.comments - a.comments;
        return dayjs(b.updated_at).valueOf() - dayjs(a.updated_at).valueOf();
    });
    closed.sort((a, b) => {
        const at = a.closed_at ? dayjs(a.closed_at).valueOf() : 0;
        const bt = b.closed_at ? dayjs(b.closed_at).valueOf() : 0;
        return bt - at;
    });
    return [...open, ...closed];
}

function formatIssue(i: IssueData, bodyMax: number): { block: string; truncated: boolean } {
    const labels = i.labels.map((l) => l.name).join(', ') || '(none)';
    const closed = i.closed_at ? ` closed_at=${i.closed_at}` : '';
    const reason = i.state_reason ? ` reason=${i.state_reason}` : '';
    const assoc = i.author_association && i.author_association !== 'NONE'
        ? ` assoc=${i.author_association}`
        : '';
    const header =
        `### #${i.number} [${i.state}${reason}] ${i.title}\n` +
        `- author: @${i.user.login}${assoc}\n` +
        `- created_at: ${i.created_at}${closed}\n` +
        `- updated_at: ${i.updated_at}\n` +
        `- comments: ${i.comments}\n` +
        `- labels: ${labels}\n` +
        `- url: ${i.html_url}\n\n`;
    const { text, truncated } = truncate(normalizeBody(i.body), bodyMax);
    return { block: `${header}${text}\n`, truncated };
}

/**
 * Build two views of the issue corpus:
 *   - inlineText: budgeted, prompt-friendly; respects maxContextChars.
 *   - fullText  : every issue, every byte (for file attachment / debugging).
 */
export function buildIssueCorpus(issues: IssueData[], opts: CorpusOptions): CorpusResult {
    const ordered = prioritize(issues);

    // Full dump (no truncation), one block per issue, in priority order.
    const fullBlocks = ordered.map((i) => formatIssue(i, Number.MAX_SAFE_INTEGER).block);
    const fullText = fullBlocks.join('\n---\n\n');

    // Inline budgeted view.
    const candidates = ordered.slice(0, Math.max(0, opts.maxIssuesInContext));
    const parts: string[] = [];
    let used = 0;
    let included = 0;
    let truncated = false;
    for (const i of candidates) {
        const { block, truncated: t } = formatIssue(i, opts.maxIssueBodyChars);
        if (t) truncated = true;
        const piece = parts.length === 0 ? block : `\n---\n\n${block}`;
        if (used + piece.length > opts.maxContextChars) break;
        parts.push(piece);
        used += piece.length;
        included += 1;
    }

    const dropped = issues.length - included;
    return {
        inlineText: parts.join(''),
        fullText,
        includedCount: included,
        droppedCount: dropped < 0 ? 0 : dropped,
        truncated,
    };
}
