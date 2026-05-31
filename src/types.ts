export interface IssueLabel {
    name: string;
}

export interface IssueUser {
    login: string;
}

export interface IssueData {
    number: number;
    title: string;
    state: 'open' | 'closed';
    state_reason: string | null;
    created_at: string;
    closed_at: string | null;
    updated_at: string;
    user: IssueUser;
    author_association: string | null;
    labels: IssueLabel[];
    comments: number;
    html_url: string;
    body: string;
}

export interface TopIssue {
    number: number;
    title: string;
    comments: number;
    url: string;
}

export interface LabelStat {
    name: string;
    count: number;
}

export interface AnalysisResult {
    repo: string;
    sinceISO: string;
    untilISO: string;
    totalFetched: number;
    activity: {
        created: number;
        closed: number;
        open: number;
    };
    responseEfficiency: {
        avgCloseHours: number | null;
        avgCloseDays: number | null;
        closedSampleSize: number;
    };
    participation: {
        uniqueAuthors: number;
        authors: string[];
    };
    topLabels: LabelStat[];
    topHotIssues: TopIssue[];
}

export interface CliOptions {
    repo: string;
    days: number;
    noAi: boolean;
    noCache: boolean;
    cacheTtl: number;
    json: boolean;
    output?: string;
    maxContextChars: number;
    maxIssueBodyChars: number;
    maxIssuesInContext: number;
    contextFile?: string;
    /** When set in --no-ai mode, dump the AI prompt for debugging. Empty string means stdout. */
    promptDump?: string;
}
