import type { AIProvider } from "./AIProvider";

export class ClaudeProvider implements AIProvider {
  async generate(prompt: string): Promise<string> {
    void prompt;
    throw new Error("Not implemented");
  }
}
