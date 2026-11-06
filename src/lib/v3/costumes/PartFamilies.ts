import type { V3FaceShape } from "../render/RenderPlanTypes";

/**
 * Parametric part families: period headwear, facial hair, chest pieces and held objects drawn by code — free, and the
 * same right shape every time (owner, 6 Nov 2026: "bunu kendimiz ücretsiz çizebilecek bir şey yok mu çünkü çok fazla
 * olacak maliyet", after the Waterloo Short's three bicornes came out of the paid designer as domes, judged 10/10, and
 * Blücher's moustache failed three paid rounds). An order whose words name a family ("Napoleon's black bicorne hat with
 * tricolor cockade") is drawn here and never reaches the model; colours, cockade, plume and type are read from the
 * same words. Pure: text in, SVG out, in the wardrobe's part frame (PartDesigner's SLOT_RULES).
 */

export type FamilySlot = "head" | "beard" | "mustache" | "chest" | "hand";

export interface FamilyPart {
  readonly family: string;
  readonly svg: string;
  /** A held object the fist closes around. */
  readonly grip?: boolean;
  /** What was read from the words (kept with the part for the record). */
  readonly params: Readonly<Record<string, string>>;
}

const INK = "#1d1b26";
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-170 -300 340 380">';
const shape = (d: string, fill: string, width = 6) => `<path d="${d}" style="fill:${fill};stroke:${INK};stroke-width:${width};stroke-linejoin:round"/>`;
const line = (d: string, colour: string, width: number, opacity?: number) => `<path d="${d}" style="fill:none;stroke:${colour};stroke-width:${width};stroke-linecap:round;stroke-linejoin:round${opacity !== undefined ? `;opacity:${opacity}` : ""}"/>`;
const circle = (cx: number, cy: number, r: number, fill: string, width = 3.5) => `<circle cx="${cx}" cy="${cy}" r="${r}" style="fill:${fill};stroke:${INK};stroke-width:${width}"/>`;
const svg = (...parts: string[]) => `${OPEN}${parts.join("")}</svg>`;

/** Cloth and metal colours by the words models use (English and Turkish), flat-cartoon tones. */
const COLOURS: readonly [RegExp, string][] = [
  [/^(black|siyah)$/, "#23232b"],
  [/^(white|beyaz|cream)$/, "#fffdf6"],
  [/^(scarlet|crimson|red|kırmızı|kirmizi)$/, "#c62839"],
  [/^(navy|lacivert|prussian-blue|dark-blue)$/, "#22305e"],
  [/^(blue|mavi)$/, "#2f6fb0"],
  [/^(green|yeşil|yesil)$/, "#2f7a3e"],
  [/^(gold|golden|gilt|altın|altin)$/, "#e1ad3e"],
  [/^(silver|steel|gümüş|gumus)$/, "#c9ced6"],
  [/^(grey|gray|gri)$/, "#9aa0a8"],
  [/^(brown|kahverengi|kahve)$/, "#6b4a2e"],
  [/^(orange|turuncu)$/, "#e07a2e"],
  [/^(yellow|sarı|sari)$/, "#e8c93a"],
  [/^(buff|beige|bej|khaki|haki|tan)$/, "#d8c08a"],
  [/^(purple|mor)$/, "#6a3d8f"],
];
/** Hair colours: a white moustache is not a white coat. */
const HAIR: readonly [RegExp, string][] = [
  [/^(white|snow|beyaz|ak)$/, "#f4f1ea"],
  [/^(grey|gray|silver|grizzled|kır|kir|gri)$/, "#b9b6ae"],
  [/^(black|dark|jet|siyah|koyu)$/, "#2a2420"],
  [/^(brown|chestnut|kahve|kahverengi)$/, "#5b3e26"],
  [/^(red|ginger|auburn|kızıl|kizil)$/, "#a8492a"],
  [/^(blond|blonde|fair|sandy|sarı|sari)$/, "#d9b46a"],
];

/** The order's words, lower-case, "dark blue" kept as one word. */
export function words(tarif: string): string[] {
  return tarif
    .toLowerCase()
    .replace(/dark\s+blue/g, "dark-blue")
    .replace(/prussian\s+blue/g, "prussian-blue")
    .split(/[^a-zçğıöşü0-9-]+/)
    .filter(Boolean);
}

const colourOf = (w: string, table: readonly [RegExp, string][]) => table.find(([re]) => re.test(w))?.[1];

/**
 * The colour said beside a noun ("white plume", "plume of white", "gold trim"): two words before it first, then two after
 * (skipping "of", "with", "and"). Undefined when none is said.
 */
export function colourNear(ws: readonly string[], noun: RegExp, table: readonly [RegExp, string][] = COLOURS, beforeOnly = false): string | undefined {
  for (const [i, w] of ws.entries()) {
    if (!noun.test(w)) continue;
    for (const j of [i - 1, i - 2]) if (j >= 0 && colourOf(ws[j]!, table)) return colourOf(ws[j]!, table);
    if (beforeOnly) continue;
    const after = ws.slice(i + 1, i + 4).filter((x) => !/^(of|with|and|in|a|the)$/.test(x));
    for (const x of after.slice(0, 2)) if (colourOf(x, table)) return colourOf(x, table);
  }
  return undefined;
}

/** A cockade's rings, outside in, by the army it names (French tricolour unless another is said). */
function cockade(ws: readonly string[]): readonly string[] | undefined {
  if (!ws.some((w) => /^(cockade|rosette|kokart|tricolou?r|tricolore)$/.test(w))) return undefined;
  const t = ws.join(" ");
  if (/prussian|prusya|german/.test(t)) return ["#fffdf6", "#23232b"];
  if (/british|english|ingiliz|hanover/.test(t)) return ["#23232b", "#23232b"];
  if (/austrian|avusturya/.test(t)) return ["#e8c93a", "#23232b"];
  if (/russian|rus\b/.test(t)) return ["#fffdf6", "#e07a2e", "#23232b"];
  if (/american|us\b/.test(t)) return ["#23232b", "#fffdf6"];
  return ["#2f6fb0", "#fffdf6", "#c62839"];
}

const rings = (cx: number, cy: number, colours: readonly string[]) => colours.map((c, i) => circle(cx, cy, 15 - i * (11 / colours.length), c, i === 0 ? 4 : 2.5)).join("");

/** A plume or feather tuft rising from (x, y), in its colour. */
const plume = (x: number, y: number, colour: string) =>
  shape(`M${x - 8} ${y} C${x - 34} ${y - 36} ${x - 30} ${y - 84} ${x + 4} ${y - 108} C${x + 2} ${y - 80} ${x + 20} ${y - 56} ${x + 18} ${y - 30} C${x + 16} ${y - 14} ${x + 12} ${y - 6} ${x + 8} ${y} Z`, colour, 5) +
  line(`M${x} ${y - 4} C${x - 10} ${y - 40} ${x - 10} ${y - 70} ${x + 2} ${y - 98}`, INK, 2.5, 0.35);

interface Head {
  readonly main: string;
  readonly trim?: string;
  readonly plume?: string;
  readonly cockade?: readonly string[];
}

const HEADWEAR: readonly { readonly family: string; readonly match: RegExp; readonly fallback: string; readonly draw: (h: Head) => string }[] = [
  {
    // A wide low crescent across the head, never a dome: corners at ±150, the raised middle at -182.
    family: "bicorne",
    match: /^(bicorne?s?|cocked|two-cornered|bicorn)$/,
    fallback: "#23232b",
    draw: (h) =>
      svg(
        shape("M-150 -72 Q-112 -188 0 -182 Q112 -188 150 -72 Q118 -58 0 -46 Q-118 -58 -150 -72 Z", h.main, 6.5),
        h.trim ? line("M-144 -70 Q-110 -178 0 -172 Q110 -178 144 -70", h.trim, 5) : "",
        h.plume ? plume(4, -180, h.plume) : "",
        h.cockade ? rings(-104, -92, h.cockade) : "",
        line("M-84 -142 Q-24 -166 56 -158", "#ffffff", 7, 0.45),
      ),
  },
  {
    // Turned up on three sides: two corners at the sides, one low in front; the crown shows above.
    family: "tricorne",
    match: /^(tricorne?s?|tricorn|three-cornered)$/,
    fallback: "#23232b",
    draw: (h) =>
      svg(
        shape("M-66 -112 Q-58 -168 6 -172 Q72 -168 80 -112 Z", h.main, 6),
        shape("M-146 -112 Q-70 -136 8 -128 Q86 -136 150 -112 L22 -40 Q8 -32 -6 -40 Z", h.main, 6.5),
        h.trim ? line("M-138 -112 Q-70 -130 8 -122 Q86 -130 142 -112", h.trim, 4.5) : "",
        h.plume ? plume(-30, -160, h.plume) : "",
        h.cockade ? rings(-62, -104, h.cockade) : "",
        line("M-30 -160 Q10 -170 50 -160", "#ffffff", 6, 0.45),
      ),
  },
  {
    // A tall cylinder a little wider at the top, a black peak towards the face, a plate in front, a plume or pompom.
    family: "shako",
    match: /^(shakos?|şako|sako|czapka)$/,
    fallback: "#23232b",
    draw: (h) =>
      svg(
        shape("M-78 -60 L-92 -232 Q0 -248 92 -232 L78 -60 Q0 -48 -78 -60 Z", h.main, 6.5),
        shape("M-92 -232 Q0 -248 92 -232 L89 -210 Q0 -226 -89 -210 Z", h.trim ?? "#23232b", 5),
        shape("M-6 -62 Q58 -70 124 -50 Q76 -34 -6 -46 Z", "#23232b", 5),
        shape("M10 -176 L40 -140 L10 -98 L-20 -140 Z", h.trim ?? "#e1ad3e", 4.5),
        h.cockade ? rings(10, -196, h.cockade) : "",
        h.plume ? plume(0, -244, h.plume) : circle(0, -256, 15, "#fffdf6", 4.5),
        line("M-62 -200 L-52 -84", "#ffffff", 7, 0.35),
      ),
  },
  {
    // A tall fur cap (guards, grenadiers, hussars' busby).
    family: "bearskin",
    // Not "kalpak": a Turkish kalpak is a short lambskin cap, not a grenadier's tall fur.
    match: /^(bearskins?|busby|colpack)$/,
    fallback: "#2a2420",
    draw: (h) =>
      svg(
        shape("M-94 -50 C-114 -150 -84 -272 0 -280 C84 -272 114 -150 94 -50 Q0 -36 -94 -50 Z", h.main === "#23232b" ? "#2a2420" : h.main, 6.5),
        line("M-60 -230 Q-70 -170 -58 -110 M-20 -256 Q-28 -180 -18 -96 M24 -256 Q32 -180 22 -96 M62 -230 Q72 -170 60 -110", "#4a3c34", 5),
        h.plume ? plume(-70, -150, h.plume) : "",
        h.trim ? line("M-74 -200 Q0 -150 74 -110", h.trim, 6) : "",
        h.cockade ? rings(-56, -96, h.cockade) : "",
      ),
  },
  {
    // A civilian's tall hat: crown, band, curled brim.
    family: "silindir",
    match: /^(top-hat|tophat|silindir|stovepipe)$/,
    fallback: "#23232b",
    draw: (h) =>
      svg(
        shape("M-68 -70 L-62 -248 Q0 -258 62 -248 L68 -70 Z", h.main, 6.5),
        shape("M-67 -96 L-65 -126 Q0 -134 65 -126 L67 -96 Q0 -88 -67 -96 Z", h.trim ?? "#4a4a55", 5),
        shape("M-124 -66 Q0 -98 124 -66 Q112 -42 0 -56 Q-112 -42 -124 -66 Z", h.main, 6),
        line("M-40 -232 L-36 -140", "#ffffff", 7, 0.4),
      ),
  },
];

/** A head order's family and its drawing, or undefined. */
function headFamily(ws: readonly string[]): FamilyPart | undefined {
  const text = ws.join(" ");
  const fam = HEADWEAR.find((f) => ws.some((w) => f.match.test(w)) || (f.family === "silindir" && /\btop hat\b/.test(text)) || (f.family === "bicorne" && /\bcocked hat\b/.test(text)));
  if (!fam) return undefined;
  const noun = /^(bicorne?s?|bicorn|cocked|tricorne?s?|tricorn|shakos?|şako|sako|bearskins?|busby|kalpak|hat|cap|top-hat)$/;
  // The hat's own colour comes before its name ("black bicorne"); a colour after it belongs to what follows ("bearskin
  // with red plume").
  const main = colourNear(ws, noun, COLOURS, true) ?? fam.fallback;
  const trim = colourNear(ws, /^(trim|trimmed|lace|laced|edge|edged|braid|braided|band|piping|cords?|plate|şerit|serit)$/);
  const plumeColour = colourNear(ws, /^(plumes?|feathers?|tuft|pompom|pompon|tüy|tuy|hackle)$/) ?? (ws.some((w) => /^(plumes?|feathers?|tüy|tuy|hackle)$/.test(w)) ? "#fffdf6" : undefined);
  const c = cockade(ws);
  const h: Head = { main, ...(trim ? { trim } : {}), ...(plumeColour ? { plume: plumeColour } : {}), ...(c ? { cockade: c } : {}) };
  return { family: fam.family, svg: fam.draw(h), params: { renk: main, ...(trim ? { kenar: trim } : {}), ...(plumeColour ? { tuy: plumeColour } : {}), ...(c ? { kokart: c.join(",") } : {}) } };
}

/** The puppet's chin by face shape (Face.tsx), as PartDesigner tells the model. */
const CHIN_Y: Readonly<Record<V3FaceShape, number>> = { yuvarlak: 98, oval: 114, uzun: 128, genis: 124, kare: 118 };

type MoustacheKind = "pala" | "gur" | "ince" | "duz";
const moustacheKind = (ws: readonly string[]): MoustacheKind =>
  ws.some((w) => /^(handlebar|curled|curling|upturned|pala|kaytan)$/.test(w))
    ? "pala"
    : ws.some((w) => /^(walrus|bushy|thick|heavy|large|big|drooping|full|gür|gur|kalın|kalin)$/.test(w))
      ? "gur"
      : ws.some((w) => /^(pencil|thin|narrow|ince)$/.test(w))
        ? "ince"
        : "duz";

/** A moustache under the nose, centred at (10,34), never over the mouth's opening (below y = 44 only a little). */
function moustache(kind: MoustacheKind, colour: string): string[] {
  switch (kind) {
    case "pala":
      return [shape("M10 30 C0 20 -24 18 -44 32 C-56 40 -62 30 -68 24 C-64 46 -38 54 -14 44 C-2 40 6 37 10 37 C14 37 22 40 34 44 C58 54 84 46 88 24 C82 30 76 40 64 32 C44 18 20 20 10 30 Z", colour, 4.5)];
    case "gur":
      return [shape("M-42 30 C-28 12 -2 14 10 24 C22 14 48 12 62 30 C66 44 56 52 44 48 C34 46 22 42 10 44 C-2 42 -14 46 -24 48 C-36 52 -46 44 -42 30 Z", colour, 4.5)];
    case "ince":
      return [shape("M-24 32 Q-6 24 10 30 Q26 24 44 32 Q26 36 10 34 Q-6 36 -24 32 Z", colour, 3.5)];
    default:
      return [shape("M-34 32 C-18 18 0 22 10 30 C20 22 38 18 54 32 C44 46 24 44 10 38 C-4 44 -24 46 -34 32 Z", colour, 4.5)];
  }
}

/** Facial hair (beard slot): a full or short beard, a goatee, sideburns — with the moustache when the order says so. */
function beardFamily(ws: readonly string[], face: V3FaceShape | undefined): FamilyPart | undefined {
  const text = ws.join(" ");
  const sideburns = /sideburn|mutton|favori|whisker|side-whisker|side whisker/.test(text);
  const goatee = /goatee|keçi|keci|van dyke|imperial/.test(text);
  const beard = /beard|sakal/.test(text);
  if (!sideburns && !goatee && !beard) return undefined;
  const colour = colourNear(ws, /^(beards?|sideburns?|whiskers?|moustaches?|mustaches?|goatee|sakal|bıyık|biyik|favori|hair)$/, HAIR) ?? ws.map((w) => colourOf(w, HAIR)).find(Boolean) ?? "#5b3e26";
  const chin = CHIN_Y[face ?? "yuvarlak"];
  const withMoustache = /moustache|mustache|bıyık|biyik/.test(text);
  const parts: string[] = [];
  let kind = "sakal";
  if (sideburns && !beard) {
    kind = "favori";
    // Mutton chops: narrow at the temple, widening down the cheek towards the jaw.
    parts.push(shape(`M-99 -38 L-76 -38 Q-72 8 -56 ${chin - 60} Q-72 ${chin - 40} -92 ${chin - 56} Q-104 0 -99 -38 Z`, colour, 4.5));
    parts.push(shape(`M86 -38 L99 -38 Q105 8 98 ${chin - 62} Q88 ${chin - 52} 78 ${chin - 60} Q88 8 86 -38 Z`, colour, 4));
  } else if (goatee && !/full|long|bushy|gür|gur/.test(text)) {
    kind = "keci";
    parts.push(shape(`M-12 ${chin - 34} Q10 ${chin - 40} 32 ${chin - 34} Q30 ${chin + 6} 10 ${chin + 22} Q-10 ${chin + 6} -12 ${chin - 34} Z`, colour, 4.5));
  } else {
    const long = /long|full|bushy|flowing|gür|gur|uzun/.test(text) && !/short|trimmed|kısa|kisa/.test(text);
    const bottom = chin + (long ? 64 : 34);
    kind = long ? "sakal-uzun" : "sakal-kisa";
    parts.push(shape(`M-86 6 C-92 ${chin - 6} -42 ${bottom - 10} 8 ${bottom} C58 ${bottom - 10} 104 ${chin - 6} 98 6 C76 40 40 ${Math.min(70, chin - 30)} 8 ${Math.min(72, chin - 28)} C-26 ${Math.min(70, chin - 30)} -64 40 -86 6 Z`, colour, 6));
    parts.push(line(`M-46 ${chin - 20} Q-38 ${chin + 6} -20 ${chin + 22} M8 ${chin - 6} L8 ${bottom - 18} M52 ${chin - 20} Q46 ${chin + 6} 32 ${chin + 22}`, INK, 3.5, 0.25));
  }
  if (withMoustache) parts.push(...moustache(moustacheKind(ws), colour));
  return { family: kind, svg: svg(...parts), params: { renk: colour, tip: kind, ...(withMoustache ? { biyik: moustacheKind(ws) } : {}) } };
}

function moustacheFamily(ws: readonly string[]): FamilyPart | undefined {
  const text = ws.join(" ");
  if (!/moustache|mustache|bıyık|biyik/.test(text)) return undefined;
  const colour = colourNear(ws, /^(moustaches?|mustaches?|bıyık|biyik)$/, HAIR) ?? ws.map((w) => colourOf(w, HAIR)).find(Boolean) ?? "#5b3e26";
  const kind = moustacheKind(ws);
  return { family: `biyik-${kind}`, svg: svg(...moustache(kind, colour)), params: { renk: colour, tip: kind } };
}

/** Chest pieces: an order sash (over the right shoulder to the left hip), medals or stars, epaulettes. */
function chestFamily(ws: readonly string[]): FamilyPart | undefined {
  const text = ws.join(" ");
  const sash = /sash|kuşak|kusak|ribbon|cordon|band/.test(text);
  const medals = /medal|medals|order|orders|star|stars|cross|decoration|nişan|nisan|madalya/.test(text);
  const epaulettes = /epaulet|epaulette|apolet/.test(text);
  if (!sash && !medals && !epaulettes) return undefined;
  const parts: string[] = [];
  const params: Record<string, string> = {};
  if (epaulettes) {
    const c = colourNear(ws, /^(epaulets?|epaulettes?|apolet)$/) ?? "#e1ad3e";
    params.apolet = c;
    for (const s of [-1, 1]) {
      parts.push(shape(`M${s * 50} -18 Q${s * 70} -30 ${s * 94} -16 Q${s * 98} -4 ${s * 90} 4 L${s * 54} 0 Z`, c, 4.5));
      parts.push(line(`M${s * 60} 2 L${s * 60} 16 M${s * 70} 3 L${s * 70} 18 M${s * 80} 3 L${s * 80} 17 M${s * 90} 2 L${s * 90} 14`, c, 4));
    }
  }
  if (sash) {
    const c = colourNear(ws, /^(sash|sashes|kuşak|kusak|ribbon|cordon|band)$/) ?? "#2f6fb0";
    params.kusak = c;
    parts.push(shape("M56 -8 L86 14 L-60 168 L-90 146 Z", c, 4.5));
    parts.push(line("M66 2 L-74 154", "#ffffff", 3, 0.45));
  }
  if (medals) {
    const c = colourNear(ws, /^(medals?|orders?|stars?|cross|crosses|decorations?)$/) ?? "#d9dde3";
    params.nisan = c;
    const iron = /iron cross|demir haç|cross/.test(text);
    parts.push(iron ? shape("M-40 30 L-30 30 L-28 40 L-18 42 L-18 52 L-28 54 L-30 64 L-40 64 L-42 54 L-52 52 L-52 42 L-42 40 Z", "#23232b", 3.5) : shape("M-35 22 L-30 36 L-15 36 L-27 45 L-23 60 L-35 51 L-47 60 L-43 45 L-55 36 L-40 36 Z", c, 3.5));
    parts.push(circle(-62, 78, 8, "#e1ad3e", 3));
    parts.push(circle(-40, 84, 8, "#c62839", 3));
  }
  return { family: [epaulettes ? "apolet" : "", sash ? "kusak" : "", medals ? "nisan" : ""].filter(Boolean).join("+"), svg: svg(...parts), params };
}

/** Held objects: a curved sabre or a straight sword, a marshal's baton. Drawn along +y inside rotate(-40), handle through the fist. */
function handFamily(ws: readonly string[]): FamilyPart | undefined {
  const text = ws.join(" ");
  if (/baton|mareşal asası|maresal asasi/.test(text)) {
    const c = colourNear(ws, /^(baton)$/) ?? "#22305e";
    return {
      family: "asa",
      grip: true,
      params: { renk: c },
      svg: svg(`<g transform="rotate(-40)">`, `<rect x="-10" y="-58" width="20" height="116" rx="6" style="fill:${c};stroke:${INK};stroke-width:4.5;stroke-linejoin:round"/>`, shape("M-12 -66 L12 -66 L12 -50 L-12 -50 Z", "#e1ad3e", 4), shape("M-12 50 L12 50 L12 66 L-12 66 Z", "#e1ad3e", 4), circle(0, -24, 4, "#e1ad3e", 2), circle(0, 0, 4, "#e1ad3e", 2), circle(0, 24, 4, "#e1ad3e", 2), "</g>"),
    };
  }
  if (!/sabre|saber|sword|kılıç|kilic|cutlass|scimitar/.test(text)) return undefined;
  const curved = /sabre|saber|cutlass|scimitar|curved|light cavalry|hussar|kılıç|kilic/.test(text) && !/straight|düz|duz|heavy cavalry|epee|épée|rapier/.test(text);
  const hilt = colourNear(ws, /^(hilt|hilted|guard|kabza)$/) ?? "#e1ad3e";
  const blade = curved ? "M-9 34 C-8 101 0 163 11 194 Q17.5 206 24 215 Q24.5 202 23 193 C18 152 10.5 94 9 34 Z" : "M-8 34 L-8 196 L0 216 L8 196 L8 34 Z";
  return {
    family: curved ? "kilic-egri" : "kilic-duz",
    grip: true,
    params: { kabza: hilt },
    svg: svg(
      `<g transform="rotate(-40)">`,
      `<rect x="-6.5" y="-44" width="13" height="76" rx="5" style="fill:#4a2e1c;stroke:${INK};stroke-width:4;stroke-linejoin:round"/>`,
      shape("M-26 28 L26 28 L26 38 L-26 38 Z", hilt, 4),
      shape("M-9.5 -42 C-12.5 -53 -5 -61 3 -58.5 C10 -56 12.5 -49 9.5 -42 Z", hilt, 4),
      shape(blade, "#d7dde4", 4.5),
      line(curved ? "M3 50 C4 94 7.5 131 13 164" : "M0 50 L0 190", "#9ba6b3", 3),
      "</g>",
    ),
  };
}

/**
 * The family part for an order, or undefined when no family draws it (then the model does, as before). `face`: the
 * wearer's face shape, so a beard reaches the right chin.
 */
export function familyPart(order: { readonly slot: string; readonly tarif: string }, face?: V3FaceShape): FamilyPart | undefined {
  const ws = words(order.tarif);
  switch (order.slot) {
    case "head":
      return headFamily(ws);
    case "beard":
      return beardFamily(ws, face) ?? moustacheFamily(ws);
    case "mustache":
      return moustacheFamily(ws);
    case "chest":
      return chestFamily(ws);
    case "hand":
      return handFamily(ws);
    default:
      return undefined;
  }
}
