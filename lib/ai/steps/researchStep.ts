import { openai } from "../client";

export async function researchStep(topic: string) {
  const prompt = `
You are a senior research analyst.

Analyze the topic and return a structured JSON ONLY.

Topic: ${topic}

Return format:
{
  "topic": string,
  "angles": string[],
  "keywords": string[],
  "summary": string
}
`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  });

  const text = res.choices[0].message.content || "{}";

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("JSON PARSE ERROR:", text);

    return {
      topic,
      angles: [],
      keywords: [],
      summary: text,
    };
  }
}