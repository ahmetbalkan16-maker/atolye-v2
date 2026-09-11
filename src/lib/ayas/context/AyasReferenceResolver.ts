/**
 * Atölye Brain — AYAS reference resolver (Phase 2 · Phase B).
 *
 * Turns "az önce konuştuğumuz projeyi kontrol et" / "bunu da ekle" / "devam et"
 * into an explicit referent, using the deterministic {@link AyasConversationStateView}
 * + the raw turns. Pure — no model.
 *
 * It does NOT rewrite the user's message. It produces a small `resolutions`
 * list + an optional `hint` line the prompt appends, so AYAS sees
 * "  · 'az önceki proje' = Mimar Sinan" without the text being silently mutated.
 * Anything it cannot pin down goes in `unresolved` — the prompt then tells AYAS
 * to ASK rather than guess.
 */

import type { AyasConversationStateView } from "./AyasConversationState";
import type { BrainChatMessage } from "@/components/brain/brainCore";

export interface AyasReferenceResolution {
  /** The phrase in the user's text, e.g. `"o proje"`, `"az önceki"`, `"devam et"`. */
  readonly phrase: string;
  /** What it resolves to — a project, the last reply, the pending question, … */
  readonly referent: string;
  /** `project` | `prior-reply` | `prior-question` | `continuation` | `last-topic`. */
  readonly kind: "project" | "prior-reply" | "prior-question" | "continuation" | "last-topic";
}

export interface AyasReferenceResolutionResult {
  readonly resolutions: readonly AyasReferenceResolution[];
  /** Reference phrases present in the text that could not be pinned to anything. */
  readonly unresolved: readonly string[];
  /** A ready-to-append prompt block (empty when nothing to say). */
  readonly promptLines: readonly string[];
}

const EMPTY: AyasReferenceResolutionResult = Object.freeze({ resolutions: [], unresolved: [], promptLines: [] });

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g");
}

/** Demonstratives / back-references we look for. */
const REF_PATTERNS: { re: RegExp; phrase: string }[] = [
  { re: /\b(az once(ki)?|az onceden|demin(ki)?|birazonce|bir onceki|onceki)\b/, phrase: "az önceki" },
  { re: /\b(o proje(yi|nin|de)?|su proje(yi|nin)?|bu proje(yi|nin)?)\b/, phrase: "o proje" },
  { re: /\b(bunu|sunu|onu|bunlari|sunlari)\b/, phrase: "bunu / şunu / onu" },
  { re: /\b(devam et|devam edelim|kaldigimiz yerden|bir daha soyle|tekrar et)\b/, phrase: "devam et" },
  { re: /\b(orada|oradaki|orasi)\b/, phrase: "orada" },
];

export function resolveAyasReferences(
  text: string,
  state: AyasConversationStateView,
  history: readonly { readonly role: BrainChatMessage["role"]; readonly text: string }[] = [],
): AyasReferenceResolutionResult {
  const raw = String(text ?? "").trim();
  if (!raw) return EMPTY;
  const folded = fold(raw);

  const present = REF_PATTERNS.filter((p) => p.re.test(folded)).map((p) => p.phrase);
  if (present.length === 0) return EMPTY;

  const resolutions: AyasReferenceResolution[] = [];
  const unresolved: string[] = [];

  const lastUserBefore = [...history].reverse().find((t) => t.role === "user" && t.text.trim() !== raw)?.text?.trim() ?? null;

  for (const phrase of present) {
    if (phrase === "o proje") {
      if (state.activeProject) {
        resolutions.push({ phrase, referent: state.activeProject, kind: "project" });
      } else {
        unresolved.push(phrase);
      }
    } else if (phrase === "az önceki") {
      const mentionsProject = /proje/.test(folded);
      if (mentionsProject) {
        // "az önceki proje" — only resolvable to a project actually in context.
        if (state.activeProject) {
          resolutions.push({ phrase: "az önceki proje", referent: state.activeProject, kind: "project" });
        } else {
          unresolved.push(phrase);
        }
      } else if (state.activeTopic) {
        resolutions.push({ phrase: "az önceki", referent: state.activeTopic, kind: "last-topic" });
      } else if (state.lastAssistantText) {
        resolutions.push({
          phrase: "az önceki",
          referent: truncate(state.lastAssistantText, 120),
          kind: "prior-reply",
        });
      } else {
        unresolved.push(phrase);
      }
    } else if (phrase === "devam et") {
      if (state.lastUserText || lastUserBefore) {
        resolutions.push({
          phrase,
          referent: truncate((lastUserBefore ?? state.lastUserText)!, 120),
          kind: "continuation",
        });
      } else {
        unresolved.push(phrase);
      }
    } else if (phrase === "bunu / şunu / onu") {
      if (state.unresolvedQuestions.length) {
        resolutions.push({
          phrase: "bunu / şunu / onu",
          referent: `AYAS'ın sorduğu: "${truncate(state.unresolvedQuestions[0], 120)}"`,
          kind: "prior-question",
        });
      } else if (state.lastAssistantText) {
        resolutions.push({
          phrase: "bunu / şunu / onu",
          referent: truncate(state.lastAssistantText, 120),
          kind: "prior-reply",
        });
      } else {
        unresolved.push(phrase);
      }
    } else if (phrase === "orada") {
      const path = state.recentEntities.find((e) => e.kind === "path");
      if (path) resolutions.push({ phrase, referent: path.value, kind: "last-topic" });
      else if (state.activeProject) resolutions.push({ phrase, referent: state.activeProject, kind: "project" });
      else unresolved.push(phrase);
    }
  }

  const promptLines: string[] = [];
  if (resolutions.length) {
    promptLines.push("Bağlam çözümlemesi (kullanıcının kısaltmalı referansları):");
    for (const r of resolutions) promptLines.push(`  · "${r.phrase}" = ${r.referent}`);
  }
  if (unresolved.length) {
    promptLines.push(
      `Şu referanslar çözülemedi: ${unresolved.join(", ")}. Bunları tahmin etme — kullanıcıya kısaca neyi kastettiğini sor.`,
    );
  }

  return { resolutions, unresolved, promptLines };
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
