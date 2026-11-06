# LLM Chatbot Benchmark

Promptfoo evaluates answers and tool selection across Bedrock models. AI SDK
handles model requests, tool validation/execution, and bounded multi-step calls.
The project supplies the shared prompt, tools, model registry, and scenarios.

## Setup

Requires Node.js 22.22+; Python is not needed.

```sh
npm ci
npm run check
npm run smoke
```

`check` runs Prettier, ESLint, and strict TypeScript checks. `npm run format`
applies formatting. There is no separate unit-test suite.

`smoke` uses AI SDK's mock model and a fixture judge. It exercises the same tool
execution path and native Promptfoo assertions/exports without credentials or
API calls. Passing smoke scores establish wiring only, never model quality.

## Run

Use an existing AWS CLI profile or another standard AWS credential-chain source:

```sh
export AWS_PROFILE=benchmark
export AWS_REGION=us-east-1

# No API calls: inspect exact models, judge, criteria, and request ceiling.
npm run preview -- --models nova-micro nova-lite

# Paid: targets plus two GPT-6.1 Sol rubric grades per answer.
npm run benchmark -- --live --allow-paid --models nova-micro nova-lite
```

For a new profile, use `aws configure --profile benchmark` or AWS SSO. Credentials
stay outside this repository. Each paid invocation needs `--allow-paid`.

Defaults: Nova Micro, one repeat, concurrency 1, no retries, 1,024 output tokens,
60-second target-step timeout, and at most three model steps. The default
`--max-requests 200` is a conservative request ceiling including grading/retries,
not a dollar budget. Model and judge calls go directly to their configured
providers; Vercel hosting and AI Gateway are not involved.

```sh
npm run benchmark -- --help
npm run preview -- --models nova-micro --category tool_call
npm run preview -- --models nova-micro --dataset datasets/sample.jsonl
```

`--judge-provider openai` selects Promptfoo's native OpenAI judge and requires
`OPENAI_API_KEY`. Otherwise grading uses native Promptfoo Bedrock. Exact model
IDs and unverified tool routes are recorded in [docs/models.md](docs/models.md).
`--allow-unverified-tools` explicitly enables a capability probe for Qwen.
`--delay-ms` uses Promptfoo's delay between evaluations; it does not pace each
SDK tool step or impose a global request rate.

## Resources

| File | Purpose |
| --- | --- |
| `promptfooconfig.yaml` | Canonical Promptfoo rubrics, weights, thresholds, and safe defaults |
| `config/models.json` | Exact target IDs, model settings, and native judge providers |
| `prompts/chat.json` | Shared system/user prompt |
| `datasets/sample.jsonl` | Existing development scenarios; dataset design is deferred |
| `src/tools.ts` | Tool schemas and deterministic local implementations |
| `src/chatbot.ts` | Thin AI SDK adapter returning answers/tool calls to Promptfoo |
| `src/smoke.ts` | SDK mock model and offline fixture judge |
| `src/dataset.ts` | Zod validation and conversion of the existing JSONL format |
| `src/run.ts` | CLI options, resolved config, run metadata, and Promptfoo invocation |

Each JSONL line retains `{"item":{"input":"...","expected_answer":"...",
"expected_tool":"none","expected_category":"factual"}}`. The loader validates
schema and duplicate inputs before selection. Use another file with `--dataset`;
keep held-out scenarios separate when preparing a real model comparison.

Tools return fixed scenario data: Boston is sunny at 18 C, order A100 is delivered,
and A200 is in transit. AI SDK validates arguments and feeds tool results back to
the model. Targets receive only the rendered conversation and tools, never the
reference answers or grading criteria. All tool calls across all steps count,
including duplicates/extras; malformed calls and unfinished responses fail.

Scoring stays in Promptfoo: answer quality (50%), directness (20%), and exact tool
selection (30%). Both rubric grades pass at 0.8; a case passes when all three
assertions pass. No automatic tool-call repair is enabled.

## Results

Each run creates a new ignored `results/<timestamp>/` directory:

- `result.html`: native Promptfoo report to inspect models and individual cases.
- `result.json`: native scores, explanations, errors, SDK steps, calls, and usage.
- `config.yaml`: resolved providers, scenarios, and criteria.
- `metadata.json`: run dates, code revision/dirty state, source hashes, library
  versions, selected models, judge, parameters, and process exit code.
- `run.log`: Promptfoo diagnostics.

Preview writes configuration/metadata only. Existing result directories are never
overwritten. Failed runs preserve diagnostics and return a nonzero exit code.
Artifacts may contain scenario/response content and should be shared accordingly.

Compare models in one run where possible. Across runs, check matching cases,
criteria, model/judge IDs, and parameters; inspect category-level failures too.
AI SDK reports usage when available. Target pricing is not estimated here;
missing costs are unknown. Judge cost estimates, if supplied by Promptfoo, are
not billing records. No real-model baseline exists, and the migrated provider
routes have not been live-validated.

[MIT license](LICENSE).
