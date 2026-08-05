import fs from "node:fs";
import path from "node:path";
import {
  type ProductionPipelineRetryBudgetExtensionBody,
  type ProductionPipelineRetryBudgetExtensionReceipt,
  type RetryBudgetExtensionReceiptState,
  validateExtensionBodyIntegrity,
  validateExtensionReceiptIntegrity,
} from "./ProductionPipelineRetryBudgetExtensionSchema";
import { createRuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";

export interface RetryBudgetExtensionStoreResult<T> {
  readonly ok: boolean;
  readonly status: "created" | "found" | "replayed" | "not-found" | "conflict" | "failed";
  readonly writeFree: boolean;
  readonly value?: T;
  readonly reasonCode: string;
  readonly evidence: readonly string[];
}

export function getRetryBudgetExtensionDirectory(projectSlug: string): string {
  const context = createRuntimeStorageContext();
  return path.join(context.runtimeRoot, projectSlug, "production-execution", "retry-budget-extensions");
}

function ensureExtensionDirectory(projectSlug: string): string {
  const dir = getRetryBudgetExtensionDirectory(projectSlug);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function writeRetryBudgetExtensionAuthority(
  projectSlug: string,
  body: ProductionPipelineRetryBudgetExtensionBody,
): RetryBudgetExtensionStoreResult<ProductionPipelineRetryBudgetExtensionBody> {
  if (!validateExtensionBodyIntegrity(body)) {
    return {
      ok: false,
      status: "failed",
      writeFree: true,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_INTEGRITY_MISMATCH",
      evidence: ["body:integrity-invalid"],
    };
  }

  const dir = ensureExtensionDirectory(projectSlug);
  const authorityPath = path.join(dir, `authority-${body.authorityId}.json`);

  if (fs.existsSync(authorityPath)) {
    try {
      const existingText = fs.readFileSync(authorityPath, "utf8");
      const existingBody = JSON.parse(existingText) as ProductionPipelineRetryBudgetExtensionBody;
      if (!validateExtensionBodyIntegrity(existingBody)) {
        return {
          ok: false,
          status: "conflict",
          writeFree: true,
          reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_CORRUPT",
          evidence: ["store:existing-authority-corrupt"],
        };
      }
      if (existingBody.authorityId === body.authorityId) {
        return {
          ok: true,
          status: "replayed",
          writeFree: true,
          value: existingBody,
          reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_REPLAYED",
          evidence: ["store:authority-replayed"],
        };
      }
    } catch {
      return {
        ok: false,
        status: "conflict",
        writeFree: true,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_CORRUPT",
        evidence: ["store:existing-authority-unreadable"],
      };
    }
  }

  const tempPath = path.join(dir, `authority-${body.authorityId}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(body, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, authorityPath);
    return {
      ok: true,
      status: "created",
      writeFree: false,
      value: body,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_PUBLISHED",
      evidence: ["store:authority-published"],
    };
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
    const isEExist = error && typeof error === "object" && "code" in error && error.code === "EEXIST";
    if (isEExist || fs.existsSync(authorityPath)) {
      try {
        const existingText = fs.readFileSync(authorityPath, "utf8");
        const existingBody = JSON.parse(existingText) as ProductionPipelineRetryBudgetExtensionBody;
        if (existingBody.authorityId === body.authorityId && validateExtensionBodyIntegrity(existingBody)) {
          return {
            ok: true,
            status: "replayed",
            writeFree: false,
            value: existingBody,
            reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_REPLAYED",
            evidence: ["store:authority-replayed-after-commit"],
          };
        }
      } catch { /* ignore */ }
    }
    return {
      ok: false,
      status: "failed",
      writeFree: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_PUBLICATION_FAILED",
      evidence: [`store:write-error:${error}`],
    };
  }
}

export function readRetryBudgetExtensionAuthority(
  projectSlug: string,
  authorityId: string,
): RetryBudgetExtensionStoreResult<ProductionPipelineRetryBudgetExtensionBody> {
  const dir = getRetryBudgetExtensionDirectory(projectSlug);
  const authorityPath = path.join(dir, `authority-${authorityId}.json`);
  if (!fs.existsSync(authorityPath)) {
    return {
      ok: false,
      status: "not-found",
      writeFree: true,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_NOT_FOUND",
      evidence: ["store:authority-not-found"],
    };
  }
  try {
    const text = fs.readFileSync(authorityPath, "utf8");
    const body = JSON.parse(text) as ProductionPipelineRetryBudgetExtensionBody;
    if (!validateExtensionBodyIntegrity(body) || body.authorityId !== authorityId) {
      return {
        ok: false,
        status: "conflict",
        writeFree: true,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_CORRUPT",
        evidence: ["store:authority-corrupt"],
      };
    }
    return {
      ok: true,
      status: "found",
      writeFree: true,
      value: body,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_FOUND",
      evidence: ["store:authority-found"],
    };
  } catch {
    return {
      ok: false,
      status: "conflict",
      writeFree: true,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_CORRUPT",
      evidence: ["store:authority-unreadable"],
    };
  }
}

export function writeRetryBudgetExtensionReceipt(
  projectSlug: string,
  receipt: ProductionPipelineRetryBudgetExtensionReceipt,
): RetryBudgetExtensionStoreResult<ProductionPipelineRetryBudgetExtensionReceipt> {
  if (!validateExtensionReceiptIntegrity(receipt)) {
    return {
      ok: false,
      status: "failed",
      writeFree: true,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
      evidence: ["receipt:integrity-invalid"],
    };
  }

  const dir = ensureExtensionDirectory(projectSlug);
  const receiptPath = path.join(dir, `receipt-${receipt.authorityId}-${receipt.state}.json`);

  if (fs.existsSync(receiptPath)) {
    try {
      const text = fs.readFileSync(receiptPath, "utf8");
      const existing = JSON.parse(text) as ProductionPipelineRetryBudgetExtensionReceipt;
      if (validateExtensionReceiptIntegrity(existing) && existing.authorityId === receipt.authorityId) {
        if (existing.jobVersion === receipt.jobVersion && existing.integrity.fingerprint === receipt.integrity.fingerprint) {
          return {
            ok: true,
            status: "replayed",
            writeFree: true,
            value: existing,
            reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_REPLAYED",
            evidence: [`store:receipt-${receipt.state}-replayed`],
          };
        }
        return {
          ok: false,
          status: "conflict",
          writeFree: true,
          reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
          evidence: [`store:receipt-${receipt.state}-already-exists-conflict`],
        };
      }
    } catch {
      return {
        ok: false,
        status: "conflict",
        writeFree: true,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
        evidence: [`store:receipt-${receipt.state}-corrupt`],
      };
    }
  }

  try {
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    return {
      ok: true,
      status: "created",
      writeFree: false,
      value: receipt,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_WRITTEN",
      evidence: [`store:receipt-${receipt.state}-written`],
    };
  } catch (error) {
    const isEExist = error && typeof error === "object" && "code" in error && error.code === "EEXIST";
    if (isEExist || fs.existsSync(receiptPath)) {
      try {
        const text = fs.readFileSync(receiptPath, "utf8");
        const existing = JSON.parse(text) as ProductionPipelineRetryBudgetExtensionReceipt;
        if (existing.authorityId === receipt.authorityId && validateExtensionReceiptIntegrity(existing)) {
          if (existing.jobVersion === receipt.jobVersion && existing.integrity.fingerprint === receipt.integrity.fingerprint) {
            return {
              ok: true,
              status: "replayed",
              writeFree: false,
              value: existing,
              reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_REPLAYED",
              evidence: [`store:receipt-${receipt.state}-replayed-after-commit`],
            };
          }
          return {
            ok: false,
            status: "conflict",
            writeFree: true,
            reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_ALREADY_CONSUMED",
            evidence: [`store:receipt-${receipt.state}-already-exists-conflict`],
          };
        }
      } catch { /* ignore */ }
    }

    return {
      ok: false,
      status: "failed",
      writeFree: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_WRITE_FAILED",
      evidence: [`store:receipt-write-error:${error}`],
    };
  }
}

export function readRetryBudgetExtensionReceipt(
  projectSlug: string,
  authorityId: string,
  state: RetryBudgetExtensionReceiptState,
): RetryBudgetExtensionStoreResult<ProductionPipelineRetryBudgetExtensionReceipt> {
  const dir = getRetryBudgetExtensionDirectory(projectSlug);
  const receiptPath = path.join(dir, `receipt-${authorityId}-${state}.json`);
  if (!fs.existsSync(receiptPath)) {
    return {
      ok: false,
      status: "not-found",
      writeFree: true,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_NOT_FOUND",
      evidence: [`store:receipt-${state}-not-found`],
    };
  }
  try {
    const text = fs.readFileSync(receiptPath, "utf8");
    const receipt = JSON.parse(text) as ProductionPipelineRetryBudgetExtensionReceipt;
    if (!validateExtensionReceiptIntegrity(receipt) || receipt.authorityId !== authorityId || receipt.state !== state) {
      return {
        ok: false,
        status: "conflict",
        writeFree: true,
        reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
        evidence: [`store:receipt-${state}-corrupt`],
      };
    }
    return {
      ok: true,
      status: "found",
      writeFree: true,
      value: receipt,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_FOUND",
      evidence: [`store:receipt-${state}-found`],
    };
  } catch {
    return {
      ok: false,
      status: "conflict",
      writeFree: true,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_RECEIPT_CORRUPT",
      evidence: [`store:receipt-${state}-unreadable`],
    };
  }
}
