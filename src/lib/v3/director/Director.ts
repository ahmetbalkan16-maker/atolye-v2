import { crowdId } from "../costumes/CastMapper";
import type { Episode, EpisodeScene, SceneCrowd, SceneLine } from "../episode/EpisodeTypes";
import type {
  V3Accessory,
  V3Background,
  V3Bubble,
  V3CameraKey,
  V3CaptionPage,
  V3CastMember,
  V3EffectEvent,
  V3Emotion,
  V3Extra,
  V3FaceEvent,
  V3GestureEvent,
  V3Insert,
  V3MoveEvent,
  V3NameTag,
  V3Performer,
  V3Prop,
  V3RenderPlan,
  V3Shake,
  V3Shot,
  V3TitleCard,
  V3Transition,
  V3VisemeKey,
} from "../render/RenderPlanTypes";
import { buildGeoMap, type MapData } from "../maps/MapBuilder";
import type { EpisodeTimeline, LineTiming } from "../timeline/Timeline";

/** A scene's period image, cut in over the set while the narrator speaks. */
export interface SceneInsert {
  readonly src: string;
  readonly caption?: string;
}

export interface DirectorInput {
  readonly episode: Episode;
  readonly timeline: EpisodeTimeline;
  readonly cast: readonly V3CastMember[];
  readonly accessories: readonly V3Accessory[];
  /** One background per scene, already resolved into the render public dir. */
  readonly backgrounds: readonly V3Background[];
  /** Per scene: a period image for the narrator's lines, or nothing. */
  readonly inserts?: readonly (SceneInsert | undefined)[];
  readonly language?: "tr" | "en";
  /** Natural Earth data for scenes with a geographic map (`harita.merkez`). */
  readonly mapData?: MapData;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly showCaptions: boolean;
  readonly audio?: string;
}

const WALK_SPEED = 0.26; // stage widths per second
const RUN_SPEED = 0.62;
const OFFSTAGE_LEFT = -0.14;
const OFFSTAGE_RIGHT = 1.14;
/**
 * Camera centre of a medium shot, as a fraction of the frame height: a little below a front-row face (≈ 0.55), so the
 * head sits in the upper part of the frame and the body leaves it at the knees, as on the reference channel.
 */
const FACE_Y = 0.58;
/** Two-shots and narrator shots sit lower still: the cast fills the frame and the legs leave it. */
const TWO_SHOT_Y = 0.6;

/** How a listener's face answers the speaker's emotion; others keep their own face. */
const LISTENER_REACTION: Partial<Record<V3Emotion, V3Emotion>> = { kizgin: "korkmus", saskin: "saskin", mutlu: "mutlu", korkmus: "saskin" };

interface Slot {
  x: number;
  depth: number;
  facing: "left" | "right";
  seated: boolean;
}

export function autoSlots(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  const margin = count === 2 ? 0.27 : count === 3 ? 0.18 : 0.12;
  return Array.from({ length: count }, (_, i) => margin + ((1 - 2 * margin) * i) / (count - 1));
}

/** Where each visible character of a scene stands: explicit blocking first, then free slots. */
export function placeScene(scene: EpisodeScene, visibleIds: ReadonlySet<string>): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const b of scene.sahne_duzeni ?? []) {
    if (!visibleIds.has(b.karakter)) continue;
    slots.set(b.karakter, { x: b.x, depth: b.derinlik ?? 0.08, facing: b.yon ? (b.yon === "sol" ? "left" : "right") : b.x < 0.5 ? "right" : "left", seated: !!b.oturuyor });
  }
  const needed: string[] = [];
  for (const line of scene.satirlar) {
    for (const id of [line.karakter, typeof line.hedef === "string" ? line.hedef : undefined]) {
      if (id && visibleIds.has(id) && !slots.has(id) && !needed.includes(id)) needed.push(id);
    }
  }
  if (needed.length) {
    const taken = [...slots.values()].map((s) => s.x);
    const candidates = autoSlots(needed.length + taken.length).filter((x) => taken.every((t) => Math.abs(t - x) > 0.12));
    needed.forEach((id, i) => {
      const x = candidates[i] ?? autoSlots(needed.length)[i]!;
      slots.set(id, { x, depth: 0.08, facing: x < 0.5 ? "right" : "left", seated: false });
    });
  }
  return slots;
}

/** Splits a line's words into caption pages: at most 9 words and ~60 characters (two lines). */
export function captionPages(line: LineTiming, fps: number, emphasis: readonly string[], text: string): V3CaptionPage[] {
  const words = line.words.length ? line.words : proportionalWords(line.duration, text);
  const pages: V3CaptionPage[] = [];
  let current: { text: string; start: number; end: number }[] = [];
  const flush = () => {
    if (!current.length) return;
    const f = (t: number) => Math.round((line.start + t) * fps);
    pages.push({
      start: f(current[0]!.start),
      end: f(current[current.length - 1]!.end + 0.12),
      speaker: line.speaker,
      words: current.map((w) => ({ text: w.text, start: f(w.start), end: Math.max(f(w.start) + 1, f(w.end)), ...(isEmphasis(w.text, emphasis) ? { emphasis: true } : {}) })),
    });
    current = [];
  };
  for (const w of words) {
    const chars = current.reduce((n, c) => n + c.text.length + 1, 0) + w.text.length;
    if (current.length >= 9 || chars > 60) flush();
    current.push(w);
  }
  flush();
  // Pages of one line never overlap and the last one holds until the line ends.
  for (let i = 0; i < pages.length - 1; i++) pages[i] = { ...pages[i]!, end: pages[i + 1]!.start };
  return pages;
}

function isEmphasis(word: string, emphasis: readonly string[]): boolean {
  const w = word.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]/gu, "");
  return emphasis.some((e) => {
    const k = e.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]/gu, "");
    return k.length > 0 && w.startsWith(k);
  });
}

/** Fallback word timing when no recognizer is available: time shared by word length. */
export function proportionalWords(duration: number, text: string): { text: string; start: number; end: number }[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const total = parts.reduce((n, p) => n + p.length + 1, 0) || 1;
  let t = 0;
  return parts.map((p) => {
    const d = (duration * (p.length + 1)) / total;
    const w = { text: p, start: t, end: t + d };
    t += d;
    return w;
  });
}

function sideOf(fromX: number, toX: number): "left" | "right" {
  return toX >= fromX ? "right" : "left";
}

function clampCam(zoom: number, cx: number, cy: number): { zoom: number; cx: number; cy: number } {
  const z = Math.max(1, zoom);
  const half = 0.5 / z;
  return { zoom: z, cx: Math.min(1 - half, Math.max(half, cx)), cy: Math.min(1 - half, Math.max(half, cy)) };
}

/** Half the width a front-row character takes on stage (body, open arms, headwear), in stage units. */
export const BODY_HALF = 0.065;

/**
 * Reframes a close shot so no character is cut by the frame edge (the pilot showed half a neighbour at the edge
 * of every close-up): a neighbour half in shot is panned fully out or fully in, whichever is the smaller move that
 * keeps `keep` in frame; when neither works the shot widens step by step.
 */
export function cleanFrame(zoom: number, cx: number, keep: readonly number[], others: readonly number[]): { zoom: number; cx: number } {
  const margin = 0.015;
  const fits = (z: number, c: number) => {
    const half = 0.5 / z;
    const l = c - half, r = c + half;
    if (keep.some((x) => x - BODY_HALF < l + margin || x + BODY_HALF > r - margin)) return false;
    return others.every((x) => x + BODY_HALF <= l || x - BODY_HALF >= r || (x - BODY_HALF >= l && x + BODY_HALF <= r));
  };
  for (let z = Math.max(1, zoom); z >= 1; z = z > 1.0001 ? Math.max(1, z * 0.92) : 0) {
    const half = 0.5 / z;
    const clamp = (c: number) => Math.min(1 - half, Math.max(half, c));
    const c0 = clamp(cx);
    if (fits(z, c0)) return { zoom: z, cx: c0 };
    // Every pan that puts one neighbour's edge exactly on a frame edge, nearest first.
    const options = others
      .flatMap((x) => [x + BODY_HALF + half, x - BODY_HALF + half, x - BODY_HALF - half, x + BODY_HALF - half])
      .map(clamp)
      .sort((a, b) => Math.abs(a - c0) - Math.abs(b - c0));
    const pick = options.find((c) => fits(z, c));
    if (pick !== undefined) return { zoom: z, cx: pick };
    if (z === 1) break;
  }
  return { zoom: 1, cx: 0.5 };
}

/** Deterministic 0..1 sequence from a string (the same crowd stands the same way in every render). */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Where a scene's extras stand: rows well behind the actors (depth 0.72–1, so the actors stay in front and read
 * bigger), spread over
 * their side of the stage; council benches and army blocks stagger alternate rows. Extras face the middle of
 * the stage, an army faces the other side.
 */
export function placeCrowd(groups: readonly SceneCrowd[], sceneId: string): V3Extra[] {
  const out: V3Extra[] = [];
  groups.forEach((g, gi) => {
    const castId = crowdId(sceneId, gi);
    const rand = rng(castId);
    const n = Math.max(2, Math.min(40, Math.round(g.sayi)));
    const [x0, x1] = g.taraf === "sol" ? [0.03, 0.42] : g.taraf === "sag" ? [0.58, 0.97] : [0.04, 0.96];
    const rows = g.duzen === "ordu" ? Math.min(5, Math.max(2, Math.ceil(n / 8))) : g.duzen === "meclis" ? Math.min(3, Math.max(2, Math.ceil(n / 7))) : n > 9 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const step = (x1 - x0) / Math.max(1, perRow - 1);
    let k = 0;
    for (let r = 0; r < rows && k < n; r++) {
      const depth = rows === 1 ? 0.8 : 0.72 + (0.28 * r) / (rows - 1);
      const count = Math.min(perRow, n - k);
      const stagger = g.duzen !== "sira" && r % 2 === 1 ? step / 2 : 0;
      for (let c = 0; c < count; c++, k++) {
        const base = count === 1 ? (x0 + x1) / 2 : x0 + stagger + step * c;
        const x = Math.min(x1, Math.max(x0, base + (rand() - 0.5) * step * (g.duzen === "ordu" ? 0.15 : 0.4)));
        const facing: "left" | "right" = g.duzen === "ordu" ? (g.taraf === "sag" ? "left" : "right") : x < 0.5 ? "right" : "left";
        out.push({ castId, x, depth, facing, scale: 0.72 + rand() * 0.1, mood: g.ruh_hali ?? "notr", seed: Math.floor(rand() * 1e6) });
      }
    }
  });
  return out;
}

/**
 * Narrator stretches of a scene (consecutive off-screen lines) as insert windows, in shot frames. A scene with no
 * one on stage stays on the period image throughout; one where characters act silently cuts away only for its
 * first narrator line, so the acting is seen. With characters on stage a cutaway lasts at most MAX_INSERT_S: the
 * reference channel shows a real painting for a beat, then the story goes on with its characters (a 10-second still
 * painting was the slowest part of the Rubicon pilot).
 */
export const MAX_INSERT_S = 4.5;

export function insertWindows(lines: readonly { start: number; end: number; onScreen: boolean }[], duration: number, fps: number, hasPerformers = true): { start: number; end: number }[] {
  if (!lines.some((l) => l.onScreen)) {
    if (!hasPerformers) return [{ start: 0, end: duration }];
    lines = lines.slice(0, 1);
  }
  const out: { start: number; end: number }[] = [];
  for (const l of lines) {
    if (l.onScreen) continue;
    const start = Math.max(0, l.start - Math.round(0.15 * fps));
    const end = Math.min(duration, l.end + Math.round(0.25 * fps));
    const last = out[out.length - 1];
    // Back-to-back narrator lines stay on the same picture.
    if (last && start - last.end < Math.round(0.8 * fps) && !lines.some((x) => x.onScreen && x.start >= last.end && x.start < start)) last.end = end;
    else out.push({ start, end });
  }
  // The first stretch of a scene starts with the scene (no flash of the empty set before it).
  if (out[0] && out[0].start <= Math.round(0.5 * fps)) out[0].start = 0;
  for (const w of out) w.end = Math.min(w.end, w.start + Math.round(MAX_INSERT_S * fps));
  return out.filter((w) => w.end - w.start >= Math.round(1.5 * fps));
}

export function buildRenderPlan(input: DirectorInput): V3RenderPlan {
  const { episode, timeline, fps } = input;
  const f = (sec: number) => Math.round(sec * fps);
  const visibleIds = new Set(input.cast.map((c) => c.id));
  const shots: V3Shot[] = [];
  const captions: V3CaptionPage[] = [];
  // Characters already introduced with a name tag (the first time they speak in the episode).
  const introduced = new Set<string>();

  episode.sahneler.forEach((scene, si) => {
    const st = timeline.scenes[si]!;
    const start = f(st.start);
    const end = si === episode.sahneler.length - 1 ? f(timeline.duration) : f(timeline.scenes[si + 1]!.start);
    const duration = Math.max(1, end - start);
    const local = (sec: number) => f(sec) - start;
    const lines = timeline.lines.filter((l) => l.sceneIndex === si);
    const slots = placeScene(scene, visibleIds);

    // Per-performer tracks.
    type Track = { x: number; initialX: number; moves: V3MoveEvent[]; gestures: V3GestureEvent[]; faces: V3FaceEvent[]; visemes: V3VisemeKey[]; effects: V3EffectEvent[]; speaking: { start: number; end: number }[]; turns: { frame: number; facing: "left" | "right" }[]; facing: "left" | "right"; lastFace?: V3Emotion };
    const tracks = new Map<string, Track>();
    for (const [id, s] of slots) tracks.set(id, { x: s.x, initialX: s.x, moves: [], gestures: [], faces: [{ start: 0, emotion: "notr" }], visemes: [], effects: [], speaking: [], turns: [], facing: s.facing });
    const firstMoveIsEntry = new Set<string>();

    const camera: V3CameraKey[] = [];
    const shakes: V3Shake[] = [];
    const key = (frame: number, zoom: number, cx: number, cy: number, ease: V3CameraKey["ease"]) => camera.push({ frame: Math.max(0, Math.min(duration - 1, frame)), ...clampCam(zoom, cx, cy), ease });
    /** A key that keeps `keepIds` in frame and cuts nobody in half at the frame edge. */
    const framed = (frame: number, zoom: number, cx: number, cy: number, ease: V3CameraKey["ease"], keepIds: readonly string[]) => {
      const others = [...tracks.entries()].filter(([id]) => !keepIds.includes(id)).map(([, t]) => t.x);
      const c = cleanFrame(zoom, cx, keepIds.map((id) => tracks.get(id)!.x), others);
      key(frame, c.zoom, c.cx, cy, ease);
    };
    const hasPerformers = tracks.size > 0;
    key(0, hasPerformers ? 1.0 : 1.0, 0.5, 0.5, "smooth");
    const bubbles: V3Bubble[] = [];
    const nameTags: V3NameTag[] = [];

    let prevSpeaker: string | undefined;
    let speakerChanges = 0;
    lines.forEach((lt, idx) => {
      const line: SceneLine = scene.satirlar[lt.lineIndex]!;
      const ls = local(lt.start), le = local(lt.end);
      const speaker = tracks.get(line.karakter);
      const targetId = typeof line.hedef === "string" ? line.hedef : undefined;
      const target = targetId ? tracks.get(targetId) : undefined;

      // Movement.
      if (speaker && line.hareket && line.hareket !== "dur") {
        let toX: number | undefined;
        let fromX = speaker.x;
        if (line.hareket === "gir") {
          const slotX = slots.get(line.karakter)!.x;
          fromX = slotX < 0.5 ? OFFSTAGE_LEFT : OFFSTAGE_RIGHT;
          toX = typeof line.hedef === "number" ? line.hedef : slotX;
          if (speaker.moves.length === 0) {
            speaker.initialX = fromX;
            firstMoveIsEntry.add(line.karakter);
          }
        } else if (line.hareket === "cik") {
          toX = speaker.x < 0.5 ? OFFSTAGE_LEFT : OFFSTAGE_RIGHT;
        } else if (typeof line.hedef === "number") {
          toX = line.hedef;
        } else if (target) {
          toX = target.x + (speaker.x < target.x ? -0.17 : 0.17);
        }
        if (toX !== undefined && Math.abs(toX - fromX) > 0.01) {
          const run = line.hareket === "kos";
          const secs = Math.max(0.6, Math.abs(toX - fromX) / (run ? RUN_SPEED : WALK_SPEED));
          speaker.moves.push({ start: ls, end: ls + f(secs), fromX, toX, ...(run ? { run: true } : {}) });
          speaker.x = toX;
        }
      }

      // Speaking, mouth, face, gesture, effect.
      if (speaker) {
        speaker.speaking.push({ start: ls, end: le });
        for (const v of lt.visemes) speaker.visemes.push({ frame: ls + f(v.t), viseme: v.v });
        speaker.visemes.push({ frame: le, viseme: "X" });
        speaker.faces.push({ start: ls, emotion: line.duygu });
        speaker.lastFace = line.duygu;
        const towardX = target?.x ?? nearestOther(tracks, line.karakter)?.x;
        const toward = towardX !== undefined ? sideOf(speaker.x, towardX) : undefined;
        const gesture = line.jest ?? (le - ls >= f(1.0) ? "konus" : undefined);
        if (gesture) speaker.gestures.push({ gesture, start: ls + 2, end: Math.max(ls + 6, le - 3), ...(toward ? { toward } : {}) });
        const effect = line.efekt ?? (line.jest === "sasir" ? "unlem" : undefined);
        if (effect) speaker.effects.push({ effect, start: ls, end: ls + Math.min(f(1.6), le - ls + f(0.5)) });
        if (toward && toward !== speaker.facing && !line.hareket) {
          speaker.turns.push({ frame: ls, facing: toward });
          speaker.facing = toward;
        }
        if (line.balon?.trim()) bubbles.push({ castId: line.karakter, text: line.balon.trim(), start: ls + f(0.08), end: Math.max(le + f(0.35), ls + f(1.6)) });
        if (!introduced.has(line.karakter)) {
          introduced.add(line.karakter);
          const entry = episode.oyuncu_kadrosu.find((c) => c.id === line.karakter);
          const member = input.cast.find((c) => c.id === line.karakter);
          nameTags.push({ castId: line.karakter, name: entry?.ad ?? member?.name ?? line.karakter, ...(entry?.rol ? { role: entry.rol } : {}), start: ls, end: Math.min(duration, ls + f(2.8)) });
        }
      }

      // Listeners turn to the speaker and react a beat later.
      for (const [id, tr] of tracks) {
        if (id === line.karakter) continue;
        if (speaker) {
          const face = sideOf(tr.x, speaker.x);
          if (face !== tr.facing) {
            tr.turns.push({ frame: ls + f(0.15), facing: face });
            tr.facing = face;
          }
          const reaction = LISTENER_REACTION[line.duygu];
          if (reaction && reaction !== tr.lastFace) {
            tr.faces.push({ start: ls + f(0.3), emotion: reaction });
            tr.lastFace = reaction;
          }
        }
      }

      // Camera language.
      const punch = /!\s*$/.test(line.metin) && (line.duygu === "kizgin" || line.duygu === "saskin" || line.efekt === "unlem" || line.jest === "sasir");
      if (speaker) {
        const changed = prevSpeaker !== line.karakter;
        if (changed) speakerChanges++;
        if (changed && speakerChanges % 3 === 0 && tracks.size > 1) {
          // Every third reply: back to a two-shot so the geography stays readable.
          const otherId = targetId && tracks.has(targetId) ? targetId : nearestOtherId(tracks, line.karakter);
          const other = otherId ? tracks.get(otherId) : undefined;
          const mid = other ? (speaker.x + other.x) / 2 : speaker.x;
          const pair = otherId ? [line.karakter, otherId] : [line.karakter];
          key(ls - 1, camera[camera.length - 1]!.zoom, camera[camera.length - 1]!.cx, camera[camera.length - 1]!.cy, "smooth");
          framed(ls, 1.26, mid, TWO_SHOT_Y, "cut", pair);
          framed(le, 1.32, mid, TWO_SHOT_Y, "smooth", pair);
        } else if (changed) {
          const last = camera[camera.length - 1]!;
          key(ls - 1, last.zoom, last.cx, last.cy, "smooth");
          framed(ls, tracks.size > 1 ? 1.62 : 1.42, speaker.x, FACE_Y, "cut", [line.karakter]);
          framed(le, tracks.size > 1 ? 1.7 : 1.5, speaker.x, FACE_Y, "smooth", [line.karakter]);
        } else {
          framed(le, (camera[camera.length - 1]!.zoom ?? 1.4) + 0.08, speaker.x, FACE_Y, "smooth", [line.karakter]);
        }
        if (punch) {
          const last = camera[camera.length - 1]!;
          framed(ls + 3, last.zoom + 0.24, speaker.x, FACE_Y - 0.02, "snap", [line.karakter]);
          shakes.push({ start: ls + 3, end: ls + f(0.3), amplitude: 9 });
        }
        prevSpeaker = line.karakter;
      } else {
        // Narrator: a wide medium shot (the cast large, cut at the legs, as on the reference channel) that keeps
        // drifting so the picture never freezes; an empty stage stays wide.
        const drift = idx % 2 === 0 ? 0.46 : 0.54;
        const last = camera[camera.length - 1]!;
        const wide = hasPerformers ? { from: 1.18, to: 1.26, y: TWO_SHOT_Y } : { from: 1.06, to: 1.14, y: 0.5 };
        if (last.zoom > 1.4) {
          key(ls - 1, last.zoom, last.cx, last.cy, "smooth");
          framed(ls, wide.from, 0.5, wide.y, "cut", []);
        }
        framed(le, wide.to, drift, wide.y, "smooth", []);
        prevSpeaker = undefined;
      }
      if (line.sfx === "top_atisi") shakes.push({ start: ls, end: ls + f(0.7), amplitude: 26 });

      captions.push(...captionPages(lt, fps, line.vurgu ?? [], line.metin));
    });

    // Scene camera cues from the script (seconds from the scene start).
    for (const cue of scene.kamera ?? []) {
      const at = f(cue.t);
      const tgt = cue.hedef ? tracks.get(cue.hedef) : undefined;
      if (cue.tip === "shake") shakes.push({ start: at, end: at + f(0.6), amplitude: 18 });
      else if (cue.tip === "zoom" && tgt) key(at, 1.7, tgt.x, FACE_Y, "snap");
      else if (cue.tip === "pan" && tgt) key(at, 1.2, tgt.x, 0.5, "smooth");
      else if (cue.tip === "cut") key(at, 1.0, 0.5, 0.5, "cut");
    }

    const titleCards: V3TitleCard[] = (scene.yazi_karti ?? []).map((c) => {
      const anchor = lines[Math.min(c.satir ?? 0, lines.length - 1)];
      const s = anchor ? Math.max(0, local(anchor.start) - (c.stil === "bolum" ? f(0.2) : 0)) : 0;
      const len = c.stil === "kelime" ? f(1.3) : c.stil === "bolum" ? f(2.2) : f(2.8);
      return { text: c.metin, ...(c.alt_metin ? { subtext: c.alt_metin } : {}), start: s, end: Math.min(duration - 1, s + len), style: c.stil };
    });

    // A geographic map scene: things appear with the line that names them (satir), else one after another.
    const geo = scene.harita?.merkez && scene.harita.genislik_km && input.mapData
      ? buildGeoMap(scene.harita, input.mapData, input.width, input.height, (index, order) => (index !== undefined && lines[index] ? local(lines[index]!.start) : f(0.4 + order * 1.2)))
      : undefined;
    const mapArrows = (geo ? [] : (scene.harita?.oklar ?? [])).map((o, i) => ({
      points: o.noktalar.map(([x, y]) => ({ x, y })),
      start: f(0.5 + i * 1.3),
      end: f(1.7 + i * 1.3),
      color: o.renk ?? "#e0283c",
      ...(o.etiket ? { label: o.etiket } : {}),
    }));

    const props: V3Prop[] = (scene.dekor ?? []).map((d) => ({ kind: d.tur, x: d.x, depth: d.derinlik ?? 0.3, ...(d.olcek ? { scale: d.olcek } : {}), ...(d.ters ? { flip: true } : {}) }));
    for (const s of slots.values()) if (s.seated && !props.some((p) => p.kind === "taht" && Math.abs(p.x - s.x) < 0.08)) props.push({ kind: "taht", x: s.x, depth: s.depth + 0.02, scale: 1.3 });

    const performers: V3Performer[] = [...tracks.entries()].map(([id, t]) => {
      const s = slots.get(id)!;
      const faces = dedupeByStart(t.faces);
      return {
        castId: id,
        x: firstMoveIsEntry.has(id) ? t.initialX : s.x,
        depth: s.depth,
        facing: s.facing,
        ...(s.seated ? { seated: true } : {}),
        moves: t.moves,
        gestures: t.gestures,
        faces,
        visemes: t.visemes.sort((a, b) => a.frame - b.frame),
        effects: t.effects,
        speaking: t.speaking,
        turns: t.turns,
      };
    });

    const prevMood = si > 0 ? episode.sahneler[si - 1]!.duygu : undefined;
    const transitionIn: V3Transition = scene.gecis ?? (si === 0 ? "kes" : prevMood !== scene.duygu ? "murekkep" : "kaydir");
    const period = input.inserts?.[si];
    const inserts: V3Insert[] = period
      ? insertWindows(lines.map((lt) => ({ start: local(lt.start), end: local(lt.end), onScreen: visibleIds.has(lt.speaker) })), duration, fps, tracks.size > 0).map((w, i) => ({
          src: period.src,
          ...w,
          // Alternate push-in and pull-out so two cutaways to the same picture do not look like a repeat.
          kenBurns: i % 2 === 0 ? { fromZoom: 1.03, toZoom: 1.17, fromX: 0.02, toX: -0.02 } : { fromZoom: 1.18, toZoom: 1.04, fromX: -0.02, toX: 0.02 },
          ...(period.caption ? { caption: period.caption } : {}),
        }))
      : [];
    shots.push({
      id: scene.id,
      sceneId: scene.id,
      start,
      duration,
      background: input.backgrounds[si]!,
      performers,
      props,
      camera: fillTempo(normalizeCamera(camera), shotEventFrames(performers, titleCards, []), duration, fps),
      shakes,
      titleCards,
      mapArrows,
      transitionIn,
      dramatized: lines.some((l) => visibleIds.has(l.speaker)),
      bubbles: settleBubbles(bubbles, duration),
      nameTags,
      inserts,
      extras: placeCrowd(scene.kalabalik ?? [], scene.id),
      ...(geo ? { geoMap: geo } : {}),
    });
  });

  // The opening cover (owner, 20 Oct 2026): the episode title over the first scene's period picture (or its set or
  // map) before anyone speaks; and a subscribe end card over the closing seconds, under the narrator's invitation.
  const intro = timeline.intro ?? 0;
  const first = shots[0];
  if (intro > 0 && first && first.start > 0) {
    const period = input.inserts?.[0];
    shots.unshift({
      id: "kapak",
      sceneId: "kapak",
      start: 0,
      duration: first.start,
      background: period ? { src: period.src, kind: "archival", kenBurns: { fromZoom: 1.02, toZoom: 1.12, fromX: 0.01, toX: -0.01 } } : { ...first.background, kenBurns: { fromZoom: 1, toZoom: 1.08, fromX: 0, toX: 0 } },
      performers: [],
      props: [],
      camera: [{ frame: 0, zoom: 1, cx: 0.5, cy: 0.5 }],
      shakes: [],
      titleCards: [{ text: episode.baslik, subtext: episode.donem, start: 0, end: first.start, style: "kapak" }],
      mapArrows: [],
      transitionIn: "kes",
      dramatized: false,
      ...(first.geoMap && !period ? { geoMap: { ...first.geoMap, territories: [], armies: [], arrows: [] } } : {}),
    });
  }
  const last = shots[shots.length - 1];
  if (last) {
    const len = Math.min(last.duration, f(5));
    const en = input.language === "en";
    shots[shots.length - 1] = { ...last, titleCards: [...last.titleCards, { text: en ? "SUBSCRIBE" : "ABONE OL", subtext: en ? "Thanks for watching!" : "İzlediğin için teşekkürler!", start: last.duration - len, end: last.duration, style: "abone" }] };
  }

  return {
    version: 1,
    episodeId: episode.id,
    title: episode.baslik,
    fps,
    width: input.width,
    height: input.height,
    durationInFrames: f(timeline.duration),
    cast: input.cast,
    accessories: input.accessories,
    shots,
    captions,
    showCaptions: input.showCaptions,
    ...(input.language ? { language: input.language } : {}),
    ...(input.audio ? { audio: input.audio } : {}),
  };
}

function nearestOther<T extends { x: number }>(tracks: ReadonlyMap<string, T>, id: string): T | undefined {
  const me = tracks.get(id);
  if (!me) return undefined;
  let best: T | undefined;
  for (const [other, t] of tracks) {
    if (other === id) continue;
    if (!best || Math.abs(t.x - me.x) < Math.abs(best.x - me.x)) best = t;
  }
  return best;
}

function nearestOtherId<T extends { x: number }>(tracks: ReadonlyMap<string, T>, id: string): string | undefined {
  const me = tracks.get(id);
  if (!me) return undefined;
  let best: string | undefined;
  for (const [other, t] of tracks) {
    if (other !== id && (best === undefined || Math.abs(t.x - me.x) < Math.abs(tracks.get(best)!.x - me.x))) best = other;
  }
  return best;
}

/** One bubble on screen at a time: each one ends before the next begins. */
export function settleBubbles(bubbles: readonly V3Bubble[], duration: number): V3Bubble[] {
  const sorted = [...bubbles].sort((a, b) => a.start - b.start);
  return sorted
    .map((b, i) => ({ ...b, end: Math.min(b.end, duration, sorted[i + 1] ? sorted[i + 1]!.start - 1 : Infinity) }))
    .filter((b) => b.end - b.start >= 8);
}

function dedupeByStart<T extends { start: number }>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const out: T[] = [];
  for (const item of sorted) {
    if (out.length && out[out.length - 1]!.start === item.start) out[out.length - 1] = item;
    else out.push(item);
  }
  return out;
}

/** Frames inside a shot where the picture visibly changes: its start, cards, gestures, expressions, walks, effects, camera keys. */
export function shotEventFrames(
  performers: readonly Pick<V3Performer, "gestures" | "faces" | "moves" | "effects">[],
  titleCards: readonly { readonly start: number }[],
  camera: readonly V3CameraKey[],
): number[] {
  const t = [0, ...titleCards.map((c) => c.start), ...camera.map((k) => k.frame)];
  for (const p of performers) t.push(...p.gestures.map((g) => g.start), ...p.faces.map((x) => x.start), ...p.moves.map((m) => m.start), ...p.effects.map((e) => e.start));
  return [...new Set(t)].sort((a, b) => a - b);
}

/** Events closer than this count as one: a gesture and the expression it starts with are one beat. */
export const EVENT_CLUSTER_S = 0.4;

/** Event times collapsed into beats (see EVENT_CLUSTER_S), in frames. */
export function beats(frames: readonly number[], fps: number): number[] {
  const out: number[] = [];
  for (const f of [...frames].sort((a, b) => a - b)) if (!out.length || f - out[out.length - 1]! > EVENT_CLUSTER_S * fps) out.push(f);
  return out;
}

function cameraAtFrame(keys: readonly V3CameraKey[], frame: number): { zoom: number; cx: number; cy: number } {
  const next = keys.findIndex((k) => k.frame > frame);
  const a = keys[next < 0 ? keys.length - 1 : Math.max(0, next - 1)];
  const b = next < 0 ? undefined : keys[next];
  if (!a) return { zoom: 1, cx: 0.5, cy: 0.5 };
  if (!b || b.frame <= a.frame || b.frame <= frame) return { zoom: a.zoom, cx: a.cx, cy: a.cy };
  const u = (frame - a.frame) / (b.frame - a.frame);
  return { zoom: a.zoom + (b.zoom - a.zoom) * u, cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u };
}

/**
 * Tempo: no stretch longer than `maxGapS` without a visible beat. Long stretches (one long narration over a set)
 * get gentle 5% camera pushes at even spacing, so the picture keeps moving like a filmed shot.
 */
export function fillTempo(camera: readonly V3CameraKey[], events: readonly number[], duration: number, fps: number, maxGapS = 5): V3CameraKey[] {
  const all = beats([...events, ...camera.map((k) => k.frame), duration], fps);
  const added: V3CameraKey[] = [];
  for (let i = 1; i < all.length; i++) {
    const gap = all[i]! - all[i - 1]!;
    const n = Math.ceil(gap / (maxGapS * fps)) - 1;
    for (let k = 1; k <= n; k++) {
      const frame = Math.round(all[i - 1]! + (gap * k) / (n + 1));
      const at = cameraAtFrame(camera, frame);
      added.push({ frame, zoom: Math.min(2.2, at.zoom * 1.05), cx: at.cx, cy: at.cy, ease: "smooth" });
    }
  }
  return added.length ? normalizeCamera([...camera, ...added]) : [...camera];
}

/** Camera keys strictly increasing in time; at equal frames the later instruction wins. */
export function normalizeCamera(keys: readonly V3CameraKey[]): V3CameraKey[] {
  const sorted = keys.map((k, i) => ({ k, i })).sort((a, b) => a.k.frame - b.k.frame || a.i - b.i).map((x) => x.k);
  const out: V3CameraKey[] = [];
  for (const k of sorted) {
    if (out.length && out[out.length - 1]!.frame === k.frame) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}
