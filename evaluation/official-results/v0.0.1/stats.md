# Benchmark statistics

List-price estimate checked 2026-11-07. Not an invoice. Assistant rows are the model under test. Judge rows are grading overhead.

## Results

| Scope | Passed | Failed | Errors | Total |
| --- | --- | --- | --- | --- |
| Turns | 307 | 271 | 2 | 580 |
| Model sessions | 293 | 255 | 2 | 550 |

Session counts group each conversation separately for each model (55 sessions × 10 models). The saved session summary merged identical conversation IDs across models, so these counts were recomputed from the raw result rows.

## Per model

| Model | Turn pass / fail / error | Responses / graded / attempted | Sessions passed / total | Target / judge / total est. USD | Input / output tokens | Provider requests / usage-missing turns | Median / max latency (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nova-micro | 5 / 52 / 1 | 57 / 57 / 58 | 4 / 55 | $0.011420 / $0.331007 / $0.342427 | 272,332 / 13,490 | 109 / 1 | 1.874 / 3.691 |
| nova-lite | 19 / 39 / 0 | 58 / 58 / 58 | 18 / 55 | $0.020791 / $0.312611 / $0.333402 | 301,051 / 11,361 | 116 / 0 | 2.175 / 4.160 |
| nemotron-nano | 21 / 37 / 0 | 58 / 58 / 58 | 20 / 55 | $0.013997 / $0.321662 / $0.335659 | 200,381 / 8,219 | 92 / 0 | 1.419 / 3.023 |
| nemotron-super | 26 / 32 / 0 | 58 / 58 / 58 | 25 / 55 | $0.046334 / $0.289779 / $0.336113 | 272,384 / 8,427 | 113 / 0 | 2.039 / 4.706 |
| gpt-oss-20b | 28 / 29 / 1 | 57 / 57 / 58 | 28 / 55 | $0.020751 / $0.259118 / $0.279869 | 220,454 / 17,725 | 111 / 1 | 2.277 / 60.863 |
| gpt-oss-120b | 34 / 24 / 0 | 58 / 58 / 58 | 32 / 55 | $0.044577 / $0.282410 / $0.326987 | 223,206 / 18,491 | 112 / 0 | 2.311 / 6.658 |
| qwen3-32b | 30 / 28 / 0 | 58 / 58 / 58 | 29 / 55 | $0.038629 / $0.276137 / $0.314766 | 231,914 / 6,399 | 110 / 0 | 1.785 / 3.415 |
| haiku-5.5 | 33 / 25 / 0 | 58 / 58 / 58 | 32 / 55 | $0.054296 / $0.317287 / $0.371583 | 396,677 / 19,382 | 109 / 0 | 4.068 / 6.407 |
| gpt-6-luna | 57 / 1 / 0 | 58 / 58 / 58 | 54 / 55 | $0.031873 / $0.232274 / $0.264147 | 243,365 / 9,276 | 119 / 0 | 1.998 / 6.318 |
| gpt-6.1-sol | 54 / 4 / 0 | 58 / 58 / 58 | 51 / 55 | $0.712787 / $0.251401 / $0.964188 | 285,514 / 7,696 | 127 / 0 | 3.470 / 6.957 |
| All models | 307 / 271 / 2 | 578 / 578 / 580 | 293 / 550 | $0.995455 / $2.873686 / $3.869141 | 2,647,278 / 120,466 | 1,118 / 2 | 2.142 / 60.863 |

Turn outcomes use Promptfoo pass, failed evaluation, and provider error classifications. The harness has no separate “partial” or human-reviewed state. Response / graded / attempted counts are non-empty final responses, rows with grading component results, and attempted turns. HTTP status codes were not recorded, so response completion is reported instead.

Estimated USD is target model / judge / combined list-price cost; no separate preflight cost is recorded. Provider requests use target `tokenUsage.numRequests`; usage-missing turns had attempted requests but no reported prompt or completion tokens. Latency is the recorded Promptfoo row latency in seconds.

## Time

| Metric | Value |
| --- | --- |
| Wall clock | 1 h 32 min 42.418 s (5,562,418 ms) |
| Latency mean | 2589 ms |
| Latency median | 2142 ms |
| Latency P95 | 4945 ms |
| Latency max | 60863 ms |

## Tokens

|  | Prompt | Completion | Total | Requests |
| --- | --- | --- | --- | --- |
| Assistant | 2647278 | 120466 | 2767744 | 1118 |
| Judge | 581037 | 145036 | 726073 | 1734 |
| Total | 3228315 | 265502 | 3493817 | 2852 |

## Estimated cost

|  | USD |
| --- | --- |
| Assistant | $0.995455 |
| Judge | $2.873686 |
| Total | $3.869141 |
| Mean per turn | $0.006671 |
| Median per turn | $0.005651 |
| P95 per turn | $0.014496 |
| Mean per session | $0.070348 |
| Repeat estimate | $3.869180 |

## Category

| Category | Passed | Not passed | Total | Mean latency | Assistant tokens | Judge tokens | Cost | Mean cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calculation_accuracy | 20 | 30 | 50 | 2969 ms | 305229 | 61321 | $0.352300 | $0.007046 |
| clarification_quality | 19 | 21 | 40 | 1593 ms | 103671 | 50656 | $0.224752 | $0.005619 |
| conversation_context | 23 | 37 | 60 | 2999 ms | 192717 | 82350 | $0.398103 | $0.006635 |
| cross_source_accuracy | 14 | 26 | 40 | 3195 ms | 252636 | 52129 | $0.310325 | $0.007758 |
| operational_accuracy | 33 | 17 | 50 | 1984 ms | 165854 | 69486 | $0.279580 | $0.005592 |
| policy_accuracy | 184 | 116 | 300 | 2686 ms | 1623365 | 356037 | $2.047182 | $0.006824 |
| robustness | 14 | 26 | 40 | 1919 ms | 124272 | 54094 | $0.256899 | $0.006422 |

## Conclusions

- **Quality on this development snapshot:** gpt-6-luna led with 57/58 passed turns (98.3%). gpt-6.1-sol followed with 54/58 (93.1%), while the next model, gpt-oss-120b, passed 34/58 (58.6%). Treat this as evidence about these 58 turns, not a general model ranking or held-out release result.
- **Judge caveat:** gpt-6.1-sol was also the judge for every model, including itself. Its score may benefit from judge/candidate alignment; use an independent judge or human review before making a final selection.
- **Areas to improve:** cross-source accuracy and robustness had the lowest pooled pass rates (14/40, 35% each); conversation context was 23/60 (38.3%). Grading comments repeatedly pointed to missing facts or qualifications, unsupported details, and verbose answers. Operational accuracy was strongest at 33/50 (66%).
- **Cost tradeoff:** gpt-6-luna's estimated combined model-plus-judge cost was $0.264 for 58 attempts, compared with $0.964 for gpt-6.1-sol. The full run estimate was $3.869, with $2.874 (74.3%) attributed to grading. These are list-price estimates, not billing records.
- **Run reliability:** 578/580 attempts produced graded responses; two ended in provider errors. Keep those availability failures distinct from answer-quality failures when comparing models.
