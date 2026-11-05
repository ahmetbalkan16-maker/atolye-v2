import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The text of a PDF the owner gives AYAS (owner, 5 Nov 2026: "PDF okuma" was the last unread link kind). No new npm
 * dependency: the `pdftotext` that Git for Windows ships (xpdf 4.x; poppler's on Linux/macOS) is run as a plain child
 * process — no shell, a fixed argument list, bounded bytes, pages, time and output — on a temporary copy that is
 * deleted afterwards. Only background callers use it (the V3 idle loop and the research CLI); the live chat server
 * never fetches or parses. The text is untrusted data like any page: quoted, injection-checked, never obeyed.
 */

export const PDF_MAX_BYTES = 15_000_000;
export const PDF_MAX_PAGES = 40;
export const PDF_TEXT_MAX_CHARS = 200_000;
const PDF_TIMEOUT_MS = 30_000;

/** `AYAS_PDFTOTEXT` first, then Git for Windows' copy, then the usual Unix places. */
export function pdfToTextBinary(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const own = env.AYAS_PDFTOTEXT?.trim();
  if (own) return existsSync(own) ? own : undefined;
  const roots = [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs") : undefined].filter((x): x is string => !!x);
  const candidates = [...roots.map((r) => path.join(r, "Git", "mingw64", "bin", "pdftotext.exe")), "/usr/bin/pdftotext", "/usr/local/bin/pdftotext", "/opt/homebrew/bin/pdftotext"];
  return candidates.find((c) => existsSync(c));
}

export type PdfTextResult = { readonly ok: true; readonly text: string; readonly kesildi: boolean } | { readonly ok: false; readonly reason: string };

export async function pdfText(bytes: Buffer, options: { readonly binary?: string; readonly timeoutMs?: number } = {}): Promise<PdfTextResult> {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, reason: "dosya PDF değil (%PDF- imzası yok)" };
  if (bytes.length > PDF_MAX_BYTES) return { ok: false, reason: `PDF ${Math.round(bytes.length / 1e6)} MB — sınır ${PDF_MAX_BYTES / 1e6} MB` };
  const binary = options.binary ?? pdfToTextBinary();
  if (!binary) return { ok: false, reason: "pdftotext bulunamadı (Git for Windows ile gelir; başka yerdeyse AYAS_PDFTOTEXT ile yolu verilebilir)" };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ayas-pdf-"));
  const file = path.join(dir, "girdi.pdf");
  try {
    await fs.writeFile(file, bytes);
    const out = await new Promise<{ readonly stdout: string; readonly error?: string }>((resolve) => {
      execFile(binary, ["-enc", "UTF-8", "-l", String(PDF_MAX_PAGES), "-q", file, "-"], { timeout: options.timeoutMs ?? PDF_TIMEOUT_MS, maxBuffer: 8_000_000, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
        resolve(error ? { stdout: "", error: (error as NodeJS.ErrnoException & { killed?: boolean }).killed ? "süre doldu" : error.message.slice(0, 160) } : { stdout });
      });
    });
    if (out.error) return { ok: false, reason: `PDF metni çıkarılamadı (${out.error})` };
    const text = out.stdout.replace(/\f/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return { ok: false, reason: "PDF'te okunabilir metin yok (taranmış görüntü olabilir; OCR yapılmaz)" };
    return { ok: true, text: text.slice(0, PDF_TEXT_MAX_CHARS), kesildi: text.length > PDF_TEXT_MAX_CHARS };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
