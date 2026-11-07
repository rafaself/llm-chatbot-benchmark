# Eval-driven development — Sonora end-to-end benchmark

This project compares **complete model-driven customer-support workflows** with
a fixed Sonora policy corpus, a deterministic lexical retriever, read-only
SQLite operational fixtures, AI SDK tool calling and Promptfoo grading.

## Workflow

1. Add or review a golden case with a stable ID, source-referenced expected
   facts, prohibited claims, expected tool names/arguments and relevant policy
   subsection IDs. The reference must follow the actual versioned policy and
   database, not assumptions about Elaria or real-world law.
2. Run `npm run check`, `npm run smoke` and `npm run preview -- --models nova-micro`.
   Smoke uses fixtures, not a live model; report it as wiring evidence only.
3. Before modifying prompts, retriever or tools, record the baseline revision,
   fixed retrieval/data snapshot, selected cases and judge configuration.
4. After changing behavior, evaluate focused development categories, then the
   complete development dataset. Review correctness, groundedness, tool
   arguments and evidence coverage per category. Never silently change gold
   expectations to turn a failing case green.
5. Keep `datasets/golden/heldout.jsonl` reserved for release-candidate
   checks. Do not tune the retriever/prompts using held-out case-level failures.
   Public repository holdouts are not truly blind.
6. Promote new or revised golden labels only after independent review.

## Evaluation conventions

- The prompt receives only conversation messages, available tool interfaces
  and tool results; **never expected answers, tool labels or evidence IDs**.
- Model-initiated search queries and all executed tool calls form part of the
  end-to-end system being compared. Keep tools, retrieval ranking, policy,
  database and judge fixed between candidates.
- Required-section evidence coverage is a deterministic trace check.
  It does not establish faithfulness by itself.
- Tool route/argument assertions are deterministic; the three LLM rubrics
  assess answer quality, evidence support and directness.
- Keep each run's source hashes, configured models, parameters and results.
  Separate mock results from paid real-model results, and report missing
  latency/cost data as unknown.

## Security and costs

- Do not include personal customer data or secrets in source control or reports.
  SQLite stores fictitious data; never reuse these unauthenticated tools against
  a real customer database.
- Paid calls are forbidden without explicit user opt-in. Use
  `--live --allow-paid` only for an approved run and inspect the request ceiling.
- Prefer the existing libraries; avoid unnecessary production dependencies.
