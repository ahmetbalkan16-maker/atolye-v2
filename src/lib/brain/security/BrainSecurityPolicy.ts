/**
 * Atölye Brain — deterministic security policy checks (pure).
 *
 * These are the checks the emir insists must be **code-level and deterministic**,
 * never left to a model: allowlist / denylist, path containment, request-risk
 * classification, secret redaction (re-exported from `BrainRedaction`).
 *
 * They are conservative: unknown → block.
 */

import { containsBrainSecret, redactBrainText } from "../BrainRedaction";
import type {
  BrainRequestClassification,
  BrainRequestRisk,
} from "@/types/brainSecurity";

export { redactBrainText, containsBrainSecret };

/* ------------------------------------------------------------------------- *
 * Shell command allowlist
 * ------------------------------------------------------------------------- */

/**
 * The only executables the Brain's executor may spawn unattended. Everything
 * else is denied — there is no "looks safe" path.
 */
export const BRAIN_SHELL_ALLOWLIST: readonly string[] = Object.freeze([
  "node",
  "npx",
  "npm",
  "tsc",
  "eslint",
  "tsx",
  "git",
  "graphify",
  "ffprobe",
]);

/** Argument fragments that turn an allowlisted command into a denied one. */
const SHELL_DENY_FRAGMENTS: readonly RegExp[] = Object.freeze([
  /\brm\s+-rf?\b/i,
  /\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--)\b/i,
  /\bnpm\s+(publish|version)\b/i,
  /\bnpx\s+.*(--yes|-y)\b.*\b(pull|install)\b/i,
  /\bcurl\b|\bwget\b|\bInvoke-WebRequest\b/i,
  />|>>|\|\s*(sh|bash|node)\b/,
  /\bnvidia-smi\b.*(-pl|--power-limit|-lgc|-lmc)/i,
  /\b(shutdown|reboot|bcdedit|reg\s+add|reg\s+delete)\b/i,
  /\bset\s+.*(API|SECRET|TOKEN|KEY)/i,
]);

export interface BrainShellCheck {
  readonly allowed: boolean;
  readonly executable: string;
  readonly reason: string;
}

/**
 * Check a single shell command string. Only the leading executable is matched
 * against the allowlist; the rest is scanned for denied fragments.
 */
export function checkBrainShellCommand(command: string): BrainShellCheck {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, executable: "", reason: "empty command" };

  const executable = (trimmed.split(/\s+/)[0] ?? "")
    .replace(/^["']|["']$/g, "")
    .replace(/\.(exe|cmd|bat)$/i, "")
    .split(/[\\/]/)
    .pop() as string;

  if (!BRAIN_SHELL_ALLOWLIST.includes(executable)) {
    return {
      allowed: false,
      executable,
      reason: `"${executable}" is not on the Brain shell allowlist`,
    };
  }
  for (const fragment of SHELL_DENY_FRAGMENTS) {
    if (fragment.test(trimmed)) {
      return {
        allowed: false,
        executable,
        reason: `command contains a denied fragment (${fragment.source})`,
      };
    }
  }
  if (containsBrainSecret(trimmed)) {
    return { allowed: false, executable, reason: "command string contains a secret-looking value" };
  }
  return { allowed: true, executable, reason: "allowlisted executable, no denied fragments" };
}

/* ------------------------------------------------------------------------- *
 * Path containment
 * ------------------------------------------------------------------------- */

const REPARSE_OR_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]|\\\\)|(^|[\\/])\.\.([\\/]|$)|\0/;

/**
 * `true` when `relativePath` stays inside `baseDir` — no `..`, no absolute
 * root, no UNC, no NUL. Deterministic; does not touch the filesystem.
 */
export function isBrainPathContained(relativePath: string): boolean {
  if (typeof relativePath !== "string" || relativePath.length === 0) return false;
  if (REPARSE_OR_ABSOLUTE.test(relativePath)) return false;
  const parts = relativePath.split(/[\\/]/);
  let depth = 0;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return false;
    } else {
      depth += 1;
    }
  }
  return depth >= 0;
}

/** Paths the Brain worker may WRITE to unattended (workspace + regenerable output). */
export const BRAIN_WRITABLE_PREFIXES: readonly string[] = Object.freeze([
  "data/brain/",
  "docs/brain/",
  ".graphify/",
  "graphify-out/",
]);

export function isBrainWritablePath(relativePath: string): boolean {
  if (!isBrainPathContained(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, "/");
  return BRAIN_WRITABLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/* ------------------------------------------------------------------------- *
 * Request-risk classification
 * ------------------------------------------------------------------------- */

const BLOCK_ACTIONS = /\b(delete|drop|truncate|disable|bypass|exfiltrat|escalat|chmod|chown|sudo)\b/i;
const REVIEW_ACTIONS = /\b(write|modify|update|deploy|publish|install|migrate|rotate|grant|revoke)\b/i;
const SENSITIVE_TARGETS = /\b(\.env|env\.local|secret|credential|auth|token|production|data\/projects|\.git\/)\b/i;

/**
 * Classify a `{ action, target }` pair. `block` → never; `review` → needs the
 * user; `safe` → the Brain may proceed within its autonomy ceiling.
 */
export function classifyBrainRequest(input: {
  readonly action: string;
  readonly target: string;
}): BrainRequestClassification {
  const reasons: string[] = [];
  let risk: BrainRequestRisk = "safe";

  const action = input.action.toLowerCase();
  const target = input.target;

  if (BLOCK_ACTIONS.test(action)) {
    risk = "block";
    reasons.push(`destructive verb in action: "${input.action}"`);
  }
  if (SENSITIVE_TARGETS.test(target)) {
    risk = risk === "block" ? "block" : "review";
    reasons.push(`sensitive target: "${target}"`);
  }
  if (REVIEW_ACTIONS.test(action) && risk === "safe") {
    risk = "review";
    reasons.push(`mutating verb in action: "${input.action}"`);
  }
  if (containsBrainSecret(`${input.action} ${target}`)) {
    risk = "block";
    reasons.push("request text contains a secret-looking value");
  }
  if (reasons.length === 0) reasons.push("read-only / non-sensitive");

  return { risk, reasons };
}
