# Model compatibility snapshot

Checked against official documentation on **2026-11-04**. Catalog support is not evidence that this account can invoke a model. No live target or judge calls have been executed for this checkout. Regions, inference profiles, subscriptions, IAM/SCP permissions, quotas, and lifecycle can change independently.

All configured target routes use Promptfoo's documented `bedrock:converse:<invocation_id>` selector with the AWS credential chain. The registry distinguishes base model identifiers from invocation profiles. The default source region is `us-east-1`; verify a different source region before changing it.

| Requested target | Base model ID | Configured invocation ID | Tool evidence |
| --- | --- | --- | --- |
| [Nova Micro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-micro.html) | `amazon.nova-micro-v1:0` | `us.amazon.nova-micro-v1:0` | AWS card documents Converse and client-side tools |
| [Nova Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html) | `amazon.nova-lite-v1:0` | `us.amazon.nova-lite-v1:0` | AWS card documents Converse and client-side tools |
| [Nemotron Nano 3 30B](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-nvidia-nemotron-nano-3-30b.html) | `nvidia.nemotron-nano-3-30b` | Same | Converse on model card; native tool support in AWS newsletter below; commercial-region behavior untested |
| [Nemotron Super 3 120B](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-nvidia-nemotron-super-3-120b.html) | `nvidia.nemotron-super-3-120b` | Same | Same qualification as Nano |
| [GPT-OSS 20B](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-20b.html) | `openai.gpt-oss-20b-1:0` | Same | Converse on card; native tool support in AWS newsletter; region/account untested |
| [GPT-OSS 120B](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-oss-120b.html) | `openai.gpt-oss-120b-1:0` | Same | Same qualification as 20B |
| [Qwen3 32B](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-32b.html) | `qwen.qwen3-32b-v1:0` | Same | Converse documented; tool use on this exact route remains unverified |
| [Claude Haiku 5.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html) | `anthropic.claude-haiku-5-5` | `us.anthropic.claude-haiku-5-5` | AWS card documents Converse and client-side tools |
| [GPT-6 Luna](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-luna.html) | `openai.gpt-6-luna` | `us.openai.gpt-6-luna` | Converse on card; client-side tools documented in AWS post below |
| [GPT-6.1 Sol](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html) | `openai.gpt-6.1-sol` | `us.openai.gpt-6.1-sol` | Same, plus independent exact judge configuration |

The [AWS GovCloud newsletter](https://aws.amazon.com/govcloud-us/newsletter/newsletter-issue-01/) documents native tool calling for GPT-OSS and the Nano 30B/Super 120B Nemotron models. It is evidence for model capability; this repository has not established commercial-region account access. The [AWS GPT family integration post](https://aws.amazon.com/blogs/machine-learning/access-openai-gpt-models-on-amazon-bedrock-from-canada-with-cross-region-inference/) documents GPT-6/GPT-6.1 model profiles, Converse, and client-side tool use. Its regional examples are not proof of account entitlement elsewhere.

Qwen remains deliberately gated: native Promptfoo [Qwen tool configuration](https://www.promptfoo.dev/docs/providers/aws-bedrock/) documents the InvokeModel path, while older AWS Marketplace material explicitly qualified Converse tool support. Neither establishes current tool behavior on `qwen.qwen3-32b-v1:0` Converse. A deliberate capability probe may be prepared/run with `--allow-unverified-tools`; failures remain visible and are not scored as demonstrated lack of model capability. No older/different Qwen model is substituted.

All ten requested names currently have AWS catalog entries, so no alternative inference provider is required merely to preserve their identity. A future alternative target route needs explicit registry/config support, compatible tool exchange, and its own validation; the current tool loop supports Converse targets only.

## Judge

The default grading model is separately configured as `bedrock:converse:us.openai.gpt-6.1-sol`. The explicit alternative is `openai:responses:gpt-6.1-sol`; it requires `OPENAI_API_KEY` and uses Promptfoo's native Responses provider. [OpenAI's exact model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) documents the identifier and function calling. [GPT-6 Luna's page](https://developers.openai.com/api/docs/models/gpt-6-luna) documents the `gpt-6-luna` identity and the Chat Completions/function-calling reasoning constraint; the target registry uses Converse rather than assuming equivalent behavior on that API.

## Runtime limitations and extension rules

- All rows are configuration candidates, not executed compatibility claims. Verify actual account availability through a paid opt-in evaluation before comparing quality.
- An API access denial or invalid parameter stays an API error, not an unsupported-tool label. Only declared unsupported capabilities or the adapter's detected unsupported exchange use that status.
- Signed reasoning blocks cannot currently be replayed by pinned Promptfoo's Converse prompt parser. If a tool response includes reasoning blocks, the adapter preserves the raw response and returns an explicit unsupported exchange. Haiku thinking is disabled; other reasoning models retain provider defaults. A parser/provider upgrade needs regression tests before removing this guard.
- All requests share the prompt and tools. Model-specific sampling/reasoning constraints remain explicit in `config/models.json`; do not claim identical reasoning budgets. At most three target turns are allowed by default.
- Authentication/entitlement checks and text-only catalog support do not prove tool-calling support. Keep uncertainty in the registry/docs until a matching endpoint/model scenario is tested.
- Cost reporting uses whatever the pinned native provider can estimate. It can remain unavailable for newer IDs; no price is invented. Update verified pricing/configuration deliberately rather than borrowing another model's rate.

## Framework evidence

The installed package is pinned and its native Converse tool conversion, inference settings, and response parsing are exercised without network calls in `tests/test_tools.ts`. The complete offline smoke run exercises both native `llm-rubric` assertions and deterministic `equals`. These checks establish integration behavior with fixtures, not live model performance.

Official framework sources: [Converse configuration](https://www.promptfoo.dev/docs/providers/aws-bedrock/#converse-api), [tool formats](https://www.promptfoo.dev/docs/configuration/tools/), [rubric grading](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/), [assertion transforms](https://www.promptfoo.dev/docs/configuration/reference/), and [Python test generators](https://www.promptfoo.dev/docs/configuration/test-cases/#python).
