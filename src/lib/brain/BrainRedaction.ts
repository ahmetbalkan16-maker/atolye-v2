/**
 * Atölye Brain — deterministic secret / sensitive-string scrubber.
 *
 * Applied to everything the Brain writes down (memory, decision evidence,
 * proposals, worker reports, security findings). It is **code-level and
 * deterministic** — the model is never trusted to "know not to log the key".
 *
 * It errs toward over-redaction: a false positive costs a `[redacted:…]`
 * marker, a false negative costs a leaked credential.
 */

export type BrainRedactionHit =
  | "openai-key"
  | "anthropic-key"
  | "google-key"
  | "aws-key"
  | "slack-token"
  | "github-token"
  | "bearer-token"
  | "jwt"
  | "private-key-block"
  | "env-secret-assignment"
  | "connection-string"
  | "absolute-path"
  | "email";

export interface BrainRedactionResult {
  readonly text: string;
  readonly redacted: boolean;
  readonly hits: readonly BrainRedactionHit[];
}

interface Rule {
  readonly hit: BrainRedactionHit;
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

const RULES: readonly Rule[] = [
  {
    hit: "private-key-block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    replace: () => "[redacted:private-key-block]",
  },
  {
    hit: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
    replace: () => "[redacted:anthropic-key]",
  },
  {
    hit: "openai-key",
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: () => "[redacted:openai-key]",
  },
  {
    hit: "google-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: () => "[redacted:google-key]",
  },
  {
    hit: "aws-key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => "[redacted:aws-key]",
  },
  {
    hit: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => "[redacted:slack-token]",
  },
  {
    hit: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    replace: () => "[redacted:github-token]",
  },
  {
    hit: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => "[redacted:jwt]",
  },
  {
    hit: "connection-string",
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"']+/gi,
    replace: () => "[redacted:connection-string]",
  },
  {
    hit: "bearer-token",
    pattern: /\b(?:Bearer|Authorization:\s*Bearer)\s+[A-Za-z0-9._~+/-]{12,}=*/g,
    replace: () => "Bearer [redacted:bearer-token]",
  },
  {
    hit: "env-secret-assignment",
    // KEY=value / "key": "value" where the key name looks sensitive.
    pattern:
      /\b([A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|AUTH)[A-Z0-9_]*)\s*([=:])\s*("?)([^\s"']{4,})\3/gi,
    replace: (_m, key: string, sep: string) => `${key}${sep} [redacted:env-secret-assignment]`,
  },
  {
    hit: "absolute-path",
    // Windows drive paths and *nix home paths — carry a username.
    pattern: /(?:[A-Za-z]:\\[^\s"'|]+|\/(?:home|Users|root)\/[^\s"'|]+)/g,
    replace: () => "[redacted:absolute-path]",
  },
  {
    hit: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: () => "[redacted:email]",
  },
];

/**
 * Scrub a string. Deterministic: the same input always yields the same output
 * and the same ordered `hits`.
 */
export function redactBrainText(input: string): BrainRedactionResult {
  if (typeof input !== "string" || input.length === 0) {
    return { text: input ?? "", redacted: false, hits: [] };
  }
  let text = input;
  const hits: BrainRedactionHit[] = [];
  for (const rule of RULES) {
    // Fresh regex per call — `RULES` is module-level and a shared global regex
    // carries `lastIndex` between calls, which would make redaction
    // non-deterministic across repeated inputs.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const next = text.replace(pattern, rule.replace as never);
    if (next !== text) {
      hits.push(rule.hit);
      text = next;
    }
  }
  return { text, redacted: hits.length > 0, hits };
}

/** Convenience: scrub every string in an array, preserving order. */
export function redactBrainLines(lines: readonly string[]): {
  readonly lines: readonly string[];
  readonly redacted: boolean;
  readonly hits: readonly BrainRedactionHit[];
} {
  const hits = new Set<BrainRedactionHit>();
  let redacted = false;
  const out = lines.map((line) => {
    const result = redactBrainText(line);
    if (result.redacted) {
      redacted = true;
      for (const hit of result.hits) hits.add(hit);
    }
    return result.text;
  });
  return { lines: out, redacted, hits: [...hits] };
}

/** `true` when the string still contains something that looks secret. */
export function containsBrainSecret(input: string): boolean {
  return redactBrainText(input).redacted;
}
