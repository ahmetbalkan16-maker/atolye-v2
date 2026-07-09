import { aiProviderConfig } from "../AIProviderConfig";
import { openai } from "../client";
import type { AIProvider } from "./AIProvider";

export class OpenAIProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
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
      max_tokens: aiProviderConfig.openai.maxTokens,
      temperature: aiProviderConfig.openai.temperature,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}
