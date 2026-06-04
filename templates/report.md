Below is a snapshot of a GitHub repository's recent issue activity. Write a **brief, mobile-friendly pulse summary** in Markdown that a maintainer can read on a phone in under a minute.

# Aggregated statistics

{{stats}}
{{corpus_section}}
---

Output requirements:

- Markdown is the only allowed output format. Do not include any explanations or notes outside the Markdown report.
- {{language_directive}}
- Do not include the raw numbers above; interpret them in the summary.
- Bold a few key numbers or judgements; do not bold whole sentences.
- Keep the whole response short — target ~150–250 words, no more than ~350.
- Do not restate the raw numbers above; interpret them.
- Begin the response with a single level-1 heading (`#`) that names the report and explicitly states the time window length as **{{window_days}} days** (translate the wording to the target language, but keep the number and the word "days" / its translation). Example shape: `# Pulse summary — last {{window_days}} days`.
- After the title, use exactly these three short sections, in this order, each as a level-3 heading (`###`). Translate the heading names to the target language; the English names below are only a structural reference:
  1. `### Overall` — 1–2 sentences on health, momentum, and any standout signal.
  2. `### Trends & focus` — 2–4 terse bullets covering activity trend, response efficiency, community participation, and recurring themes. Mention at most 2–3 representative issue numbers (e.g. #123) across the whole section.
  3. `### Recommendations` — 2–3 short, concrete, actionable bullets.
- End the response with exactly the following footnote, on its own line, verbatim (do not translate, do not modify, do not wrap in a code block):
  <small>Generated on {{timestamp}} by [GH Pulse Scout](https://github.com/oss-infra/gh-pulse-scout), a tool that analyzes GitHub issue data to provide insights into project health and trends with AI 💖.</small>
- No tables. No long URLs. No section beyond the three above. Avoid filler like "In summary" or "Overall, this report shows".
