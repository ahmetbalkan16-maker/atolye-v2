import type { SEOData } from "@/types/seo";

/**
 * Grammar-constraint contract for the SEO planning response.
 *
 * Mirrors `canonicalAnimationProviderSchema` / the other `*StructuredOutput`
 * modules: a frozen descriptor whose `jsonSchema` member is passed to a
 * structured-decoding provider (Ollama's `format`) on the fail-closed path so a
 * small local model is held to the exact response shape. It only fixes
 * STRUCTURE — the field set (`additionalProperties: false`), that the four list
 * fields are non-empty string arrays and the four scalar fields are strings.
 * Everything semantic (non-empty trimmed strings, a round-trip `createdAt`) is
 * still enforced by `isStrictSEOResponse` in `SEOManager`, which runs unchanged.
 *
 * `createdAt` is reconciled with a server timestamp downstream
 * (`SEOManager.getCreatedAt`), so the model only has to emit a plausible string.
 */
const seoResponseFields = [
  "titleSuggestions",
  "description",
  "tags",
  "hashtags",
  "keywords",
  "targetAudience",
  "searchIntent",
  "createdAt",
] as const satisfies readonly (keyof SEOData)[];

const stringArrayProperty = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
} as const;

export const canonicalSeoProviderSchema = Object.freeze({
  responseFields: seoResponseFields,
  additionalProperties: false,
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    required: [...seoResponseFields],
    properties: {
      titleSuggestions: stringArrayProperty,
      description: { type: "string" },
      tags: stringArrayProperty,
      hashtags: stringArrayProperty,
      keywords: stringArrayProperty,
      targetAudience: { type: "string" },
      searchIntent: { type: "string" },
      createdAt: { type: "string" },
    },
  } as Record<string, unknown>,
});
