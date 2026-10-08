/** Read-only operator. Stdout by default; optional new output only within caller-created TEMP. */
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {collectAyasSystemAudit,createLocalAyasAuditCollector,inventoryAyasAuditProtectedRoots} from "../src/lib/ayas/audit/AyasSystemAuditCollector";
import {inventoryAyasAuditCombinedScope} from "../src/lib/ayas/audit/AyasSystemAuditCombinedScope";
import {createAyasAuditOperatorProbes} from "./lib/AyasSystemAuditProbes";
async function main(){let root=process.cwd(),output:string|null=null,protectedHash=false,combined=false,runtimeRoot:string|null=null,authorityRoot:string|null=null;const args=process.argv.slice(2);for(let i=0;i<args.length;i++){if(args[i]==="--repo"&&args[i+1])root=args[++i]!;else if(args[i]==="--output"&&args[i+1])output=args[++i]!;else if(args[i]==="--protected-hash"&&!protectedHash)protectedHash=true;
    else if(args[i]==="--protected-combined"&&!combined)combined=true;else if(args[i]==="--runtime-root"&&args[i+1]&&runtimeRoot===null)runtimeRoot=args[++i]!;else if(args[i]==="--authority-root"&&args[i+1]&&authorityRoot===null)authorityRoot=args[++i]!;else throw Error("AUDIT_ARGUMENT_INVALID");}
  // The combined scope takes explicit external roots only; no env file is read.
  if(combined?protectedHash||runtimeRoot===null||authorityRoot===null:runtimeRoot!==null||authorityRoot!==null)throw Error("AUDIT_ARGUMENT_INVALID");
  const deps=createLocalAyasAuditCollector(root,createAyasAuditOperatorProbes(root));
  const inventory=combined?()=>inventoryAyasAuditCombinedScope({repository:root,runtime:runtimeRoot!,authority:authorityRoot!}):protectedHash?()=>inventoryAyasAuditProtectedRoots(root,"STREAMING_LOCAL_HASH_ONLY"):null;
  const result=await collectAyasSystemAudit(inventory?{...deps,inventory}:deps),text=JSON.stringify(result,null,2)+"\n";
  if(output!==null){if(!path.isAbsolute(output)||!output.endsWith(".json"))throw Error("AUDIT_OUTPUT_INVALID");const parent=fs.realpathSync.native(path.dirname(output)),temp=fs.realpathSync.native(os.tmpdir()),relative=path.relative(temp,parent);
    if(relative.startsWith("..")||path.isAbsolute(relative)||!path.basename(parent).startsWith("ayas-audit-output-")||fs.lstatSync(path.dirname(output)).isSymbolicLink()||fs.existsSync(output))throw Error("AUDIT_OUTPUT_INVALID");fs.writeFileSync(path.join(parent,path.basename(output)),text,{flag:"wx",mode:0o600});}
  else console.log(text.trimEnd());
}
main().catch(()=>{console.error("AYAS_SYSTEM_AUDIT_UNAVAILABLE");process.exitCode=1;});
