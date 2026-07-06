import { openai } from "../client";

export async function sceneStep(script: any) {
  const prompt = `
You are a cinematic video director.

Convert this script into video scenes.

SCRIPT:
${JSON.stringify(script)}

Return ONLY valid JSON:

{
  "scenes": [
    {
      "visual": string,
      "narration": string,
      "duration": number
    }
  ]
}

Rules:
- cinematic visuals
- each section becomes multiple scenes
- no extra text
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
  });

  const text = res.choices[0].message.content || "{}";

  try {
    return JSON.parse(text);
  } catch {
    return { scenes: [] };
  }
}