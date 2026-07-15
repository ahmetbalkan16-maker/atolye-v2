import { createHash } from "node:crypto";
import { ProjectManager } from "@/lib/projects/ProjectManager";

export const productionAcceptanceTopicLimits = Object.freeze({
  minimumCharacters: 8,
  maximumCharacters: 120,
});

export type ProductionAcceptanceTopicErrorCode =
  | "PRODUCTION_ACCEPTANCE_TOPIC_EMPTY"
  | "PRODUCTION_ACCEPTANCE_TOPIC_INVALID"
  | "PRODUCTION_ACCEPTANCE_TOPIC_TOO_SHORT"
  | "PRODUCTION_ACCEPTANCE_TOPIC_TOO_LONG";

export class ProductionAcceptanceTopicError extends Error {
  constructor(readonly code: ProductionAcceptanceTopicErrorCode) {
    super("Production acceptance topic validation failed.");
    this.name = "ProductionAcceptanceTopicError";
    this.stack = undefined;
  }
}

export function normalizeProductionAcceptanceTopic(value: string): string {
  const topic = value.trim();
  if (!topic) {
    throw new ProductionAcceptanceTopicError("PRODUCTION_ACCEPTANCE_TOPIC_EMPTY");
  }
  if (/\p{Cc}|\p{Cf}|[\uD800-\uDFFF]/u.test(topic)) {
    throw new ProductionAcceptanceTopicError("PRODUCTION_ACCEPTANCE_TOPIC_INVALID");
  }
  const length = [...topic].length;
  if (length < productionAcceptanceTopicLimits.minimumCharacters) {
    throw new ProductionAcceptanceTopicError("PRODUCTION_ACCEPTANCE_TOPIC_TOO_SHORT");
  }
  if (length > productionAcceptanceTopicLimits.maximumCharacters) {
    throw new ProductionAcceptanceTopicError("PRODUCTION_ACCEPTANCE_TOPIC_TOO_LONG");
  }
  return topic;
}

export function productionAcceptanceTopicFingerprint(topic: string): string {
  return createHash("sha256")
    .update(normalizeProductionAcceptanceTopic(topic))
    .digest("hex");
}

export function createProductionAcceptanceProjectSlug(topic: string, runId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(runId)) {
    throw new ProductionAcceptanceTopicError("PRODUCTION_ACCEPTANCE_TOPIC_INVALID");
  }
  const slug = ProjectManager.createSlug(
    `${normalizeProductionAcceptanceTopic(topic)} ${runId}`,
  );
  if (!/^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?$/.test(slug)) {
    throw new ProductionAcceptanceTopicError("PRODUCTION_ACCEPTANCE_TOPIC_INVALID");
  }
  return slug;
}
