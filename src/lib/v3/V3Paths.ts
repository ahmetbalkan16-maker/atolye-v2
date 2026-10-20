import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Where V3 finds its tools and writes its work. Machine-specific values come from the environment or from
 * an optional `.env.v3.local` (git-ignored by the `.env*` rule); defaults stay inside the repository.
 */
export interface V3Paths {
  readonly repoRoot: string;
  readonly remotionRoot: string;
  readonly contentRoot: string;
  readonly workRoot: string;
  /** Rhubarb, TTS venv, downloaded models. */
  readonly toolsRoot: string;
  /** Third-party licensed music in MusicLibrary's layout (`<mood>/<file>` + `.license.json`), outside git. */
  readonly musicRoot: string;
  /** Existing SDXL backdrop cache (`bin/ayas-local-visual/library`). */
  readonly backdropLibrary: string;
  readonly piperExe: string;
  readonly piperVoice: string;
  readonly whisperExe: string;
  readonly whisperModel: string;
  readonly rhubarbExe: string;
  readonly ttsPython: string;
  /** Second venv for Kokoro (English TTS) and SDXL (background designer); keeps Chatterbox's pins untouched. */
  readonly genPython: string;
  /** SDXL base 1.0 weights (diffusers layout) for designing period sets. */
  readonly sdxlModel: string;
  /** Owner voice reference clips for cloning; never inside the repository. */
  readonly voiceRefRoot: string;
  /** An ASCII-only scratch folder: whisper.cpp and Rhubarb refuse Unicode paths on Windows. */
  readonly asciiTemp: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

function loadEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/** Secrets V3 may borrow from another env file; nothing else is read from it. */
const BORROWABLE_SECRETS = new Set(["OPENAI_API_KEY"]);

/**
 * A secret for this process only: the environment first, then the env file named by `ATOLYE_V3_SECRETS_ENV`
 * (e.g. the main app's `.env.local`), so the key is never copied into the worktree. Returns undefined if absent.
 */
export function v3Secret(name: string, repoRoot = process.cwd(), env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (!BORROWABLE_SECRETS.has(name)) throw new Error(`V3_SECRET_NOT_ALLOWED: ${name}`);
  if (env[name]) return env[name];
  const from = env.ATOLYE_V3_SECRETS_ENV || loadEnvFile(path.join(repoRoot, ".env.v3.local")).ATOLYE_V3_SECRETS_ENV;
  return (from ? loadEnvFile(from)[name] : undefined) || undefined;
}

export function resolveV3Paths(repoRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): V3Paths {
  const file = loadEnvFile(path.join(repoRoot, ".env.v3.local"));
  // An empty value (as in `.env.v3.example`) means "use the default".
  const get = (key: string, fallback: string) => env[key] || file[key] || fallback;
  const bin = path.join(repoRoot, "bin");
  const toolsRoot = get("ATOLYE_V3_TOOLS_ROOT", path.join(bin, "v3-tools"));
  return {
    repoRoot,
    remotionRoot: path.join(repoRoot, "remotion-v3"),
    contentRoot: path.join(repoRoot, "content", "v3"),
    workRoot: get("ATOLYE_V3_WORK_ROOT", path.join(repoRoot, "output", "v3")),
    toolsRoot,
    musicRoot: get("ATOLYE_V3_MUSIC_ROOT", path.join(toolsRoot, "music")),
    backdropLibrary: get("ATOLYE_V3_BACKDROP_LIBRARY", path.join(bin, "ayas-local-visual", "library")),
    piperExe: get("ATOLYE_V3_PIPER_EXE", path.join(bin, "piper", "piper.exe")),
    piperVoice: get("ATOLYE_V3_PIPER_VOICE", path.join(bin, "piper", "tr_TR-dfki-medium.onnx")),
    whisperExe: get("ATOLYE_V3_WHISPER_EXE", path.join(bin, "whisper", "cublas", "Release", "whisper-cli.exe")),
    whisperModel: get("ATOLYE_V3_WHISPER_MODEL", path.join(bin, "whisper", "ggml-large-v3-turbo.bin")),
    rhubarbExe: get("ATOLYE_V3_RHUBARB_EXE", path.join(toolsRoot, "rhubarb", "Rhubarb-Lip-Sync-1.14.0-Windows", "rhubarb.exe")),
    ttsPython: get("ATOLYE_V3_TTS_PYTHON", path.join(toolsRoot, "tts-venv", "Scripts", "python.exe")),
    genPython: get("ATOLYE_V3_GEN_PYTHON", path.join(toolsRoot, "gen-venv", "Scripts", "python.exe")),
    sdxlModel: get("ATOLYE_V3_SDXL_MODEL", path.join(get("ATOLYE_V3_BACKDROP_LIBRARY", path.join(bin, "ayas-local-visual", "library")), "..", "model")),
    voiceRefRoot: get("ATOLYE_V3_VOICE_REFS", path.join(repoRoot, "output", "v3-voices")),
    asciiTemp: get("ATOLYE_V3_ASCII_TEMP", path.join(repoRoot, "output", "v3-tmp")),
    ffmpeg: get("ATOLYE_V3_FFMPEG", "ffmpeg"),
    ffprobe: get("ATOLYE_V3_FFPROBE", "ffprobe"),
  };
}
