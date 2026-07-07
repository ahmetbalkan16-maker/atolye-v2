import type { AIProvider } from "./providers";
import { AIRouter } from "./router/AIRouter";

const router = new AIRouter();

const defaultProvider = router.getProvider("openai");

export async function runPipeline(
  prompt: string,
  selectedProvider: AIProvider = defaultProvider,
): Promise<string> {
  return await selectedProvider.generate(prompt);
}