/** Owner briefing from existing Control Center facts. No IO, approval or execution. */
import { buildAyasControlCenterView, type AyasControlCenterInput, type AyasCcDomainId } from "../../brain/ui/AyasControlCenterModel";
import { alertDigest, briefingText, type AyasExecutiveSignal, type AyasBriefingDomain } from "./AyasExecutiveAlerts";
export interface AyasBriefingSection { readonly domain: AyasBriefingDomain; readonly title: string; readonly status: "OBSERVED" | "NOT_CONFIGURED" | "UNAVAILABLE"; readonly summary: string; readonly evidence: readonly string[] }
const titles: Readonly<Record<AyasBriefingDomain,string>> = { health:"Sistem sağlığı", improvements:"Gelişmeler", failures:"Hatalar ve kurtarmalar", decisions:"Bekleyen owner kararları",
  production:"Üretim ve maliyet", revenue:"Gerçekleşen gelir, kesinti ve kâr", security:"Güvenlik", technology:"Model ve teknik fırsatlar", capacity:"Kapasite ve engeller" };
const mapping: Readonly<Record<AyasCcDomainId,AyasBriefingDomain>> = { health:"health", autonomy:"health", approvals:"decisions", development:"improvements", graphify:"capacity",
  research:"technology", experiments:"improvements", memory:"capacity", capabilities:"technology", security:"security", atolye:"production", reports:"failures" };
export function buildAyasExecutiveBriefing(input: AyasControlCenterInput) {
  const view = buildAyasControlCenterView(input), sections: AyasBriefingSection[] = [], covered: AyasBriefingDomain[] = [];
  const validDomains = view.domains.filter(d => d.availability === "OK");
  for (const [domain,title] of Object.entries(titles) as [AyasBriefingDomain,string][]) {
    const rows = view.domains.filter(d => mapping[d.id] === domain), valid = rows.filter(d => d.availability === "OK");
    if (valid.length && valid.length === rows.length) covered.push(domain);
    sections.push({ domain,title,status: valid.length ? "OBSERVED" : rows.some(d => d.availability === "UNAVAILABLE") ? "UNAVAILABLE" : "NOT_CONFIGURED",
      summary: domain === "revenue" ? "Gelir ledger'i henüz bağlı değil; gerçekleşen gelir, kesinti ve kâr ölçülmedi."
        : domain === "production" ? briefingText(rows.map(d => d.summary).join(" · ")) + " Maliyet ledger'i bağlı değil; maliyet bilinmiyor."
        : briefingText(rows.map(d => d.summary).join(" · ") || "Henüz veri yok."),
      evidence: rows.map(d => d.source) });
  }
  const signals: AyasExecutiveSignal[] = [];
  for (const item of view.attention) {
    if (!validDomains.some(d => d.id === item.domain)) continue;
    const domain = mapping[item.domain];
    // Coverage is all-or-nothing for a domain: a failed source cannot resolve an old issue.
    const critical = item.domain === "health" && input.server?.health.kind === "ok" && input.server.health.value.findings.some(f => f.severity === "CRITICAL")
      || item.domain === "security" && input.server?.security.kind === "ok" && (input.server.security.value.accessGate === "misconfigured" || input.server.security.value.review.blockers > 0);
    const priority = critical ? "CRITICAL" as const : item.level === "ACTION_REQUIRED" ? "ACTION_REQUIRED" as const : item.level === "WARNING" ? "MATERIAL_INFO" as const : "ROUTINE" as const;
    const stable = ["health","security","development","graphify"].includes(item.domain) ? item.domain + ":condition" : item.domain + ":" + alertDigest(item.id).slice(0,32);
    const signal: AyasExecutiveSignal = { issueKey: stable,domain,priority,summary: briefingText(item.title),consequence: briefingText(item.reason),
      requestedDecision: priority === "ACTION_REQUIRED" ? "Mevcut kontrol merkezinde gerekli kararı incele." : null,
      evidence: { source: "control-center:" + item.domain,reference: "brain:" + item.domain,
        digest: alertDigest({ id:stable,title:briefingText(item.title),reason:briefingText(item.reason),details:item.details.map(d => briefingText(d)),priority }),observedAt:item.at } };
    if (!signals.some(s => s.issueKey === signal.issueKey)) signals.push(signal);
  }
  return { schemaVersion:"1" as const,generatedAt:view.generatedAt,sections,signals,covered,grantsAuthority:false as const,
    monetaryAuthority:"NONE" as const,productionCost:"NOT_CONFIGURED" as const,realizedRevenue:"NOT_CONFIGURED" as const,
    transport:"LOCAL_OWNER_UI_ONLY" as const };
}
