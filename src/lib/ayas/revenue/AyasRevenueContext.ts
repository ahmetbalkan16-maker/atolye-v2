/** Only code-generated compact facts reach chat. No writer binding, raw message, owner authentication or action authority. */
import { buildAyasRevenueIntelligence } from "./AyasRevenueIntelligence";
import { detectAyasRevenueRecall } from "./AyasRevenueRecall";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue } from "./AyasRevenueRedaction";
export const AYAS_REVENUE_CONTEXT_MAX_LINES=12,AYAS_REVENUE_CONTEXT_MAX_CHARS=3072;
export function isAyasRevenueContextRelevant(text:string):boolean {
  if(typeof text!=="string"||text.length>8192)return false;
  const t=text.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu,"").replace(/ı/g,"i");
  return /etsy|upwork|fiverr|udemy|lemon|sat[iı]|satiyor|teklif|gelir|kazand|kanal|fiyat|deney|follow.?up|takip|urun|kar\b/.test(t);
}
export function buildAyasRevenueContext(input:{readonly memory:unknown;readonly ledger:unknown;readonly userText:string;readonly now:string}) {
  const done=(status:"OK"|"UNAVAILABLE"|"NOT_RELEVANT",lines:readonly string[],records:number,warnings:number)=>deepFreezeAyasRevenueValue({status,lines,recordCount:records,warningCount:warnings,grantsAuthority:false,autonomousBudgetUsd:0});
  if(!isAyasRevenueContextRelevant(input.userText))return done("NOT_RELEVANT",[],0,0);
  try{
    const query=detectAyasRevenueRecall(input.userText,input.now),s=buildAyasRevenueIntelligence(input.memory,input.ledger,query);
    const selected=s.views.filter(v=>(query.mode==="history"?v.state!=="future":v.isCurrent)&&(!query.platform||v.record.platform===query.platform));
    const lines=["[Gelir iş bağlamı: salt okunur gözlemler; owner kaydı doğrulanmış onay değildir; yürütme yetkisi NONE; bütçe 0.]",
      `Zaman: ${query.mode}; asOf=${s.asOf}; evidence=${s.evidenceFreshness}.`,
      ...(s.currentPrimaryOffer?[`Owner-source plan digest=${s.currentPrimaryOffer}; normalized/unverified.`]:["Geçerli tek owner-source ana teklif planı: UNKNOWN."]),
      ...s.realizedEconomicsByCurrency.slice(0,3).map(e=>`Ledger ${e.currency}: net=${e.netRevenueMinor} minor; katkı=${e.contributionProfitMinor??"UNKNOWN"} minor; ${e.status}; observations unverified.`),
      ...selected.slice().sort((a,b)=>Date.parse(b.record.effectiveFrom)-Date.parse(a.record.effectiveFrom)||a.record.recordId.localeCompare(b.record.recordId)).slice(0,3).map(v=>`${v.record.kind}/${v.record.platform??"local"}: ${v.record.value.state??v.record.value.code??"DIGEST_ONLY"}; ${v.state}; ${v.record.factClass}.`),
      ...(s.followUps.length?[`Açık takip=${s.followUps.length}; sıradaki=${[...s.followUps].filter(v=>v.value.dueAt).sort((a,b)=>a.value.dueAt!.localeCompare(b.value.dueAt!))[0]?.value.dueAt??"UNKNOWN"}.`]:[]),
      ...(s.warnings.length?["Uyarılar: "+s.warnings.slice(0,6).join(",")]:[])
    ].slice(0,AYAS_REVENUE_CONTEXT_MAX_LINES);
    if(lines.join("\n").length>AYAS_REVENUE_CONTEXT_MAX_CHARS||containsAyasRevenueSensitiveData(lines))throw Error();
    return done("OK",lines,selected.length,s.warnings.length);
  }catch{return done("UNAVAILABLE",["[Gelir iş bağlamı UNAVAILABLE; ekonomik gerçek veya owner onayı çıkarılamaz; yürütme yetkisi NONE; bütçe 0.]"],0,0);}
}
