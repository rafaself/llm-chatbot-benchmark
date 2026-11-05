"""Prepare and run the central Promptfoo configuration. Network calls are opt-in."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from benchmark.dataset import load_dataset, to_promptfoo_tests

ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_config(
    args: argparse.Namespace, output: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    config = yaml.safe_load((ROOT / "promptfooconfig.yaml").read_text())
    registry = json.loads((ROOT / "config/models.json").read_text())
    items = load_dataset(args.dataset, args.category)
    if not items:
        raise ValueError("Dataset selection is empty")
    selected = args.models or ["nova-micro"]
    unknown = set(selected) - registry["models"].keys()
    if unknown:
        raise ValueError(f"Unknown models: {sorted(unknown)}")
    if len(set(selected)) != len(selected):
        raise ValueError("Duplicate model selection")
    if not args.live and args.models:
        raise ValueError("--smoke uses fixtures; select models with --live")
    # Upper bound: max_turns target requests + two rubric requests per row.
    planned = (
        len(items)
        * (len(selected) if args.live else 1)
        * args.repeat
        * (args.max_turns + 2)
        * (args.retries + 1)
    )
    if planned > args.max_requests:
        raise ValueError(
            f"Planned upper bound {planned} exceeds --max-requests {args.max_requests}"
        )
    tests_path = output / "tests.json"
    config["tests"] = str(tests_path)
    config["prompts"] = [f"file://{ROOT / 'prompts/chat.json'}"]
    adapter = f"file://{ROOT / 'integrations/chatbot.ts'}"
    config["providers"][0]["id"] = adapter
    config["defaultTest"]["options"]["provider"]["id"] = adapter
    if args.live:
        config["description"] = (
            "Live chatbot benchmark; two GPT-6.1 Sol rubric grades per response"
        )
        config["providers"] = []
        for key in selected:
            model = registry["models"][key]
            if (
                model["tool_support"] == "unverified_on_converse"
                and not args.allow_unverified_tools
            ):
                raise ValueError(
                    f"{key}: Converse tool support is unverified; "
                    "inspect docs/models.md or explicitly use "
                    "--allow-unverified-tools for a capability probe"
                )
            parameters = copy.deepcopy(model["parameters"])
            parameters.update(
                region=args.region, maxTokens=args.max_tokens, showThinking=False
            )
            if args.temperature is not None:
                if key.startswith("gpt-6") or key == "haiku-5.5":
                    raise ValueError(
                        f"{key} does not expose comparable temperature settings; "
                        "omit --temperature"
                    )
                parameters["temperature"] = args.temperature
            parameters["tools"] = json.loads((ROOT / "config/tools.json").read_text())
            provider = {
                "id": f"bedrock:converse:{model['invocation_id']}",
                "config": parameters,
            }
            config["providers"].append(
                {
                    "id": adapter,
                    "label": key,
                    "config": {
                        "mode": "live",
                        "provider": provider,
                        "tool_support": model["tool_support"],
                        "max_turns": args.max_turns,
                        "timeout_ms": args.timeout_ms,
                        "delay_ms": args.delay_ms,
                    },
                }
            )
        judge = copy.deepcopy(registry["judge"][args.judge_provider])
        if args.judge_provider == "bedrock":
            judge["config"]["region"] = args.region
        else:
            judge["config"]["maxRetries"] = args.retries
        config["defaultTest"]["options"]["provider"] = {
            "id": adapter,
            "config": {
                "mode": "live",
                "judge": True,
                "provider": judge,
                "timeout_ms": args.timeout_ms,
                "delay_ms": args.delay_ms,
            },
        }
    config["evaluateOptions"] = {
        "maxConcurrency": args.concurrency,
        "repeat": args.repeat,
    }
    metadata = {
        "created_at": datetime.now(UTC).isoformat(),
        "mode": "live" if args.live else "smoke",
        "evidence": "unexecuted"
        if args.prepare_only
        else ("live_attempt" if args.live else "fixture"),
        "models": selected if args.live else ["offline-fixture"],
        "model_identifiers": [registry["models"][k]["invocation_id"] for k in selected]
        if args.live
        else [],
        "categories": sorted({i["expected_category"] for i in items}),
        "case_count": len(items),
        "selected_cases_sha256": hashlib.sha256(
            json.dumps(items, sort_keys=True).encode()
        ).hexdigest(),
        "judge": config["defaultTest"]["options"]["provider"],
        "planned_max_requests": planned,
        "source_hashes": {
            name: digest(path)
            for name, path in {
                "dataset": Path(args.dataset),
                "prompt": ROOT / "prompts/chat.json",
                "criteria": ROOT / "promptfooconfig.yaml",
                "models": ROOT / "config/models.json",
                "tools": ROOT / "config/tools.json",
                "adapter": ROOT / "integrations/chatbot.ts",
            }.items()
        },
        "parameters": {
            k: getattr(args, k)
            for k in [
                "max_tokens",
                "temperature",
                "concurrency",
                "repeat",
                "retries",
                "timeout_ms",
                "delay_ms",
                "max_turns",
                "region",
            ]
        },
        "promptfoo_version": json.loads((ROOT / "package.json").read_text())[
            "devDependencies"
        ]["promptfoo"],
    }
    revision = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True
    )
    metadata["git_revision"] = revision.stdout.strip() or None
    metadata["git_dirty"] = bool(
        subprocess.run(
            ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True
        ).stdout.strip()
    )
    output.mkdir(parents=True, exist_ok=True)
    tests_path.write_text(json.dumps(to_promptfoo_tests(items), indent=2) + "\n")
    return dict(config), metadata


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--smoke",
        action="store_true",
        help="Offline fixtures (default); no quality evidence",
    )
    mode.add_argument(
        "--live",
        action="store_true",
        help="Use selected Bedrock models and GPT-6.1 Sol judge",
    )
    p.add_argument(
        "--allow-paid", action="store_true", help="Explicitly opt in to this paid run"
    )
    p.add_argument(
        "--prepare-only",
        action="store_true",
        help="Prepare inspectable config; never invoke APIs",
    )
    p.add_argument("--models", nargs="+")
    p.add_argument("--category", action="append")
    p.add_argument("--dataset", type=Path, default=ROOT / "datasets/sample.jsonl")
    p.add_argument(
        "--output",
        type=Path,
        help="New result directory; existing directories are never overwritten",
    )
    p.add_argument(
        "--region",
        default=os.environ.get(
            "AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
        ),
    )
    p.add_argument("--judge-provider", choices=["bedrock", "openai"], default="bedrock")
    p.add_argument("--allow-unverified-tools", action="store_true")
    p.add_argument("--max-tokens", type=int, default=1024)
    p.add_argument("--temperature", type=float)
    p.add_argument("--concurrency", type=int, default=1)
    p.add_argument("--repeat", type=int, default=1)
    p.add_argument("--retries", type=int, default=0)
    p.add_argument("--timeout-ms", type=int, default=60000)
    p.add_argument(
        "--delay-ms",
        type=int,
        default=0,
        help="Delay before every target and judge request; "
        "concurrency=1 gives serial pacing",
    )
    p.add_argument("--max-turns", type=int, default=3)
    p.add_argument("--max-requests", type=int, default=200)
    return p


def main(argv: list[str] | None = None) -> int:
    p = parser()
    args = p.parse_args(argv)
    if args.live and not args.prepare_only and not args.allow_paid:
        p.error(
            "Live calls require --allow-paid. "
            "Use --prepare-only to review without spending."
        )
    if args.allow_paid and not args.live:
        p.error("--allow-paid requires --live")
    for field in [
        "max_tokens",
        "concurrency",
        "repeat",
        "timeout_ms",
        "max_turns",
        "max_requests",
    ]:
        if getattr(args, field) < 1:
            p.error(f"--{field.replace('_', '-')} must be positive")
    if args.retries < 0 or args.delay_ms < 0:
        p.error("retries and delay must be nonnegative")
    if args.temperature is not None and not 0 <= args.temperature <= 1:
        p.error("temperature must be between 0 and 1")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    output = (args.output or ROOT / "results" / stamp).resolve()
    if output.exists():
        p.error(f"Refusing to overwrite existing result directory: {output}")
    try:
        config, metadata = build_config(args, output)
    except (ValueError, OSError) as error:
        p.error(str(error))
    (output / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False))
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(
        f"Prepared {metadata['case_count']} cases; {metadata['mode']}; "
        f"request upper bound {metadata['planned_max_requests']}.\nResults: {output}",
        flush=True,
    )
    if args.prepare_only:
        return 0
    env = dict(os.environ)
    env.update(
        PROMPTFOO_CONFIG_DIR=str(ROOT / ".promptfoo"),
        PROMPTFOO_DISABLE_TELEMETRY="1",
        PROMPTFOO_DISABLE_UPDATE="1",
        PROMPTFOO_CACHE_ENABLED="false",
        AWS_BEDROCK_MAX_RETRIES=str(args.retries + 1),
        REQUEST_TIMEOUT_MS=str(args.timeout_ms),
        BENCHMARK_ALLOW_PAID="1" if args.live else "0",
    )
    # Use the locally pinned CLI; never let npx silently download another version.
    command = [
        str(ROOT / "node_modules/.bin/promptfoo"),
        "eval",
        "-c",
        str(output / "config.yaml"),
        "--no-cache",
        "--no-share",
        "--no-write",
        "--no-progress-bar",
        "--no-table",
        "-o",
        str(output / "result.json"),
    ]
    with (output / "run.log").open("w") as log:
        try:
            result = subprocess.run(
                command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT
            )
        except OSError as error:
            log.write(str(error))
            print(f"Could not start Promptfoo: {error}. Run npm ci.", file=sys.stderr)
            return 2
    metadata["process_exit_code"] = result.returncode
    metadata["finished_at"] = datetime.now(UTC).isoformat()
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print((output / "run.log").read_text())
    if (output / "result.json").exists():
        from benchmark.report import write_report

        write_report(output / "result.json", output)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
