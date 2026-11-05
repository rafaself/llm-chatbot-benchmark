# Eval-driven development

Use this repository's root `promptfooconfig.yaml` as the canonical chatbot evaluation entrypoint. Keep application behavior, prompts, datasets, and evaluation criteria under version control.

## Workflow

1. **Write cases before changing behavior.** Add or refine JSONL cases first. Each case must have `input`, `expected_answer`, `expected_tool`, and `expected_category`. Make the answer reference and category specific enough to review; use a stable tool identifier (or an explicit no-tool value) for `expected_tool`. Cover ordinary requests, important edge cases, and each tool route.
2. **Capture a baseline before edits.** Inspect the current config, providers, dataset, and git revision. If a non-paid local model or prior real-model output is available, record an offline baseline and label its evidence source. If paid evaluation is unavailable, run the existing offline case/schema and deterministic checks, and compare with a versioned real-output snapshot if one exists. If there is no real-output baseline, say model-quality comparison is unavailable. Mocked or stubbed responses may verify plumbing only; never treat them as quality evidence.
3. **Evaluate every relevant change.** After changing prompts, tools, datasets, provider settings, the judge, rubric, or evaluation config, run the focused affected cases and then the full suite before accepting the change. Use the same case revision, provider/model, and criteria for a meaningful baseline comparison.
4. **Review regressions by category.** Compare overall and per-`expected_category` results, answer quality/directness, and tool selection. Investigate every regression and evaluation error; do not hide errors by dropping cases or changing expectations without checking the underlying source of truth.
5. **Keep a held-out set.** Separate development cases from held-out evaluation cases. Use development results while iterating; reserve held-out cases for a release-candidate check, and do not tune prompts, tools, or rubric thresholds against their individual failures. Include varied wording and cases beyond the examples used during development to limit overfitting.

## Evaluation criteria and evidence

- Use Promptfoo `llm-rubric` with the GPT-6.1 Sol judge to assess answer quality and directness against `expected_answer`.
- Check tool routing deterministically with `equals`: the selected tool must equal `expected_tool`. Do not delegate tool-selection correctness to the LLM judge.
- Version the rubric, pass thresholds, dataset, and provider/model configuration. Record the code revision, case/config revision, provider/model, judge, and run date with each reported comparison. Update criteria only with a documented reason, not just to turn a failure green.
- A mock, fixture, or offline plumbing check cannot establish live API success, provider behavior, or model answer quality. State clearly which evidence came from deterministic/offline checks and which came from a real model run.

## Running evaluations

From the repository root, activate `.venv`, inspect the central config and provider list, and use the existing runner and criteria.

```sh
git status --short
npm run check
npm run smoke
python -m benchmark.run --live --models nova-micro --prepare-only
```

Only run an evaluation that calls a paid external model when the user has explicitly opted into that run. A configured credential or a request to implement a change is not permission for paid calls. Once authorized, export a comparable result artifact:

```sh
python -m benchmark.run --live --allow-paid --models nova-micro
python -m benchmark.report results/NEW/result.json --baseline results/BASELINE/result.json
```

Compare that artifact with the captured baseline using the same criteria and inspect category-level failures, not only the aggregate score. Keep generated outputs out of source control unless the repository explicitly versions evaluation artifacts.

## Dependencies and security

- Ask before adding a production dependency unless it is highly consolidated, safe, and trustworthy. Prefer the repository's existing Python tooling and evaluation setup.
- Do not introduce security vulnerabilities. Keep credentials out of configs, datasets, logs, and reports; load them through the existing secret mechanism. If a necessary change creates a security concern, warn the root user and explain the risk.
