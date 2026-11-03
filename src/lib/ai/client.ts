export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionCreateParams {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function createChatCompletion(
  body: ChatCompletionCreateParams,
): Promise<ChatCompletionResponse> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // A rate limit and an empty account are both 429; only the error's type/code tells them apart.
    const detail = await response
      .json()
      .then((b: { error?: { type?: unknown; code?: unknown } }) => [b?.error?.type, b?.error?.code].filter((x): x is string => typeof x === "string" && x.length > 0).join(" ").slice(0, 80))
      .catch(() => "");
    throw new Error(`OpenAI request failed: ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  return (await response.json()) as ChatCompletionResponse;
}

export const openai = {
  chat: {
    completions: {
      create: createChatCompletion,
    },
  },
};
