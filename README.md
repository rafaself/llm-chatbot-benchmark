<img width="2508" height="627" alt="image" src="https://github.com/user-attachments/assets/1e2df849-365f-40e2-9dae-02d9a5a4fdc3" />

# Sonora End-to-End Chatbot Benchmark

Compare language models as complete customer-support agents, not as answer
generators alone. Every candidate works with the same fictional Sonora store
policy, product and order data, tools, and evaluation settings.

---

**Latest winner:** GPT 6 Luna

---

## How it works

- A deterministic BM25 retriever searches the fixed policy corpus.
- Read-only tools query a fictional SQLite database for product and order facts.
- Promptfoo runs multi-turn scenarios and grades answer quality, evidence
  support, and directness. Deterministic checks also verify tool calls,
  arguments, and required policy sections.
- Expected answers and labels are used for grading only; they are not shown to
  the model.

This measures the full model, prompt, retrieval, and tool workflow. It is not
an isolated model-knowledge test or a production-ready semantic search system.

## Quick start

Requires Node.js 22.22 or later.

```sh
npm ci
npm run check
npm run smoke
npm run preview -- --models nova-micro
```

`smoke` uses offline fixtures to check the evaluation wiring. `preview`
prepares a live configuration and request ceiling without invoking models.

### Paid live runs

Copy `.env.example` to `.env` and provide AWS credentials, then run:

```sh
npm run benchmark -- --live --allow-paid --models nova-micro
npm run full-benchmark
```

Live runs call Bedrock and may incur charges. The full run includes all
configured models. Its 4,060-request ceiling limits requests, not cost.

## Evaluation data

- `evaluation/datasets/golden/development.jsonl` is for development and prompt
  iteration. Its labels are drafts and should be independently reviewed before
  using scores for decisions.
- `evaluation/datasets/golden/heldout.jsonl` is reserved for release-candidate
  checks. The cases are public, so this is not a blind test set.
- `evaluation/datasets/smoke.jsonl` contains offline fixtures for wiring checks.

Live runs use the development dataset by default. See
[`evaluation/datasets/README.md`](evaluation/datasets/README.md) for the data
format and dataset guidance.

## Results and versions

Timestamped run output is written to the ignored
`evaluation/results/<timestamp>/` directory. Official snapshots are stored
separately under `evaluation/official-results/v<version>/`.

**Latest official run — `2026-11-08T16-31-21.751Z` (v0.0.1):** 10 models,
580 attempted turns (307 passed, 271 failed, 2 provider errors), 1 h 32 min
42 s, and an estimated combined cost of $3.869.

**Winner by turn pass rate: `gpt-6-luna` — 57/58 passes (98.3%).**

Scores are from the development dataset; `gpt-6.1-sol` judged every candidate,
including itself. See the [full run summary](evaluation/official-results/v0.0.1/stats.md).

The first official snapshot is [v0.0.1](evaluation/official-results/v0.0.1/),
with its [summary](evaluation/official-results/v0.0.1/stats.md) and
[release metadata](evaluation/official-results/v0.0.1/release.json). See the
[versioning guide](evaluation/official-results/README.md) before creating a
new official version.

## Project files

- [`evaluation/config/models.json`](evaluation/config/models.json) — candidate
  models and invocation settings.
- [`evaluation/prompts/chat.json`](evaluation/prompts/chat.json) — target
  assistant prompt.
- [`evaluation/docs/system-prompt.md`](evaluation/docs/system-prompt.md) —
  prompt contracts and grounding rules.
- [`evaluation/docs/models.md`](evaluation/docs/models.md) — model routes and
  compatibility evidence.

All customer, product, order, and policy data is fictional. The operational
database is read-only and must not be replaced with real customer data.

[MIT License](LICENSE).
