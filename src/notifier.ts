import crypto from 'node:crypto';
import type { AnalysisResult } from './types.js';

export interface DingtalkOptions {
    webhook: string;
    secret?: string;
}

function sign(secret: string, timestamp: number): string {
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(stringToSign, 'utf8');
    return encodeURIComponent(hmac.digest('base64'));
}

function buildMarkdown(result: AnalysisResult, aiReport?: string): string {
    const eff = result.responseEfficiency;
    const labels =
        result.topLabels.map((l) => `- \`${l.name}\`: ${l.count}`).join('\n') || '- (none)';
    const hot =
        result.topHotIssues
            .map((i) => `- [#${i.number} ${i.title}](${i.url}) — 💬 ${i.comments}`)
            .join('\n') || '- (none)';

    const base =
        `# 📊 GitHub Pulse Scout — ${result.repo}\n\n` +
        `**Window**: ${result.sinceISO} → ${result.untilISO}\n\n` +
        `## Activity\n` +
        `- 🆕 New: **${result.activity.created}**\n` +
        `- ✅ Closed: **${result.activity.closed}**\n` +
        `- 📂 Open: **${result.activity.open}**\n\n` +
        `## Response\n` +
        `- Avg close time: ${eff.avgCloseHours != null ? `${eff.avgCloseHours.toFixed(1)}h (${eff.avgCloseDays!.toFixed(2)}d)` : 'N/A'}\n` +
        `- Unique authors: ${result.participation.uniqueAuthors}\n\n` +
        `## Top labels\n${labels}\n\n` +
        `## Hottest issues\n${hot}\n`;

    return aiReport ? `${base}\n---\n\n## 🤖 AI Summary\n\n${aiReport}` : base;
}

export async function sendDingtalk(
    result: AnalysisResult,
    aiReport: string | undefined,
    opts: DingtalkOptions,
): Promise<void> {
    let url = opts.webhook;
    if (opts.secret) {
        const ts = Date.now();
        const s = sign(opts.secret, ts);
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}timestamp=${ts}&sign=${s}`;
    }

    const payload = {
        msgtype: 'markdown',
        markdown: {
            title: `GH Pulse Scout — ${result.repo}`,
            text: buildMarkdown(result, aiReport),
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        throw new Error(`DingTalk webhook failed: ${resp.status} ${resp.statusText}`);
    }
    const data = (await resp.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (typeof data.errcode === 'number' && data.errcode !== 0) {
        throw new Error(`DingTalk returned error: ${data.errcode} ${data.errmsg ?? ''}`);
    }
}
