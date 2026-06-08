import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type { AnalysisResult } from "./types.js";
import type { CorpusResult } from "./corpus.js";

// Templates live at <package-root>/templates/. This module resolves to either
// <root>/src/ai.ts (dev via tsx) or <root>/dist/ai.js (built), so going one
// directory up always lands at the package root.
const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);

const templateCache = new Map<string, string>();

function loadTemplate(name: string): string {
  const cached = templateCache.get(name);
  if (cached !== undefined) return cached;
  const filePath = path.join(TEMPLATES_DIR, name);
  const text = fs.readFileSync(filePath, "utf8");
  templateCache.set(name, text);
  return text;
}

function renderTemplate(name: string, vars: Record<string, string>): string {
  const tpl = loadTemplate(name);
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Template "${name}" is missing variable "${key}".`);
    }
    return vars[key]!;
  });
}

export interface AiOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Path to the dumped full-corpus file (mentioned to the model for traceability). */
  contextFilePath?: string;
  /** Best-effort: upload the corpus file via OpenAI Files API and reference it. */
  uploadContextFile?: boolean;
  /** Output language for the AI summary. "auto" / undefined lets the model choose. */
  language?: string;
}

function languageDirective(lang?: string): string {
  const v = (lang ?? "").trim();
  if (!v || v.toLowerCase() === "auto") {
    return "Reply in the language the user most likely speaks; if unclear, use English.";
  }
  return `Write the entire response in ${v}. Translate the three section headings into ${v} as well. Keep issue references like "#123" and code identifiers untouched.`;
}

function buildStatsBlock(result: AnalysisResult): string {
  const eff = result.responseEfficiency;
  const labels =
    result.topLabels.map((l) => `- ${l.name}: ${l.count}`).join("\n") ||
    "- (none)";
  const hot =
    result.topHotIssues
      .map(
        (i) => `- #${i.number} "${i.title}" (${i.comments} comments) ${i.url}`,
      )
      .join("\n") || "- (none)";

  return [
    `Repository: ${result.repo}`,
    `Window: ${result.sinceISO} ~ ${result.untilISO}`,
    `Total issues fetched (touched in window): ${result.totalFetched}`,
    ``,
    `## Activity`,
    `- New issues: ${result.activity.created}`,
    `- Closed issues: ${result.activity.closed}`,
    `- Currently open: ${result.activity.open}`,
    ``,
    `## Response efficiency`,
    `- Average close time: ${eff.avgCloseHours != null ? `${eff.avgCloseHours.toFixed(1)} hours (${eff.avgCloseDays!.toFixed(2)} days)` : "N/A"}`,
    `- Closed sample size: ${eff.closedSampleSize}`,
    ``,
    `## Participation`,
    `- Unique issue authors: ${result.participation.uniqueAuthors}`,
    ``,
    `## Top labels`,
    labels,
    ``,
    `## Hottest issues (by comment count)`,
    hot,
  ].join("\n");
}

export function buildPrompt(
  result: AnalysisResult,
  corpus: CorpusResult | undefined,
  contextFilePath: string | undefined,
  language?: string,
): string {
  let corpusSection = "";
  if (corpus && corpus.inlineText.length > 0) {
    const meta =
      `Showing ${corpus.includedCount} of ${corpus.includedCount + corpus.droppedCount} issues, ` +
      `prioritized by open state + comment count + recency` +
      (corpus.truncated ? ", long bodies truncated." : ".") +
      (contextFilePath
        ? ` The complete, untruncated corpus is also written to "${contextFilePath}".`
        : "");
    corpusSection = renderTemplate("corpus-inline.md", {
      meta,
      corpus: corpus.inlineText,
    });
  } else if (contextFilePath) {
    corpusSection = renderTemplate("corpus-file-only.md", {
      path: contextFilePath,
    });
  }

  const windowDays = computeWindowDays(result.sinceISO, result.untilISO);
  const timestamp = new Date().toISOString();

  return renderTemplate("report.md", {
    stats: buildStatsBlock(result),
    corpus_section: corpusSection,
    language_directive: languageDirective(language),
    window_days: String(windowDays),
    timestamp,
  });
}

function computeWindowDays(sinceISO: string, untilISO: string): number {
  const since = Date.parse(sinceISO);
  const until = Date.parse(untilISO);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since) {
    return 0;
  }
  return Math.max(1, Math.round((until - since) / 86_400_000));
}

async function tryUploadAsAttachment(
  client: OpenAI,
  filePath: string,
): Promise<{ fileId: string; name: string } | null> {
  try {
    if (!fs.existsSync(filePath)) return null;
    // Best-effort: many OpenAI-compatible providers do not implement the
    // /files endpoint. We swallow failures and fall back to inline context.
    const uploaded = await client.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    });
    return { fileId: uploaded.id, name: path.basename(filePath) };
  } catch {
    return null;
  }
}

export async function generateAiReport(
  result: AnalysisResult,
  corpus: CorpusResult | undefined,
  opts: AiOptions,
): Promise<string> {
  if (!opts.apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Set it in env or pass via .env file.",
    );
  }
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
  });
  const model = opts.model ?? "gpt-4o-mini";

  let attachmentNote: string | undefined;
  if (opts.uploadContextFile && opts.contextFilePath) {
    const uploaded = await tryUploadAsAttachment(client, opts.contextFilePath);
    if (uploaded) {
      attachmentNote = renderTemplate("attachment-note.md", {
        fileId: uploaded.fileId,
        name: uploaded.name,
      }).trim();
    }
  }

  const prompt = buildPrompt(
    result,
    corpus,
    opts.contextFilePath,
    opts.language,
  );
  const userContent = attachmentNote
    ? `${attachmentNote}\n\n${prompt}`
    : prompt;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: loadTemplate("system.md").trim(),
      },
      { role: "user", content: userContent },
    ],
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("AI model returned an empty response.");
  }
  return text;
}

export interface ModelCheckResult {
  model?: string;
  reply: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Minimal connectivity probe against the configured OpenAI-compatible endpoint.
 * Sends a tiny prompt and returns the model's reply along with usage info.
 */
export async function checkModel(opts: {
  apiKey: string;
  baseURL?: string | undefined;
  model?: string | undefined;
}): Promise<ModelCheckResult> {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  const model = opts.model ?? "gpt-4o-mini";
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 16,
    messages: [
      {
        role: "system",
        content:
          "You are a connectivity probe. Reply with a single short word.",
      },
      { role: "user", content: "ping" },
    ],
  });
  const reply = completion.choices[0]?.message?.content?.trim() ?? "";
  const result: ModelCheckResult = {
    reply,
  };
  if (completion.model) result.model = completion.model;
  if (completion.usage) {
    result.usage = {
      prompt_tokens: completion.usage.prompt_tokens,
      completion_tokens: completion.usage.completion_tokens,
      total_tokens: completion.usage.total_tokens,
    };
  }
  return result;
}
