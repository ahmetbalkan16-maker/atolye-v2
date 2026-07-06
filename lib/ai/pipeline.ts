import { OpenAIProvider } from "./providers";

const provider = new OpenAIProvider();

export async function runPipeline(prompt: string) {
  return await provider.generate(prompt);
}