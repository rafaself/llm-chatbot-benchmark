import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from benchmark.run import ROOT, build_config, main, parser


class ConfigurationTests(unittest.TestCase):
    def config(self, *arguments: str) -> tuple[dict[str, Any], dict[str, Any]]:
        args = parser().parse_args(["--prepare-only", *arguments])
        with tempfile.TemporaryDirectory() as directory:
            return build_config(args, Path(directory))

    def test_safe_defaults_and_central_assertions(self) -> None:
        config, metadata = self.config("--smoke")
        self.assertEqual(config["providers"][0]["config"]["mode"], "smoke")
        self.assertEqual(
            [a["type"] for a in config["defaultTest"]["assert"]],
            ["llm-rubric", "llm-rubric", "equals"],
        )
        self.assertEqual(
            [a["weight"] for a in config["defaultTest"]["assert"]], [5, 2, 3]
        )
        self.assertEqual(metadata["evidence"], "unexecuted")
        self.assertEqual(metadata["case_count"], 8)

    def test_all_ten_models_can_be_explicitly_prepared(self) -> None:
        registry = json.loads((ROOT / "config/models.json").read_text())
        self.assertEqual(len(registry["models"]), 10)
        for key, model in registry["models"].items():
            with self.subTest(model=key):
                config, _ = self.config(
                    "--live", "--models", key, "--allow-unverified-tools"
                )
                provider = config["providers"][0]["config"]["provider"]
                self.assertEqual(
                    provider["id"], f"bedrock:converse:{model['invocation_id']}"
                )
                self.assertEqual(len(provider["config"]["tools"]), 2)
                judge = config["defaultTest"]["options"]["provider"]["config"][
                    "provider"
                ]
                self.assertEqual(judge["id"], "bedrock:converse:us.openai.gpt-6.1-sol")

    def test_alternative_judge_keeps_exact_model(self) -> None:
        config, _ = self.config("--live", "--judge-provider", "openai")
        self.assertEqual(
            config["defaultTest"]["options"]["provider"]["config"]["provider"]["id"],
            "openai:responses:gpt-6.1-sol",
        )

    def test_filter_and_request_limit(self) -> None:
        _, metadata = self.config("--category", "ambiguous")
        self.assertEqual(metadata["case_count"], 1)
        with self.assertRaisesRegex(ValueError, "upper bound"):
            self.config("--repeat", "100")

    def test_unknown_models_and_unverified_tools_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unknown models"):
            self.config("--live", "--models", "made-up")
        with self.assertRaisesRegex(ValueError, "unverified"):
            self.config("--live", "--models", "qwen3-32b")

    def test_cli_rejects_unapproved_paid_calls_before_build(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            main(["--live"])
        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
