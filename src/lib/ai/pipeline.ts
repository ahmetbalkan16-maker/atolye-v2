import type { AIProvider } from "./providers";
import { AIRouter } from "./router/AIRouter";
import { runObservedAIRequest } from "./runObservedAIRequest";
import type { AIRequestContext } from "@/types/aiUsage";

const router = new AIRouter();

const defaultProvider = router.getProvider();

export async function runPipeline(
  prompt: string,
  selectedProvider: AIProvider = defaultProvider,
  context: Partial<AIRequestContext> = {},
): Promise<string> {
  const { response } = await runObservedAIRequest({
    prompt,
    provider: selectedProvider,
    context: {
      ...context,
      operation: context.operation ?? "legacy-ai-pipeline",
      stage: context.stage ?? "unknown",
    },
  });

  return response;
}
