import type { VolumeCharacter } from "./character-volume";

export type WardrobeRecipe = "OTTOMAN_15_PORTRAIT" | "OTTOMAN_16_TEXTILE" | "BYZANTINE_PALAIOLOGAN" | "ROMAN_EARLY_IMPERIAL" | "EGYPTIAN_DYNASTY_18";
export interface WardrobeBrief {
  readonly version: "1";
  readonly culture: VolumeCharacter["culture"];
  readonly role: VolumeCharacter["role"];
  /** Historical dating: negative = BCE, positive = CE, no year zero. */
  readonly year: number | null;
  readonly recipe: WardrobeRecipe | null;
  readonly status: "REFERENCE_INSPIRED_NEEDS_REVIEW" | "RESEARCH_REQUIRED";
  readonly reason: "SUPPORTED_REFERENCE_WINDOW" | "YEAR_REQUIRED" | "SCENE_YEAR_AMBIGUOUS" | "NO_PERIOD_ROLE_REFERENCE";
  readonly sources: readonly {readonly title: string;readonly url: string;readonly supports: string}[];
  readonly limitations: readonly string[];
}
interface ReferenceWindow {
  readonly culture: VolumeCharacter["culture"];
  readonly from: number;
  readonly to: number;
  readonly recipe: WardrobeRecipe;
  readonly title: string;
  readonly url: string;
  readonly supports: string;
}
/** Small curated starting set, not a universal database of every person's dress.
 * Windows are design review buckets, not assertions that dress was unchanged.
 * Never extend these automatically to a different century, role or civilisation.
 */
const references: readonly ReferenceWindow[] = [
  {culture:"OTTOMAN",from:1450,to:1500,recipe:"OTTOMAN_15_PORTRAIT",title:"National Gallery — Bellini, Sultan Mehmet II (1480)",url:"https://www.nationalgallery.org.uk/paintings/gentile-bellini-the-sultan-mehmet-ii",supports:"Late-15th-century royal portrait reference; exact personal wardrobe outside the depicted event is not established."},
  {culture:"OTTOMAN",from:1501,to:1600,recipe:"OTTOMAN_16_TEXTILE",title:"The Met — Ottoman Textile Fragment, 16th century",url:"https://www.metmuseum.org/art/collection/search/445264",supports:"Ogival lattice and floral Ottoman court textile motifs; fabric evidence alone does not establish a complete outfit or turban."},
  {culture:"BYZANTINE",from:1391,to:1425,recipe:"BYZANTINE_PALAIOLOGAN",title:"The Met — Manuel II manuscript, Faith and Power exhibition",url:"https://www.metmuseum.org/press-releases/dazzling-byzantine-treasures-displayed-in-major-international-exhibition-at-metropolitan-museum-opening-march-23-2004-exhibitions",supports:"Manuel II (1391–1425): imperial loros and crown with hanging ornaments; not every Byzantine dynasty's dress."},
  {culture:"ROMAN",from:1,to:25,recipe:"ROMAN_EARLY_IMPERIAL",title:"Vatican Museums — Augustus from Prima Porta",url:"https://www.museivaticani.va/content/museivaticani/en/collezioni/musei/braccio-nuovo/Augusto-di-Prima-Porta.html",supports:"Early-first-century statue: decorated cuirass and paludamentum for addressing troops; colour and every civilian outfit are not established."},
  {culture:"EGYPTIAN",from:-1473,to:-1458,recipe:"EGYPTIAN_DYNASTY_18",title:"The Met — Seated Statue of Hatshepsut, ca. 1473–1458 BCE",url:"https://www.metmuseum.org/art/collection/search/544450",supports:"Ceremonial ruler's nemes and shendyt kilt; blue/yellow headcloth pigment. Royal headcloth must not be copied to a whole population."},
];

export function planPeriodWardrobe(input: {readonly culture: VolumeCharacter["culture"];readonly role: VolumeCharacter["role"];readonly sceneYears: readonly number[]}): WardrobeBrief {
  if(!["OTTOMAN","BYZANTINE","ROMAN","EGYPTIAN"].includes(input.culture)||!["RULER","ADVISOR","GUARD"].includes(input.role)||!Array.isArray(input.sceneYears)||input.sceneYears.length>16||input.sceneYears.some(y=>!Number.isInteger(y)||y===0||y< -4000||y>2100)) throw new Error("WARDROBE_CONTEXT_REFUSED");
  const years=[...new Set(input.sceneYears)],year=years.length===1?years[0]!:null;
  const reference=year!==null&&input.role==="RULER"?references.find(r=>r.culture===input.culture&&year>=r.from&&year<=r.to):undefined;
  return {version:"1",culture:input.culture,role:input.role,year,recipe:reference?.recipe??null,status:reference?"REFERENCE_INSPIRED_NEEDS_REVIEW":"RESEARCH_REQUIRED",reason:reference?"SUPPORTED_REFERENCE_WINDOW":years.length===0?"YEAR_REQUIRED":years.length>1?"SCENE_YEAR_AMBIGUOUS":"NO_PERIOD_ROLE_REFERENCE",sources:reference?[{title:reference.title,url:reference.url,supports:reference.supports}]:[],limitations:["Stylised reference-inspired costume; not exact personal clothing certified for this year.","Specific person, setting, gender, rank, occasion, material and headwear need source review.","Advisor/guard and palace-period evidence are not supplied by a royal portrait.","Multiple years require separate scene-local briefs; never choose the first year silently."]};
}

/** Consumers get only a recomputed curated recipe, never a user-supplied code/url. */
export function reviewedWindowRecipe(brief: WardrobeBrief,culture: VolumeCharacter["culture"],role: VolumeCharacter["role"]): WardrobeRecipe {
  const expected=planPeriodWardrobe({culture,role,sceneYears:brief.year===null?[]:[brief.year]});
  if(brief.culture!==culture||brief.role!==role||!expected.recipe||JSON.stringify(brief)!==JSON.stringify(expected)) throw new Error("WARDROBE_BRIEF_NOT_A_SUPPORTED_CANDIDATE");
  return expected.recipe;
}
