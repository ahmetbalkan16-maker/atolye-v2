import Link from "next/link";
import { loadAyasRevenueActivityReport } from "@/lib/ayas/revenue/activity/AyasRevenueActivityReport";
export const dynamic = "force-dynamic";
export default function RevenueCenterPage() {
  const report = loadAyasRevenueActivityReport(new Date().toISOString());
  return <main className="bc-shell">
    <h1>Gelir Merkezi</h1>
    <p>Kaynak durumu: {report.status}. Salt okunur gözlemler; yürütme ve finansal yetki verilmez.</p>
    <Link href="/brain/briefing">Owner özeti</Link>
    <h2>Platformlar ve güncel faaliyet</h2>
    <table><thead><tr><th>Platform</th><th>Hesap / bağlantı</th><th>Fırsatlar</th><th>Taslaklar</th><th>Aktif işler</th><th>Bugün brüt gelir (UTC)</th><th>Gerçekleşen net kâr</th><th>Bekleyen inceleme</th><th>Sıradaki adım</th></tr></thead>
      <tbody>{report.platforms.map(p => <tr key={p.platform}><td>{p.platform}</td><td>{p.accountLabel ?? "Bağlı kaynak yok"} / {p.connection}</td><td>{p.opportunities ?? "Bilinmiyor"}</td><td>{p.drafts ?? "Bilinmiyor"}</td><td>{p.activeWork ?? "Bilinmiyor"}</td><td>{p.todayRealized?.map(e=>e.currency+" "+e.grossRevenueMinor+" minor").join(", ")||"Bilinmiyor"}</td><td>{p.realized?.map(e=>e.currency+" "+(e.contributionProfitMinor??"Bilinmiyor")+" minor").join(", ")||"Bilinmiyor"}</td><td>{p.approvalsPending ?? "Bilinmiyor"}</td><td>{p.nextAction}</td></tr>)}</tbody></table>
    {report.status === "OBSERVED" && report.platforms.map(p => <section key={p.platform}><p>{p.platform}: {p.liveActivity.map(a => a.operation + "/" + a.phase).join(", ") || "Aktif faaliyet gözlemi yok"}</p>{p.accounts.map(a=><p key={a.accountDigest}>account-{a.accountDigest.slice(0,12)} · bağlantı {a.connection} · gözlem {a.observedAt}</p>)}</section>)}
    <h2>Owner inceleme kuyruğu</h2>
    <p>Bu liste gözlemlenen inceleme talepleridir. Kararlar mevcut owner onay yolunda verilir.</p>
    {report.approvalQueue.length ? report.approvalQueue.map(a => <p key={a.recordDigest}>{a.platform} · {a.operation} · neden {a.reasonCode} · beklenen maliyet {a.expectedCost.state === "KNOWN" ? a.expectedCost.amount.valueMinor + " " + a.expectedCost.amount.currency + " minor" : "Bilinmiyor"} · etki {a.expectedEffect} · risk {a.risk} · karar {a.requestedDecision} · eylem {a.actionDigest}</p>) : <p>{report.status === "OBSERVED" ? "Bekleyen inceleme gözlemi yok." : "Onay kaynağı bağlı değil."}</p>}
    <h2>Gerçekleşen gelir ve maliyet</h2>
    {report.realized?.length ? report.realized.map(e => <p key={e.currency}>{e.currency} · brüt {e.grossRevenueMinor} · platform kesintisi {e.platformFeesMinor} · işlem kesintisi {e.paymentProcessingFeesMinor} · iade {e.refundsMinor} · gider {e.variableDeliveryCostMinor + e.adSpendMinor + e.otherCostMinor} · net kâr {e.contributionProfitMinor ?? "Bilinmiyor"} minor · {e.status}</p>) : <p>Gerçekleşen para gözlemi yok; kazanç çıkarılamaz.</p>}
    <p>Bekleyen mutabakat, üretim transferi ve kullanılabilir üretim limiti: kaynak bağlı değil.</p>
    <h2>Tahminler</h2>
    <p>Tahmini maliyetler gerçekleşen paraya veya harcama yetkisine eklenmez.</p>
    {report.estimates.map(e => <p key={e.actionDigest}>{e.expectedEffect}: {e.expectedCost.state === "KNOWN" ? e.expectedCost.amount.valueMinor + " " + e.expectedCost.amount.currency + " minor" : "Bilinmiyor"}</p>)}
    <h2>Faaliyet ve neden geçmişi</h2>
    {report.timeline.length ? report.timeline.map(a => <p key={a.recordDigest}>{a.occurredAt} · {a.platform} · {a.operation}/{a.phase} · {a.effect} · {a.reasonCode} · kural {a.ruleCode} · kanıt {a.evidenceDigest}</p>) : <p>Dayanıklı faaliyet kaynağı bağlı değil.</p>}
  </main>;
}
