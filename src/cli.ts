#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { fetchIssues } from './github.js';
import { analyzeIssues } from './analyzer.js';
import { generateAiReport, buildPrompt } from './ai.js';
import { buildIssueCorpus } from './corpus.js';
import { renderConsoleReport } from './reporter.js';
import { Cache } from './cache.js';
import { sendDingtalk } from './notifier.js';
import type { CliOptions } from './types.js';

const program = new Command();

program
    .name('gh-pulse-scout')
    .description('Fetch recent GitHub issues for a repo and generate an AI-powered status report.')
    .version('0.1.0')
    .requiredOption('-r, --repo <owner/repo>', 'GitHub repository, e.g. "octocat/Hello-World"')
    .option('-d, --days <number>', 'Lookback window in days', (v) => parseInt(v, 10), 30)
    .option('--no-ai', 'Skip AI summary generation')
    .option('--no-cache', 'Disable local cache')
    .option('--cache-ttl <seconds>', 'Cache TTL in seconds', (v) => parseInt(v, 10), 3600)
    .option('--json', 'Print analysis as JSON only', false)
    .option('-o, --output <file>', 'Write the full report (text + AI) to a file')
    .option('--notify <channel>', 'Send report to a channel (supported: dingtalk)')
    .option(
        '--max-context-chars <n>',
        'Max characters of inlined issue corpus passed to the model',
        (v) => parseInt(v, 10),
        60000,
    )
    .option(
        '--max-issue-body-chars <n>',
        'Max characters retained per issue body in the inlined corpus',
        (v) => parseInt(v, 10),
        1200,
    )
    .option(
        '--max-issues-in-context <n>',
        'Hard cap on number of issues considered for the inlined corpus',
        (v) => parseInt(v, 10),
        80,
    )
    .option(
        '--context-file <file>',
        'Path to write the full (untruncated) issue corpus. Defaults to a path under .cache/ when AI is enabled.',
    )
    .option(
        '--prompt [file]',
        'In --no-ai mode, dump the prompt (and corpus attachment path) that would be sent to the AI model. Writes to <file>, or stdout if no path is given. Useful for debugging.',
    );

program.parseAsync(process.argv).then(async () => {
    const raw = program.opts<{
        repo: string;
        days: number;
        ai: boolean;
        cache: boolean;
        cacheTtl: number;
        json: boolean;
        output?: string;
        notify?: string;
        maxContextChars: number;
        maxIssueBodyChars: number;
        maxIssuesInContext: number;
        contextFile?: string;
        prompt?: string | boolean;
    }>();

    let promptDump: string | undefined;
    if (raw.prompt === true) promptDump = '';
    else if (typeof raw.prompt === 'string') promptDump = raw.prompt;

    const opts: CliOptions = {
        repo: raw.repo,
        days: raw.days,
        noAi: !raw.ai,
        noCache: !raw.cache,
        cacheTtl: raw.cacheTtl,
        json: raw.json,
        output: raw.output,
        notify: raw.notify === 'dingtalk' ? 'dingtalk' : undefined,
        maxContextChars: raw.maxContextChars,
        maxIssueBodyChars: raw.maxIssueBodyChars,
        maxIssuesInContext: raw.maxIssuesInContext,
        contextFile: raw.contextFile,
        promptDump,
    };

    try {
        await run(opts);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(chalk.red(`\n✖ ${msg}\n`));
        process.exit(1);
    }
}).catch((err) => {
    process.stderr.write(chalk.red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
});

async function run(opts: CliOptions): Promise<void> {
    const token = process.env['GITHUB_TOKEN'];
    if (!token) {
        process.stderr.write(
            chalk.yellow(
                '⚠️  GITHUB_TOKEN is not set. Anonymous GitHub API calls are heavily rate-limited.\n',
            ),
        );
    }

    const cache = new Cache(opts.cacheTtl);
    process.stderr.write(chalk.gray(`→ Fetching issues for ${opts.repo} (last ${opts.days} days)...\n`));

    const issues = await fetchIssues(opts.repo, {
        token,
        days: opts.days,
        cache,
        useCache: !opts.noCache,
    });
    process.stderr.write(chalk.gray(`  fetched ${issues.length} issues (PRs excluded)\n`));

    const analysis = analyzeIssues(opts.repo, opts.days, issues);

    if (opts.json) {
        process.stdout.write(JSON.stringify(analysis, null, 2) + '\n');
        return;
    }

    if (opts.noAi && opts.promptDump !== undefined) {
        const corpus = buildIssueCorpus(issues, {
            maxContextChars: opts.maxContextChars,
            maxIssueBodyChars: opts.maxIssueBodyChars,
            maxIssuesInContext: opts.maxIssuesInContext,
        });

        const safeRepo = opts.repo.replace(/[^a-zA-Z0-9_-]/g, '_');
        const defaultContextPath = path.join(
            '.cache',
            'gh-pulse-scout',
            `${safeRepo}-issues-${opts.days}d.md`,
        );
        const contextPath = opts.contextFile ?? defaultContextPath;
        try {
            const dir = path.dirname(contextPath);
            if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
            const header =
                `# Issue corpus — ${opts.repo}\n` +
                `Window: last ${opts.days} days\n` +
                `Issues: ${issues.length}\n\n---\n\n`;
            fs.writeFileSync(contextPath, header + corpus.fullText, 'utf8');
            process.stderr.write(
                chalk.gray(`→ Full issue corpus (attachment) written to ${contextPath}\n`),
            );
        } catch (err) {
            process.stderr.write(
                chalk.yellow(
                    `⚠️  Could not write corpus file: ${err instanceof Error ? err.message : String(err)}\n`,
                ),
            );
        }

        const prompt = buildPrompt(analysis, corpus, contextPath);
        if (opts.promptDump === '') {
            process.stdout.write(prompt + '\n');
        } else {
            const dir = path.dirname(opts.promptDump);
            if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(opts.promptDump, prompt, 'utf8');
            process.stderr.write(
                chalk.gray(`→ AI prompt written to ${opts.promptDump} (attachment: ${contextPath})\n`),
            );
        }
        return;
    }

    let aiReport: string | undefined;
    if (!opts.noAi) {
        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
            process.stderr.write(
                chalk.yellow('⚠️  OPENAI_API_KEY is not set, skipping AI summary.\n'),
            );
        } else {
            const corpus = buildIssueCorpus(issues, {
                maxContextChars: opts.maxContextChars,
                maxIssueBodyChars: opts.maxIssueBodyChars,
                maxIssuesInContext: opts.maxIssuesInContext,
            });

            // Always dump the full untruncated corpus to a file so the user can
            // re-feed it manually to any LLM client that supports attachments.
            const safeRepo = opts.repo.replace(/[^a-zA-Z0-9_-]/g, '_');
            const defaultContextPath = path.join(
                '.cache',
                'gh-pulse-scout',
                `${safeRepo}-issues-${opts.days}d.md`,
            );
            const contextPath = opts.contextFile ?? defaultContextPath;
            try {
                const dir = path.dirname(contextPath);
                if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
                const header =
                    `# Issue corpus — ${opts.repo}\n` +
                    `Window: last ${opts.days} days\n` +
                    `Issues: ${issues.length}\n\n---\n\n`;
                fs.writeFileSync(contextPath, header + corpus.fullText, 'utf8');
                process.stderr.write(
                    chalk.gray(`→ Full issue corpus written to ${contextPath}\n`),
                );
            } catch (err) {
                process.stderr.write(
                    chalk.yellow(
                        `⚠️  Could not write corpus file: ${err instanceof Error ? err.message : String(err)}\n`,
                    ),
                );
            }

            process.stderr.write(
                chalk.gray(
                    `→ Generating AI summary (inlining ${corpus.includedCount}/${issues.length} issues, ${corpus.inlineText.length} chars${corpus.truncated ? ', some bodies truncated' : ''})...\n`,
                ),
            );
            try {
                aiReport = await generateAiReport(analysis, corpus, {
                    apiKey,
                    baseURL: process.env['OPENAI_BASE_URL'],
                    model: process.env['OPENAI_MODEL'],
                    contextFilePath: contextPath,
                    uploadContextFile: process.env['OPENAI_UPLOAD_CONTEXT'] === '1',
                });
            } catch (err) {
                process.stderr.write(
                    chalk.yellow(
                        `⚠️  AI summary failed: ${err instanceof Error ? err.message : String(err)}\n`,
                    ),
                );
            }
        }
    }

    const output = renderConsoleReport(analysis, aiReport);
    process.stdout.write(output + '\n');

    if (opts.output) {
        const dir = path.dirname(opts.output);
        if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(opts.output, stripAnsi(output), 'utf8');
        process.stderr.write(chalk.gray(`→ Report written to ${opts.output}\n`));
    }

    if (opts.notify === 'dingtalk') {
        const webhook = process.env['DINGTALK_WEBHOOK'];
        const secret = process.env['DINGTALK_SECRET'];
        if (!webhook) {
            process.stderr.write(chalk.yellow('⚠️  DINGTALK_WEBHOOK is not set, skipping notification.\n'));
        } else {
            try {
                await sendDingtalk(analysis, aiReport, { webhook, secret });
                process.stderr.write(chalk.gray('→ DingTalk notification sent.\n'));
            } catch (err) {
                process.stderr.write(
                    chalk.yellow(
                        `⚠️  DingTalk send failed: ${err instanceof Error ? err.message : String(err)}\n`,
                    ),
                );
            }
        }
    }
}

function stripAnsi(s: string): string {
    // Minimal ANSI escape stripper to keep saved file clean.
    return s.replace(
        // eslint-disable-next-line no-control-regex
        /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PRZcf-ntqry=><~]))/g,
        '',
    );
}
