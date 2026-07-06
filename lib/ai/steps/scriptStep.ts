import { openai } from "../client";

export async function scriptStep(research: any) {
  const prompt = `
You are a professional YouTube documentary script writer.

Based on this research JSON, create a structured video script.

RESEARCH:
${JSON.stringify(research)}

Return ONLY valid JSON in this format:

{
  "title": string,
  "hook": string,
  "sections": [
    {
      "heading": string,
      "narration": string
    }
  ],
  "outro": string
}

Rules:
- Make it cinematic
- Make it engaging
- Short sentences for voiceover
- No extra text outside JSON
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
  } catch (err) {
    console.error("SCRIPT PARSE ERROR:", text);

    return {
      title: "Error Script",
      hook: "",
      sections: [],
      outro: "",
    };
  }
}