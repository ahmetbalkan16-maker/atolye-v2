import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import type { ConfiguredAIProvider } from "./AIProvider";

export class MockAIProvider implements ConfiguredAIProvider {
  createImmutableAiDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: "mock" }, requiredMethods: ["generate"],
    });
  }

  async generate(prompt: string): Promise<string> {
    void prompt;
    return "";
  }
}
