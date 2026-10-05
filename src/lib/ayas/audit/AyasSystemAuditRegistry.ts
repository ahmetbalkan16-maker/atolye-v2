import { freezeAudit, type AyasAuditClass, type AyasAuditDomain } from "./AyasSystemAuditModel";
/** Presence is its own check; it never means the capability works or is operational. */
export const AUDIT_DOMAIN_SOURCES = freezeAudit([
  {domain:"A",label:"Repository / build / CI",source:"package.json"},
  {domain:"B",label:"Graphify / architecture",source:"src/lib/ayas/developer/AyasGraphifyState.ts"},
  {domain:"C",label:"Conversation / context",source:"src/lib/ayas/AyasChatStream.ts"},
  {domain:"D",label:"Memory / retrieval / temporal",source:"src/lib/ayas/memory/AyasMemoryTemporal.ts"},
  {domain:"E",label:"Model / voice / mobile",source:"src/components/brain/voice/localLlm/phoneLlmModelResources.ts"},
  {domain:"F",label:"Autonomy / approval / execution",source:"src/lib/ayas/execution/AyasActionRuntime.ts"},
  {domain:"G",label:"Security / supply chain",source:"src/lib/ayas/security/AyasBoundedRequestBody.ts"},
  {domain:"H",label:"Privacy / governance",source:"src/lib/ayas/memory/AyasMemoryGovernance.ts"},
  {domain:"I",label:"Backup / recovery",source:"src/lib/runtime/backup/RuntimeBackupVerifier.ts"},
  {domain:"J",label:"Runtime / remote",source:"src/lib/runtime/ProductionRuntimeStatusProjection.ts"},
  {domain:"K",label:"Production / media",source:"src/lib/ayas/director/AyasProductionDirectorSession.ts"},
  {domain:"L",label:"Research / evolution / watch",source:"src/lib/ayas/technology/AyasTechnologyWatch.ts"},
  {domain:"M",label:"Developer / skills / agents",source:"src/lib/ayas/developer/AyasDeveloperTaskModel.ts"},
  {domain:"N",label:"Revenue",source:"src/lib/ayas/revenue/activity/AyasRevenueCenterClosure.ts"},
  {domain:"O",label:"Documentation / roadmap",source:"ATOLYE_CHECKPOINT.md"},
] as const);
export interface AyasAuditCheck {domain:AyasAuditDomain;id:string;version:1;kind:"SOURCE"|"TEST"|"LIVE";evidenceClass:AyasAuditClass;sourceRef:string;liveRequired:boolean;allowNotApplicable:false}
export const AYAS_AUDIT_CHECKS: readonly AyasAuditCheck[] = freezeAudit(AUDIT_DOMAIN_SOURCES.flatMap(d=>[
  {domain:d.domain,id:d.domain+"_SOURCE",version:1 as const,kind:"SOURCE" as const,evidenceClass:"STATIC_SOURCE" as const,sourceRef:d.source,liveRequired:false,allowNotApplicable:false as const},
  {domain:d.domain,id:d.domain+"_TEST",version:1 as const,kind:"TEST" as const,evidenceClass:"DETERMINISTIC_TEST" as const,sourceRef:d.source,liveRequired:false,allowNotApplicable:false as const},
  {domain:d.domain,id:d.domain+"_LIVE",version:1 as const,kind:"LIVE" as const,evidenceClass:d.domain==="O"?"OWNER_DECISION" as const:d.domain==="G"?"EXTERNAL_OFFICIAL" as const:"LIVE_READ_ONLY" as const,sourceRef:d.source,liveRequired:true,allowNotApplicable:false as const},
]));
export const AYAS_AUDIT_PROTECTED_ROOTS = freezeAudit(["data/brain","data/projects","runtime","authority","projects",".atolye"] as const);
