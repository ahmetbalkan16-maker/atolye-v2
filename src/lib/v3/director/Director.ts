import type { Episode, EpisodeScene, SceneLine } from "../episode/EpisodeTypes";
import type {
  V3Accessory,
  V3Background,
  V3CameraKey,
  V3CaptionPage,
  V3CastMember,
  V3EffectEvent,
  V3Emotion,
  V3FaceEvent,
  V3GestureEvent,
  V3MoveEvent,
  V3Performer,
  V3Prop,
  V3RenderPlan,
  V3Shake,
  V3Shot,
  V3TitleCard,
  V3Transition,
  V3VisemeKey,
} from "../render/RenderPlanTypes";
import type { EpisodeTimeline, LineTiming } from "../timeline/Timeline";

export interface DirectorInput {
  readonly episode: Episode;
  readonly timeline: EpisodeTimeline;
  readonly cast: readonly V3CastMember[];
  readonly accessories: readonly V3Accessory[];
  /** One background per scene, already resolved into the render public dir. */
  readonly backgrounds: readonly V3Background[];
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
/** Head height of a front-row character, as a fraction of the frame height; medium shots centre here. */
const FACE_Y = 0.52;

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

export function buildRenderPlan(input: DirectorInput): V3RenderPlan {
  const { episode, timeline, fps } = input;
  const f = (sec: number) => Math.round(sec * fps);
  const visibleIds = new Set(input.cast.map((c) => c.id));
  const shots: V3Shot[] = [];
  const captions: V3CaptionPage[] = [];

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
    const hasPerformers = tracks.size > 0;
    key(0, hasPerformers ? 1.0 : 1.0, 0.5, 0.5, "smooth");

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
          const other = target ?? nearestOther(tracks, line.karakter);
          const mid = other ? (speaker.x + other.x) / 2 : speaker.x;
          key(ls - 1, camera[camera.length - 1]!.zoom, camera[camera.length - 1]!.cx, camera[camera.length - 1]!.cy, "smooth");
          key(ls, 1.12, mid, 0.5, "cut");
          key(le, 1.18, mid, 0.5, "smooth");
        } else if (changed) {
          const last = camera[camera.length - 1]!;
          key(ls - 1, last.zoom, last.cx, last.cy, "smooth");
          key(ls, tracks.size > 1 ? 1.48 : 1.3, speaker.x, FACE_Y, "cut");
          key(le, tracks.size > 1 ? 1.56 : 1.36, speaker.x, FACE_Y, "smooth");
        } else {
          key(le, (camera[camera.length - 1]!.zoom ?? 1.4) + 0.08, speaker.x, FACE_Y, "smooth");
        }
        if (punch) {
          const last = camera[camera.length - 1]!;
          key(ls + 3, last.zoom + 0.24, speaker.x, FACE_Y - 0.02, "snap");
          shakes.push({ start: ls + 3, end: ls + f(0.3), amplitude: 9 });
        }
        prevSpeaker = line.karakter;
      } else {
        // Narrator: wide framing that keeps drifting so the picture never freezes.
        const drift = idx % 2 === 0 ? 0.46 : 0.54;
        const last = camera[camera.length - 1]!;
        if (last.zoom > 1.25) {
          key(ls - 1, last.zoom, last.cx, last.cy, "smooth");
          key(ls, 1.06, 0.5, 0.5, "cut");
        }
        key(le, 1.14, drift, 0.5, "smooth");
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
      const len = c.stil === "bolum" ? f(2.2) : f(2.8);
      return { text: c.metin, ...(c.alt_metin ? { subtext: c.alt_metin } : {}), start: s, end: Math.min(duration - 1, s + len), style: c.stil };
    });

    const mapArrows = (scene.harita?.oklar ?? []).map((o, i) => ({
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
    shots.push({
      id: scene.id,
      sceneId: scene.id,
      start,
      duration,
      background: input.backgrounds[si]!,
      performers,
      props,
      camera: normalizeCamera(camera),
      shakes,
      titleCards,
      mapArrows,
      transitionIn,
      dramatized: lines.some((l) => visibleIds.has(l.speaker)),
    });
  });

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

function dedupeByStart<T extends { start: number }>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  const out: T[] = [];
  for (const item of sorted) {
    if (out.length && out[out.length - 1]!.start === item.start) out[out.length - 1] = item;
    else out.push(item);
  }
  return out;
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
