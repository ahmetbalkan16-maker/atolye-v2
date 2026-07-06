import OpenAI from "openai";

console.log("🔥 OPENAI KEY:", process.env.OPENAI_API_KEY);

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});