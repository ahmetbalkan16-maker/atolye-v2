/**
 * Text the voice reads, as opposed to text the captions show: numbers, regnal numerals and names are
 * spelled out so every TTS engine pronounces them the same way.
 */

const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
const ORDINAL_SUFFIX: Record<string, string> = {
  bir: "birinci", iki: "ikinci", üç: "üçüncü", dört: "dördüncü", beş: "beşinci", altı: "altıncı", yedi: "yedinci", sekiz: "sekizinci", dokuz: "dokuzuncu",
  on: "onuncu", yirmi: "yirminci", otuz: "otuzuncu", kırk: "kırkıncı", elli: "ellinci", altmış: "altmışıncı", yetmiş: "yetmişinci", seksen: "sekseninci", doksan: "doksanıncı",
  yüz: "yüzüncü", bin: "bininci", milyon: "milyonuncu",
};

function belowThousand(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  if (h) out.push(...(h > 1 ? [ONES[h]!, "yüz"] : ["yüz"]));
  if (t) out.push(TENS[t]!);
  if (o) out.push(ONES[o]!);
  return out;
}

/** 0..999 999 999 in words: 1453 → "bin dört yüz elli üç". */
export function numberToTurkish(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new RangeError(`TR_NUMBER_RANGE: ${n}`);
  if (n === 0) return "sıfır";
  const words: string[] = [];
  const millions = Math.floor(n / 1_000_000), thousands = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  if (millions) words.push(...belowThousand(millions), "milyon");
  if (thousands) words.push(...(thousands === 1 ? ["bin"] : [...belowThousand(thousands), "bin"]));
  words.push(...belowThousand(rest));
  return words.join(" ");
}

export function ordinalTurkish(n: number): string {
  const words = numberToTurkish(n).split(" ");
  const last = words.pop()!;
  return [...words, ORDINAL_SUFFIX[last] ?? `${last}inci`].join(" ");
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
export function romanToNumber(s: string): number | undefined {
  if (!/^[IVXLC]+$/.test(s)) return undefined;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!]!, next = ROMAN[s[i + 1] ?? ""] ?? 0;
    total += v < next ? -v : v;
  }
  return total > 0 && total < 100 ? total : undefined;
}

/** First letter upper-cased the Turkish way (i → İ). */
const capitalTr = (w: string) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1);

export interface Lexicon {
  /** Whole-word replacements applied before numbers, e.g. "Giustiniani" → "Custiniyani". */
  readonly kelimeler: Readonly<Record<string, string>>;
  readonly kisaltmalar?: Readonly<Record<string, string>>;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeForSpeech(text: string, lexicon: Lexicon = { kelimeler: {} }): string {
  let t = text.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, "...").replace(/\s+/g, " ").trim();
  // Lexicon first (longest keys first so "Fatih Sultan Mehmed" wins over "Mehmed").
  const entries = [...Object.entries(lexicon.kisaltmalar ?? {}), ...Object.entries(lexicon.kelimeler)].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    t = t.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(from)}(?=$|[^\\p{L}])`, "gu"), (_m, pre: string) => `${pre}${to}`);
  }
  // Regnal numerals: "II. Mehmed" → "İkinci Mehmed", "XI. Konstantinos" → "On birinci Konstantinos".
  t = t.replace(/(^|[\s(])([IVXLC]{1,6})\.\s+(?=\p{Lu})/gu, (m, pre: string, roman: string) => {
    const n = romanToNumber(roman);
    return n ? `${pre}${capitalTr(ordinalTurkish(n))} ` : m;
  });
  // "15. yüzyıl" → "on beşinci yüzyıl"
  t = t.replace(/(\d{1,3})\.\s+(?=\p{Ll})/gu, (_m, d: string) => `${ordinalTurkish(Number(d))} `);
  // Plain integers, with an apostrophe suffix kept ("1453'te" → "bin dört yüz elli üç'te" reads naturally).
  t = t.replace(/\d{1,3}(?:\.\d{3})+|\d+/g, (d) => {
    const n = Number(d.replace(/\./g, ""));
    return n <= 999_999_999 ? numberToTurkish(n) : d;
  });
  return t.replace(/\s+/g, " ").trim();
}
