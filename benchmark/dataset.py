"""Load and validate JSONL benchmark datasets."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

_ITEM_FIELD_ORDER = ("input", "expected_answer", "expected_tool", "expected_category")
_ITEM_FIELDS = frozenset(_ITEM_FIELD_ORDER)
_TOOLS = frozenset({"none", "get_weather", "lookup_order"})
_CATEGORIES = frozenset({"factual", "tool_call", "no_tool", "ambiguous"})


class DatasetValidationError(ValueError):
    """Raised when a JSONL dataset row does not match the benchmark schema."""


class _DuplicateJSONKey(ValueError):
    def __init__(self, key: str) -> None:
        super().__init__(f"duplicate JSON key {key!r}")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateJSONKey(key)
        result[key] = value
    return result


def _shape_error(actual: set[str], expected: frozenset[str]) -> str:
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    details = []
    if missing:
        details.append(f"missing keys: {', '.join(missing)}")
    if extra:
        details.append(f"unexpected keys: {', '.join(extra)}")
    return "; ".join(details)


def load_dataset(
    path: str | Path, categories: Iterable[str] | None = None
) -> list[dict[str, str]]:
    """Load JSONL items, validating each row before applying a category filter.

    Every line must contain exactly ``{"item": { ... }}``, where the item has
    the four benchmark fields. Duplicate input strings are rejected even when
    they would be excluded by ``categories``.
    """

    selected_categories: set[str] | None = None
    if categories is not None:
        if isinstance(categories, str):
            selected_categories = {categories}
        else:
            try:
                selected_categories = set(categories)
            except TypeError as exc:
                raise ValueError("categories must be an iterable of strings") from exc

        if any(not isinstance(category, str) for category in selected_categories):
            raise ValueError("categories must contain only strings")
        unknown_categories = selected_categories - _CATEGORIES
        if unknown_categories:
            allowed = ", ".join(sorted(_CATEGORIES))
            unknown = ", ".join(sorted(unknown_categories))
            raise ValueError(
                f"unknown category filter(s): {unknown}; allowed: {allowed}"
            )

    dataset: list[dict[str, str]] = []
    seen_inputs: dict[str, int] = {}
    row_count = 0

    with Path(path).open(encoding="utf-8") as dataset_file:
        for line_number, raw_line in enumerate(dataset_file, start=1):
            try:
                record = json.loads(raw_line, object_pairs_hook=_unique_object)
            except json.JSONDecodeError as exc:
                raise DatasetValidationError(
                    f"line {line_number}: invalid JSON: {exc.msg}"
                ) from exc
            except _DuplicateJSONKey as exc:
                raise DatasetValidationError(f"line {line_number}: {exc}") from exc

            if not isinstance(record, dict):
                raise DatasetValidationError(
                    f"line {line_number}: row must be an object with exactly one "
                    "'item' key"
                )
            if set(record) != {"item"}:
                raise DatasetValidationError(
                    f"line {line_number}: row must have exactly one 'item' key; "
                    f"{_shape_error(set(record), frozenset({'item'}))}"
                )

            item = record["item"]
            if not isinstance(item, dict):
                raise DatasetValidationError(
                    f"line {line_number}: 'item' must be an object"
                )
            if set(item) != _ITEM_FIELDS:
                raise DatasetValidationError(
                    f"line {line_number}: 'item' has an invalid shape; "
                    f"{_shape_error(set(item), _ITEM_FIELDS)}"
                )

            for field in sorted(_ITEM_FIELDS):
                value = item[field]
                if not isinstance(value, str):
                    raise DatasetValidationError(
                        f"line {line_number}: '{field}' must be a string"
                    )
                if not value.strip():
                    raise DatasetValidationError(
                        f"line {line_number}: '{field}' must not be empty"
                    )

            if item["expected_tool"] not in _TOOLS:
                allowed = ", ".join(sorted(_TOOLS))
                raise DatasetValidationError(
                    f"line {line_number}: invalid expected_tool "
                    f"{item['expected_tool']!r}; allowed: {allowed}"
                )
            if item["expected_category"] not in _CATEGORIES:
                allowed = ", ".join(sorted(_CATEGORIES))
                raise DatasetValidationError(
                    f"line {line_number}: invalid expected_category "
                    f"{item['expected_category']!r}; allowed: {allowed}"
                )

            user_input = item["input"]
            if user_input in seen_inputs:
                first_line = seen_inputs[user_input]
                raise DatasetValidationError(
                    f"line {line_number}: duplicate input (first seen on line "
                    f"{first_line})"
                )
            seen_inputs[user_input] = line_number
            row_count += 1

            if (
                selected_categories is None
                or item["expected_category"] in selected_categories
            ):
                dataset.append(dict(item))

    if row_count == 0:
        raise DatasetValidationError("line 1: dataset must contain at least one row")

    return dataset


def to_promptfoo_tests(items: Iterable[Mapping[str, str]]) -> list[dict[str, Any]]:
    """Convert validated dataset items into Promptfoo's ``tests`` shape."""

    tests: list[dict[str, Any]] = []
    for item in items:
        tests.append(
            {
                "vars": {field: item[field] for field in _ITEM_FIELD_ORDER},
                "metadata": {"category": item["expected_category"]},
            }
        )
    return tests


def create_tests() -> list[dict[str, Any]]:
    """Load the bundled sample dataset for Promptfoo's Python file loader."""

    sample_path = Path(__file__).resolve().parents[1] / "datasets" / "sample.jsonl"
    return to_promptfoo_tests(load_dataset(sample_path))
