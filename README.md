# LLM Chatbot Benchmark

A Python-first chatbot benchmark using **Promptfoo 0.125.1** as its evaluation engine. `promptfooconfig.yaml` owns the prompt, assertions, thresholds, and weights. Python validates datasets, prepares selected providers, records reproducibility metadata, and summarizes native results. A TypeScript bridge adds a bounded tool-result exchange around Promptfoo's native providers.

The default run is **offline**. Fixture responses and a fixture judge verify plumbing; their passing scores are not evidence of model quality. Live validation requires explicit paid-run opt-in and authenticated provider access. No target model has been live-validated in this checkout yet.

## Setup

Use Python 3.11+ and Node.js 22.22+ (Node 24 LTS recommended). Dependencies are pinned; PyYAML is the only Python runtime dependency and parsing uses `safe_load`.

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm test
npm run smoke
```

No credentials are needed for tests or smoke runs. The runner disables telemetry, update checks, sharing, and caching. It uses the installed CLI and never downloads a different version through `npx`.

## Authentication and live runs

Use the standard AWS SDK credential chain, preferably a dedicated profile permitted to invoke only the selected target and judge. Never store credentials in this repository. Cross-Region profiles need destination model permissions; service control policies and Marketplace access can independently block requests.

```sh
aws configure sso --profile benchmark
aws sso login --profile benchmark
export AWS_PROFILE=benchmark
export AWS_REGION=us-east-1
aws sts get-caller-identity

# Review resolved configuration without making model calls.
python -m benchmark.run --live --models nova-micro --prepare-only

# Paid: eight cases, at most 24 target requests and 16 judge requests.
python -m benchmark.run --live --allow-paid --models nova-micro

# Select categories/models and repeat to assess variability.
python -m benchmark.run --live --allow-paid --models nova-micro nova-lite \
  --category factual --category tool_call --repeat 3 --max-requests 200
```

`--allow-paid` opts into that invocation, including **GPT-6.1 Sol grading**. Each answer gets two rubric grades. The adapter also requires the runner's `BENCHMARK_ALLOW_PAID=1` guard; credentials alone never enable paid calls. The default conservative request ceiling is 200, including retries. This is a request-count guard, not a dollar budget. Review prepared `config.yaml` and `metadata.json` before spending.

| Environment variable | Purpose |
| --- | --- |
| `AWS_PROFILE` | AWS standard credential-chain profile |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Source region; default `us-east-1` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Optional standard SDK credentials; never put in files or command arguments |
| `OPENAI_API_KEY` | Only for explicit alternative `--judge-provider openai` |
| `PROMPTFOO_PYTHON` | Optional Python executable for direct Promptfoo dataset loading |

The judge is configured separately from targets and defaults to Bedrock Converse `us.openai.gpt-6.1-sol`. `--judge-provider openai` uses native `openai:responses:gpt-6.1-sol`. Neither route substitutes an unavailable model. All targets currently use Bedrock Converse. See [model compatibility and evidence](docs/models.md) for exact IDs, access limitations, and unverified capabilities.

## Execution and artifacts

Run `python -m benchmark.run --help` for all options. Defaults: one concurrent evaluation, one repeat, no retries, 60-second HTTP timeout, 1,024 output tokens, and at most three target turns. Targets share a prompt and tools. Temperature defaults to zero where supported; reasoning models retain their provider defaults. An explicit `--temperature` is rejected for GPT-6 and Haiku 5.5 rather than ignored. Deterministic settings do not guarantee identical outputs or reasoning budgets across architectures.

Use `--concurrency`, `--timeout-ms`, `--retries`, `--delay-ms`, `--max-tokens`, `--max-turns`, `--max-requests`, `--models`, and repeated `--category` flags. With concurrency 1, `--delay-ms` serially paces target and judge requests. At higher concurrency, it is a per-request delay, not a global requests-per-minute limiter. Bedrock timeout configuration applies to its AWS SDK HTTP handler, including connection timeout; authentication and retry backoff can extend total wall time. No extra benchmark retry loop duplicates SDK retries.

Every run creates a fresh timestamped `results/<UTC timestamp>/` directory. `--output` selects a new directory; existing directories are never overwritten.

- `config.yaml`, `tests.json`, `metadata.json`: resolved configuration, selected cases, exact identifiers, source hashes, git revision/dirty state, parameters, timestamps, and Promptfoo version.
- `result.json`: native assertions/explanations, provider usage, errors, raw tool calls, and provider turns.
- `summary.json`, `summary.md`: machine-readable metrics and model/category comparisons.
- `run.log`: CLI diagnostics, including failures.

Nonzero Promptfoo exit codes propagate. Assertion failures still produce inspectable results. A startup failure may only leave config/metadata/log files. Results can contain user messages and responses; they stay local and are ignored by Git by default.

After setup, the central config also runs directly with safe fixture defaults:

```sh
PROMPTFOO_CONFIG_DIR=.promptfoo PROMPTFOO_DISABLE_TELEMETRY=1 \
  PROMPTFOO_DISABLE_UPDATE=1 ./node_modules/.bin/promptfoo eval \
  -c promptfooconfig.yaml --no-cache --no-share --no-write -o /tmp/smoke.json
```

Use the Python runner for reproducibility metadata and reporting.

## Dataset and tools

`datasets/sample.jsonl` has eight development cases across `factual`, `tool_call`, `no_tool`, and `ambiguous`. Each line has exactly:

```json
{"item":{"input":"Can you check my order?","expected_answer":"Ask for the order ID.","expected_tool":"none","expected_category":"ambiguous"}}
```

The loader rejects missing/extra/duplicate keys, empty strings/files, unknown categories/tools, and duplicate inputs with line-numbered errors. It validates the whole dataset before filtering and converts items to Promptfoo variables/category metadata. Use `--dataset` for a separate file. Extend the explicit allowlists deliberately when adding tools/categories. Datasets contain no model-specific configuration.

Tools are local deterministic fixtures: Boston weather is sunny/18°C; order A100 is delivered; A200 is in transit. Unknown entities and invalid arguments return errors. The tool result is fed back to the model before final-answer grading. Targets never receive reference answers, expected tools, or grading criteria.

The exact tool-name comparison checks **all** calls, so duplicates and extra calls fail. Arguments affect tool results and answer quality, but this primary metric measures names only. Raw calls live in `response.output.raw_tool_calls`, with provider data in `response.metadata.turns`. No-call output normalizes to `none`; malformed responses, API errors, and unsupported exchanges have separate statuses/sentinels. An API error alone never establishes lack of model tool support. The pinned native parser cannot replay signed reasoning blocks; such exchanges are reported unsupported with raw data retained.

## Scoring and result interpretation

The three primary assertions are versioned in the central config:

| Metric | Assertion | Weight | Criteria |
| --- | --- | --- | --- |
| Answer quality | `llm-rubric` | 50% | Relevance and completeness together, essential facts, no unsupported claims |
| Answer directness | `llm-rubric` | 20% | Direct, appropriately concise, no repetition; missing essentials cap the score at 0.5 |
| Tool accuracy | `equals` | 30% | Exact normalized tool name(s) against `expected_tool`, including `none` |

Rubric grades range from 0 to 1 and pass at 0.8. Equality scores 0 or 1. Overall score is `0.5 × quality + 0.2 × directness + 0.3 × tool_accuracy`. A high weighted score can still fail if any assertion fails. Assertion pass rate counts individual assertions; evaluation pass rate requires all three. Missing grading outcomes have explicit coverage and contribute zero to the overall score rather than disappearing.

Reports include model/category breakdowns, request success, API errors/timeouts, malformed responses, unsupported scenarios, end-to-end target latency and p50/p95, input/output/total tokens, and output tokens per target second when measurable. Target latency includes tool/provider overhead and excludes judge time; throughput is not a streaming decode rate. The small dataset's percentiles are descriptive, not production estimates.

Provider token usage is measured when supplied. **Costs are estimates**, based on Promptfoo's pinned pricing tables, never billing records. Inference and grading costs are separate. Missing prices/usage stay `null` with coverage, never fabricated zero. Failed calls can be billed without returning usage, making known-cost subtotals incomplete. Average inference cost per successful evaluation needs sufficient cost coverage and a nonzero success count. Smoke fixtures provide no meaningful inference usage/cost or model-quality evidence, even if Promptfoo synthesizes zeros.

Record a baseline before changing behavior and compare model/category metrics with identical cases, prompt, tools, criteria, judge, and parameters. Use repeats for variability. Add independent held-out cases before drawing model-selection conclusions; the initial sample is development-only. See [AGENTS.md](AGENTS.md) for the evaluation-driven workflow.

## Layout and integration references

```text
promptfooconfig.yaml   # Central criteria and safe defaults
config/               # Model registry, separate judge, shared tools
datasets/             # Model-independent JSONL
prompts/              # Shared system/user prompt
benchmark/            # Python validation, configuration, execution, reporting
integrations/         # Native-provider tool exchange and normalization
tests/                # Offline validation and integration checks
results/              # Ignored timestamped runs
```

The bridge uses two narrow, tested hooks in pinned Promptfoo Converse to preserve raw messages and configure HTTP timeouts. Revalidate them before upgrading. Official references: [configuration](https://www.promptfoo.dev/docs/configuration/reference/), [Python dataset generation](https://www.promptfoo.dev/docs/configuration/test-cases/#python), [Bedrock Converse](https://www.promptfoo.dev/docs/providers/aws-bedrock/#converse-api), and [rubric grading](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/).
