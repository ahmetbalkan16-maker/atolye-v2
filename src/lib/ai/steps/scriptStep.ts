import { openai } from "../client";
import { createScriptPrompt } from "../prompts/script";

export async function scriptStep(topic: string) {
  const prompt = createScriptPrompt(topic);

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Sen yalnızca geçerli JSON döndüren profesyonel bir Türkçe belgesel senaryo motorusun.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  const text = res.choices[0]?.message?.content || "{}";

  try {
    return JSON.parse(text);
  } catch {
    console.error("SCRIPT PARSE ERROR:", text);

    return {
      topic,
      title: "Senaryo oluşturulamadı",
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
