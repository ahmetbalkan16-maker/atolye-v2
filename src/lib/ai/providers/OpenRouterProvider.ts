import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import type { ConfiguredAIProvider } from "./AIProvider";

export class OpenRouterProvider implements ConfiguredAIProvider {
  createImmutableAiDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: "openrouter" }, requiredMethods: ["generate"],
    });
  }

  async generate(prompt: string): Promise<string> {
    void prompt;
    throw new Error("Not implemented");
  }
}
