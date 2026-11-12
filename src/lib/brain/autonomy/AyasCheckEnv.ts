/**
 * The one rule for which environment variables code a developer build wrote may never see (11 Nov 2026 security
 * review; owner 2026-11-12: "kalan güvenlik açıklarını kapatalım"). Before this module the V3 developer's checks
 * (`src/lib/v3/util/Proc.ts`) and the code-apply runner's re-verification (`AyasCodeChangeApplyRunner`) each kept their
 * own list, and the runner's had drifted behind (it still handed GEMINI_*, GOOGLE_*, GH_*, GIT_ASKPASS, passphrases,
 * sessions and V3's secrets-file pointer to the checks). It lives here, under `src/lib/brain/autonomy/`, because the
 * code lane refuses every file in this folder: a build can never loosen the rule its own checks run under.
 *
 * Pure: no imports, no process, no file. Callers pass the environment and get a filtered copy.
 */

/**
 * Variable names a build's checks never see: credentials and the settings that lead to them (API keys, tokens,
 * passwords, OAuth/session material, cloud and model vendors, YouTube, GitHub, Git's askpass/credential-manager and
 * env-injected config, connection strings, webhook URLs, credential files, V3's pointer to its secrets file). Matched on
 * the upper-cased name; `PWD`, `PATH`, `SESSIONNAME` and the ATOLYE_V3_* path settings do not match.
 */
export const AYAS_CHECK_ENV_DENY: readonly RegExp[] = Object.freeze([
  /KEY/, /TOKEN/, /SECRET/, /PASSW/, /PASSPHRASE/, /CREDENTIAL/, /COOKIE/, /(?:^|_)O?AUTH(?:_|$)/, /(?:^|_)SESSION(?:_|$)/,
  /PRIVATE/, /WEBHOOK/, /JWT/, /NETRC/, /(?:^|_)DSN$/, /^(?:DATABASE|DB|REDIS|MONGO(?:DB)?|POSTGRES(?:QL)?|MYSQL)_URL$/,
  /^OPENAI/, /^ANTHROPIC/, /^CLAUDE/, /^GEMINI/, /^GOOGLE/, /^YOUTUBE/, /^ELEVENLABS/, /^GH_/, /^GITHUB/, /^GCM_/,
  /^AWS_/, /^AZURE_/, /^HF_/, /^HUGGING/, /^CLOUDFLARE/, /^CF_/, /^AYAS_PHONE/, /^KUBECONFIG$/,
  /^(?:GIT|SSH)_ASKPASS$/, /^SSH_AUTH_SOCK$/, /^GIT_CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS)/,
  /^ATOLYE_V3_SECRETS_ENV$/,
]);

/** Whether a variable name is credential-shaped by `AYAS_CHECK_ENV_DENY` (case-insensitive: Windows names are). */
export function isAyasCheckEnvDenied(name: string): boolean {
  const upper = name.toUpperCase();
  return AYAS_CHECK_ENV_DENY.some((pattern) => pattern.test(upper));
}

/**
 * A copy of `env` without any variable `AYAS_CHECK_ENV_DENY` matches (and without undefined values). The checks run
 * code the build just wrote (its own smoke suites included), and the build's task comes partly from LLM-written
 * reports of fetched material: an injected instruction must not find the OpenAI key, AYAS_ACCESS_KEY or Git
 * credentials in the environment. A deny list, not an allow list: tsc, tsx, node, git and the lint keep PATH,
 * SystemRoot, TEMP/TMP, USERPROFILE, APPDATA, NPM_CONFIG_CACHE, NODE_OPTIONS and every non-secret setting. Files are
 * not covered: a check can still read a secrets file by its path — this removes only what the process is handed.
 */
export function ayasCheckEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || isAyasCheckEnvDenied(name)) continue;
    out[name] = value;
  }
  return out;
}
