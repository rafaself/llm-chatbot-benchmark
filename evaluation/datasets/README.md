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
- `golden/scope.jsonl` — role-boundary cases. These are not part of the
  development or held-out sets. Run this file on its own.
- `golden/heldout.jsonl` — 9 cases reserved for release-candidate evaluation.
  The file is public, so it is an organizational holdout rather than a blind
  test set.
- `smoke.jsonl` — offline fixture sessions, including the three-turn context
  session, used to check wiring. Smoke results are not model-quality evidence.
- `context-session.jsonl` — the same three-turn session alone, for a minimal
  live check.

## Evaluation JSON Structure

The golden and smoke datasets use JSON Lines (JSONL): each non-empty line is a
separate JSON object with one top-level `item` property. Do not wrap the file in
an array or add commas between lines. The loader validates the item schema,
category names, stable IDs, and policy subsection references.

```json
{"item": {
  "id": "SON-MHP-008",
  "category": "cross_source_accuracy",
  "difficulty": "hard",
  "capabilities": ["cross_source_reasoning", "operational_lookup", "policy_retrieval"],
  "tags": [],
  "turns": [{
    "id": "SON-MHP-008-T01",
    "input": "My order SON-1059 is ready for pickup. How long will Sonora hold it, and can you give me the exact last day?",
    "expected": {
      "answer": "SON-1059 is ready for pickup. Sonora normally holds paid orders for 7 consecutive days after the pickup notice; the exact deadline depends on when the notice was sent.",
      "required_facts": ["ready for pickup", "7 consecutive days after notice", "deadline not derivable without notice timestamp"],
      "forbidden_claims": [],
      "tools": [
        {"name": "lookup_order", "arguments": {"order_id": "SON-1059"}}
      ]
    },
    "retrieval": {"relevant_sections": ["7.7"]}
  }]
}}
```

Fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable session identifier, formatted as `SON-<LETTERS>-<3 digits>`. It becomes Promptfoo `metadata.conversationId`. |
| `category` | Scenario type: `policy_accuracy`, `cross_source_accuracy`, `calculation_accuracy`, `operational_accuracy`, `clarification_quality`, `conversation_context`, or `robustness`. |
| `difficulty` | Editorial estimate: `easy`, `medium`, or `hard`. |
| `capabilities` | Capability labels for the session. At least one is required. |
| `tags` | Optional labels for slicing results. Defaults to an empty list. |
| `turns` | Ordered user turns. Turn IDs are `<session>-T01`, `<session>-T02`, and so on. Each turn is graded independently. |
| `turns[].input` | User message for that turn. The prompt does not include a predefined assistant reply. |
| `turns[].expected.answer` | Reference answer used by the answer-quality grader for that turn. |
| `turns[].expected.required_facts` | Facts that turn's answer should include. At least one is required. |
| `turns[].expected.forbidden_claims` | Claims that turn's answer must avoid. Defaults to an empty list. |
| `turns[].expected.tools` | Expected tool calls for that turn. Each has a tool `name` and optional `arguments`; supplied argument values are checked exactly. Defaults to an empty list. |
| `turns[].retrieval.relevant_sections` | Policy subsection IDs that should be returned to the model on that turn. The deterministic check measures retrieval coverage, not whether the answer faithfully used the evidence. Defaults to an empty list. |

The `expected` labels and retrieval IDs are supplied to the evaluator, not the
target model's prompt. Follow-up turns receive the model's previous answer
through Promptfoo `_conversation`. Keep references grounded in the versioned
policy and SQLite fixture, and have another reviewer check new or changed gold
labels before using results for decisions.

`context-session.jsonl` is the three-turn validation session
`SON-CTX-001`: look up order `SON-1042`, repeat its recorded `processing`
status, then give the Section 7.7 pickup hold and the consequence if the
customer does not collect it. The same session is appended to `smoke.jsonl`
for the offline wiring check.

## Category Guidance

- `policy_accuracy` tests an answer grounded in store policy, including rules
  that combine more than one section.
- `cross_source_accuracy` combines a database tool result with policy evidence.
- `calculation_accuracy` tests arithmetic under stated policy rules.
- `operational_accuracy` tests a direct operational lookup.
- `clarification_quality` tests whether the assistant asks for missing
  information.
- `conversation_context` tests use of earlier user messages and the model's own
  previous answers.
- `robustness` tests resistance to unsupported claims, disclosure requests, or
  instructions that conflict with the available evidence.
