/** Stage 15A: a bounded request shape, not a coding or execution authority. */
export const ayasLocalCodingTaskSchemaVersion = "1" as const;

export interface AyasLocalCodingTaskContract {
  readonly schemaVersion: typeof ayasLocalCodingTaskSchemaVersion;
  readonly taskId: string;
  readonly baseHead: string;
  readonly objective: string;
  readonly exactFiles: readonly string[];
  readonly maxChangedLines: number;
}

export class AyasLocalCodingTaskContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AyasLocalCodingTaskContractError";
  }
}

const HEAD = /^[0-9a-f]{40}$/;
const TASK_ID = /^ayas-coding-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^(?:src|scripts)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx)$/;
const KEYS = ["baseHead", "exactFiles", "maxChangedLines", "objective", "schemaVersion", "taskId"];

/** Parse untrusted task data without accepting backend, command, network or approval fields. */
export function parseAyasLocalCodingTaskContract(value: unknown): AyasLocalCodingTaskContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AyasLocalCodingTaskContractError("task must be an object");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join("|") !== KEYS.join("|")) throw new AyasLocalCodingTaskContractError("task fields are not allowed");
  if (item.schemaVersion !== ayasLocalCodingTaskSchemaVersion) throw new AyasLocalCodingTaskContractError("unsupported task schema");
  if (typeof item.taskId !== "string" || !TASK_ID.test(item.taskId)) throw new AyasLocalCodingTaskContractError("invalid task identity");
  if (typeof item.baseHead !== "string" || !HEAD.test(item.baseHead)) throw new AyasLocalCodingTaskContractError("invalid base HEAD");
  if (typeof item.objective !== "string" || item.objective.length < 8 || item.objective.length > 500
    || /[\u0000-\u001f\u007f]/.test(item.objective)) throw new AyasLocalCodingTaskContractError("invalid objective");
  if (!Array.isArray(item.exactFiles) || item.exactFiles.length < 1 || item.exactFiles.length > 2
    || item.exactFiles.some((file) => typeof file !== "string" || file.length > 180 || !FILE.test(file)
      || file.split("/").some((segment) => segment === "." || segment === ".."))
    || new Set(item.exactFiles).size !== item.exactFiles.length) throw new AyasLocalCodingTaskContractError("invalid exact files");
  if (!Number.isInteger(item.maxChangedLines) || (item.maxChangedLines as number) < 1
    || (item.maxChangedLines as number) > 80) throw new AyasLocalCodingTaskContractError("invalid change budget");
  return Object.freeze({
    schemaVersion: ayasLocalCodingTaskSchemaVersion,
    taskId: item.taskId,
    baseHead: item.baseHead,
    objective: item.objective,
    exactFiles: Object.freeze([...item.exactFiles]),
    maxChangedLines: item.maxChangedLines,
  }) as AyasLocalCodingTaskContract;
}
