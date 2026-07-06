import { runAIScript } from "@/src/lib/ai/router";

export type GeneratedScript = {
  content: string;
};

export async function generateScript(topic: string): Promise<GeneratedScript> {
  const content = await runAIScript(topic);

  return {
    content,
  };
}