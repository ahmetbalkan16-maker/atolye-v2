/** Explicit-root offline history. Fixed file, append-only events, atomic CAS; no production binding or executor. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { ensureSafeContainedDirectory,requireContainedRealDirectory } from "../../../runtime/RuntimeStoragePaths";
import { withAyasExecutionAuthorityLock,AyasExecutionAuthorityLockError } from "../../../brain/autonomy/AyasExecutionAuthorityLock";
import { assertAyasSafeModeAllowsMutation } from "../../safety/AyasSafeModeReader";
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { hasExactAyasRevenueKeys,isAyasRevenuePlainRecord,isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { AYAS_REVENUE_PILOT_LIMITS,AyasRevenuePilotError,createAyasRevenuePilot,createAyasRevenuePilotObservation,emptyAyasRevenuePilotStore,
  makeAyasRevenuePilotEvent,projectAyasRevenuePilotStore,snapshotAyasRevenuePilotData,validateAyasRevenuePilotStore,type AyasRevenuePilotEvent,type AyasRevenuePilotState,type AyasRevenuePilotStoreState } from "./AyasRevenuePilot";
import { createAyasRevenuePilotPolicy,type AyasRevenuePilotOwnerRead } from "./AyasRevenuePilotPolicy";
export class AyasRevenuePilotStore {
  private readonly repoRoot:string;private readonly root:string;private readonly file:string;private readonly now:()=>string;
  private readonly policy:ReturnType<typeof createAyasRevenuePilotPolicy>;
  constructor(repoRoot:string,options:{readonly now?:()=>string;readonly readExistingOwnerReviewedDecision?:(scope:AyasRevenuePilotOwnerRead)=>unknown}={}){
    if(types.isProxy(options)||!isAyasRevenuePlainRecord(options)||!hasExactAyasRevenueKeys(options,[],["now","readExistingOwnerReviewedDecision"]))throw new AyasRevenuePilotError("INVALID_OPTIONS");
    try{this.repoRoot=requireContainedRealDirectory(path.resolve(repoRoot),path.resolve(repoRoot),true);}catch{throw new AyasRevenuePilotError("STORAGE_UNSAFE");}
    this.root=path.join(this.repoRoot,"data","brain","revenue","pilots");this.file=path.join(this.root,"pilot.json");this.now=options.now??(()=>new Date().toISOString());
    if(typeof this.now!=="function")throw new AyasRevenuePilotError("INVALID_CLOCK");this.policy=createAyasRevenuePilotPolicy(options.readExistingOwnerReviewedDecision===undefined?{}:{readExistingOwnerReviewedDecision:options.readExistingOwnerReviewedDecision});
  }
  private checkRoot():boolean {
    try{requireContainedRealDirectory(this.repoRoot,this.repoRoot,true);for(const p of [path.join(this.repoRoot,"data"),path.join(this.repoRoot,"data","brain"),path.join(this.repoRoot,"data","brain","revenue"),this.root]){
      try{fs.lstatSync(p);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}requireContainedRealDirectory(this.repoRoot,p);}return true;
    }catch{throw new AyasRevenuePilotError("STORAGE_UNSAFE");}
  }
  read():AyasRevenuePilotStoreState {
    const now=this.now();if(!isAyasRevenueTimestamp(now))throw new AyasRevenuePilotError("INVALID_CLOCK");
    for(let attempt=0;attempt<3;attempt++){
      if(!this.checkRoot())return emptyAyasRevenuePilotStore();let stat:fs.Stats;
      try{stat=fs.lstatSync(this.file);}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return emptyAyasRevenuePilotStore();throw new AyasRevenuePilotError("STORAGE_IO");}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>AYAS_REVENUE_PILOT_LIMITS.maxBytes)throw new AyasRevenuePilotError("STORAGE_UNSAFE");
      let fd:number|undefined;
      try{fd=fs.openSync(this.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));const opened=fs.fstatSync(fd);
        if(!opened.isFile()||opened.nlink>1||opened.size>AYAS_REVENUE_PILOT_LIMITS.maxBytes)throw new AyasRevenuePilotError("STORAGE_UNSAFE");
        if(opened.nlink===0||opened.ino!==stat.ino||opened.dev!==stat.dev)continue;
        const bytes=fs.readFileSync(fd,"utf8");if(Buffer.byteLength(bytes)>AYAS_REVENUE_PILOT_LIMITS.maxBytes)throw new AyasRevenuePilotError("STORAGE_UNSAFE");
        let raw:unknown;try{raw=JSON.parse(bytes);}catch{throw new AyasRevenuePilotError("INVALID_STORE");}const state=validateAyasRevenuePilotStore(raw);
        if(state.events.some(e=>Date.parse(e.recordedAt)>Date.parse(now)))throw new AyasRevenuePilotError("CLOCK_ROLLBACK");return state;
      }catch(e){if(e instanceof AyasRevenuePilotError)throw e;throw new AyasRevenuePilotError("STORAGE_IO");}finally{if(fd!==undefined)fs.closeSync(fd);}
    }throw new AyasRevenuePilotError("REVISION_CONFLICT");
  }
  private async append(before:AyasRevenuePilotStoreState,event:AyasRevenuePilotEvent,expectedRevision:number){
    if(before.revision!==expectedRevision)throw new AyasRevenuePilotError("REVISION_CONFLICT");
    const next=validateAyasRevenuePilotStore({schemaVersion:"1",revision:before.revision+1,events:[...before.events,event]});
    const bytes=JSON.stringify(next,null,2)+"\n";if(Buffer.byteLength(bytes)>AYAS_REVENUE_PILOT_LIMITS.maxBytes)throw new AyasRevenuePilotError("CAPACITY");
    assertAyasSafeModeAllowsMutation(this.repoRoot);
    try{ensureSafeContainedDirectory(this.repoRoot,this.root);const execution=ensureSafeContainedDirectory(this.repoRoot,path.join(this.root,"execution")),lock=path.join(execution,".authority-lock");
      if(fs.existsSync(lock))requireContainedRealDirectory(this.repoRoot,lock);
      return await withAyasExecutionAuthorityLock(this.root,async()=>{
        assertAyasSafeModeAllowsMutation(this.repoRoot);this.checkRoot();requireContainedRealDirectory(this.repoRoot,execution);requireContainedRealDirectory(this.repoRoot,lock);
        const current=this.read();if(current.revision!==expectedRevision||JSON.stringify(current)!==JSON.stringify(before))throw new AyasRevenuePilotError("REVISION_CONFLICT");
        const pending=path.join(this.root,".pilot-"+randomUUID()+".tmp");let fd:number|undefined;
        try{fd=fs.openSync(pending,"wx",0o600);fs.writeFileSync(fd,bytes,"utf8");fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
          assertAyasSafeModeAllowsMutation(this.repoRoot);this.checkRoot();if(JSON.stringify(this.read())!==JSON.stringify(current))throw new AyasRevenuePilotError("REVISION_CONFLICT");fs.renameSync(pending,this.file);
        }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(pending))fs.unlinkSync(pending);}
        return Object.freeze({status:"APPENDED" as const,revision:next.revision,eventDigest:event.eventDigest,grantsAuthority:false as const,executionAuthority:"NONE" as const});
      },{acquireRetryLimit:250,acquireRetryDelayMs:20});
    }catch(e){if(e instanceof AyasRevenuePilotError||e instanceof Error&&/^AYAS_SAFE_/.test(e.message))throw e;
      if(e instanceof AyasExecutionAuthorityLockError&&e.code==="AYAS_LOCK_BUSY")throw new AyasRevenuePilotError("LOCK_BUSY");throw new AyasRevenuePilotError("STORAGE_IO");}
  }
  async createOrRevisePlan(raw:unknown,expectedRevision:number){
    const before=this.read(),at=this.now(),projection=projectAyasRevenuePilotStore(before),p=createAyasRevenuePilot(raw,at,(projection.current?.planRevision??0)+1);
    return this.append(before,makeAyasRevenuePilotEvent(before,"PLAN",p,at),expectedRevision);
  }
  async transition(requestedState:AyasRevenuePilotState,admission:unknown,expectedRevision:number){
    const before=this.read(),p=projectAyasRevenuePilotStore(before).current;if(!p)throw new AyasRevenuePilotError("MISSING_PLAN");const at=this.now(),decision=this.policy(p,requestedState,admission,at);
    if(decision.status!=="LOCAL_STATE_PLAN"||decision.next===null)return decision;
    return this.append(before,makeAyasRevenuePilotEvent(before,"STATE",decision.next,at),expectedRevision);
  }
  async observe(raw:unknown,expectedRevision:number){
    const before=this.read(),projection=projectAyasRevenuePilotStore(before),at=this.now();
    if(!projection.current)throw new AyasRevenuePilotError("MISSING_PLAN");
    const material=snapshotAyasRevenuePilotData(raw,16384),p=isAyasRevenuePlainRecord(material)?projection.plans.find(v=>v.planDigest===material.planDigest):null;
    if(!p)throw new AyasRevenuePilotError("INVALID_OBSERVATION");
    const o=createAyasRevenuePilotObservation(material,p,at),prior=projection.observations.find(v=>v.evidenceDigest===o.evidenceDigest);
    if(prior){if(digestAyasRevenueData(prior)!==digestAyasRevenueData(o))throw new AyasRevenuePilotError("OBSERVATION_CONFLICT");return Object.freeze({status:"REPLAY" as const,revision:before.revision,grantsAuthority:false as const,executionAuthority:"NONE" as const});}
    return this.append(before,makeAyasRevenuePilotEvent(before,"OBSERVATION",o,at),expectedRevision);
  }
}
