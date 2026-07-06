import {
  runOpenAIResearch,
  runOpenAIScript,
} from "./providers/openai";

export async function runAIResearch(topic: string) {
  return await runOpenAIResearch(topic);
}

export async function runAIScript(topic: string) {
  return await runOpenAIScript(topic);
}