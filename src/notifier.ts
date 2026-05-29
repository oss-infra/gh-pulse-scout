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
    const avg =
      eff.avgCloseHours != null
        ? eff.avgCloseDays! >= 1
          ? `${eff.avgCloseDays!.toFixed(1)}d`
          : `${eff.avgCloseHours.toFixed(1)}h`
        : "N/A";

    // Compact one-line stat strip — easy to scan on a phone.
    const statLine =
      `🆕 ${result.activity.created} · ` +
      `✅ ${result.activity.closed} · ` +
      `📂 ${result.activity.open} · ` +
      `⏱ ${avg} · ` +
      `👤 ${result.participation.uniqueAuthors}`;

    // At most 3 hot issues, short titles, no extra metadata noise.
    const hotItems = result.topHotIssues.slice(0, 3).map((i) => {
      const title = i.title.length > 48 ? `${i.title.slice(0, 47)}…` : i.title;
      return `- [#${i.number}](${i.url}) ${title} · 💬 ${i.comments}`;
    });

    const parts: string[] = [];
    parts.push(`#### 📊 ${result.repo}`);
    parts.push(
      `> ${result.sinceISO.slice(0, 10)} → ${result.untilISO.slice(0, 10)}`,
    );
    parts.push("");
    parts.push(statLine);

    if (aiReport) {
      parts.push("");
      parts.push("---");
      parts.push("");
      parts.push(aiReport.trim());
    }

    if (hotItems.length > 0) {
      parts.push("");
      parts.push("**🔥 热门 issue**");
      parts.push(...hotItems);
    }

    return parts.join("\n");
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
