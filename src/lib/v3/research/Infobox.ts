/**
 * A battle article's infobox as source facts. The Siege of Baghdad Short (owner, 13 Nov 2026: "osmanlı asker sayısı var
 * ama defans asker sayısı gözükmüyor"): the Ottoman strength stood in the article's prose, but the Safavid garrison
 * (40,000 infantry, 100 cannons, 211 towers) and its losses (20,000+ massacred) only in the infobox of "Siege of Baghdad
 * (1638)", which the plain-text extract the research reads drops — the writer had no number for the defenders and once
 * invented "~20,000". The infobox is read from the wikitext of the same revision (Wikipedia's API, free), its fields that
 * matter for the story — strength, casualties, commanders, result, date, place, per side — cleaned to plain text, and each
 * becomes a fact whose quote is that field's own text, marked as the infobox's (SourceResearch checks it against the
 * rendered infobox the same way a model's quote is checked against the article). Pure functions here; no network.
 */

/** One infobox field as read: its wikitext name ("strength2") and its text as a reader sees it. */
export interface InfoboxField {
  readonly name: string;
  readonly value: string;
}

export interface Infobox {
  /** The template's name ("Infobox military conflict"). */
  readonly kind: string;
  readonly fields: readonly InfoboxField[];
}

/** The infobox kinds that describe a battle, siege, war or operation (others — a person's, a ship's — are not read). */
const BATTLE_BOX = /\{\{\s*Infobox[ _]+(?:military[ _]+conflict|battle|military[ _]+operation|civil[ _]+conflict)\s*(?=[|}<\n])/i;
/** Wikitext read at most: section 0 of a long article is its lead and infobox, far below this. */
const MAX_WIKITEXT = 120_000;
/** A field's raw wikitext read at most, and its cleaned text kept at most (the quote stays ≤ 300 characters). */
const MAX_RAW_FIELD = 6_000;
const MAX_VALUE = 220;

/** Fields worth a fact, most important first (a capped list keeps the numbers before the names). */
const FIELD_ORDER = [
  "strength1", "strength2", "strength3",
  "casualties1", "casualties2", "casualties3", "casualties",
  "commander1", "commander2", "commander3", "leader1", "leader2", "leader3", "commanded_by",
  "result", "outcome", "date", "place", "location",
  "combatant1", "combatant2", "combatant3", "territory",
] as const;

/**
 * The battle infobox of a wikitext with its fields cleaned to plain text, or undefined when there is none, it is not
 * closed (malformed), or it has no field worth reading. Comments and footnotes are dropped before anything is split.
 */
export function parseInfobox(wikitext: string): Infobox | undefined {
  const text = stripNotes(wikitext.slice(0, MAX_WIKITEXT));
  const m = BATTLE_BOX.exec(text);
  if (!m) return undefined;
  const end = closingBraces(text, m.index);
  if (end === undefined) return undefined;
  const body = text.slice(m.index + 2, end - 2);
  const [head = "", ...params] = splitTopLevel(body);
  const raw = new Map<string, string>();
  for (const p of params) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    const name = p.slice(0, eq).trim().toLowerCase().replace(/\s+/g, "_");
    if ((FIELD_ORDER as readonly string[]).includes(name) && !raw.has(name)) raw.set(name, p.slice(eq + 1, eq + 1 + MAX_RAW_FIELD));
  }
  const fields: InfoboxField[] = [];
  for (const name of FIELD_ORDER) {
    const value = raw.has(name) ? capValue(wikitextToPlain(raw.get(name)!)) : "";
    if (value) fields.push({ name, value });
  }
  return fields.length ? { kind: head.trim().replace(/_/g, " ").replace(/\s+/g, " "), fields } : undefined;
}

/** Comments and footnotes (`<ref>…</ref>`, `<ref name=x/>`) out: they carry citations, not the field's text. */
function stripNotes(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref\b[^<>]*\/\s*>/gi, "")
    .replace(/<ref\b[^<>]*>[\s\S]*?<\/ref\s*>/gi, "");
}

/** The index just past the `}}` that closes the template opened at `start`, or undefined when it never closes. */
function closingBraces(text: string, start: number): number | undefined {
  let depth = 0;
  for (let i = start; i < text.length - 1; ) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth++;
      i += 2;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else i++;
  }
  return undefined;
}

/** A template's body split at its own `|` (not those inside nested templates or links). */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let braces = 0;
  let links = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "}}" || two === "[[" || two === "]]") {
      if (two === "{{") braces++;
      else if (two === "}}") braces = Math.max(0, braces - 1);
      else if (two === "[[") links++;
      else links = Math.max(0, links - 1);
      i++;
    } else if (body[i] === "|" && braces === 0 && links === 0) {
      out.push(body.slice(from, i));
      from = i + 1;
    }
  }
  out.push(body.slice(from));
  return out;
}

/** Markers templates add after a name in a commander list. */
const FATE: Readonly<Record<string, string>> = {
  kia: "(killed in action)", dow: "(died of wounds)", pow: "(prisoner of war)", wia: "(wounded)", mia: "(missing in action)",
  executed: "(executed)", surrendered: "(surrendered)", assassinated: "(assassinated)", died: "(died)",
};
/** List templates: each argument a line of its own, the list set apart from what stands beside it. */
const LIST_TEMPLATES = /^(?:plainlist|plain list|unbulleted list|ubl|ubil|unbulleted indent list|bulleted list|bulleted|flatlist|flat list|hlist|center|centre|left|right)$/i;
/** Wrappers whose arguments are inline text. */
const INLINE_TEMPLATES = /^(?:nowrap|nobr|small|smaller|big|larger|sup|sub|tooltip|abbr|abbrlink|sic|nobold|noitalic|ill|interlanguage link|vanchor|sortname|nobreak|no ?wrap|wrap)$/i;
/**
 * Templates that end a line without text (Waterloo, 13 Nov 2026: "7,500 gunners{{tree list/end}}{{Ubl|282–288 guns}}" read
 * "7,500 gunners282 – 288 guns" — two numbers run together are a wrong number).
 */
const BLOCK_TEMPLATES = /^(?:tree list|tree list\/end|hr|clear|-|break|br|\*|bulleted list\/end|endplainlist|end plainlist|startplainlist|start plainlist)$/i;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** One template (innermost, no nested braces) as the text a reader sees; unknown ones (flags, citations, notes) vanish. */
function renderTemplate(inner: string): string {
  const [rawName = "", ...args] = inner.split("|");
  const name = rawName.trim().toLowerCase().replace(/_/g, " ");
  const pos = args.filter((a) => !/^\s*[\w -]+\s*=/.test(a)).map((a) => a.trim());
  if (FATE[name]) return ` ${FATE[name]}`;
  if (name === "!") return "\u0001";
  if (/^(?:snd|spaced ndash|ndash|spaced en dash|dash)$/.test(name)) return " – ";
  if (name === "mdash") return " — ";
  if (/^(?:nbsp|space|sp)$/.test(name)) return " ";
  if (/^(?:•|·|dot|middot|bull|,)$/.test(name)) return "; ";
  if (BLOCK_TEMPLATES.test(name)) return "\n";
  if (/^(?:flag|flagcountry|flagu|flag country|flagicon text)$/.test(name)) return pos[0] ?? "";
  // A flag icon shows no text; before a count it is the count's only label ("{{flagicon|Nassau}} 3,000"), kept then.
  if (name === "flagicon" || name === "flagdeco") return pos[0] ? `\u0002${pos[0]}\u0003` : "";
  if (/^(?:circa|c\.|c|approximately|approx|approx\.|ca|ca\.)$/.test(name)) return pos[0] ? `c. ${pos[0]}` : "c.";
  if (/^(?:convert|cvt)$/.test(name)) return pos.length >= 2 ? `${pos[0]} ${pos[1]}` : (pos[0] ?? "");
  if (/^(?:start date|end date|start date and age|end date and age|date|dts|birth date|death date)$/.test(name)) {
    const [y, mo, d] = pos.map(Number);
    if (y && mo && d && MONTHS[mo - 1]) return `${d} ${MONTHS[mo - 1]} ${y}`;
    if (y && mo && MONTHS[mo - 1]) return `${MONTHS[mo - 1]} ${y}`;
    return y ? String(y) : "";
  }
  if (name === "lang" || name === "transl") return pos.at(-1) ?? "";
  if (LIST_TEMPLATES.test(name)) return `\n${pos.join("\n")}\n`;
  if (INLINE_TEMPLATES.test(name)) return name === "sortname" ? pos.slice(0, 2).join(" ") : /^(?:ill|interlanguage link|tooltip|abbr|abbrlink)$/.test(name) ? (pos[0] ?? "") : pos.join(" ");
  // Footnotes, citations and anything unknown say nothing; a space keeps the words around them apart.
  return " ";
}

/** A field's wikitext as plain text: links to their label, templates rendered or dropped, list lines joined with "; ". */
export function wikitextToPlain(wikitext: string): string {
  let t = stripNotes(wikitext);
  // File and category links carry no text; a file link may hold a link in its caption.
  for (let i = 0; i < 5 && /\[\[\s*(?:file|image|category):/i.test(t); i++) t = t.replace(/\[\[\s*(?:file|image|category):[^[\]]*\]\]/gi, "");
  t = t.replace(/\[\[([^[\]|]*)\|([^[\]]*)\]\]/g, "$2").replace(/\[\[([^[\]|]*)\]\]/g, "$1");
  for (let i = 0; i < 25 && /\{\{[^{}]*\}\}/.test(t); i++) t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => renderTemplate(inner));
  t = t
    .replace(/\{\{|\}\}/g, "")
    .replace(/<(?:br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|table|tr|td|th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/[^\]]*\]/g, "")
    .replace(/'{2,}/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u0001/g, "|")
    .replace(/\u0002([^\u0002\u0003]*)\u0003(?=\s*(?:c\.\s*|~\s*|≈\s*)?\d)/g, "$1 ")
    .replace(/\u0002[^\u0002\u0003]*\u0003/g, "");
  const lines = t
    .split("\n")
    .map((l) => l.replace(/^[\s*#:;]+/, "").replace(/\s+/g, " ").replace(/\s+([,.;)])/g, "$1").replace(/\(\s+/g, "(").trim())
    .filter((l) => l && /[\p{L}\p{N}]/u.test(l));
  // A heading line ("Land forces:") leads into the next one instead of standing as an item of its own.
  return lines
    .reduce((out, l, i) => (i === 0 ? l : `${out}${/:$/.test(lines[i - 1]!) ? " " : "; "}${l}`), "")
    .replace(/^[;,\s]+|[;,\s]+$/g, "");
}

/** A value cut to MAX_VALUE at its last list item (or word) before the limit. */
function capValue(value: string): string {
  if (value.length <= MAX_VALUE) return value;
  const head = value.slice(0, MAX_VALUE);
  const item = head.lastIndexOf("; ");
  return (item > MAX_VALUE * 0.4 ? head.slice(0, item) : head.replace(/\s+\S*$/, "")).trim();
}

/** A fact in the bank's shape (SourceResearch.ResearchFact). */
export interface InfoboxFact {
  readonly metin: string;
  readonly kaynak: string;
  readonly alinti: string;
}

type Say = (topic: string, value: string, side: string | undefined) => string;
const SAY: Readonly<Record<string, { readonly label: string; readonly en: Say; readonly tr: Say }>> = {
  strength: { label: "strength", en: (t, v, s) => (s ? `Strength of the ${s} side in the ${t}: ${v}.` : `Strength in the ${t}: ${v}.`), tr: (t, v, s) => (s ? `${t} — ${s} tarafının gücü: ${v}.` : `${t} — güç: ${v}.`) },
  casualties: { label: "casualties and losses", en: (t, v, s) => (s ? `Casualties and losses of the ${s} side in the ${t}: ${v}.` : `Other casualties and losses in the ${t}: ${v}.`), tr: (t, v, s) => (s ? `${t} — ${s} tarafının kayıpları: ${v}.` : `${t} — diğer kayıplar: ${v}.`) },
  commander: { label: "commanders and leaders", en: (t, v, s) => (s ? `Commanders and leaders of the ${s} side in the ${t}: ${v}.` : `Commanders in the ${t}: ${v}.`), tr: (t, v, s) => (s ? `${t} — ${s} tarafının komutanları: ${v}.` : `${t} — komutanlar: ${v}.`) },
  result: { label: "result", en: (t, v) => `Result of the ${t}: ${v}.`, tr: (t, v) => `${t} sonucu: ${v}.` },
  date: { label: "date", en: (t, v) => `Date of the ${t}: ${v}.`, tr: (t, v) => `${t} tarihi: ${v}.` },
  location: { label: "location", en: (t, v) => `Location of the ${t}: ${v}.`, tr: (t, v) => `${t} yeri: ${v}.` },
  combatant: { label: "belligerent", en: (t, v) => `A belligerent in the ${t}: ${v}.`, tr: (t, v) => `${t} taraflarından biri: ${v}.` },
  territory: { label: "territorial changes", en: (t, v) => `Territorial changes after the ${t}: ${v}.`, tr: (t, v) => `${t} sonrası toprak değişikliği: ${v}.` },
};

/** Which saying a field takes, and the side number it belongs to. */
function fieldKind(name: string): { kind: keyof typeof SAY; side?: number } {
  const m = /^(strength|casualties|commander|leader|combatant)(\d)?$/.exec(name);
  if (m) return { kind: m[1] === "leader" ? "commander" : (m[1] as keyof typeof SAY), ...(m[2] ? { side: Number(m[2]) } : {}) };
  if (name === "commanded_by") return { kind: "commander" };
  if (name === "outcome") return { kind: "result" };
  if (name === "place") return { kind: "location" };
  return { kind: name as keyof typeof SAY };
}

/**
 * The infobox's facts, at most `limit`, each quoting its field's own text ("Wikipedia infobox of "…", strength2
 * (Ottoman Empire): …"), and `text` — the rendered infobox those quotes stand in, for the quote check. A side is named
 * by its belligerent field's first entry; a field of a side the infobox does not name says no side.
 */
export function infoboxFacts(title: string, box: Infobox, kaynak: string, dil: "tr" | "en", limit = 16): { facts: InfoboxFact[]; text: string } {
  const value = new Map(box.fields.map((f) => [f.name, f.value]));
  const sideName = (n: number | undefined) => {
    const v = n === undefined ? undefined : value.get(`combatant${n}`);
    const first = v?.split("; ")[0]?.trim();
    return first ? capValue(first).slice(0, 80) : undefined;
  };
  const lines: string[] = [];
  const facts: InfoboxFact[] = [];
  for (const f of box.fields) {
    const { kind, side } = fieldKind(f.name);
    const say = SAY[kind];
    if (!say) continue;
    const s = kind === "combatant" ? undefined : sideName(side);
    const alinti = `Wikipedia infobox of "${title}", ${f.name}${s ? ` (${s})` : ""}: ${f.value}`;
    lines.push(alinti);
    if (facts.length < limit) facts.push({ metin: say[dil](title, f.value, s), kaynak, alinti });
  }
  return { facts, text: lines.join("\n") };
}

/** The wikitext of section 0 (lead and infobox) at a revision, from a revisions query's answer; undefined otherwise. */
export function sectionWikitext(json: unknown, revid: number): string | undefined {
  const pages = (json as { query?: { pages?: unknown } } | undefined)?.query?.pages;
  const list = Array.isArray(pages) ? pages : Object.values((pages as Record<string, unknown>) ?? {});
  for (const p of list as { revisions?: { revid?: number; slots?: { main?: { content?: unknown; "*"?: unknown } }; "*"?: unknown }[] }[]) {
    for (const r of p?.revisions ?? []) {
      if (r?.revid !== undefined && r.revid !== revid) continue;
      const content = r?.slots?.main?.content ?? r?.slots?.main?.["*"] ?? r?.["*"];
      if (typeof content === "string") return content;
    }
  }
  return undefined;
}
