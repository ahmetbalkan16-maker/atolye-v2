import OpenAI from "openai";
import { AIProvider } from "../types";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAIProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    const response = await client.chat.completions.create({
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