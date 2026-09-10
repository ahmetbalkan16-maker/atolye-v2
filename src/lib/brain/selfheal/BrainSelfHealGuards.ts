/**
 * Atölye Brain — Self-Healing: the safety kernel (pure, tiny, audited).
 *
 * Emir §0. These are the boundaries the self-healing system can NEVER cross,
 * expressed as code that fails closed. Every side-effecting adapter (sandbox,
 * apply, benchmark) calls `assertSelfHealActionAllowed` before it does anything.
 *
 * FORBIDDEN for the Brain to self-modify (see BrainPatchSafety) — this file is
 * on the forbidden list and `assertNotSelfModifyingKernel` re-checks that.
 */

import { classifyPatchSet, type BrainPatchSafetyLevel } from "./BrainPatchSafety";

/** EXACT argv tokens a self-heal adapter must never pass (matched token-by-token, not as substrings). */
const FORBIDDEN_ARGV_TOKENS = Object.freeze(["push", "--force", "-f", "--force-with-lease", "clean"]);
/** Substrings that are dangerous anywhere in the joined command (a shell fragment). */
const FORBIDDEN_ARGV_SUBSTRINGS = Object.freeze(["reset --hard", "rm -rf", "> /dev", "git push", "--no-verify"]);

const FORBIDDEN_GIT_SUBCOMMANDS = Object.freeze(["push", "remote", "config", "gc", "prune", "clean"]);

/** Files a self-heal run must never read. */
export function isSecretPath(path: string): boolean {
  const p = String(path ?? "").replace(/\\/g, "/");
  return /(^|\/)\.env($|\.)/.test(p) || p.endsWith(".pem") || p.endsWith(".key") || /id_(rsa|ed25519)/.test(p);
}

export interface SelfHealActionRequest {
  readonly kind: "sandbox-create" | "sandbox-command" | "apply-patch" | "benchmark" | "read-file";
  /** For sandbox-command / benchmark: the argv about to run. */
  readonly argv?: readonly string[];
  /** For apply-patch: the paths the patch touches + its computed safety level. */
  readonly paths?: readonly string[];
  readonly safetyLevel?: BrainPatchSafetyLevel;
  /** For apply-patch: an explicit operator approval id (never the Brain's own). */
  readonly operatorApprovalId?: string | null;
  /** For read-file. */
  readonly path?: string;
}

export interface SelfHealActionVerdict {
  readonly allowed: boolean;
  readonly reason: string;
}

const DENY = (reason: string): SelfHealActionVerdict => ({ allowed: false, reason });
const ALLOW = (reason: string): SelfHealActionVerdict => ({ allowed: true, reason });

/**
 * The single gate every self-heal side effect passes through. Fails closed:
 * anything not explicitly permitted is denied.
 */
export function assertSelfHealActionAllowed(req: SelfHealActionRequest): SelfHealActionVerdict {
  switch (req.kind) {
    case "read-file": {
      if (!req.path) return DENY("read-file requires a path");
      if (isSecretPath(req.path)) return DENY(`refusing to read a secret file: ${req.path}`);
      return ALLOW("read allowed");
    }
    case "sandbox-create":
      return ALLOW("sandbox worktree creation allowed");
    case "sandbox-command":
    case "benchmark": {
      const argv = req.argv ?? [];
      if (argv.length === 0) return DENY("no argv");
      const joined = argv.join(" ").toLowerCase();
      if (argv[0] === "git" || argv[0] === "git.exe") {
        // `git -C <dir> <sub> …` — find the first non-flag, non `-C <path>` token
        let i = 1;
        while (i < argv.length && (argv[i].startsWith("-") || (argv[i] === "-C" && (i += 1) < argv.length))) i += 1;
        const sub = (argv[i] ?? "").toLowerCase();
        if (FORBIDDEN_GIT_SUBCOMMANDS.includes(sub)) return DENY(`git ${sub} is forbidden in a self-heal run`);
      }
      for (const tok of argv) {
        if (FORBIDDEN_ARGV_TOKENS.includes(tok.toLowerCase())) return DENY(`argv contains a forbidden token: "${tok}"`);
      }
      for (const bad of FORBIDDEN_ARGV_SUBSTRINGS) {
        if (joined.includes(bad)) return DENY(`command contains a forbidden fragment: "${bad}"`);
      }
      if (/(^|\s)(npm|pnpm|yarn|npx)\s+(run\s+)?(publish|deploy|release)/.test(joined)) return DENY("publish / deploy / release is forbidden");
      if (/\b(deploy|vercel|netlify|cloudflared|wrangler|fly\s+deploy|gh\s+release)\b/.test(joined)) return DENY("a deployment command is forbidden");
      if (/curl|wget|\bnc\b|ncat|invoke-webrequest|scp\s|rsync\s|ssh\s/.test(joined)) return DENY("network egress commands are forbidden");
      return ALLOW("command allowed");
    }
    case "apply-patch": {
      const verdict = classifyPatchSet(req.paths ?? []);
      if (verdict.forbidden.length > 0) {
        return DENY(`patch touches a FORBIDDEN_AUTONOMOUS area: ${verdict.forbidden.map((f) => f.path).join(", ")}`);
      }
      if (verdict.level !== "SAFE") {
        if (!req.operatorApprovalId) {
          return DENY(`patch is ${verdict.level} — an explicit operator approval id is required to apply it`);
        }
        return ALLOW(`patch is ${verdict.level} but carries operator approval ${req.operatorApprovalId}`);
      }
      // SAFE patches still require an operator approval id in the current
      // contract (the Brain proposes; the operator applies). A future opt-in
      // could relax this for SAFE only — never here, never silently.
      if (!req.operatorApprovalId) {
        return DENY("SAFE patch — still requires the operator apply command (the Brain never writes the working tree on its own)");
      }
      return ALLOW(`SAFE patch approved by operator ${req.operatorApprovalId}`);
    }
    default:
      return DENY("unknown action");
  }
}

/** Invariants that must hold for the whole system — checked in the security smoke. */
export const BRAIN_SELFHEAL_INVARIANTS = Object.freeze({
  executionGateNeverOpened: "the self-heal system never imports or calls anything that can open ayasExecutionGate",
  writeActionsNeverEnabled: "the self-heal system never sets writeActionsEnabled",
  noSecretsInStore: "every stored string passes redactBrainText; a leak is rejected, not masked-and-kept",
  noPushMergeDeploy: "no self-heal command may run git push / merge-to-main / a deploy",
  kernelNotSelfModified: "BrainPatchSafety / BrainSelfHealLimits / BrainUntrustedInput / BrainSelfHealGuards are FORBIDDEN_AUTONOMOUS",
  operatorAppliesPatches: "APPLIED requires an operator approval id; the Brain reaches AWAITING_APPROVAL and stops",
  noProofMeansUnknown: "the anomaly classifier returns UNKNOWN when it cannot prove a cause",
});

/** True when `path` is a file the Brain must never author a patch for. */
export function assertNotSelfModifyingKernel(paths: readonly string[]): SelfHealActionVerdict {
  const kernel = classifyPatchSet(paths).forbidden.filter((f) =>
    f.why.includes("self-healing safety kernel") || f.why.includes("autonomy / security policy"),
  );
  return kernel.length
    ? DENY(`patch would modify the safety kernel: ${kernel.map((k) => k.path).join(", ")}`)
    : ALLOW("does not touch the safety kernel");
}
