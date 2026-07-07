export function extractJson(response: string): string {
  const trimmed = response.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

export function safeJsonParse<T>(jsonText: string): T | null {
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}

export function parseAIJsonResponse<T>(response: string): T {
  const parsed = safeJsonParse<T>(extractJson(response));

  if (!parsed) {
    throw new Error("AI response could not be parsed as JSON.");
  }

  return parsed;
}
