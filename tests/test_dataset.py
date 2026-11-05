"""Tests for JSONL dataset validation and Promptfoo conversion."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from benchmark.dataset import (
    DatasetValidationError,
    create_tests,
    load_dataset,
    to_promptfoo_tests,
)

SAMPLE_DATASET = Path(__file__).resolve().parents[1] / "datasets" / "sample.jsonl"


def valid_item(input_text: str = "Question?") -> dict[str, str]:
    return {
        "input": input_text,
        "expected_answer": "An answer.",
        "expected_tool": "none",
        "expected_category": "factual",
    }


class DatasetTests(unittest.TestCase):
    def write_dataset(self, *rows: str) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        path = Path(temp_dir.name) / "dataset.jsonl"
        path.write_text("\n".join(rows), encoding="utf-8")
        return path

    @staticmethod
    def row(item: object) -> str:
        return json.dumps({"item": item})

    def test_sample_dataset_has_eight_representative_cases(self) -> None:
        items = load_dataset(SAMPLE_DATASET)

        self.assertEqual(len(items), 8)
        self.assertEqual(
            {item["expected_category"] for item in items},
            {"factual", "tool_call", "no_tool", "ambiguous"},
        )
        self.assertEqual(
            [item["expected_tool"] for item in items].count("get_weather"), 1
        )
        self.assertEqual(
            [item["expected_tool"] for item in items].count("lookup_order"), 2
        )

    def test_category_filter_returns_only_selected_items(self) -> None:
        filtered = load_dataset(SAMPLE_DATASET, categories={"tool_call"})

        self.assertEqual(len(filtered), 3)
        self.assertTrue(
            all(item["expected_category"] == "tool_call" for item in filtered)
        )

    def test_single_string_category_filter_is_treated_as_one_category(self) -> None:
        filtered = load_dataset(SAMPLE_DATASET, categories="ambiguous")

        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["expected_category"], "ambiguous")

    def test_empty_category_filter_returns_no_rows(self) -> None:
        self.assertEqual(load_dataset(SAMPLE_DATASET, categories=[]), [])

    def test_empty_file_is_rejected(self) -> None:
        path = self.write_dataset()

        with self.assertRaisesRegex(
            DatasetValidationError, r"line 1: dataset must contain at least one row"
        ):
            load_dataset(path)

    def test_unknown_category_filter_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown category filter"):
            load_dataset(SAMPLE_DATASET, categories={"unknown"})

    def test_invalid_json_reports_line_number(self) -> None:
        path = self.write_dataset(self.row(valid_item()), "{broken")

        with self.assertRaisesRegex(DatasetValidationError, r"line 2: invalid JSON"):
            load_dataset(path)

    def test_blank_line_is_rejected_with_line_number(self) -> None:
        path = self.write_dataset(
            self.row(valid_item()), "", self.row(valid_item("second"))
        )

        with self.assertRaisesRegex(DatasetValidationError, r"line 2: invalid JSON"):
            load_dataset(path)

    def test_duplicate_json_keys_are_rejected_with_line_number(self) -> None:
        path = self.write_dataset(
            '{"item":{"input":"first","input":"duplicate",'
            '"expected_answer":"answer","expected_tool":"none",'
            '"expected_category":"factual"}}'
        )

        with self.assertRaisesRegex(
            DatasetValidationError, r"line 1: duplicate JSON key"
        ):
            load_dataset(path)

    def test_top_level_must_have_exact_item_shape(self) -> None:
        invalid_rows = (
            json.dumps([]),
            json.dumps({}),
            json.dumps({"item": valid_item(), "extra": True}),
        )

        for row in invalid_rows:
            with (
                self.subTest(row=row),
                self.assertRaisesRegex(DatasetValidationError, r"line 1:"),
            ):
                load_dataset(self.write_dataset(row))

    def test_item_must_be_an_object_with_exact_fields(self) -> None:
        invalid_items = (
            None,
            {key: value for key, value in valid_item().items() if key != "input"},
            {**valid_item(), "unexpected": "extra"},
        )

        for item in invalid_items:
            with (
                self.subTest(item=item),
                self.assertRaisesRegex(DatasetValidationError, r"line 1:"),
            ):
                load_dataset(self.write_dataset(self.row(item)))

    def test_each_field_must_be_a_nonempty_string(self) -> None:
        for field in valid_item():
            for invalid_value in ("", "   ", 7, None):
                with self.subTest(field=field, invalid_value=invalid_value):
                    item: dict[str, object] = {
                        key: value for key, value in valid_item().items()
                    }
                    item[field] = invalid_value
                    with self.assertRaisesRegex(DatasetValidationError, r"line 1:"):
                        load_dataset(self.write_dataset(self.row(item)))

    def test_expected_tool_must_be_allowed(self) -> None:
        item = valid_item()
        item["expected_tool"] = "unknown_tool"

        with self.assertRaisesRegex(
            DatasetValidationError, r"line 1: invalid expected_tool"
        ):
            load_dataset(self.write_dataset(self.row(item)))

    def test_expected_category_must_be_allowed(self) -> None:
        item = valid_item()
        item["expected_category"] = "unknown_category"

        with self.assertRaisesRegex(
            DatasetValidationError, r"line 1: invalid expected_category"
        ):
            load_dataset(self.write_dataset(self.row(item)))

    def test_duplicate_inputs_report_both_line_numbers(self) -> None:
        row = self.row(valid_item("Same input"))
        path = self.write_dataset(row, row)

        with self.assertRaisesRegex(
            DatasetValidationError,
            r"line 2: duplicate input \(first seen on line 1\)",
        ):
            load_dataset(path)

    def test_invalid_rows_are_checked_even_when_filtered_out(self) -> None:
        item = valid_item("not selected")
        item["expected_category"] = "unknown_category"

        with self.assertRaisesRegex(DatasetValidationError, r"line 1:"):
            load_dataset(self.write_dataset(self.row(item)), categories={"tool_call"})

    def test_promptfoo_conversion_maps_vars_and_category_metadata(self) -> None:
        items = load_dataset(SAMPLE_DATASET, categories={"ambiguous"})
        original = dict(items[0])

        tests = to_promptfoo_tests(items)

        self.assertEqual(
            tests,
            [
                {
                    "vars": original,
                    "metadata": {"category": "ambiguous"},
                }
            ],
        )
        self.assertNotIn("assert", tests[0])
        self.assertEqual(items[0], original)

    def test_promptfoo_conversion_preserves_every_item_field(self) -> None:
        item = valid_item()

        converted = to_promptfoo_tests([item])[0]

        self.assertEqual(converted["vars"], item)
        self.assertEqual(converted["metadata"], {"category": "factual"})

    def test_create_tests_loads_the_bundled_promptfoo_dataset(self) -> None:
        self.assertEqual(
            create_tests(), to_promptfoo_tests(load_dataset(SAMPLE_DATASET))
        )


if __name__ == "__main__":
    unittest.main()
