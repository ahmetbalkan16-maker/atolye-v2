/** Explicit-root offline business history. No production writer, conversation store or ledger write binding. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureSafeContainedDirectory, requireContainedRealDirectory } from "../../runtime/RuntimeStoragePaths";
import { withAyasExecutionAuthorityLock, AyasExecutionAuthorityLockError } from "../../brain/autonomy/AyasExecutionAuthorityLock";
import { assertAyasSafeModeAllowsMutation } from "../safety/AyasSafeModeReader";
import { AYAS_REVENUE_MEMORY_MAX_BYTES, AYAS_REVENUE_MEMORY_MAX_RECORDS, AyasRevenueMemoryError, createAyasRevenueMemoryRecord,
  emptyAyasRevenueMemory, planAyasRevenueMemoryAppend, validateAyasRevenueMemoryState, type AyasRevenueMemoryRecord, type AyasRevenueMemoryState } from "./AyasRevenueMemory";
export class AyasRevenueMemoryStore {
  private readonly repoRoot:string; private readonly root:string; private readonly file:string;
  private readonly limit:number; private readonly now:()=>string;
  constructor(repoRoot:string,options:{readonly maxRecords?:number;readonly now?:()=>string}={}) {
    try{this.repoRoot=requireContainedRealDirectory(path.resolve(repoRoot),path.resolve(repoRoot),true);}catch{throw new AyasRevenueMemoryError("STORAGE_UNSAFE");}
    this.root=path.join(this.repoRoot,"data","brain","revenue","intelligence");this.file=path.join(this.root,"memory.json");
    this.limit=options.maxRecords??AYAS_REVENUE_MEMORY_MAX_RECORDS;this.now=options.now??(()=>new Date().toISOString());
    if(!Number.isSafeInteger(this.limit)||this.limit<1||this.limit>AYAS_REVENUE_MEMORY_MAX_RECORDS)throw new AyasRevenueMemoryError("CAPACITY");
  }
  private checkRoot():boolean {
    try{requireContainedRealDirectory(this.repoRoot,this.repoRoot,true);for(const p of [path.join(this.repoRoot,"data"),path.join(this.repoRoot,"data","brain"),path.join(this.repoRoot,"data","brain","revenue"),this.root]){
      try{fs.lstatSync(p);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}requireContainedRealDirectory(this.repoRoot,p);}return true;
    }catch{throw new AyasRevenueMemoryError("STORAGE_UNSAFE");}
  }
  /** Missing storage is a write-free empty read; damaged or unsafe storage is never empty. */
  read():AyasRevenueMemoryState {
    for(let attempt=0;attempt<3;attempt++){
      if(!this.checkRoot())return emptyAyasRevenueMemory();let stat:fs.Stats;
      try{stat=fs.lstatSync(this.file);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return emptyAyasRevenueMemory();throw new AyasRevenueMemoryError("STORAGE_IO");}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>AYAS_REVENUE_MEMORY_MAX_BYTES)throw new AyasRevenueMemoryError("STORAGE_UNSAFE");
      let fd:number|undefined;
      try{fd=fs.openSync(this.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));const opened=fs.fstatSync(fd);
        if(!opened.isFile()||opened.nlink>1||opened.size>AYAS_REVENUE_MEMORY_MAX_BYTES)throw new AyasRevenueMemoryError("STORAGE_UNSAFE");
        if(opened.nlink===0||opened.ino!==stat.ino||opened.dev!==stat.dev)continue;
        const bytes=fs.readFileSync(fd,"utf8");if(Buffer.byteLength(bytes)>AYAS_REVENUE_MEMORY_MAX_BYTES)throw new AyasRevenueMemoryError("STORAGE_UNSAFE");
        let raw:unknown;try{raw=JSON.parse(bytes);}catch{throw new AyasRevenueMemoryError("INVALID_STORE");}return validateAyasRevenueMemoryState(raw);
      }catch(e){if(e instanceof AyasRevenueMemoryError)throw e;throw new AyasRevenueMemoryError("STORAGE_IO");}finally{if(fd!==undefined)fs.closeSync(fd);}
    }throw new AyasRevenueMemoryError("REVISION_CONFLICT");
  }
  async append(raw:unknown):Promise<{readonly status:"APPENDED"|"REPLAY";readonly revision:number;readonly record:AyasRevenueMemoryRecord;readonly grantsAuthority:false}> {
    const candidate=createAyasRevenueMemoryRecord(raw,this.now()),before=this.read(),early=planAyasRevenueMemoryAppend(before,candidate);
    const result=(status:"APPENDED"|"REPLAY",revision:number,record:AyasRevenueMemoryRecord)=>Object.freeze({status,revision,record,grantsAuthority:false as const});
    if(early.kind==="REPLAY")return result("REPLAY",before.revision,early.record);if(before.records.length>=this.limit)throw new AyasRevenueMemoryError("CAPACITY");
    assertAyasSafeModeAllowsMutation(this.repoRoot);
    try{ensureSafeContainedDirectory(this.repoRoot,this.root);const execution=ensureSafeContainedDirectory(this.repoRoot,path.join(this.root,"execution")),lock=path.join(execution,".authority-lock");
      if(fs.existsSync(lock))requireContainedRealDirectory(this.repoRoot,lock);
      return await withAyasExecutionAuthorityLock(this.root,async()=>{
        assertAyasSafeModeAllowsMutation(this.repoRoot);this.checkRoot();requireContainedRealDirectory(this.repoRoot,execution);requireContainedRealDirectory(this.repoRoot,lock);
        const current=this.read(),plan=planAyasRevenueMemoryAppend(current,candidate);if(plan.kind==="REPLAY")return result("REPLAY",current.revision,plan.record);
        if(current.records.length>=this.limit)throw new AyasRevenueMemoryError("CAPACITY");
        const next=validateAyasRevenueMemoryState({schemaVersion:"1",revision:current.revision+1,records:[...current.records,candidate]}),bytes=JSON.stringify(next,null,2)+"\n";
        if(Buffer.byteLength(bytes)>AYAS_REVENUE_MEMORY_MAX_BYTES)throw new AyasRevenueMemoryError("CAPACITY");
        const pending=path.join(this.root,".memory-"+randomUUID()+".tmp");let fd:number|undefined;
        try{fd=fs.openSync(pending,"wx",0o600);fs.writeFileSync(fd,bytes,"utf8");fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
          assertAyasSafeModeAllowsMutation(this.repoRoot);this.checkRoot();if(JSON.stringify(this.read())!==JSON.stringify(current))throw new AyasRevenueMemoryError("REVISION_CONFLICT");fs.renameSync(pending,this.file);
        }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(pending))fs.unlinkSync(pending);}
        return result("APPENDED",next.revision,candidate);
      },{acquireRetryLimit:250,acquireRetryDelayMs:20});
    }catch(e){if(e instanceof AyasRevenueMemoryError||e instanceof Error&&/^AYAS_SAFE_/.test(e.message))throw e;
      if(e instanceof AyasExecutionAuthorityLockError&&e.code==="AYAS_LOCK_BUSY")throw new AyasRevenueMemoryError("LOCK_BUSY");throw new AyasRevenueMemoryError("STORAGE_IO");}
  }
}
