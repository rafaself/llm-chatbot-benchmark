"""Summarize native Promptfoo JSON exports without external dependencies."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

METRICS = ("answer_quality", "answer_directness", "tool_accuracy")
_WEIGHTS = {
    "answer_quality": 0.5,
    "answer_directness": 0.2,
    "tool_accuracy": 0.3,
}
_COMPATIBLE_HASHES = (
    "dataset",
    "prompt",
    "criteria",
    "models",
    "tools",
    "adapter",
)
_BEHAVIOR_HASHES = ("prompt", "models", "tools", "adapter")
_IGNORED_PARAMETER_KEYS = frozenset({"concurrency", "delay", "delay_ms"})
_OUTPUT_FIELDS = ("answer", "actual_tool", "tool_status", "raw_tool_calls")
_BILLABLE_ASSERTION_TYPES = frozenset(
    {
        "agent-rubric",
        "g-eval",
        "llm-rubric",
        "model-graded-closedqa",
        "model-graded-factuality",
    }
)


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value):
        return None
    return value


def _string(value: Any, default: str = "") -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return default


def _read_results(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read Promptfoo JSON export {path}: {exc}") from exc
    if not isinstance(document, dict):
        raise TypeError("Promptfoo export root must be a JSON object")

    result_container = document.get("results")
    if isinstance(result_container, dict):
        rows = result_container.get("results")
    elif isinstance(result_container, list):
        # Also accept the EvaluateSummary itself for callers that saved that
        # object directly rather than the enclosing OutputFile.
        rows = result_container
    else:
        rows = None
    if not isinstance(rows, list):
        raise TypeError("Promptfoo export must contain results.results as an array")

    parsed_rows: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise TypeError(f"Promptfoo result at index {index} must be an object")
        parsed_rows.append(row)
    return document, parsed_rows


def _metadata_path(result_path: Path) -> Path:
    return result_path.with_name("metadata.json")


def _read_metadata(result_path: Path) -> tuple[dict[str, Any] | None, str | None]:
    path = _metadata_path(result_path)
    if not path.exists():
        return None, "metadata.json was not found beside the result export"
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"metadata.json could not be read: {exc}"
    if not isinstance(metadata, dict):
        return None, "metadata.json root must be a JSON object"
    return metadata, None


def _safe_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if metadata is None:
        return None
    # Keep run identity useful while avoiding copying arbitrary configuration,
    # credentials, or environment-derived values into the report.
    keys = (
        "mode",
        "created_at",
        "git_revision",
        "source_hashes",
        "models",
        "categories",
        "promptfoo_version",
    )
    return {key: metadata[key] for key in keys if key in metadata}


def _evidence_summary(
    rows: Sequence[Mapping[str, Any]], metadata: Mapping[str, Any] | None
) -> dict[str, Any]:
    evidence_markers: set[str] = set()
    if metadata is not None:
        evidence_markers.add(_string(metadata.get("evidence")).casefold())
        models = metadata.get("models")
        if isinstance(models, list):
            evidence_markers.update(_string(model).casefold() for model in models)
    for row in rows:
        provider = _as_mapping(row.get("provider"))
        result_metadata = _as_mapping(row.get("metadata"))
        response_metadata = _as_mapping(
            _as_mapping(row.get("response")).get("metadata")
        )
        evidence_markers.update(
            marker
            for marker in (
                _string(provider.get("id")).casefold(),
                _string(provider.get("label")).casefold(),
                _string(result_metadata.get("evidence")).casefold(),
                _string(response_metadata.get("evidence")).casefold(),
            )
            if marker
        )
        grading = _as_mapping(row.get("gradingResult"))
        components = grading.get("componentResults")
        if isinstance(components, list):
            evidence_markers.update(
                marker
                for component in components
                if (
                    marker := _string(
                        _as_mapping(_as_mapping(component).get("metadata")).get(
                            "evidence"
                        )
                    ).casefold()
                )
            )

    fixture_markers = {
        "fixture",
        "offline-fixture",
        "mock",
        "mocked",
        "stub",
        "stubbed",
    }
    is_fixture = any(
        marker in fixture_markers or marker.endswith("-fixture")
        for marker in evidence_markers
    )
    if not is_fixture and metadata is not None:
        is_fixture = (
            _string(metadata.get("mode")).casefold() == "smoke"
            and _string(metadata.get("evidence")).casefold() == "unexecuted"
        )

    if is_fixture:
        return {
            "classification": "fixture",
            "quality_evidence_available": False,
            "note": (
                "Fixture results validate evaluation wiring only; their scores are "
                "not model-quality evidence."
            ),
        }
    if metadata is not None and _string(metadata.get("mode")).casefold() == "live":
        live_rows = 0
        for row in rows:
            response = _as_mapping(row.get("response"))
            response_metadata = _as_mapping(response.get("metadata"))
            if (
                _string(response_metadata.get("evidence")).casefold() == "live"
                and not _string(response.get("error"))
                and not _invalid_response(row)
            ):
                live_rows += 1
        if live_rows:
            return {
                "classification": "live",
                "quality_evidence_available": True,
                "valid_live_responses": live_rows,
                "note": "At least one valid live model response is present.",
            }
        return {
            "classification": "live_attempt",
            "quality_evidence_available": False,
            "valid_live_responses": 0,
            "note": "No valid live model response is present in this export.",
        }
    return {
        "classification": "unknown",
        "quality_evidence_available": False,
        "note": (
            "Run evidence was not identified; do not claim model quality from "
            "these scores."
        ),
    }


def _model_identity(result: Mapping[str, Any]) -> tuple[str, str, str]:
    response = _as_mapping(result.get("response"))
    response_metadata = _as_mapping(response.get("metadata"))
    result_metadata = _as_mapping(result.get("metadata"))
    provider = _as_mapping(result.get("provider"))
    model = (
        _string(response_metadata.get("model_id"))
        or _string(result_metadata.get("model_id"))
        or _string(provider.get("label"))
        or _string(provider.get("id"), "unknown")
    )
    provider_id = _string(provider.get("id"), "unknown")
    provider_label = _string(provider.get("label"), provider_id)
    return model, provider_id, provider_label


def _category(result: Mapping[str, Any]) -> str:
    test_case = _as_mapping(result.get("testCase"))
    variables = _as_mapping(test_case.get("vars"))
    value = _string(variables.get("expected_category"))
    if value:
        return value
    test_metadata = _as_mapping(test_case.get("metadata"))
    result_metadata = _as_mapping(result.get("metadata"))
    return (
        _string(test_metadata.get("category"))
        or _string(result_metadata.get("expected_category"))
        or _string(result_metadata.get("category"), "unknown")
    )


def _metric_outcomes(result: Mapping[str, Any]) -> dict[str, list[Mapping[str, Any]]]:
    grading = _as_mapping(result.get("gradingResult"))
    components = grading.get("componentResults")
    if not isinstance(components, list):
        components = []
    # The top-level assertion is a useful fallback for one-assertion evals;
    # when components exist, they are the authoritative named outcomes.
    if not components and grading.get("assertion") is not None:
        components = [grading]

    outcomes: dict[str, list[Mapping[str, Any]]] = {metric: [] for metric in METRICS}
    for component in components:
        component_mapping = _as_mapping(component)
        assertion = _as_mapping(component_mapping.get("assertion"))
        metric = assertion.get("metric")
        if metric in outcomes:
            outcomes[metric].append(component_mapping)
    return outcomes


def _case_metric(outcomes: Sequence[Mapping[str, Any]]) -> tuple[bool, float, bool]:
    """Return outcome presence, per-case mean score, and strict pass status."""
    scores: list[float] = []
    passes: list[bool] = []
    for outcome in outcomes:
        score = _number(outcome.get("score"))
        passed = outcome.get("pass")
        if score is not None:
            scores.append(float(score))
        elif isinstance(passed, bool):
            scores.append(1.0 if passed else 0.0)
        if isinstance(passed, bool):
            passes.append(passed)
        else:
            passes.append(False)
    if not scores:
        return False, 0.0, False
    return True, sum(scores) / len(scores), all(passes)


def _latency(result: Mapping[str, Any]) -> float | None:
    latency = _number(result.get("latencyMs"))
    if latency is None:
        latency = _number(_as_mapping(result.get("response")).get("latencyMs"))
    return latency if latency is not None and latency >= 0 else None


def _token_usage(result: Mapping[str, Any]) -> Mapping[str, Any]:
    # Use response-level usage so grader tokens are not included in inference
    # token totals. The target provider's response is the inference boundary.
    return _as_mapping(_as_mapping(result.get("response")).get("tokenUsage"))


def _cost_value(value: Any) -> float | None:
    number = _number(value)
    return float(number) if number is not None and number >= 0 else None


def _component_grading_cost(component: Mapping[str, Any]) -> float | None:
    direct_cost = _cost_value(component.get("cost"))
    if direct_cost is not None:
        return direct_cost
    metadata = _as_mapping(component.get("metadata"))
    return _cost_value(metadata.get("grading_cost_usd"))


def _is_billable_grader_component(component: Mapping[str, Any]) -> bool:
    assertion = _as_mapping(component.get("assertion"))
    assertion_type = _string(assertion.get("type"))
    metric = _string(assertion.get("metric"))
    return assertion_type in _BILLABLE_ASSERTION_TYPES or metric in {
        "answer_quality",
        "answer_directness",
    }


def _grading_cost(
    result: Mapping[str, Any],
) -> tuple[float | None, str | None, int, int, bool]:
    grading = _as_mapping(result.get("gradingResult"))
    aggregate_cost = _cost_value(grading.get("cost"))
    if aggregate_cost is not None:
        # Promptfoo/custom graders may expose both an aggregate and child costs.
        # Prefer the aggregate so the same grading call is not counted twice.
        return aggregate_cost, "aggregate", 1, 1, True

    components = grading.get("componentResults")
    if not isinstance(components, list):
        return None, None, 0, 0, False
    component_mappings = [_as_mapping(component) for component in components]
    expected = [
        component
        for component in component_mappings
        if _is_billable_grader_component(component)
    ]
    if not expected:
        # Allow other explicitly priced grader assertions while keeping known
        # deterministic assertions such as `equals` out of cost coverage.
        expected = [
            component
            for component in component_mappings
            if _component_grading_cost(component) is not None
        ]
    if not expected:
        return None, None, 0, 0, False

    component_costs = [_component_grading_cost(component) for component in expected]
    known_costs = [cost for cost in component_costs if cost is not None]
    if not known_costs:
        return None, None, len(expected), 0, False
    return (
        sum(known_costs),
        "components",
        len(expected),
        len(known_costs),
        len(known_costs) == len(expected),
    )


def _nonempty_marker(value: Any) -> bool:
    if value is None or value is False or value == 0:
        return False
    if isinstance(value, str):
        return value.strip().casefold() not in {"", "false", "no", "none", "null"}
    return True


def _invalid_response(result: Mapping[str, Any]) -> bool:
    response = _as_mapping(result.get("response"))
    response_metadata = _as_mapping(response.get("metadata"))
    result_metadata = _as_mapping(result.get("metadata"))
    output = response.get("output")
    output_mapping = _as_mapping(output)
    explicit_invalid = any(
        _nonempty_marker(source.get("invalid_response"))
        for source in (response_metadata, result_metadata, output_mapping)
    )
    if explicit_invalid:
        return True

    # The custom benchmark target returns a structured object. If it reached a
    # response object but violated that contract, keep it as malformed data.
    if isinstance(output, dict):
        if any(field not in output for field in _OUTPUT_FIELDS):
            return True
        if not isinstance(output.get("answer"), str) or not output["answer"].strip():
            return True
        if not isinstance(output.get("raw_tool_calls"), list):
            return True
        if output.get("actual_tool") is not None and not isinstance(
            output.get("actual_tool"), str
        ):
            return True
        if output.get("tool_status") is not None and not isinstance(
            output.get("tool_status"), str
        ):
            return True
    return False


def _tool_status(result: Mapping[str, Any]) -> str:
    response = _as_mapping(result.get("response"))
    output = _as_mapping(response.get("output"))
    response_metadata = _as_mapping(response.get("metadata"))
    result_metadata = _as_mapping(result.get("metadata"))
    return (
        (
            _string(output.get("tool_status"))
            or _string(response_metadata.get("tool_status"))
            or _string(result_metadata.get("tool_status"))
        )
        .casefold()
        .replace("_", " ")
        .replace("-", " ")
    )


def _failure_details(result: Mapping[str, Any]) -> dict[str, bool]:
    response = _as_mapping(result.get("response"))
    grading = _as_mapping(result.get("gradingResult"))
    failure_reason = _string(result.get("failureReason"))
    error_text = " ".join(
        part
        for part in (
            _string(result.get("error")),
            _string(response.get("error")),
            failure_reason,
        )
        if part
    )
    normalized_error = error_text.casefold()
    request_failure = bool(
        _string(result.get("error")) or _string(response.get("error"))
    )
    request_failure = request_failure or "error" in failure_reason.casefold()
    response_present = isinstance(result.get("response"), Mapping)
    request_status_known = request_failure or response_present
    request_succeeded = response_present and not request_failure
    timeout = "timeout" in normalized_error or "timed out" in normalized_error

    metric_outcomes = _metric_outcomes(result)
    explicit_metric_failure = any(
        outcome.get("pass") is False
        for outcomes in metric_outcomes.values()
        for outcome in outcomes
    )
    assertion_failure = explicit_metric_failure or grading.get("pass") is False
    assertion_failure = assertion_failure and not request_failure
    result_failed = result.get("success") is False
    other_failure = result_failed and not request_failure and not assertion_failure
    status = _tool_status(result)
    unsupported_tool = status in {
        "unsupported",
        "unsupported tool",
        "unsupported capability",
        "tool unsupported",
    }
    return {
        "success": result.get("success") is True,
        "failed": result_failed,
        "request_failure": request_failure,
        "request_status_known": request_status_known,
        "request_succeeded": request_succeeded,
        "assertion_failure": assertion_failure,
        "other_failure": other_failure,
        "timeout": timeout,
        "invalid_response": _invalid_response(result),
        "unsupported_tool": unsupported_tool,
    }


def _percentile_nearest_rank(
    values: Sequence[float], percentile: float
) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def _coverage(covered: int, total: int) -> float:
    return covered / total if total else 0.0


def _sum_if_known(values: Sequence[float]) -> float | None:
    return sum(values) if values else None


def _summarize_group(
    model: str, category: str, items: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    result_count = len(items)
    metric_scores = {metric: 0.0 for metric in METRICS}
    metric_covered = {metric: 0 for metric in METRICS}
    metric_passed = {metric: 0 for metric in METRICS}

    reliability = {
        "result_count": result_count,
        "successful_results": 0,
        "failed_results": 0,
        "unknown_status_results": 0,
        "request_failures": 0,
        "request_status_known": 0,
        "request_successes": 0,
        "assertion_failure_results": 0,
        "other_failures": 0,
        "timeouts": 0,
        "invalid_or_malformed_responses": 0,
        "unsupported_tool_scenarios": 0,
    }
    latencies: list[float] = []
    token_values: dict[str, list[float]] = {
        key: [] for key in ("prompt", "completion", "total")
    }
    token_reported: dict[str, int] = dict.fromkeys(token_values, 0)
    output_token_rates: list[float] = []
    inference_costs: list[float] = []
    grading_costs: list[float] = []
    grading_cost_rows = 0
    grading_aggregate_rows = 0
    grading_component_rows = 0
    grading_eligible_rows = 0
    grading_fully_covered_rows = 0
    grading_partial_rows = 0
    expected_component_costs = 0
    reported_component_costs = 0
    provider_ids: set[str] = set()
    provider_labels: set[str] = set()

    for result in items:
        _, provider_id, provider_label = _model_identity(result)
        provider_ids.add(provider_id)
        provider_labels.add(provider_label)

        outcomes = _metric_outcomes(result)
        case_values: dict[str, tuple[bool, float, bool]] = {
            metric: _case_metric(outcomes[metric]) for metric in METRICS
        }
        for metric, (present, score, passed) in case_values.items():
            # A missing named outcome remains a zero in the denominator.
            metric_scores[metric] += score if present else 0.0
            metric_covered[metric] += int(present)
            metric_passed[metric] += int(present and passed)

        failure = _failure_details(result)
        if failure["success"]:
            reliability["successful_results"] += 1
        elif failure["failed"]:
            reliability["failed_results"] += 1
        else:
            reliability["unknown_status_results"] += 1
        reliability["request_failures"] += int(failure["request_failure"])
        reliability["request_status_known"] += int(failure["request_status_known"])
        reliability["request_successes"] += int(failure["request_succeeded"])
        reliability["assertion_failure_results"] += int(failure["assertion_failure"])
        reliability["other_failures"] += int(failure["other_failure"])
        reliability["timeouts"] += int(failure["timeout"])
        reliability["invalid_or_malformed_responses"] += int(
            failure["invalid_response"]
        )
        reliability["unsupported_tool_scenarios"] += int(failure["unsupported_tool"])

        latency = _latency(result)
        if latency is not None:
            latencies.append(latency)

        usage = _token_usage(result)
        for field in ("prompt", "completion", "total"):
            value = _number(usage.get(field))
            if value is not None and value >= 0:
                token_values[field].append(float(value))
                token_reported[field] += 1
        completion = _number(usage.get("completion"))
        if (
            completion is not None
            and completion >= 0
            and latency is not None
            and latency > 0
        ):
            output_token_rates.append(float(completion) / (latency / 1000.0))

        response = _as_mapping(result.get("response"))
        response_cost = _cost_value(response.get("cost"))
        if response_cost is not None:
            inference_costs.append(response_cost)

        (
            grading_cost,
            cost_source,
            expected_components,
            reported_components,
            fully_covered,
        ) = _grading_cost(result)
        if cost_source is not None or expected_components:
            grading_eligible_rows += 1
            grading_fully_covered_rows += int(fully_covered)
            grading_partial_rows += int(
                cost_source == "components"
                and reported_components > 0
                and not fully_covered
            )
        if cost_source != "aggregate":
            expected_component_costs += expected_components
            reported_component_costs += reported_components
        if grading_cost is not None:
            grading_costs.append(grading_cost)
            grading_cost_rows += 1
            if cost_source == "aggregate":
                grading_aggregate_rows += 1
            elif cost_source == "components":
                grading_component_rows += 1

    metrics: dict[str, Any] = {}
    for metric in METRICS:
        metrics[metric] = {
            "mean": metric_scores[metric] / result_count if result_count else 0.0,
            "covered_results": metric_covered[metric],
            "total_results": result_count,
            "coverage": _coverage(metric_covered[metric], result_count),
            "passing_results": metric_passed[metric],
        }
    expected_assertions = result_count * len(METRICS)
    passed_assertions = sum(metric_passed.values())
    metrics["assertion_pass_rate"] = {
        "rate": _coverage(passed_assertions, expected_assertions),
        "passed": passed_assertions,
        "expected": expected_assertions,
        "covered": sum(metric_covered.values()),
        "coverage": _coverage(sum(metric_covered.values()), expected_assertions),
    }
    weighted_score = sum(
        _WEIGHTS[metric] * metrics[metric]["mean"] for metric in METRICS
    )

    token_summary: dict[str, Any] = {}
    for field, values in token_values.items():
        token_summary[field] = {
            "reported_sum": _sum_if_known(values),
            "reported_results": token_reported[field],
            "total_results": result_count,
            "coverage": _coverage(token_reported[field], result_count),
        }
    token_summary["output_tokens_per_second"] = {
        "mean_per_response": (
            sum(output_token_rates) / len(output_token_rates)
            if output_token_rates
            else None
        ),
        "reported_results": len(output_token_rates),
        "total_results": result_count,
        "coverage": _coverage(len(output_token_rates), result_count),
        "definition": (
            "arithmetic mean of completion tokens divided by response latency "
            "in seconds; includes harness overhead and is not streaming speed"
        ),
    }

    average_success_cost = None
    full_inference_cost_coverage = (
        result_count > 0 and len(inference_costs) == result_count
    )
    successful_results = reliability["successful_results"]
    if full_inference_cost_coverage and successful_results > 0:
        average_success_cost = sum(inference_costs) / successful_results

    return {
        "model": model,
        "category": category,
        "provider_ids": sorted(provider_ids),
        "provider_labels": sorted(provider_labels),
        "result_count": result_count,
        "metrics": metrics,
        "weighted_score": weighted_score,
        "reliability": reliability,
        "request_success_rate": {
            "rate": (
                _coverage(
                    reliability["request_successes"],
                    reliability["request_status_known"],
                )
                if reliability["request_status_known"]
                else None
            ),
            "successful_requests": reliability["request_successes"],
            "known_requests": reliability["request_status_known"],
            "total_results": result_count,
            "coverage": _coverage(reliability["request_status_known"], result_count),
        },
        "latency_ms": {
            "p50": _percentile_nearest_rank(latencies, 0.50),
            "p95": _percentile_nearest_rank(latencies, 0.95),
            "reported_results": len(latencies),
            "total_results": result_count,
            "coverage": _coverage(len(latencies), result_count),
            "method": (
                "nearest-rank percentile; includes failed responses when "
                "latency is present"
            ),
        },
        "token_usage": token_summary,
        "inference_cost": {
            "source": "response.cost",
            "reported_partial_sum_usd": _sum_if_known(inference_costs),
            "reported_results": len(inference_costs),
            "total_results": result_count,
            "coverage": _coverage(len(inference_costs), result_count),
            "cost_coverage_complete": full_inference_cost_coverage,
            "successful_results": successful_results,
            "average_per_successful_eval_usd": average_success_cost,
            "average_definition": (
                "total inference cost for all evaluated rows divided by fully "
                "successful results; available only with complete inference-cost "
                "coverage and at least one successful result"
            ),
        },
        "grading_cost": {
            "reported_partial_sum_usd": _sum_if_known(grading_costs),
            "reported_results": grading_cost_rows,
            "total_results": result_count,
            "reported_coverage": _coverage(grading_cost_rows, result_count),
            "eligible_results": grading_eligible_rows,
            "fully_covered_results": grading_fully_covered_rows,
            "partial_results": grading_partial_rows,
            "coverage": (
                _coverage(grading_fully_covered_rows, grading_eligible_rows)
                if grading_eligible_rows
                else None
            ),
            "aggregate_cost_rows": grading_aggregate_rows,
            "component_cost_rows": grading_component_rows,
            "component_costs_reported": reported_component_costs,
            "expected_component_costs": expected_component_costs,
            "component_cost_coverage": (
                _coverage(reported_component_costs, expected_component_costs)
                if expected_component_costs
                else None
            ),
            "aggregation_rule": (
                "use gradingResult.cost when present; otherwise sum known "
                "component.cost or component.metadata.grading_cost_usd values; "
                "component coverage shows missing rubric cost data"
            ),
        },
    }


def _build_summary(
    document: Mapping[str, Any],
    rows: Sequence[Mapping[str, Any]],
    result_path: Path,
    metadata: Mapping[str, Any] | None,
    metadata_warning: str | None,
) -> dict[str, Any]:
    grouped: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
    model_grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        model, _, _ = _model_identity(row)
        grouped[(model, _category(row))].append(row)
        model_grouped[model].append(row)

    groups = [
        _summarize_group(model, category, grouped[(model, category)])
        for model, category in sorted(grouped)
    ]
    model_summaries = [
        _summarize_group(model, "all", model_grouped[model])
        for model in sorted(model_grouped)
    ]
    eval_summary = _as_mapping(document.get("results"))
    timestamp = _string(eval_summary.get("timestamp"))
    if not timestamp and metadata is not None:
        timestamp = _string(metadata.get("created_at"))
    summary: dict[str, Any] = {
        "schema_version": 1,
        "source_file": result_path.name,
        "timestamp": timestamp or None,
        "result_count": len(rows),
        "model_summaries": model_summaries,
        "groups": groups,
        "evidence": _evidence_summary(rows, metadata),
        "metadata": _safe_metadata(metadata),
        "warnings": [metadata_warning] if metadata_warning else [],
    }
    return summary


def _comparison_mismatches(
    current: Mapping[str, Any] | None, baseline: Mapping[str, Any] | None
) -> list[str]:
    if current is None or baseline is None:
        return ["metadata.json is required beside both result files"]
    mismatches: list[str] = []
    if current.get("mode") != baseline.get("mode"):
        mismatches.append("run mode differs")

    current_hashes = _as_mapping(current.get("source_hashes"))
    baseline_hashes = _as_mapping(baseline.get("source_hashes"))
    for key in _COMPATIBLE_HASHES:
        if key not in current_hashes or key not in baseline_hashes:
            mismatches.append(f"source hash '{key}' is missing")
        elif (
            key in {"dataset", "criteria"}
            and current_hashes[key] != baseline_hashes[key]
        ):
            mismatches.append(f"source hash '{key}' differs")

    if not current.get("selected_cases_sha256") or not baseline.get(
        "selected_cases_sha256"
    ):
        mismatches.append("selected case hash is missing")
    elif current.get("selected_cases_sha256") != baseline.get("selected_cases_sha256"):
        mismatches.append("selected cases differ")
    if current.get("categories") != baseline.get("categories"):
        mismatches.append("selected categories differ")

    current_models = current.get("models")
    baseline_models = baseline.get("models")
    if current_models != baseline_models:
        mismatches.append("model list differs")
    if current.get("judge") != baseline.get("judge"):
        mismatches.append("judge configuration differs")
    if current.get("promptfoo_version") != baseline.get("promptfoo_version"):
        mismatches.append("Promptfoo version differs")
    if current.get("evidence") == "fixture" or baseline.get("evidence") == "fixture":
        mismatches.append("fixture results cannot be used for model-quality comparison")

    current_parameters = _as_mapping(current.get("parameters"))
    baseline_parameters = _as_mapping(baseline.get("parameters"))
    current_comparable_parameters = {
        key: value
        for key, value in current_parameters.items()
        if key not in _IGNORED_PARAMETER_KEYS
    }
    baseline_comparable_parameters = {
        key: value
        for key, value in baseline_parameters.items()
        if key not in _IGNORED_PARAMETER_KEYS
    }
    if current_comparable_parameters != baseline_comparable_parameters:
        mismatches.append("comparable parameters differ")
    return mismatches


def _behavior_hash_changes(
    current: Mapping[str, Any] | None, baseline: Mapping[str, Any] | None
) -> list[dict[str, str]]:
    current_hashes = _as_mapping(_as_mapping(current).get("source_hashes"))
    baseline_hashes = _as_mapping(_as_mapping(baseline).get("source_hashes"))
    changes = []
    for key in _BEHAVIOR_HASHES:
        current_hash = current_hashes.get(key)
        baseline_hash = baseline_hashes.get(key)
        if (
            current_hash != baseline_hash
            and current_hash is not None
            and baseline_hash is not None
        ):
            changes.append(
                {
                    "source": key,
                    "baseline_hash": str(baseline_hash),
                    "current_hash": str(current_hash),
                }
            )
    return changes


def _compare_summaries(
    current_summary: Mapping[str, Any],
    baseline_summary: Mapping[str, Any],
    baseline_path: Path,
    mismatches: Sequence[str],
    behavior_changes: Sequence[Mapping[str, str]],
) -> dict[str, Any]:
    comparison: dict[str, Any] = {
        "baseline_file": baseline_path.name,
        "compatible": not mismatches,
        "notes": list(mismatches),
        "behavior_changes": list(behavior_changes),
        "score": "weighted_score only; current minus baseline",
        "groups": [],
    }
    if mismatches:
        return comparison

    current_groups = {
        (group["model"], group["category"]): group
        for group in current_summary.get("groups", [])
    }
    baseline_groups = {
        (group["model"], group["category"]): group
        for group in baseline_summary.get("groups", [])
    }
    for key in sorted(set(current_groups) | set(baseline_groups)):
        current_group = current_groups.get(key)
        baseline_group = baseline_groups.get(key)
        current_score = current_group.get("weighted_score") if current_group else None
        baseline_score = (
            baseline_group.get("weighted_score") if baseline_group else None
        )
        if current_group is None:
            status = "missing_current_group"
            delta = None
        elif baseline_group is None:
            status = "new_current_group"
            delta = None
        elif current_score is None or baseline_score is None:
            status = "missing_score"
            delta = None
        else:
            status = "matched"
            delta = current_score - baseline_score
        comparison["groups"].append(
            {
                "model": key[0],
                "category": key[1],
                "status": status,
                "current_weighted_score": current_score,
                "baseline_weighted_score": baseline_score,
                "delta": delta,
            }
        )
    return comparison


def _format_rate(value: Any) -> str:
    return "n/a" if value is None else f"{value:.3f}"


def _metric_cell(metrics: Mapping[str, Any], metric: str) -> str:
    summary = _as_mapping(metrics.get(metric))
    value = _format_rate(summary.get("mean"))
    covered = summary.get("covered_results", 0)
    total = summary.get("total_results", 0)
    return f"{value} ({covered}/{total})"


def _request_rate_cell(summary: Mapping[str, Any]) -> str:
    rate = _format_rate(summary.get("rate"))
    successes = summary.get("successful_requests", 0)
    known = summary.get("known_requests", 0)
    return f"{rate} ({successes}/{known} known)"


def _reported_cost_cell(summary: Mapping[str, Any]) -> str:
    cost = _format_rate(summary.get("reported_partial_sum_usd"))
    reported = summary.get("reported_results", 0)
    total = summary.get("total_results", 0)
    return f"{cost} ({reported}/{total})"


def _markdown_cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def _render_markdown(summary: Mapping[str, Any]) -> str:
    lines = [
        "# Promptfoo evaluation report",
        "",
        f"- Source: `{summary.get('source_file', 'unknown')}`",
        f"- Run timestamp: {summary.get('timestamp') or 'unknown'}",
        f"- Result rows: {summary.get('result_count', 0)}",
    ]
    metadata = _as_mapping(summary.get("metadata"))
    evidence = _as_mapping(summary.get("evidence"))
    if metadata:
        if metadata.get("mode") is not None:
            lines.append(f"- Mode: `{_markdown_cell(metadata['mode'])}`")
        if metadata.get("git_revision") is not None:
            lines.append(
                f"- Git revision: `{_markdown_cell(metadata['git_revision'])}`"
            )
    if evidence.get("classification") == "fixture":
        lines.extend(
            [
                "",
                "> **Fixture run: wiring evidence only.** Scores below are generated "
                "from fixtures and are not model-quality evidence.",
            ]
        )
    elif evidence.get("classification") == "unknown":
        lines.extend(
            [
                "",
                "> Run evidence is unknown. Do not treat scores below as "
                "model-quality evidence.",
            ]
        )
    for warning in summary.get("warnings", []):
        lines.append(f"- Warning: {_markdown_cell(warning)}")

    lines.extend(
        [
            "",
            "## Model-level summary",
            "",
            "| "
            + " | ".join(
                (
                    "Model",
                    "Results",
                    "Quality",
                    "Directness",
                    "Tool accuracy",
                    "Assertion pass rate",
                    "Request success rate",
                    "Weighted score",
                    "Inference USD (reported partial)",
                )
            )
            + " |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for group in summary.get("model_summaries", []):
        metrics = _as_mapping(group.get("metrics"))
        pass_rate = _as_mapping(metrics.get("assertion_pass_rate"))
        request_rate = _as_mapping(group.get("request_success_rate"))
        inference = _as_mapping(group.get("inference_cost"))
        lines.append(
            "| "
            + " | ".join(
                (
                    _markdown_cell(group.get("model", "unknown")),
                    str(group.get("result_count", 0)),
                    _metric_cell(metrics, "answer_quality"),
                    _metric_cell(metrics, "answer_directness"),
                    _metric_cell(metrics, "tool_accuracy"),
                    f"{_format_rate(pass_rate.get('rate'))} "
                    f"({pass_rate.get('passed', 0)}/{pass_rate.get('expected', 0)})",
                    _request_rate_cell(request_rate),
                    _format_rate(group.get("weighted_score")),
                    _reported_cost_cell(inference),
                )
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## Model and category scores",
            "",
            "Missing metric outcomes score 0 and remain in the denominator. "
            "Coverage shows how many results supplied each metric.",
            "",
            "| "
            + " | ".join(
                (
                    "Model",
                    "Category",
                    "Results",
                    "Quality",
                    "Directness",
                    "Tool accuracy",
                    "Assertion pass rate",
                    "Weighted score",
                )
            )
            + " |",
            "|---|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for group in summary.get("groups", []):
        metrics = _as_mapping(group.get("metrics"))
        pass_rate = _as_mapping(metrics.get("assertion_pass_rate"))
        lines.append(
            "| "
            + " | ".join(
                (
                    _markdown_cell(group.get("model", "unknown")),
                    _markdown_cell(group.get("category", "unknown")),
                    str(group.get("result_count", 0)),
                    _metric_cell(metrics, "answer_quality"),
                    _metric_cell(metrics, "answer_directness"),
                    _metric_cell(metrics, "tool_accuracy"),
                    f"{_format_rate(pass_rate.get('rate'))} "
                    f"({pass_rate.get('passed', 0)}/{pass_rate.get('expected', 0)})",
                    _format_rate(group.get("weighted_score")),
                )
            )
            + " |"
        )

    lines.extend(["", "## Reliability, latency, tokens, and cost", ""])
    lines.append(
        "| "
        + " | ".join(
            (
                "Model",
                "Category",
                "Request success rate",
                "Request failures",
                "Assertion failures",
                "Timeouts",
                "Invalid/malformed",
                "Unsupported tool",
                "Latency p50/p95 ms",
                "Tokens prompt/completion/total",
                "Inference USD (reported partial)",
                "Grading USD (reported partial; coverage)",
            )
        )
        + " |"
    )
    lines.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for group in summary.get("groups", []):
        reliability = _as_mapping(group.get("reliability"))
        request_rate = _as_mapping(group.get("request_success_rate"))
        latency = _as_mapping(group.get("latency_ms"))
        tokens = _as_mapping(group.get("token_usage"))
        inference = _as_mapping(group.get("inference_cost"))
        grading = _as_mapping(group.get("grading_cost"))
        token_cell = "/".join(
            _format_rate(_as_mapping(tokens.get(key)).get("reported_sum"))
            for key in ("prompt", "completion", "total")
        )
        lines.append(
            "| "
            + " | ".join(
                (
                    _markdown_cell(group.get("model", "unknown")),
                    _markdown_cell(group.get("category", "unknown")),
                    _request_rate_cell(request_rate),
                    str(reliability.get("request_failures", 0)),
                    str(reliability.get("assertion_failure_results", 0)),
                    str(reliability.get("timeouts", 0)),
                    str(reliability.get("invalid_or_malformed_responses", 0)),
                    str(reliability.get("unsupported_tool_scenarios", 0)),
                    f"{_format_rate(latency.get('p50'))}/{_format_rate(latency.get('p95'))}",
                    token_cell,
                    _reported_cost_cell(inference),
                    f"{_format_rate(grading.get('reported_partial_sum_usd'))} "
                    f"({grading.get('fully_covered_results', 0)}/"
                    f"{grading.get('eligible_results', 0)} fully covered)",
                )
            )
            + " |"
        )
    lines.extend(
        [
            "",
            (
                "Request success is separate from assertion/evaluation success: a "
                "returned response with failed assertions still counts as a "
                "successful request. Request success coverage shows rows with a "
                "response or explicit request error."
            ),
            (
                "Latency percentiles use nearest rank and include failed responses "
                "when latency is available. Output tokens/s is the arithmetic mean "
                "of per-response completion tokens divided by latency in seconds; "
                "it includes harness overhead and is not streaming speed."
            ),
            (
                "Cost totals are reported partial sums; inspect coverage before "
                "comparing them. Missing inference costs are not treated as zero. "
                "Average inference cost per successful eval divides total run "
                "inference cost by fully passing evals; it is null unless every row "
                "has a reported cost and at least one eval passes."
            ),
            (
                "Grading costs prefer an aggregate grading cost and otherwise sum "
                "known component costs; coverage shows when expected rubric costs "
                "are unavailable."
            ),
        ]
    )

    comparison = summary.get("comparison")
    if isinstance(comparison, Mapping):
        lines.extend(["", "## Baseline comparison", ""])
        if comparison.get("compatible"):
            lines.append(
                "Compatible metadata; score deltas are current weighted score "
                "minus baseline weighted score."
            )
            for change in comparison.get("behavior_changes", []):
                source = _markdown_cell(change.get("source"))
                baseline_hash = _markdown_cell(change.get("baseline_hash", ""))[:12]
                current_hash = _markdown_cell(change.get("current_hash", ""))[:12]
                lines.append(
                    f"- Behavior source changed: `{source}` "
                    f"({baseline_hash} → {current_hash})."
                )
            lines.extend(
                [
                    "",
                    "| Model | Category | Status | Current | Baseline | Delta |",
                    "|---|---|---|---:|---:|---:|",
                ]
            )
            for group in comparison.get("groups", []):
                lines.append(
                    "| "
                    + " | ".join(
                        (
                            _markdown_cell(group.get("model")),
                            _markdown_cell(group.get("category")),
                            str(group.get("status")),
                            _format_rate(group.get("current_weighted_score")),
                            _format_rate(group.get("baseline_weighted_score")),
                            _format_rate(group.get("delta")),
                        )
                    )
                    + " |"
                )
        else:
            lines.append(
                "Comparison skipped because run metadata is missing or incompatible:"
            )
            for note in comparison.get("notes", []):
                lines.append(f"- {_markdown_cell(note)}")
    return "\n".join(lines).rstrip() + "\n"


def write_report(
    result_path: str | Path,
    output_dir: str | Path | None = None,
    baseline_path: str | Path | None = None,
) -> dict[str, Any]:
    """Write ``summary.json`` and ``summary.md`` for a native Promptfoo export.

    Reports default to the result file's directory. If ``baseline_path`` is
    supplied, a score-only comparison is included only when sibling run
    metadata confirms compatible inputs and criteria.
    """
    source_path = Path(result_path)
    document, rows = _read_results(source_path)
    metadata, metadata_warning = _read_metadata(source_path)
    summary = _build_summary(document, rows, source_path, metadata, metadata_warning)

    if baseline_path is not None:
        baseline_result_path = Path(baseline_path)
        try:
            baseline_document, baseline_rows = _read_results(baseline_result_path)
            baseline_metadata, baseline_metadata_warning = _read_metadata(
                baseline_result_path
            )
            baseline_summary = _build_summary(
                baseline_document,
                baseline_rows,
                baseline_result_path,
                baseline_metadata,
                baseline_metadata_warning,
            )
            mismatch_notes = _comparison_mismatches(metadata, baseline_metadata)
            summary["comparison"] = _compare_summaries(
                summary,
                baseline_summary,
                baseline_result_path,
                mismatch_notes,
                _behavior_hash_changes(metadata, baseline_metadata),
            )
        except (TypeError, ValueError) as exc:
            summary["comparison"] = {
                "baseline_file": baseline_result_path.name,
                "compatible": False,
                "notes": [f"baseline could not be read: {exc}"],
                "behavior_changes": [],
                "score": "weighted_score only; current minus baseline",
                "groups": [],
            }

    destination = Path(output_dir) if output_dir is not None else source_path.parent
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    (destination / "summary.md").write_text(_render_markdown(summary), encoding="utf-8")
    return summary


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "result_path", type=Path, help="Promptfoo native JSON result export"
    )
    parser.add_argument(
        "--output-dir", type=Path, help="Directory for summary.json and summary.md"
    )
    parser.add_argument(
        "--baseline", type=Path, help="Optional compatible baseline result export"
    )
    args = parser.parse_args(argv)
    try:
        summary = write_report(args.result_path, args.output_dir, args.baseline)
    except (TypeError, ValueError) as exc:
        parser.error(str(exc))
    output = (
        Path(args.output_dir)
        if args.output_dir is not None
        else args.result_path.parent
    )
    print(f"Wrote {output / 'summary.json'} and {output / 'summary.md'}")
    if isinstance(summary.get("comparison"), Mapping) and not summary["comparison"].get(
        "compatible"
    ):
        print(
            "Baseline comparison skipped: "
            + "; ".join(summary["comparison"].get("notes", []))
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
