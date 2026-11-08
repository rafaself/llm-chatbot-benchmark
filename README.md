# Sonora End-to-End LLM Chatbot Benchmark

Compare Bedrock language models **as complete customer-support agents**, with the
same policy corpus, lexical document retrieval, read-only operational SQLite
database, prompts, tool interfaces, grading judge and runtime constraints.
Promptfoo measures final answers and the actual tool/retrieval trace; AI SDK
runs multi-step model/tool exchanges.

## What is measured

- Policy lookup, cross-section reasoning, conditional rules, calculations,
  operational tool calls, combined policy/database reasoning, clarifications,
  conversation history and robustness.
- Answer correctness and completeness (LLM rubric), faithfulness to evidence
  retrieved on this turn or an earlier turn (LLM rubric), and response
  directness (LLM rubric). Tool and section checks stay on the current turn.
- Deterministic tool name/argument validation and full required-section evidence
  coverage. Evidence recall measures what was **returned to the model**, not
  whether the model subsequently cited or used every passage.
- Latency, token usage and model steps in individual Promptfoo outputs.
  No cost estimate is presented as a billing record.

Policy: `datasets/sonora_store_policy.md`; fixed retrieval:
`src/retrieval.ts` (section-based BM25 lexical baseline returning the 10 highest-scoring sections, no external embeddings);
read-only customer-free tool outputs from
`datasets/sonora_store_database.sqlite` (seed SQL also provided).
The model chooses search queries and tool calls. The same retriever and data
are used for all candidates. This is a benchmark of the **full agent system**,
not an isolated language-model knowledge exam or a production-grade semantic RAG.
The system-prompt contracts, and the references they follow, are in
`docs/system-prompt.md`.

## Golden evaluation dataset

- `datasets/golden/development.jsonl` — 55 reviewed-source *draft* cases,
  used for development and prompt iteration.
- `datasets/golden/heldout.jsonl` — 9 additional cases reserved for
  release-candidate verification; do not tune against their case-level failures.
  As these cases live in a public repository, this is an organizational holdout,
  **not a confidential blind test**.
- `datasets/smoke.jsonl` — three offline fixture cases to verify plumbing.

Each JSONL line is one session: stable `id`, `category`, `difficulty`,
`capabilities`, optional `tags`, and ordered `turns`. Each turn has its own
`input`, `expected` object (`answer`, `required_facts`, `forbidden_claims`,
`tools`) and `retrieval.relevant_sections` with original policy subsection IDs.
The loader expands a session into Promptfoo tests that share
`metadata.conversationId`. Promptfoo scenario expansion is disabled so fact,
claim and section lists stay intact. There is no scripted assistant history. Prior
assistant text comes from the model's own `conversationOutput` through
Promptfoo's `_conversation` variable. The loader validates IDs, categories,
evidence references and duplicate session/turn IDs. **Gold data is passed to
Promptfoo's grader only, never to the model prompt.**

The reference answers are preliminary editorial labels and should be
reviewed by a second person before using benchmark results for decisions.

The `policy_multi_hop` category combines multiple policy sections. The
`cross_source` category requires both a read-only operational lookup and policy
evidence, so results can distinguish policy reasoning from policy-plus-database
workflows.

## Run

Requires Node.js 22.22+ and npm, with no separate Python installation.

```sh
npm ci
npm run check
npm run smoke

# No paid requests: inspect the generated config and case/attempt ceiling.
npm run preview -- --models nova-micro

# Opt-in paid run. Put Bedrock keys in .env (see .env.example). The runner loads
# that file; shell variables take precedence. Model and judge both use Bedrock.
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
steps per turn, concurrency 1, no retries, max 1024 generated tokens, and a
60-second per-step timeout. `--repeat` must stay 1: Promptfoo stores
`_conversation` by provider, prompt and `conversationId`, then runs every
repeat of a turn before the next turn, so a second repeat would pollute the
history. The conservative `--max-requests 500` upper bound counts graded
turns, not sessions: `turns × models × (max model steps + 3 rubric calls) ×
(retries + 1)`. This is **not** a monetary cap. A minimal three-turn
context-and-tool session is `datasets/context-session.jsonl`. Inspect
`config/models.json` and `docs/models.md` for model routes, judge
configuration and caveats.

## Scoring interpretation

- End-to-end turn success requires **all** assertions on that turn to pass.
  A strong directness score cannot compensate for unsupported or incorrect
  facts. Each turn is graded from its own tool trace and answer.
- Session success requires every turn in the `conversationId` to be present
  exactly once and to pass on its own. Turn scores are not averaged. The
  runner writes `sessions.json` beside the Promptfoo output.
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
