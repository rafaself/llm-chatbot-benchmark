# Sonora End-to-End LLM Chatbot Benchmark

Compare Bedrock language models **as complete customer-support agents**, with the
same policy corpus, lexical document retrieval, read-only operational SQLite
database, prompts, tool interfaces, grading judge and runtime constraints.
Promptfoo measures final answers and the actual tool/retrieval trace; AI SDK
runs multi-step model/tool exchanges.

## What is measured

- Policy lookup, cross-section reasoning, conditional rules, calculations,
  operational tool calls, clarifications, conversation history and robustness.
- Answer correctness and completeness (LLM rubric), faithfulness to **retrieved**
  documents and database results (LLM rubric), response directness (LLM rubric).
- Deterministic tool name/argument validation and full required-section evidence
  coverage. Evidence recall measures what was **returned to the model**, not
  whether the model subsequently cited or used every passage.
- Latency, token usage and model steps in individual Promptfoo outputs.
  No cost estimate is presented as a billing record.

Policy: `datasets/sonora_store_policy.md`; fixed retrieval:
`src/retrieval.ts` (section-based BM25 lexical baseline, no external embeddings);
read-only customer-free tool outputs from
`datasets/sonora_store_database.sqlite` (seed SQL also provided).
The model chooses search queries and tool calls. The same retriever and data
are used for all candidates. This is a benchmark of the **full agent system**,
not an isolated language-model knowledge exam or a production-grade semantic RAG.

## Golden evaluation dataset

- `datasets/golden/development.jsonl` — 43 reviewed-source *draft* cases,
  used for development and prompt iteration.
- `datasets/golden/heldout.jsonl` — 8 additional cases reserved for
  release-candidate verification; do not tune against their case-level failures.
  As these cases live in a public repository, this is an organizational holdout,
  **not a confidential blind test**.
- `datasets/smoke.jsonl` — three offline fixture cases to verify plumbing.

Each JSONL line has an `item` with stable `id`, `input`, `category`,
`difficulty`, optional `messages`, an `expected` object with
`answer`, `required_facts`, `forbidden_claims`, `tools`, and
`retrieval.relevant_sections` with original policy subsection IDs.
An optional `tags` array supports slice analysis. The loader validates
IDs, categories, evidence references and duplicate case IDs. **Gold data is
passed to Promptfoo's grader only, never to the model prompt.**

The reference answers are preliminary editorial labels and should be
reviewed by a second person before using benchmark results for decisions.

## Run

Requires Node.js 22.22+ and npm, with no separate Python installation.

```sh
npm ci
npm run check
npm run smoke

# No paid requests: inspect the generated config and case/attempt ceiling.
npm run preview -- --models nova-micro

# Opt-in paid run; model/judge request ceiling enforced.
export AWS_PROFILE=benchmark
export AWS_REGION=us-east-1
npm run benchmark -- --live --allow-paid --models nova-micro

# Compare two models (raise upper bound only if acceptable).
npm run benchmark -- --live --allow-paid --models nova-micro nova-lite --max-requests 600

# Reserve the holdout for release-candidate checks.
npm run preview -- --models nova-micro --dataset datasets/golden/heldout.jsonl
```

Offline is the default and selects `datasets/smoke.jsonl`; live/preview
select `datasets/golden/development.jsonl`, unless `--dataset` is explicit.
The `--category` filter selects scenario categories.
No real-model baseline was run as part of this dataset update.

Each paid run requires `--live --allow-paid`. Defaults include max 3 model
steps, one repetition, concurrency 1, no retries, max 1024 generated tokens,
60-second per-step timeout, and conservative `--max-requests 500` upper
bound counting up to three rubric judge calls per case. This is **not**
a monetary cap. Inspect `config/models.json` and `docs/models.md` for
model routes, judge configuration and caveats.

## Scoring interpretation

- End-to-end case success requires **all** assertions to pass. A strong
  directness score cannot compensate for unsupported or incorrect facts.
- Tool correctness checks required tool names and specified argument values;
  duplicate calls of the same permitted tool are tracked but not automatically
  a correctness failure. Extra *different* tool types fail.
- Evidence coverage uses stable policy subsection IDs across all search calls.
  It is strict when a case declares mandatory sections, and intentionally
  separate from answer grading.
- A missing document can be a retrieval failure; a correct document with an
  incorrect answer can be an interpretation failure.
- The offline mock judge always awards full rubric grades: smoke results
  only demonstrate wiring, **never real model quality**.

Each run creates immutable output under ignored `results/<timestamp>/`:
Promptfoo JSON/HTML, resolved config, metadata/hashes, and diagnostics.
The manifest hashes the selected dataset, policy file, operational SQLite
database, prompt, scoring config, source code, model registry and dependencies.
Keep the same revision, corpus, tools, model parameters and judge settings
when comparing results.

## Safety and limitations

The database contains fictitious information; operational tools return only
non-PII order/product fields through parameterized read-only queries. Real
deployments require authentication and authorization before exposing actual
order status. No external network retrieval is performed by the lexical index.
Search retrieval quality will limit end-to-end accuracy, especially for
paraphrases; this is intentional and must be measured. The benchmark
does not guarantee equivalent model-specific sampling or tool support.

[MIT License](LICENSE).
