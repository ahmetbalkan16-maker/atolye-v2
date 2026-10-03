/** Quarantine instructions as codes only. Accepted external text stays DATA_ONLY, never a selector. */
import { isAyasRevenuePlatform,isAyasRevenueSensitiveText,containsAyasRevenueSensitiveData } from "../AyasRevenueRedaction";
import type { AyasRevenuePlatform } from "../AyasRevenuePlatformTypes";
import { AYAS_REVENUE_SECURITY_LIMITS,revenueRiskEvidence,revenueSecuritySnapshot,type AyasRevenueRiskCode } from "./AyasRevenueThreatModel";
const HOSTS:Readonly<Record<AyasRevenuePlatform,readonly string[]>>=Object.freeze({etsy:["openapi.etsy.com","api.etsy.com","www.etsy.com"],upwork:["mcp.upwork.com","www.upwork.com"],fiverr:["www.fiverr.com"],udemy:["www.udemy.com"],"lemon-squeezy":["api.lemonsqueezy.com","www.lemonsqueezy.com"]});
/** No caller-supplied allowlist. Support/docs host qualification remains owner-unbound. No URL is opened. */
export function inspectAyasRevenueLink(raw:unknown,platform:unknown) {
  const codes:AyasRevenueRiskCode[]=[];
  try { if(typeof raw!=="string"||raw.length>2048||!isAyasRevenuePlatform(platform)||/[\s\\\u0000-\u001f\u007f]/.test(raw))throw Error("INVALID");
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.port||u.username||u.password||u.hostname.endsWith(".")||!HOSTS[platform].includes(u.hostname)
      ||/(?:^|\/)(?:redirect|redirector|out|reset|reset-password|login-reset)(?:\/|$)/i.test(u.pathname)
      ||/[?&](?:url|redirect|redirect_uri|return_url|next|target|destination)=/i.test(u.search))codes.push("PHISHING_LINK");
    if(isAyasRevenueSensitiveText(raw))codes.push("SECRET_LEAK");
  } catch { codes.push("PHISHING_LINK"); }
  return Object.freeze({decision:codes.length?"BLOCK":"ALLOW_CANONICAL_REFERENCE",autoOpen:false,...revenueRiskEvidence(codes,null)});
}
const fold=(v:string)=>v.normalize("NFKC").replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,"").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ı/g,"i").replace(/\s+/g," ");
export function inspectAyasRevenueContent(raw:unknown,platform:unknown) {
  const copied=revenueSecuritySnapshot(raw,AYAS_REVENUE_SECURITY_LIMITS.textBytes),codes:AyasRevenueRiskCode[]=[];
  if(copied===null||!isAyasRevenuePlatform(platform))return Object.freeze({decision:"BLOCK",context:null,trust:"EXTERNAL_UNTRUSTED_TEXT",...revenueRiskEvidence(["UNKNOWN_RISK"],null)});
  const text=typeof copied==="string"?copied:JSON.stringify(copied),f=fold(text);
  if(containsAyasRevenueSensitiveData(copied)||isAyasRevenueSensitiveText(text))codes.push("SECRET_LEAK");
  if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)||/\b(?:customer address|phone number|telefon numarasi|musteri adresi)\b/.test(f))codes.push("PII_OVEREXPOSURE");
  if(/(?:ignore|disregard|forget|override).{0,48}(?:instruction|system|policy)|(?:onceki|sistem).{0,30}(?:talimat|kurallari).{0,24}(?:yok say|unut)|\[(?:system|developer)\]|<\/?(?:system|developer)>/.test(f))codes.push("PROMPT_INJECTION");
  if(/\b(?:owner|sahip|kullanici)\s+(?:(?:has|already|explicitly)\s+)?(?:approved|approval|onay)|(?:bypass|skip|ignore).{0,24}(?:approval|security|gate)|onay.{0,20}(?:atla|gerekmez)|(?:run|execute|invoke|call).{0,24}(?:command|tool|powershell|shell|terminal)|(?:komut|arac).{0,20}(?:calistir|cagir)|(?:adapter|operation|tool)\s*[:=]/.test(f))codes.push("POLICY_BYPASS_DIRECTIVE");
  if(/(?:send|share|provide|enter|paste).{0,36}(?:password|token|credential|security code|api key)|(?:sifre|guvenlik kodu|erisim anahtari).{0,24}(?:gonder|paylas|gir)|\b(?:otp|verification code)\b/.test(f))codes.push("CREDENTIAL_REQUEST");
  if(/off.platform|outside.{0,16}(?:platform|marketplace)|gift.?card|crypto|bitcoin|wire transfer|verification payment|payout.{0,20}(?:change|destination)|platform disi|hediye kart|kripto|dogrulama odemesi/.test(f))codes.push("OFF_PLATFORM_PAYMENT_REQUEST");
  if(/(?:official support|support agent|resmi destek).{0,64}(?:verify|reset|pay|password|sifre|odeme|dogrula)/.test(f))codes.push("UNVERIFIED_SUPPORT_REQUEST");
  if(/[a-z]:[\\/]|(?:^|[\s"'])\.{2}[\\/]|(?:^|[\s"'])\/(?:etc|home|tmp|usr)\//i.test(text)||/\b(?:download|upload|indir|yukle).{0,60}\.(?:exe|bat|cmd|ps1|sh|msi|scr)\b/.test(f))codes.push("MALICIOUS_ATTACHMENT");
  // Walk values so JSON punctuation/escaping cannot hide a link from the hostname check.
  const visit=(v:unknown):void=>{if(typeof v==="string"){for(const m of v.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:)[^\s<>"']+/gi)){const link=m[0].replace(/[),.;]+$/,"");if(inspectAyasRevenueLink(link,platform).decision==="BLOCK")codes.push("PHISHING_LINK");}}else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==="object")Object.values(v).forEach(visit);};visit(copied);
  const evidence=revenueRiskEvidence(codes,copied);
  return Object.freeze({decision:codes.length?"BLOCK":"DATA_ONLY",context:codes.length?null:text,trust:"EXTERNAL_UNTRUSTED_TEXT",...evidence});
}
