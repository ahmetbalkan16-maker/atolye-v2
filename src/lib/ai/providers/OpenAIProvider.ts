import { openai } from "../client";
import type { AIProvider } from "./AIProvider";

export class OpenAIProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return response.choices[0]?.message?.content ?? "";
  }
}
