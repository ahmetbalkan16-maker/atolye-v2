/**
 * Atölye Brain — AYAS Reasoning Core prompt builder (Phase 2 · Phase D).
 *
 * Builds a single prompt asking the model for ONE JSON object — no prose
 * before/after, no chain-of-thought. The instruction is explicit (spec §3.2):
 * we do not want, ask for, or store the model's private reasoning process,
 * only a short operational SUMMARY of it (intent/goal/plan/risk/verification)
 * plus the final answer.
 */

import type { AyasChatComplexity } from "../model/AyasModelTypes";
import { AYAS_TOOL_REGISTRY } from "./AyasToolRegistry";

const COMPLEXITY_FRAMING: Record<AyasChatComplexity, string> = {
  SIMPLE: "Basit bir istek. (Bu seviye normalde Reasoning Core'a hiç gelmez.)",
  NORMAL: "Sıradan bir durum sorusu. (Bu seviye normalde Reasoning Core'a hiç gelmez.)",
  COMPLEX: "Çok adımlı analiz gerektiriyor — 'neden', 'ne yapmalıyız' türü bir istek.",
  TOOL: "Kullanıcı salt-okunur bir inceleme/kontrol istiyor (ör. 'git durumu', 'test et'). Yalnızca aşağıdaki katalogdaki salt-okunur araçları 'requiredTools' içinde adlandırabilirsin — gerçekten çalıştıramazsın.",
  REPAIR: "Bir hata / kendi kendini onarma (self-heal) ile ilgili. Aşağıda (varsa) salt-okunur self-heal bağlamı var.",
  RESEARCH: "Bir konu hakkında araştırma/bilgi isteniyor.",
};

export interface AyasReasoningPromptInput {
  readonly userText: string;
  readonly complexity: AyasChatComplexity;
  /** Phase B context block lines, already rendered by AyasContextAssembly. */
  readonly contextLines?: readonly string[];
  /** Phase C recalled memory lines. */
  readonly memoryLines?: readonly string[];
  /** REPAIR only — a redacted, read-only self-heal summary (health + up to 2 active incidents). */
  readonly selfHealLines?: readonly string[];
}

export function buildAyasReasoningPrompt(input: AyasReasoningPromptInput): string {
  const toolCatalog = AYAS_TOOL_REGISTRY.map(
    (t) => `  - "${t.id}" (${t.readOnly ? "salt-okunur" : "KULLANILAMAZ — yürütme kapısı kapalı"}): ${t.description}`,
  ).join("\n");

  const lines: string[] = [
    "Sen AYAS'sın — Atölye V2 stüdyosunun akıl yürütme çekirdeğisin.",
    "Aşağıdaki isteği değerlendir ve YALNIZCA tek bir JSON nesnesi üret.",
    "",
    "KESİN KURALLAR:",
    "  - Çıktın SADECE geçerli JSON olsun. Öncesinde/sonrasında açıklama, markdown, kod bloğu YAZMA.",
    "  - İç düşünce sürecini (chain-of-thought) YAZMA. Yalnızca aşağıdaki kısa, işlevsel alanları doldur.",
    "  - Hiçbir zaman bir dosya yazdığını, komut çalıştırdığını, git push/commit yaptığını, deploy ettiğini,",
    "    bir pipeline aşaması başlattığını iddia ETME — sen yalnızca metin üretiyorsun, hiçbir şey çalıştırmadın.",
    '  - "requiredTools" alanına SADECE aşağıdaki katalogdaki araç id\'lerini yaz. Katalogda olmayan bir',
    "    araç/eylem gerekiyorsa onu \"risk\" veya \"verification\" alanında açıkla, uydurma bir id yazma.",
    "  - Katalogda \"KULLANILAMAZ\" diye işaretli bir araç gerekiyorsa, bunu plan'da adım olarak yaz ama",
    '    "requiredTools" listesine ekleme ve yanıtta bunu yaptığını iddia etme — yalnızca "bunun için',
    '    operatör onayı / yürütme kapısı açılması gerekir" de.',
    "  - Yakın konuşma turları varsa aktif konu, seçilen seçenek ve geçici kısıtlar bakımından birincil kaynaktır;",
    "    kalıcı hafıza bunlarla çelişirse yakın konuşmayı tercih et.",
    "  - Kısa bir takip ifadesini önce verilen bağlamdan çöz. Tek bir güvenli karşılık yoksa tahmin etme; answer",
    "    alanında kısa bir netleştirme sorusu sor.",
    "  - Araç sonucunu gerçekten almadın ve bu çekirdek araç çalıştırmaz. Bir aracı requiredTools içinde adlandırmak,",
    "    onun çalıştığı veya bir sonuç döndürdüğü anlamına gelmez; answer içinde böyle bir iddia kurma.",
    "",
    "Bağlam:",
    `  - karmaşıklık sınıfı: ${input.complexity} — ${COMPLEXITY_FRAMING[input.complexity]}`,
    ...(input.contextLines?.length ? input.contextLines.map((l) => `  ${l}`) : []),
    ...(input.memoryLines?.length ? input.memoryLines.map((l) => `  ${l}`) : []),
    ...(input.selfHealLines?.length ? input.selfHealLines.map((l) => `  ${l}`) : []),
    "",
    "Araç kataloğu:",
    toolCatalog,
    "",
    "JSON şeması (tüm alanlar zorunlu; diziler boş olabilir, string olmayabilir):",
    "{",
    '  "intent": string,          // kullanıcının kısa niyeti',
    '  "goal": string,            // ulaşılmak istenen hedef, 1 cümle',
    '  "constraints": string[],   // bilinen kısıtlar (varsa)',
    '  "assumptions": string[],   // yapılan varsayımlar (varsa)',
    '  "plan": string[],          // kısa, sıralı adımlar (salt-okunur/açıklayıcı; hiçbiri gerçekte çalıştırılmadı)',
    '  "requiredTools": string[], // YALNIZCA yukarıdaki katalogdaki salt-okunur id\'ler',
    '  "risk": string,            // kısa risk değerlendirmesi',
    '  "verification": string[], // bu cevabın nasıl doğrulanabileceği',
    '  "answer": string           // kullanıcıya gösterilecek nihai, doğal dildeki Türkçe cevap',
    "}",
    "",
    `Kullanıcı: ${input.userText}`,
    "JSON:",
  ];

  return lines.join("\n");
}
