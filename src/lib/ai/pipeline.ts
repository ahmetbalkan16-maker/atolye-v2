import type { AIProvider } from "./providers";
import { OpenAIProvider } from "./providers";

const defaultProvider = new OpenAIProvider();

export async function runPipeline(
  prompt: string,
  selectedProvider: AIProvider = provider,
): Promise<string> {
  return await selectedProvider.generate(prompt);
}
