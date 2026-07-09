import { createScriptPrompt } from "../prompts/script";
import { AIRouter } from "../router/AIRouter";

export async function scriptStep(topic: string) {
  const prompt = createScriptPrompt(topic);
  const provider = new AIRouter().getProvider();
  const text =
    (await provider.generate(
      [
        "Sen yalnizca gecerli JSON donduren profesyonel bir Turkce belgesel senaryo motorusun.",
        prompt,
      ].join("\n\n"),
    )) || "{}";

  try {
    return JSON.parse(text);
  } catch {
    console.error("SCRIPT PARSE ERROR:", text);

    return {
      topic,
      title: "Senaryo olusturulamadi",
      subtitle: "",
      hook: "",
      introduction: "",
      chapters: [],
      conclusion: "",
      callToAction: "",
      estimatedDuration: 0,
      narrationWordCount: 0,
      targetAudience: "",
      language: "tr",
      voiceStyle: "",
      musicStyle: "",
      thumbnailIdea: "",
      seoKeywords: [],
      createdAt: new Date().toISOString(),
    };
  }
}
