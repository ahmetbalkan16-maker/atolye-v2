import { aiProviderConfig } from "../AIProviderConfig";
import { openai } from "../client";
import type {
  AIProvider,
  AIProviderGenerateOptions,
  AIProviderResult,
} from "./AIProvider";

export class OpenAIProvider implements AIProvider {
  async generate(
    prompt: string,
    options?: AIProviderGenerateOptions,
  ): Promise<AIProviderResult> {
    if (process.env.AI_PROVIDER !== "openai") {
      throw new Error("OpenAI provider requires AI_PROVIDER=openai.");
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI provider is not configured.");
    }

    const response = await openai.chat.completions.create({
      model: aiProviderConfig.openai.model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: options?.maxTokens ?? aiProviderConfig.openai.maxTokens,
      temperature: aiProviderConfig.openai.temperature,
    });

    const choice = response.choices[0];
    const finishReason = normalizeFinishReason(choice?.finish_reason);
    const refused = Boolean(choice?.message?.refusal);
    return {
      content: choice?.message?.content ?? "",
      finishReason,
      refused,
      complete: finishReason === "stop" && !refused,
      truncated: finishReason === "length",
      ...(response.usage ? {
        usage: {
          promptTokens: safeTokenCount(response.usage.prompt_tokens),
          completionTokens: safeTokenCount(response.usage.completion_tokens),
          totalTokens: safeTokenCount(response.usage.total_tokens),
        },
      } : {}),
    };
  }
}

function normalizeFinishReason(value: string | null | undefined): AIProviderResult["finishReason"] {
  if (value === "stop" || value === "length") return value;
  if (value === "content_filter") return "content-filter";
  if (value === "tool_calls" || value === "function_call") return "tool-calls";
  return "unknown";
}

function safeTokenCount(value: number | undefined) {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value : undefined;
}
