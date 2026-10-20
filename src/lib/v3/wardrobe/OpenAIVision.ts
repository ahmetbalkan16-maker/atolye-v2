import type { AIProvider, AIProviderGenerateOptions, AIProviderResult } from "../../ai/providers/AIProvider";

/**
 * OpenAI chat with image input, for the wardrobe brain only (the designer looks at a real museum piece before drawing
 * it). Kept inside V3 so the shared client and OpenAIProvider of the main app (text only) do not change. Images go as
 * low-detail data URLs (~85 tokens each); usage is reported for the episode budget.
 */
export class OpenAIVisionProvider implements AIProvider {
  async generate(prompt: string, options?: AIProviderGenerateOptions): Promise<AIProviderResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI vision: OPENAI_API_KEY yok");
    const images = options?.images ?? [];
    const content = images.length ? [{ type: "text", text: prompt }, ...images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "low" } }))] : prompt;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: options?.model ?? "gpt-4.1", messages: [{ role: "user", content }], max_tokens: options?.maxTokens ?? 2_000, temperature: 0.4 }),
    });
    if (!res.ok) throw new Error(`OpenAI vision HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      choices?: { finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices?.[0];
    const finish = choice?.finish_reason;
    const finishReason: AIProviderResult["finishReason"] = finish === "stop" || finish === "length" ? finish : finish === "content_filter" ? "content-filter" : "unknown";
    const refused = Boolean(choice?.message?.refusal);
    return {
      content: choice?.message?.content ?? "",
      finishReason,
      refused,
      complete: finishReason === "stop" && !refused,
      truncated: finishReason === "length",
      ...(data.usage ? { usage: { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens } } : {}),
    };
  }
}
