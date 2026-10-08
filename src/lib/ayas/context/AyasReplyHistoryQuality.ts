/** F97: bounded final-answer checks. Pure text only; no model, state, authority or UI changes. */
function normalized(text: string): string {
  return text.toLocaleLowerCase("tr").normalize("NFKC").replace(/[ıİ]/g, "i").replace(/ç/g,"c").replace(/ğ/g,"g").replace(/ö/g,"o").replace(/ş/g,"s").replace(/ü/g,"u").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
export function ayasReplyHistoryQualityIssue(reply: string, userText: string, history: readonly { readonly role: string; readonly text: string }[]): "question-echo" | "history-replay" | "unverified-global-status" | null {
  const user = normalized(userText), answer = normalized(reply);
  const quoting = /\b(tekrarla|yeniden soyle|aynen soyle|alinti|ne demistim|ne soylemistim|ne demistin|ne soylemistin|hatirlat)\b/.test(user);
  // These categorical whole-system claims have no supporting full-system observation in a chat turn.
  if (!quoting && reply.split(/[.!?\n]+/u).map(normalized).some(sentence => /^(?:su an )?sistem(?:iniz)? (?:tam olarak calismaktadir|tamamen sorunsuz(?:dur)?|tamamen hatasiz(?:dir)?)$/u.test(sentence))) return "unverified-global-status";
  if (quoting) return null;
  if (/[?？]\s*$/.test(userText) && answer === user) return "question-echo";
  // Preserve genuine repeated questions and historical recall; short answers (names/numbers/facts) never trigger this check.
  if (history.some(turn => turn.role === "user" && normalized(turn.text) === user)) return null;
  if (/\b(hatirliyor|hakkimda|adim|kararim|daha once|gecmiste)\b/.test(user)) return null;
  const sentences = reply.split(/[.!?\n]+/u).map(normalized).filter(text => text.length >= 45 && text.split(" ").length >= 7);
  if (!sentences.length) return null;
  for (const turn of history.slice(-12)) {
    if (turn.role === "system") continue;
    const earlier = new Set(turn.text.split(/[.!?\n]+/u).map(normalized));
    if (sentences.some(sentence => earlier.has(sentence) && sentence !== user)) return "history-replay";
  }
  return null;
}
