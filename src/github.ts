import { Octokit } from '@octokit/rest';
import dayjs from 'dayjs';
import type { IssueData } from './types.js';
import type { Cache } from './cache.js';

export interface FetchOptions {
    token?: string;
    days: number;
    cache?: Cache;
    useCache: boolean;
}

export function parseRepo(repo: string): { owner: string; name: string } {
    const m = repo.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
    if (!m) {
        throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
    }
    return { owner: m[1]!, name: m[2]! };
}

export async function fetchIssues(repo: string, opts: FetchOptions): Promise<IssueData[]> {
    const { owner, name } = parseRepo(repo);
    const since = dayjs().subtract(opts.days, 'day').toISOString();
    // Bump the version suffix whenever the IssueData shape changes so stale
    // cache files are ignored automatically.
    const cacheKey = `issues_:${owner}:${name}:${opts.days}`;

    if (opts.useCache && opts.cache) {
        const cached = opts.cache.get<IssueData[]>(cacheKey);
        if (cached) return cached;
    }

    const octokit = new Octokit({
        auth: opts.token,
        userAgent: 'gh-pulse-scout',
    });

    let raw: Array<Record<string, unknown>>;
    try {
        raw = (await octokit.paginate(octokit.rest.issues.listForRepo, {
            owner,
            repo: name,
            state: 'all',
            since,
            per_page: 100,
            sort: 'created',
            direction: 'desc',
        })) as Array<Record<string, unknown>>;
    } catch (err: unknown) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) {
            throw new Error(`Repository not found or not accessible: ${owner}/${name}. Check the name and your GITHUB_TOKEN scopes.`);
        }
        if (e.status === 401 || e.status === 403) {
            throw new Error(`GitHub API authentication failed (status ${e.status}). Verify GITHUB_TOKEN. ${e.message ?? ''}`);
        }
        throw new Error(`Failed to fetch issues from GitHub: ${e.message ?? String(err)}`);
    }

    const issues: IssueData[] = raw
        .filter((it) => !('pull_request' in it) || it['pull_request'] == null)
        .map((it) => {
            const labelsRaw = (it['labels'] as Array<string | { name?: string }> | undefined) ?? [];
            const labels = labelsRaw
                .map((l) => (typeof l === 'string' ? { name: l } : { name: l?.name ?? '' }))
                .filter((l) => l.name.length > 0);
            const user = (it['user'] as { login?: string } | null) ?? null;
            return {
                number: it['number'] as number,
                title: (it['title'] as string) ?? '',
                state: (it['state'] as 'open' | 'closed') ?? 'open',
                state_reason: (it['state_reason'] as string | null) ?? null,
                created_at: it['created_at'] as string,
                closed_at: (it['closed_at'] as string | null) ?? null,
                updated_at: it['updated_at'] as string,
                user: { login: user?.login ?? 'ghost' },
                author_association: (it['author_association'] as string | null) ?? null,
                labels,
                comments: (it['comments'] as number) ?? 0,
                html_url: (it['html_url'] as string) ?? '',
                body: (it['body'] as string | null) ?? '',
            };
        });

    if (opts.useCache && opts.cache) {
        opts.cache.set(cacheKey, issues);
    }

    return issues;
}
