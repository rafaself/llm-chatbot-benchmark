# Model compatibility snapshot

Checked against official documentation on **2026-11-04**. Catalog support is not evidence that this account can invoke a model. On **2026-11-07** a three-turn GPT-6 Luna run (`us.openai.gpt-6-luna`, judge `bedrock:converse:us.openai.gpt-6.1-sol`, request ceiling 18) failed before any model response because the AWS credential chain had no access key. No other target was substituted. Regions, inference profiles, subscriptions, IAM/SCP permissions, quotas, and lifecycle can change independently.

Targets now use AI SDK’s direct Bedrock Converse provider with the AWS credential chain; native Promptfoo providers perform grading. The catalog evidence below predates this adapter migration and does not verify SDK/account compatibility. The registry distinguishes base model identifiers from invocation profiles. The default source region is `us-east-1`; verify a different source region before changing it.

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

Qwen remains deliberately gated: Promptfoo [Qwen tool configuration](https://www.promptfoo.dev/docs/providers/aws-bedrock/) documents the InvokeModel path, while older AWS Marketplace material explicitly qualified Converse tool support. Neither establishes current tool behavior on `qwen.qwen3-32b-v1:0` Converse. A deliberate capability probe may be prepared/run with `--allow-unverified-tools`; failures remain visible and are not scored as demonstrated lack of model capability. No older/different Qwen model is substituted.

All ten requested names currently have AWS catalog entries, so no alternative inference provider is required merely to preserve their identity. A future alternative target route needs explicit registry/config support, compatible tool exchange, and its own validation; the current tool loop supports Converse targets only.

## Judge

The default grading model is separately configured as `bedrock:converse:us.openai.gpt-6.1-sol`. The explicit alternative is `openai:responses:gpt-6.1-sol`; it requires `OPENAI_API_KEY` and uses Promptfoo's native Responses provider. [OpenAI's exact model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) documents the identifier and function calling. [GPT-6 Luna's page](https://developers.openai.com/api/docs/models/gpt-6-luna) documents the `gpt-6-luna` identity and the Chat Completions/function-calling reasoning constraint; the target registry uses Converse rather than assuming equivalent behavior on that API.

## Runtime and evidence boundaries

- All target IDs are configuration candidates, not executed compatibility claims.
  Exact account/model/SDK compatibility needs a separately authorized live run.
  Multi-turn runs pass Promptfoo `_conversation` back as ordinary user and
  assistant messages. The provider's `conversationOutput` is the model's answer
  text; the structured tool and evidence payload stays on `output` for grading.
- AI SDK owns Converse serialization, tool validation/execution, reasoning message
  replay, and retries. The benchmark no longer patches private Promptfoo hooks or
  manually replays tool exchanges. This removes the old parser-specific reasoning
  restriction; support for each exact model remains unverified.
- Model sampling constraints remain in `../config/models.json`. Haiku's disabled
  thinking setting is passed through AI SDK's Bedrock provider options. These
  settings do not establish equal reasoning budgets across architectures.
- API/access failures remain errors, not proof that a model lacks tool support.
- `stats.json` prices assistant and judge tokens from `../config/prices.json`.
  Rates cover every model in `../config/models.json` at US East Standard
  on-demand prices. A `us.` profile uses that profile's published rate.
  GPT-6 long-context rates start above 272,000 prompt tokens. Haiku 5.5
  uses its own 100,000-token tier. The file is a list-price estimate, not
  an AWS invoice.
- `npm run smoke` uses AI SDK's mock model, deterministic local tools, both
  Promptfoo rubric assertions, equality checks, and native HTML/JSON exports.
  It establishes offline plumbing only, not live compatibility or answer quality.

Framework references: [AI SDK Bedrock](https://ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock),
[AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling),
and [Promptfoo rubric grading](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/).
