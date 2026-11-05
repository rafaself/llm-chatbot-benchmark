"""Tests for stdlib reporting of native Promptfoo result exports."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from benchmark.report import write_report


def assertion(metric: str, score: float, passed: bool, **extra: Any) -> dict[str, Any]:
    return {
        "assertion": {"metric": metric},
        "score": score,
        "pass": passed,
        **extra,
    }


def result(
    *,
    category: str = "factual",
    model: str = "model-a",
    components: list[dict[str, Any]] | None = None,
    success: bool | None = True,
    error: str | None = None,
    response: dict[str, Any] | None = None,
    latency_ms: float | None = 100,
    result_cost: float = 0,
    grading_cost: float | None = None,
    metadata: dict[str, Any] | None = None,
    failure_reason: str = "NONE",
) -> dict[str, Any]:
    grading: dict[str, Any] = {
        "pass": all(component.get("pass") is True for component in components or []),
        "score": 1.0,
        "componentResults": components or [],
    }
    if grading_cost is not None:
        grading["cost"] = grading_cost
    return {
        "provider": {"id": "custom-target", "label": model},
        "testCase": {"vars": {"expected_category": category}},
        "response": response or {"metadata": {"model_id": model}},
        "gradingResult": grading,
        "latencyMs": latency_ms,
        "cost": result_cost,
        "success": success,
        "error": error,
        "failureReason": failure_reason,
        "metadata": metadata or {},
    }


class ReportTests(unittest.TestCase):
    root: Path

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def write_export(
        self,
        name: str,
        rows: list[dict[str, Any]],
        metadata: dict[str, Any] | None = None,
    ) -> Path:
        run_dir = self.root / name
        run_dir.mkdir(parents=True)
        result_path = run_dir / "result.json"
        result_path.write_text(
            json.dumps(
                {
                    "results": {
                        "version": 3,
                        "timestamp": "2026-11-05T00:00:00Z",
                        "results": rows,
                    }
                }
            ),
            encoding="utf-8",
        )
        if metadata is not None:
            (run_dir / "metadata.json").write_text(
                json.dumps(metadata), encoding="utf-8"
            )
        return result_path

    def test_missing_metrics_are_zero_and_groups_include_coverage(self) -> None:
        rows = [
            result(
                components=[
                    assertion("answer_quality", 0.8, True),
                    assertion("answer_directness", 0.5, False),
                    assertion("tool_accuracy", 1.0, True),
                ]
            ),
            result(
                components=[
                    assertion("answer_quality", 0.4, False),
                    assertion("tool_accuracy", 0.0, False),
                ],
                success=False,
            ),
        ]
        path = self.write_export("scores", rows)

        summary = write_report(path)

        self.assertEqual(summary["result_count"], 2)
        self.assertEqual(len(summary["groups"]), 1)
        group = summary["groups"][0]
        self.assertEqual(group["model"], "model-a")
        self.assertEqual(group["category"], "factual")
        self.assertEqual(summary["model_summaries"][0]["result_count"], 2)
        self.assertEqual(
            summary["model_summaries"][0]["request_success_rate"]["rate"], 1.0
        )
        metrics = group["metrics"]
        self.assertAlmostEqual(metrics["answer_quality"]["mean"], 0.6)
        self.assertEqual(metrics["answer_quality"]["coverage"], 1.0)
        self.assertAlmostEqual(metrics["answer_directness"]["mean"], 0.25)
        self.assertEqual(metrics["answer_directness"]["coverage"], 0.5)
        self.assertEqual(metrics["tool_accuracy"]["mean"], 0.5)
        self.assertEqual(metrics["assertion_pass_rate"]["passed"], 2)
        self.assertEqual(metrics["assertion_pass_rate"]["expected"], 6)
        self.assertAlmostEqual(metrics["assertion_pass_rate"]["coverage"], 5 / 6)
        self.assertAlmostEqual(group["weighted_score"], 0.5)
        self.assertEqual((path.parent / "summary.json").exists(), True)
        self.assertEqual((path.parent / "summary.md").exists(), True)

    def test_latency_tokens_partial_costs_and_grader_costs_are_separate(self) -> None:
        rows = [
            result(
                components=[
                    assertion("answer_quality", 1.0, True, cost=0.01),
                    assertion("answer_directness", 1.0, True, cost=0.02),
                    assertion("tool_accuracy", 1.0, True),
                ],
                latency_ms=1000,
                response={
                    "metadata": {"model_id": "model-a"},
                    "cost": 0.02,
                    "tokenUsage": {"prompt": 10, "completion": 20},
                },
                grading_cost=0.03,
            ),
            result(
                components=[
                    {
                        **assertion("answer_quality", 0.0, False),
                        "assertion": {
                            "metric": "answer_quality",
                            "type": "llm-rubric",
                        },
                        "metadata": {"grading_cost_usd": 0.04},
                    },
                    {
                        **assertion("answer_directness", 0.7, True),
                        "assertion": {
                            "metric": "answer_directness",
                            "type": "llm-rubric",
                        },
                    },
                ],
                success=False,
                error="request timed out",
                latency_ms=2000,
                response={
                    "metadata": {"model_id": "model-a"},
                    "cost": 0.01,
                    "tokenUsage": {"prompt": 5, "total": 7},
                },
                failure_reason="ERROR",
            ),
        ]
        # This second row only exposes one of two component grader costs. The
        # first row's aggregate must not add its two child costs as well.
        path = self.write_export("usage", rows)

        summary = write_report(path)
        group = summary["groups"][0]

        self.assertEqual(group["latency_ms"]["p50"], 1000)
        self.assertEqual(group["latency_ms"]["p95"], 2000)
        self.assertEqual(
            group["latency_ms"]["method"].split(";")[0], "nearest-rank percentile"
        )
        tokens = group["token_usage"]
        self.assertEqual(tokens["prompt"]["reported_sum"], 15)
        self.assertEqual(tokens["completion"]["reported_sum"], 20)
        self.assertEqual(tokens["total"]["reported_sum"], 7)
        self.assertEqual(tokens["output_tokens_per_second"]["mean_per_response"], 20.0)
        self.assertEqual(group["inference_cost"]["reported_partial_sum_usd"], 0.03)
        self.assertEqual(group["inference_cost"]["coverage"], 1.0)
        self.assertEqual(
            group["inference_cost"]["average_per_successful_eval_usd"], 0.03
        )
        self.assertAlmostEqual(group["grading_cost"]["reported_partial_sum_usd"], 0.07)
        self.assertEqual(group["grading_cost"]["aggregate_cost_rows"], 1)
        self.assertEqual(group["grading_cost"]["component_cost_rows"], 1)
        self.assertEqual(group["grading_cost"]["component_costs_reported"], 1)
        self.assertEqual(group["grading_cost"]["expected_component_costs"], 2)
        self.assertEqual(group["grading_cost"]["component_cost_coverage"], 0.5)
        self.assertEqual(group["grading_cost"]["coverage"], 0.5)
        self.assertEqual(group["grading_cost"]["partial_results"], 1)
        self.assertEqual(group["request_success_rate"]["rate"], 0.5)
        model_summary = summary["model_summaries"][0]
        self.assertEqual(
            model_summary["inference_cost"]["reported_partial_sum_usd"], 0.03
        )
        self.assertEqual(model_summary["request_success_rate"]["rate"], 0.5)
        self.assertEqual(group["reliability"]["request_failures"], 1)
        self.assertEqual(group["reliability"]["timeouts"], 1)

    def test_fixture_scores_are_labeled_and_costs_do_not_use_aggregate_zero(
        self,
    ) -> None:
        path = self.write_export(
            "fixture",
            [
                result(
                    components=[
                        assertion(
                            "answer_quality",
                            1.0,
                            True,
                            metadata={"evidence": "fixture"},
                        ),
                        assertion(
                            "answer_directness",
                            1.0,
                            True,
                            metadata={"evidence": "fixture"},
                        ),
                        assertion("tool_accuracy", 1.0, True),
                    ],
                    response={"metadata": {"evidence": "fixture"}},
                    result_cost=0,
                    metadata={"evidence": "fixture"},
                )
            ],
            {"mode": "smoke", "evidence": "fixture", "models": ["offline-fixture"]},
        )

        summary = write_report(path)

        group = summary["groups"][0]
        self.assertEqual(summary["evidence"]["classification"], "fixture")
        self.assertFalse(summary["evidence"]["quality_evidence_available"])
        self.assertIsNone(group["inference_cost"]["reported_partial_sum_usd"])
        self.assertIsNone(group["inference_cost"]["average_per_successful_eval_usd"])
        self.assertIsNone(group["grading_cost"]["reported_partial_sum_usd"])
        markdown = (path.parent / "summary.md").read_text(encoding="utf-8")
        self.assertIn("Fixture run: wiring evidence only", markdown)
        self.assertIn("not model-quality evidence", markdown)

    def test_malformed_and_unsupported_tool_rows_are_retained(self) -> None:
        rows = [
            result(
                response={
                    "metadata": {"model_id": "model-a", "invalid_response": True},
                    "output": {"answer": ""},
                },
                components=[],
            ),
            result(
                category="tool_call",
                response={
                    "metadata": {"model_id": "model-a"},
                    "output": {
                        "answer": "I cannot access that tool.",
                        "actual_tool": None,
                        "tool_status": "unsupported",
                        "raw_tool_calls": [],
                    },
                },
                components=[],
                success=False,
            ),
        ]
        path = self.write_export("reliability", rows)

        summary = write_report(path)

        self.assertEqual(summary["result_count"], 2)
        groups = {group["category"]: group for group in summary["groups"]}
        self.assertEqual(
            groups["factual"]["reliability"]["invalid_or_malformed_responses"], 1
        )
        self.assertEqual(
            groups["tool_call"]["reliability"]["unsupported_tool_scenarios"], 1
        )
        self.assertEqual(groups["factual"]["metrics"]["answer_quality"]["mean"], 0.0)

    def test_comparison_requires_compatible_metadata_and_ignores_pacing(self) -> None:
        common_metadata: dict[str, Any] = {
            "mode": "live",
            "source_hashes": {
                "dataset": "d",
                "prompt": "p",
                "criteria": "c",
                "models": "m",
                "tools": "t",
                "adapter": "a",
            },
            "selected_cases_sha256": "selected-cases",
            "categories": ["factual"],
            "models": ["model-a"],
            "judge": {"id": "judge-model"},
            "promptfoo_version": "0.125.1",
            "parameters": {"max_tokens": 128, "concurrency": 1, "delay_ms": 0},
        }
        baseline_path = self.write_export(
            "baseline",
            [
                result(
                    components=[
                        assertion(metric, 0.5, False)
                        for metric in (
                            "answer_quality",
                            "answer_directness",
                            "tool_accuracy",
                        )
                    ]
                )
            ],
            common_metadata,
        )
        current_metadata = {
            **common_metadata,
            "parameters": {"max_tokens": 128, "concurrency": 4, "delay_ms": 20},
        }
        current_path = self.write_export(
            "current",
            [
                result(
                    components=[
                        assertion(metric, 1.0, True)
                        for metric in (
                            "answer_quality",
                            "answer_directness",
                            "tool_accuracy",
                        )
                    ]
                )
            ],
            current_metadata,
        )

        summary = write_report(current_path, baseline_path=baseline_path)

        comparison = summary["comparison"]
        self.assertTrue(comparison["compatible"])
        self.assertEqual(comparison["groups"][0]["status"], "matched")
        self.assertAlmostEqual(comparison["groups"][0]["delta"], 0.5)

        current_metadata["source_hashes"] = {
            **common_metadata["source_hashes"],
            "prompt": "changed",
        }
        (current_path.parent / "metadata.json").write_text(
            json.dumps(current_metadata), encoding="utf-8"
        )
        incompatible = write_report(current_path, baseline_path=baseline_path)
        self.assertTrue(incompatible["comparison"]["compatible"])
        self.assertEqual(
            incompatible["comparison"]["behavior_changes"][0]["source"], "prompt"
        )

        current_metadata["source_hashes"] = {
            **common_metadata["source_hashes"],
            "criteria": "changed",
        }
        (current_path.parent / "metadata.json").write_text(
            json.dumps(current_metadata), encoding="utf-8"
        )
        incompatible_criteria = write_report(current_path, baseline_path=baseline_path)
        self.assertFalse(incompatible_criteria["comparison"]["compatible"])
        self.assertIn(
            "source hash 'criteria' differs",
            incompatible_criteria["comparison"]["notes"],
        )


if __name__ == "__main__":
    unittest.main()
