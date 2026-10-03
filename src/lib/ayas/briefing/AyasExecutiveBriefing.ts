/**
 * Stage 15T — the owner briefing, projected from facts AYAS already reads
 * (Control Center sources and the Stage 15F reliability counters). No IO,
 * approval, execution or money.
 *
 * Nine canonical areas. Revenue and production cost stay NOT_CONFIGURED until
 * their ledgers are live; an unknown amount is never shown as zero. A source
 * that cannot be read is surfaced as MATERIAL_INFO and keeps its area
 * uncovered, so an old issue in that area is never treated as resolved.
 */
import { buildAyasControlCenterView, type AyasControlCenterInput, type AyasCcDomainId } from "../../brain/ui/AyasControlCenterModel";
import type { AyasReliabilitySloReport } from "../observability/AyasReliabilitySlo";
import { alertDigest, briefingText, type AyasExecutiveSignal, type AyasBriefingDomain } from "./AyasExecutiveAlerts";
export interface AyasBriefingSection { readonly domain: AyasBriefingDomain; readonly title: string; readonly status: "OBSERVED" | "NOT_CONFIGURED" | "UNAVAILABLE"; readonly summary: string; readonly evidence: readonly string[] }
export type AyasBriefingReliabilityFact = { readonly kind: "ok"; readonly value: AyasReliabilitySloReport } | { readonly kind: "unavailable" };
export interface AyasExecutiveBriefingInput extends AyasControlCenterInput {
  readonly reliability?: AyasBriefingReliabilityFact;
  /** The Control Center shows a failed report-center read as NO_DATA; the briefing reports it as unreadable. */
  readonly reportCenterUnavailable?: boolean;
}
const titles: Readonly<Record<AyasBriefingDomain,string>> = { health:"Sistem sağlığı", improvements:"Gelişmeler", failures:"Hatalar ve kurtarmalar", decisions:"Bekleyen owner kararları",
  production:"Üretim ve maliyet", revenue:"Gerçekleşen gelir, kesinti ve kâr", security:"Güvenlik", technology:"Model ve teknik fırsatlar", capacity:"Kapasite ve engeller" };
const mapping: Readonly<Record<AyasCcDomainId,AyasBriefingDomain>> = { health:"health", autonomy:"health", approvals:"decisions", development:"improvements", graphify:"capacity",
  research:"technology", experiments:"improvements", memory:"capacity", capabilities:"technology", security:"security", atolye:"production", reports:"failures" };
const RELIABILITY_SOURCE = "AyasReliabilitySlo (Stage 15F)";
const counters = [["unauthorizedWrites","unauthorized-writes","Yetkisiz yazma"],["duplicateExternalWrites","duplicate-external-writes","Yinelenen dış yazma"],
  ["staleHeadMutation","stale-head-mutation","Eski HEAD üzerinde değişiklik"],["unexplainedTaskLoss","unexplained-task-loss","Açıklanamayan görev kaybı"],
  ["regressionGateBypass","regression-gate-bypass","Regresyon kapısı atlatma"]] as const;
export function buildAyasExecutiveBriefing(input: AyasExecutiveBriefingInput) {
  const view = buildAyasControlCenterView(input), sections: AyasBriefingSection[] = [], covered: AyasBriefingDomain[] = [];
  const reliability = input.reliability?.kind === "ok" ? input.reliability.value : null;
  const validDomains = view.domains.filter(d => d.availability === "OK");
  for (const [domain,title] of Object.entries(titles) as [AyasBriefingDomain,string][]) {
    const rows = view.domains.filter(d => mapping[d.id] === domain), valid = rows.filter(d => d.availability === "OK");
    // Failures are observed only when both the report center and the reliability counters were read.
    const extraUnavailable = domain === "failures" && (!reliability || input.reportCenterUnavailable === true);
    if (valid.length && valid.length === rows.length && !extraUnavailable) covered.push(domain);
    const reliabilityLine = !reliability ? "Güvenilirlik sayaçları okunamadı."
      : "Güvenilirlik: " + counters.map(([key,,label]) => label + " " + (reliability[key].status === "UNKNOWN" ? "ölçülemedi" : reliability[key].status === "BREACH" ? reliability[key].observedViolations + " ihlal" : "0 (kapsamlı)")).join(" · ") + ". Küresel SLO sertifikalı değil.";
    sections.push({ domain,title,status: domain === "revenue" ? "NOT_CONFIGURED" : rows.some(d => d.availability === "UNAVAILABLE") || extraUnavailable ? "UNAVAILABLE" : valid.length ? "OBSERVED" : "NOT_CONFIGURED",
      summary: domain === "revenue" ? "Gelir ledger'i henüz bağlı değil; gerçekleşen gelir, kesinti ve kâr ölçülmedi."
        : domain === "production" ? briefingText(rows.map(d => d.summary).join(" · ")) + " Maliyet ledger'i bağlı değil; maliyet bilinmiyor."
        : domain === "failures" ? briefingText([...rows.map(d => d.summary), reliabilityLine].join(" · "), 480)
        : briefingText(rows.map(d => d.summary).join(" · ") || "Henüz veri yok."),
      evidence: domain === "failures" ? [...rows.map(d => d.source), RELIABILITY_SOURCE] : rows.map(d => d.source) });
  }
  const signals: AyasExecutiveSignal[] = [];
  for (const item of view.attention) {
    // Only readable domains raise issues. An unreadable source is reported once, below, under its own key,
    // so its WARNING item never replaces or lowers a known condition.
    if (!validDomains.some(d => d.id === item.domain)) continue;
    const domain = mapping[item.domain];
    const critical = item.domain === "health" && input.server?.health.kind === "ok" && input.server.health.value.findings.some(f => f.severity === "CRITICAL")
      || item.domain === "security" && input.server?.security.kind === "ok" && (input.server.security.value.accessGate === "misconfigured" || input.server.security.value.review.blockers > 0);
    const priority = critical ? "CRITICAL" as const : item.level === "ACTION_REQUIRED" ? "ACTION_REQUIRED" as const : item.level === "WARNING" ? "MATERIAL_INFO" as const : "ROUTINE" as const;
    // One condition per domain where the item id carries the changing state; otherwise the item id is the issue.
    const stable = ["health","security","development","graphify"].includes(item.domain) ? item.domain + ":condition" : item.domain + ":" + alertDigest(item.id).slice(0,32);
    const signal: AyasExecutiveSignal = { issueKey: stable,domain,priority,summary: briefingText(item.title),consequence: briefingText(item.reason),
      requestedDecision: priority === "ACTION_REQUIRED" ? "Mevcut kontrol merkezinde gerekli kararı incele." : null,
      evidence: { source: "control-center:" + item.domain,reference: "brain:" + item.domain,
        digest: alertDigest({ id:stable,title:briefingText(item.title),reason:briefingText(item.reason),details:item.details.map(d => briefingText(d)),priority }),observedAt:item.at } };
    if (!signals.some(s => s.issueKey === signal.issueKey)) signals.push(signal);
  }
  if (reliability) for (const [key,slug,label] of counters) {
    const counter = reliability[key];
    if (counter.status !== "BREACH") continue;
    signals.push({ issueKey: "failures:reliability-" + slug, domain: "failures", priority: "CRITICAL", summary: briefingText(label + ": " + counter.observedViolations + " gözlenmiş ihlal"),
      consequence: briefingText("Sıfır hedefli güvenilirlik sayacı ihlal edildi (" + counter.scope + "). Kanıtı incele; hiçbir işlem kendiliğinden başlatılmaz."),
      requestedDecision: null, evidence: { source: "reliability-slo", reference: "reliability:" + slug,
        digest: alertDigest({ counter: key, status: counter.status, observedViolations: counter.observedViolations }), observedAt: null } });
  }
  const unreadable = [...view.domains.filter(d => d.availability === "UNAVAILABLE").map(d => d.title), ...(reliability ? [] : ["Güvenilirlik sayaçları"]),
    ...(input.reportCenterUnavailable === true ? ["AYAS Raporları"] : [])].sort((a,b) => a.localeCompare(b, "tr"));
  if (unreadable.length) signals.push({ issueKey: "health:sources-unavailable", domain: "health", priority: "MATERIAL_INFO",
    summary: briefingText(unreadable.length + " kaynak okunamadı: " + unreadable.join(", ")),
    consequence: "Bu alanlardaki durum doğrulanamıyor; oradaki eski bildirimler çözülmüş sayılmaz.", requestedDecision: null,
    evidence: { source: "briefing-coverage", reference: "brain:sources", digest: alertDigest({ unreadable }), observedAt: null } });
  return { schemaVersion:"1" as const,generatedAt:view.generatedAt,sections,signals,covered,grantsAuthority:false as const,
    monetaryAuthority:"NONE" as const,productionCost:"NOT_CONFIGURED" as const,realizedRevenue:"NOT_CONFIGURED" as const,
    transport:"LOCAL_OWNER_UI_ONLY" as const };
}
