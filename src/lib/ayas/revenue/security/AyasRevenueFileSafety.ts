/** Byte inspection is a quarantine eligibility check, never a malware-free attestation or parser. */
import { TextDecoder } from "node:util";
import { inspectAyasRevenueContent } from "./AyasRevenueContentFirewall";
import { AYAS_REVENUE_SECURITY_LIMITS,revenueRiskEvidence,type AyasRevenueRiskCode } from "./AyasRevenueThreatModel";
function inspectAttachment(name:unknown,mime:unknown,raw:unknown,platform:unknown) {
  const codes:AyasRevenueRiskCode[]=[];
  if(typeof name!=="string"||name.length>128||!/^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(name)||name.includes("..")||/[\\/:]/.test(name))codes.push("ARCHIVE_TRAVERSAL");
  const extension=typeof name==="string"?name.toLowerCase().split(".").pop():"";
  if(typeof name==="string"&&/\.(?:exe|dll|bat|cmd|com|scr|msi|ps1|sh|js|vbs|jar|lnk|docm|xlsm|pptm)(?:\.|$)/i.test(name))codes.push("EXECUTABLE_ATTACHMENT");
  if(!Buffer.isBuffer(raw)||!raw.length||raw.length>AYAS_REVENUE_SECURITY_LIMITS.fileBytes)return Object.freeze({decision:"BLOCK",isolation:"NONE",...revenueRiskEvidence([...codes,"MALICIOUS_ATTACHMENT"],null)});
  const bytes=Buffer.from(raw),head=bytes.subarray(0,16),ascii=bytes.toString("latin1");
  if(head.subarray(0,2).toString()==="MZ"||head[0]===0x7f&&head.subarray(1,4).toString()==="ELF"||ascii.startsWith("#!"))codes.push("EXECUTABLE_ATTACHMENT");
  // All archives/office containers need a separately qualified parser; listing metadata is not trusted.
  if(head.subarray(0,2).toString()==="PK"||["zip","rar","7z","tar","gz","docx","xlsx","pptx"].includes(extension??""))codes.push("MALICIOUS_ATTACHMENT");
  const matches=extension==="pdf"&&mime==="application/pdf"&&ascii.startsWith("%PDF-")&&!/\/(?:JS|JavaScript|Launch|EmbeddedFile|OpenAction|AA)\b/.test(ascii)
    ||extension==="png"&&mime==="image/png"&&head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(-8,-4).toString()==="IEND"
    ||["jpg","jpeg"].includes(extension??"")&&mime==="image/jpeg"&&head[0]===255&&head[1]===216&&head[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217
    ||extension==="txt"&&mime==="text/plain";
  if(!matches)codes.push("MALICIOUS_ATTACHMENT");
  try { const text=extension==="txt"?new TextDecoder("utf-8",{fatal:true}).decode(bytes):ascii;
    const content=inspectAyasRevenueContent(text,platform);if(content.decision==="BLOCK")codes.push(...content.risks);
  } catch { codes.push("MALICIOUS_ATTACHMENT"); }
  return Object.freeze({decision:codes.length?"BLOCK":"ALLOW_TEMP_QUARANTINE",isolation:codes.length?"NONE":"OWNED_TEMP_READ_ONLY",...revenueRiskEvidence(codes,{name,mime,byteLength:bytes.length})});
}
export function inspectAyasRevenueAttachment(name:unknown,mime:unknown,raw:unknown,platform:unknown) {
  try { return inspectAttachment(name,mime,raw,platform); } catch { return Object.freeze({decision:"BLOCK",isolation:"NONE",...revenueRiskEvidence(["MALICIOUS_ATTACHMENT"],null)}); }
}
