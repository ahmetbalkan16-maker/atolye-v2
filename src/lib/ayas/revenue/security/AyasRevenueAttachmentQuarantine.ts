/** No downloads, caller paths or parsers. Only inspected bytes enter a fresh owned TEMP directory. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectAyasRevenueAttachment } from "./AyasRevenueFileSafety";
import { revenueRiskEvidence,AYAS_REVENUE_SECURITY_LIMITS } from "./AyasRevenueThreatModel";
export function quarantineAyasRevenueAttachment(name:unknown,mime:unknown,raw:unknown,platform:unknown) {
  let captured:Buffer|null=null;try { if(Buffer.isBuffer(raw)&&raw.length<=AYAS_REVENUE_SECURITY_LIMITS.fileBytes)captured=Buffer.from(raw); } catch { /* Refuse without exposing the caller's exception. */ }
  const inspection=inspectAyasRevenueAttachment(name,mime,captured,platform);
  if(inspection.decision!=="ALLOW_TEMP_QUARANTINE"||captured===null)return Object.freeze({state:"REFUSED",...inspection});
  const parent=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,"ayas-revenue-quarantine-")),file=path.join(root,"attachment.bin");
  try {
    if(path.dirname(fs.realpathSync.native(root)).toLowerCase()!==parent.toLowerCase()||fs.lstatSync(root).isSymbolicLink())throw Error("TEMP_BOUNDARY");
    fs.writeFileSync(file,captured,{flag:"wx",mode:0o400});fs.chmodSync(file,0o444);
    const identity=fs.lstatSync(file);if(!identity.isFile()||identity.isSymbolicLink()||identity.nlink!==1||identity.size!==captured.length)throw Error("FILE_BOUNDARY");
    const observed=fs.readFileSync(file);if(!observed.equals(captured))throw Error("FILE_CHANGED");
    const checked=inspectAyasRevenueAttachment(name,mime,observed,platform);if(checked.decision!=="ALLOW_TEMP_QUARANTINE")throw Error("FILE_REFUSED");
    return Object.freeze({state:"TEMP_READ_ONLY_INSPECTED",byteLength:observed.length,parserQualification:"NONE",malwareAttestation:"NONE",durableRetention:"NONE",...checked});
  } catch { return Object.freeze({state:"REFUSED",...revenueRiskEvidence(["MALICIOUS_ATTACHMENT"],null)}); }
  finally {
    // Delete only the known file/root we created, with containment and link checks; never recurse.
    if(!fs.lstatSync(root).isSymbolicLink()&&path.dirname(fs.realpathSync.native(root)).toLowerCase()===parent.toLowerCase()) {
      if(fs.existsSync(file)){const s=fs.lstatSync(file);if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1){fs.chmodSync(file,0o600);fs.unlinkSync(file);}}
      if(fs.readdirSync(root).length===0)fs.rmdirSync(root);
    }
  }
}
