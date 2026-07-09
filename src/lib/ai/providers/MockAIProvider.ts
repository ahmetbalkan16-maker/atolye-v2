import type { AIProvider } from "./AIProvider";

export class MockAIProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    void prompt;
    return "";
  }
}
