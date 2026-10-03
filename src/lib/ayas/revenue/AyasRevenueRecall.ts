/** Stateless Turkish business-query intent. A historical turn cannot change the next current query. */
import { isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import type { AyasRevenueTemporalQuery } from "./AyasRevenueTemporal";
export interface AyasRevenueRecallQuery extends AyasRevenueTemporalQuery {readonly intent:"PLANS"|"ECONOMICS"|"EXPERIMENTS"|"FOLLOWUPS"|"HISTORY";readonly platform:string|null}
export function detectAyasRevenueRecall(text:string,now:string):AyasRevenueRecallQuery {
  if(typeof text!=="string"||text.length>8192||!isAyasRevenueTimestamp(now))throw Error("AYAS_REVENUE_RECALL_QUERY_INVALID");
  const t=text.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu,"").replace(/[ı]/g,"i"),n=new Date(now);
  let mode:AyasRevenueTemporalQuery["mode"]="current",at=now,from:string|null=null,until:string|null=null;
  if(!/\b(su an|simdi|guncel|halen|bugun)\b/.test(t)) {
    if(/\b(gecen ay|onceki ay)\b/.test(t)){from=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth()-1,1)).toISOString();until=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),1)).toISOString();at=new Date(Date.parse(until)-1).toISOString();mode="as-of";}
    else {const date=t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(date){const d=new Date(date[1]+"T23:59:59.999Z");if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date[1]||d.getTime()>Date.parse(now))throw Error("AYAS_REVENUE_RECALL_QUERY_INVALID");at=d.toISOString();mode="as-of";}
      else if(/\b(gecmis|onceki|eskiden|vazgecmis|degisti|neyi denedik|ne denedik)\b|miydik|mustuk|mistik/.test(t))mode="history";
    }
  }
  const intent=/kazand|gelir|kar\b|ucret|refund|iade|ekonomi/.test(t)?"ECONOMICS":/takip|follow.?up|vadesi/.test(t)?"FOLLOWUPS":/deney|denedik|deneme/.test(t)?"EXPERIMENTS":mode==="history"?"HISTORY":"PLANS";
  const platform=["etsy","upwork","fiverr","udemy","lemon-squeezy"].find(p=>t.includes(p)||p==="lemon-squeezy"&&t.includes("lemon"))??null;
  return Object.freeze({mode,at,knownAt:now,from,until,intent,platform});
}
