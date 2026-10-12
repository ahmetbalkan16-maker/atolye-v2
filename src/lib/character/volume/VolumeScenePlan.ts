import type { SceneBlocking } from "../SceneBlocking";
import type { CharacterArtDirection } from "../SvgSceneRenderer";
import { planPeriodWardrobe, type WardrobeBrief } from "./PeriodWardrobe";
import {createPeriodDesign,type PeriodDesign,type PeriodUnit} from "./PeriodDesign";

export interface VolumeScenePlan {
  readonly version: "1";
  readonly camera: "EDITORIAL";
  readonly sceneYears: readonly number[];
  readonly wardrobes: readonly {readonly actorId: string;readonly brief: WardrobeBrief}[];
  /** Absent on earlier volume assets, whose rendering stays unchanged. */
  readonly design?:PeriodDesign;
}

/** Only explicit scene date grammar, never a count or a global topic keyword.
 * This extracts a stated date; it does not certify its historical truth.
 */
export function extractCostumeSceneYears(text: string): number[] {
  const years: number[]=[];
  const normalized=text.slice(0,8192).normalize("NFKC");
  for(const m of normalized.matchAll(/\b(?:milattan\s+önce|milattan\s+sonra|in\s+the\s+year|in|year)\s+(\d{1,4})(?![\d.,])(?:\s+(BC|BCE|AD|CE))?\b/giu)) {
    const following=normalized.slice((m.index??0)+m[0].length);
    if(/^\s+(?:soldiers|troops|ships|people|men|years|asker|gemi|kişi|insan|yıl)\b/iu.test(following)) continue;
    const year=Number(m[1])*(/önce|\bBC(?:E)?\b/iu.test(m[0])?-1:1);
    if(year&&year>=-4000&&year<=2100&&!years.includes(year)) years.push(year);
  }
  for(const m of normalized.matchAll(/(?<![\p{L}\d.,])(?:(M\s*\.?\s*[ÖO]\s*\.?|BCE?)\s*)?(\d{1,4})\s*(?:[-–—]|ve|ile|to)\s*(\d{1,4})\s*(?:y[ıi]llar\p{L}*|y[ıi]l[ıi]nda|senelerinde)/giu)) {
    const sign=m[1]?-1:1;
    for(const token of [m[2],m[3]]) {const year=Number(token)*sign;if(year&&year>=-4000&&year<=2100&&!years.includes(year)) years.push(year);}
    if(years.length>=16) return years.slice(0,16);
  }
  const pattern=/(?<![\p{L}\d.,])(?:(M\s*\.?\s*[ÖO]\s*\.?|BCE?|M\s*\.?\s*S\s*\.?|CE|AD)\s*)?(\d{1,4})(?![\d.,])(?:(?:['’](?:te|ta|de|da|ten|tan|den|dan))|(?:\s+(?:y[ıi]l[ıi]nda|y[ıi]l[ıi]|y[ıi]llar[ıi]nda|senesinde|BC|BCE|AD|CE)))?/giu;
  for(const match of normalized.matchAll(pattern)) {
    const token=match[0],prefix=match[1];
    if(!prefix&&!/(?:['’](?:te|ta|de|da|ten|tan|den|dan)|y[ıi]l|senesinde|\b(?:BC|BCE|AD|CE)\b)/iu.test(token)) continue;
    const negative=/M\s*\.?\s*[ÖO]|\bBC(?:E)?\b/iu.test(token);
    const year=Number(match[2])*(negative?-1:1);
    if(year!==0&&year>=-4000&&year<=2100&&!years.includes(year)) years.push(year);
    if(years.length===16) break;
  }
  return years;
}

export function createVolumeScenePlan(blocking: SceneBlocking,art: CharacterArtDirection,sceneYears: readonly number[],unit?:PeriodUnit): VolumeScenePlan {
  const wardrobes=blocking.characters.map(c=>{
    const role=art.roles.find(r=>r.id===c.id)?.role??"CITIZEN";
    return {actorId:c.id,brief:planPeriodWardrobe({culture:art.culture,role,sceneYears})};
  });
  return {version:"1",camera:"EDITORIAL",sceneYears:[...new Set(sceneYears)],wardrobes,...(unit!==undefined?{design:createPeriodDesign(blocking,art,[...new Set(sceneYears)],unit)}:{})};
}

/** Same scene context reconstructs all permitted metadata. No free-form prompt,
 * file path, shader, URL or serialized mesh is admitted into a portable asset.
 */
export function findVolumeScenePlanProblems(value: unknown,blocking: SceneBlocking,art: CharacterArtDirection): string[] {
  const v=value as VolumeScenePlan|null;
  try {
    if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length!==(v.design===undefined?4:5)||!Array.isArray(v.sceneYears)||v.sceneYears.length>16||!Array.isArray(v.wardrobes)||v.wardrobes.length>8||v.version!=="1"||v.camera!=="EDITORIAL") return ["VOLUME_PLAN_SHAPE"];
    const expected=createVolumeScenePlan(blocking,art,v.sceneYears,v.design?.unit);
    return JSON.stringify(v)===JSON.stringify(expected)?[]:["VOLUME_PLAN_CONTEXT"];
  } catch { return ["VOLUME_PLAN_CONTEXT"]; }
}
