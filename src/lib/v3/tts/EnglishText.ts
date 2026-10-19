/**
 * English speech text: digits become words before synthesis, because the TTS reads "1452" as "forty-five two".
 * Four-digit numbers from 1000 to 2099 are read as years ("fourteen fifty-two", "two thousand five").
 */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
}

function below1000(n: number): string {
  if (n < 100) return below100(n);
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${below100(n % 100)}` : ""}`;
}

export function englishNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e9) return String(n);
  if (n < 1000) return below1000(n);
  const parts: string[] = [];
  for (const [size, name] of [[1e6, "million"], [1e3, "thousand"]] as const) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

export function englishYear(y: number): string {
  if (y >= 2000 && y < 2010) return englishNumber(y);
  const hi = Math.floor(y / 100), lo = y % 100;
  if (lo === 0) return `${below100(hi)} hundred`;
  return `${below100(hi)} ${lo < 10 ? `oh-${ONES[lo]}` : below100(lo)}`;
}

const ROMAN_ORDINALS: Readonly<Record<string, string>> = {
  I: "First", II: "Second", III: "Third", IV: "Fourth", V: "Fifth", VI: "Sixth", VII: "Seventh", VIII: "Eighth",
  IX: "Ninth", X: "Tenth", XI: "Eleventh", XII: "Twelfth", XIII: "Thirteenth", XIV: "Fourteenth", XV: "Fifteenth",
};

export function normalizeEnglishForSpeech(text: string): string {
  return text
    // Regnal numbers: "Mehmed II" → "Mehmed the Second" (but "World War II" stays a war).
    .replace(/\b([A-Z][a-z]+) (XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g, (m, name: string, roman: string) => (name === "War" ? m : `${name} the ${ROMAN_ORDINALS[roman]}`))
    .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m) => englishNumber(Number(m.replace(/,/g, ""))))
    .replace(/\b\d+\b/g, (m) => {
      const n = Number(m);
      return m.length === 4 && n >= 1000 && n < 2100 ? englishYear(n) : englishNumber(n);
    })
    .replace(/\s+/g, " ")
    .trim();
}
