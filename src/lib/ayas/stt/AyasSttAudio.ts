/**
 * AYAS STT — audio container sniffing (Voice Closure Sprint).
 *
 * A tiny magic-byte check so a request body that is not audio is rejected with
 * a `400` before anything spawns. ffmpeg does the real decoding; this only
 * gates the obviously-wrong input and picks a temp-file extension.
 *
 * Browsers in scope produce: WAV (AudioWorklet PCM we wrap ourselves),
 * `audio/webm;codecs=opus` (Chromium MediaRecorder), `audio/mp4`/`audio/aac`
 * (iOS MediaRecorder), and Ogg/Opus (Firefox).
 */

export interface AudioContainer {
  readonly kind: "wav" | "webm" | "ogg" | "mp4" | "mp3" | "aac";
  readonly ext: string;
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

export function sniffAudioContainer(bytes: Uint8Array): AudioContainer | null {
  if (bytes.length < 12) return null;

  // RIFF....WAVE
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return { kind: "wav", ext: "wav" };
  // EBML (Matroska / WebM): 1A 45 DF A3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: "webm", ext: "webm" };
  }
  // OggS
  if (ascii(bytes, 0, 4) === "OggS") return { kind: "ogg", ext: "ogg" };
  // ISO-BMFF: bytes 4..8 == "ftyp"
  if (ascii(bytes, 4, 4) === "ftyp") return { kind: "mp4", ext: "m4a" };
  // ADTS AAC: 0xFFF sync + layer 0
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { kind: "aac", ext: "aac" };
  // MP3: ID3 tag or MPEG frame sync
  if (ascii(bytes, 0, 3) === "ID3") return { kind: "mp3", ext: "mp3" };
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { kind: "mp3", ext: "mp3" };

  return null;
}
