# Sonora Dataset Files

This directory contains the fictional Sonora store policy, operational data, and
evaluation cases used by the chatbot benchmark. Names, customer records, orders,
and policies are fictional. The SQLite tools are read-only fixtures and must not
be connected to real customer data.

## Files

- `sonora_store_policy.md` — the policy corpus. Subsection IDs such as `7.7`
  are used by retrieval labels in the evaluation cases.
- `sonora_store_database.sqlite` — the operational fixture database used by
  order and product lookup tools.
- `sonora_store_database.sql` — the SQL schema and seed data corresponding to
  the SQLite fixture.
- `golden/development.jsonl` — 55 draft-labeled cases for development and
  iteration.
- `golden/heldout.jsonl` — 9 cases reserved for release-candidate evaluation.
  The file is public, so it is an organizational holdout rather than a blind
  test set.
- `smoke.jsonl` — 3 simple cases used with offline fixtures to check wiring;
  smoke results are not model-quality evidence.

## Evaluation JSON Structure

The golden and smoke datasets use JSON Lines (JSONL): each non-empty line is a
separate JSON object with one top-level `item` property. Do not wrap the file in
an array or add commas between lines. The loader validates the item schema,
category names, stable IDs, and policy subsection references.

```json
{"item": {
  "id": "SON-MHP-008",
  "input": "My order SON-1059 is ready for pickup. How long will Sonora hold it?",
  "category": "cross_source",
  "difficulty": "hard",
  "messages": [],
  "expected": {
    "answer": "SON-1059 is ready for pickup. Sonora normally holds paid orders for 7 consecutive days after the pickup notice; the exact deadline depends on when the notice was sent.",
    "required_facts": ["ready for pickup", "7 consecutive days after notice", "deadline not derivable without notice timestamp"],
    "forbidden_claims": [],
    "tools": [
      {"name": "lookup_order", "arguments": {"order_id": "SON-1059"}},
      {"name": "search_policy", "arguments": {"query": "My order SON-1059 is ready for pickup. How long will Sonora hold it?"}}
    ]
  },
  "retrieval": {"relevant_sections": ["7.7"]},
  "tags": ["cross_source", "policy_and_database"]
}}
```

Fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable case identifier, formatted as `SON-<LETTERS>-<3 digits>`. |
| `input` | Latest user message sent to the assistant. |
| `category` | Scenario type: `policy_lookup`, `policy_multi_hop`, `cross_source`, `conditional`, `calculation`, `tool_call`, `clarification`, `multi_turn`, or `robustness`. `policy_multi_hop` requires reasoning across policy sections; `cross_source` requires both an operational lookup and policy evidence. |
| `difficulty` | Editorial estimate: `easy`, `medium`, or `hard`. |
| `messages` | Optional prior conversation turns, each with `role` (`user` or `assistant`) and `content`. Defaults to an empty list. |
| `expected.answer` | Reference answer used by the answer-quality grader. |
| `expected.required_facts` | Facts the answer should include. At least one is required. |
| `expected.forbidden_claims` | Claims the answer must avoid. Defaults to an empty list. |
| `expected.tools` | Expected tool calls. Each has a tool `name` and optional `arguments`; supplied argument values are checked exactly. Policy searches include the expected `query` string. Defaults to an empty list. |
| `retrieval.relevant_sections` | Policy subsection IDs that should be returned to the model. The deterministic check measures retrieval coverage, not whether the answer faithfully used the evidence. Defaults to an empty list. |
| `tags` | Optional labels for slicing results, such as `privacy`, `refunds`, or `cross_source`. Defaults to an empty list. |

The `expected` labels and retrieval IDs are supplied to the evaluator, not the
target model's prompt. `messages` and `input` form the conversation the model
receives. Keep references grounded in the versioned policy and SQLite fixture,
and have another reviewer check new or changed gold labels before using results
for decisions.

## Category Guidance

- `policy_lookup` tests a focused answer from one policy area.
- `policy_multi_hop` combines rules from multiple policy sections.
- `cross_source` combines a database tool result with policy evidence.
- `conditional` tests whether qualifications and exceptions are handled.
- `calculation` tests arithmetic under stated policy rules.
- `tool_call` tests a direct operational lookup.
- `clarification` tests whether the assistant asks for missing information.
- `multi_turn` tests use of prior conversation context.
- `robustness` tests resistance to unsupported claims, disclosure requests, or
  instructions that conflict with the available evidence.
