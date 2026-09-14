import type { AyasExecutionActionId, AyasExecutionRequest } from "./AyasExecutionPolicy";

export class AyasActionValidationError extends Error {
  constructor(readonly reasonCode: string, message: string) { super(message); this.name = "AyasActionValidationError"; }
}

export interface AyasExecutorResult {
  readonly action: AyasExecutionActionId | "resume-stage";
  readonly write: boolean;
  readonly sideEffectApplied?: boolean;
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type AyasExecutor = (request: AyasExecutionRequest) => Promise<AyasExecutorResult>;
