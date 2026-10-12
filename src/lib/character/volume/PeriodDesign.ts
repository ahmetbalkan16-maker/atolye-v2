import type {SceneBlocking} from "../SceneBlocking";
import type {CharacterArtDirection} from "../SvgSceneRenderer";

export type PeriodProfile="BASE"|"JANISSARY_EARLY"|"JANISSARY_OFFICER_18"|"JANISSARY_GUARDHOUSE_18"|"OTTOMAN_MAIL_PLATE"|"OTTOMAN_FEZ_COURT";
export type PeriodUnit="UNSPECIFIED"|"JANISSARY"|"JANISSARY_OFFICER"|"JANISSARY_GUARDHOUSE"|"ARMOURED";
export interface PeriodDesign {
  readonly version:"1";readonly performance:"GROUNDED";readonly unit:PeriodUnit;
  readonly setting:"BASE"|"OTTOMAN_COURT_15"|"OTTOMAN_COURT_16"|"OTTOMAN_COURT_19";
  readonly actors:readonly {readonly actorId:string;readonly profile:PeriodProfile;readonly status:"REFERENCE_INSPIRED_NEEDS_REVIEW"|"RESEARCH_REQUIRED";readonly sources:readonly string[]}[];
  readonly settingStatus:"SCHEMATIC_PERIOD_MOTIFS"|"RESEARCH_REQUIRED";readonly settingSources:readonly string[];
}
const early="https://www.britishmuseum.org/collection/object/P_Pp-1-19";
const officer="https://www.rijksmuseum.nl/nl/collectie/object/Aga-Opperbevelhebber-der-Janitsaren--d2416ef449704f143440b192615c7fe4";
const guardhouse="https://www.britishmuseum.org/collection/object/W_1974-0617-0-12-1-117";
const mail="https://www.metmuseum.org/art/collection/search/24193",helmet="https://art.thewalters.org/object/51.74/";
const late="https://www.npg.org.uk/collections/search/portrait/mw261414/Abdlmecid-I-Sultan-of-the-Ottoman-Empire";
const lateDescription="https://www.rct.uk/collection/407268/abd-ul-mejid-1823-1861-sultan-of-turkey";
const palace="https://www.millisaraylar.gov.tr/Lokasyon/3/dolmabahce-sarayi";
export function periodUnitFromScene(text:string):PeriodUnit {
  const s=text.slice(0,8192).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i');
  const armoured=/\b(zirh\w*|armou?r\w*|sipahi\w*|heavy cavalry)\b/.test(s);
  if(/\b(yeniceri\w*|janissar\w*)\b/.test(s)) {
    if(armoured||/\b(degil|olmayan|not|without)\b/.test(s)) return "UNSPECIFIED";
    if(/\b(aga\w*|commander|officer)\b/.test(s)) return "JANISSARY_OFFICER";
    if(/\b(karakol|kullukcu|guardhouse)\b/.test(s)) return "JANISSARY_GUARDHOUSE";
    return "JANISSARY";
  }
  return armoured&&!/\b(degil|olmayan|not|without)\b/.test(s)?"ARMOURED":"UNSPECIFIED";
}
export function createPeriodDesign(blocking:SceneBlocking,art:CharacterArtDirection,years:readonly number[],unit:PeriodUnit):PeriodDesign {
  if(!['UNSPECIFIED','JANISSARY','JANISSARY_OFFICER','JANISSARY_GUARDHOUSE','ARMOURED'].includes(unit)) throw new Error('PERIOD_UNIT_REFUSED');
  const year=years.length===1?years[0]!:null,ottoman=art.culture==='OTTOMAN';
  const officerIndex=blocking.characters.findIndex(c=>art.roles.find(r=>r.id===c.id)?.role==='GUARD');
  const actors=blocking.characters.map((c,index)=>{
    const role=art.roles.find(r=>r.id===c.id)?.role??'CITIZEN';
    const eligible=unit==='JANISSARY_OFFICER'?index===(officerIndex<0?0:officerIndex)&&role!=='RULER'&&role!=='ADVISOR':role==='GUARD'||(role!=='RULER'&&role!=='ADVISOR'&&(unit==='JANISSARY'||index===0||c.costume==='ARMOR'||c.handProp==='SPEAR'||c.handProp==='SWORD'||c.handProp==='SHIELD'));
    let profile:PeriodProfile='BASE',sources:string[]=[];
    if(ottoman&&year!==null) {
      if(unit==='JANISSARY'&&eligible&&year>=1450&&year<=1500){profile='JANISSARY_EARLY';sources=[early];}
      else if(unit==='JANISSARY_OFFICER'&&eligible&&year>=1700&&year<=1737){profile='JANISSARY_OFFICER_18';sources=[officer];}
      else if(unit==='JANISSARY_GUARDHOUSE'&&eligible&&year>=1780&&year<=1800){profile='JANISSARY_GUARDHOUSE_18';sources=[guardhouse];}
      else if(unit==='ARMOURED'&&eligible&&year>=1451&&year<=1600){profile='OTTOMAN_MAIL_PLATE';sources=[mail,helmet];}
      else if(unit==='UNSPECIFIED'&&role==='RULER'&&year>=1860&&year<=1861){profile='OTTOMAN_FEZ_COURT';sources=[late,lateDescription];}
    }
    return {actorId:c.id,profile,status:profile==='BASE'?'RESEARCH_REQUIRED' as const:'REFERENCE_INSPIRED_NEEDS_REVIEW' as const,sources};
  });
  const setting:PeriodDesign['setting']=ottoman&&blocking.backdrop==='INTERIOR'&&year!==null?year>=1450&&year<=1500?'OTTOMAN_COURT_15':year>=1501&&year<=1600?'OTTOMAN_COURT_16':year>=1856&&year<=1861?'OTTOMAN_COURT_19':'BASE':'BASE';
  return {version:'1',performance:'GROUNDED',unit,setting,actors,settingStatus:setting==='BASE'?'RESEARCH_REQUIRED':'SCHEMATIC_PERIOD_MOTIFS',settingSources:setting==='OTTOMAN_COURT_19'?[palace]:[]};
}
export function isPeriodProfile(value:unknown):value is PeriodProfile {return typeof value==='string'&&['BASE','JANISSARY_EARLY','JANISSARY_OFFICER_18','JANISSARY_GUARDHOUSE_18','OTTOMAN_MAIL_PLATE','OTTOMAN_FEZ_COURT'].includes(value);}

/** Our own bounded decoration, never a claimed photographic palace reconstruction.
 * Plates retain their existing reviewed art; the era changes fittings, textiles
 * and lighting fixtures. No remote media, fonts, filters or executable input.
 */
export function periodSettingOverlay(setting:PeriodDesign['setting']):string {
  let body='';
  if(setting==='OTTOMAN_COURT_15') {
    body='<path d="M40 0H340V280L190 335 40 280Z M1580 0H1880V280L1730 335 1580 280Z" fill="#733847" stroke="#cbaa69" stroke-width="14"/>';
    for(const x of [72,1595]) for(let i=0;i<5;i++) body+=`<path d="M${x+25+i*35} 70l18 28-18 28-18-28Z" fill="#d2b479"/>`;
  } else if(setting==='OTTOMAN_COURT_16') {
    for(const x of [0,1610]) {
      body+=`<rect x="${x}" y="470" width="310" height="360" fill="#ede0bc" stroke="#b89a5a" stroke-width="12"/>`;
      for(let row=0;row<6;row++) for(let col=0;col<5;col++){const cx=x+32+col*62,cy=500+row*60;body+=`<path d="M${cx} ${cy-20}q25 20 0 40q-25-20 0-40Z" fill="#21648a"/><circle cx="${cx}" cy="${cy}" r="7" fill="#bd5146"/>`;}
    }
  } else if(setting==='OTTOMAN_COURT_19') {
    body='<path d="M0 0H650Q430 300 170 480L0 800Z M1920 0H1270Q1490 300 1750 480L1920 800Z" fill="#6f243e" stroke="#dfb965" stroke-width="22"/><path d="M0 0H1920V110Q960 250 0 110Z" fill="#452239" stroke="#dfb965" stroke-width="18"/>';
    for(const x of [82,310,1610,1838]) body+=`<rect x="${x-30}" y="230" width="60" height="560" fill="#eddfbd" stroke="#cda65c" stroke-width="10"/><ellipse cx="${x}" cy="225" rx="56" ry="24" fill="#d4af60"/><ellipse cx="${x}" cy="785" rx="56" ry="18" fill="#d4af60"/>`;
    body+='<path d="M960 0V175M740 240Q960 380 1180 240M800 200Q960 295 1120 200" fill="none" stroke="#d7b36b" stroke-width="16"/>';
    for(let i=0;i<9;i++){const x=744+i*54,y=240+50*Math.sin(i*Math.PI/8);body+=`<path d="M${x} ${y}v55l-10 22 10 22 10-22-10-22" fill="#e5f2eb" stroke="#d7b36b" stroke-width="4"/><circle cx="${x}" cy="${y-13}" r="13" fill="#fff0b9"/>`;}
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">${body}</svg>`;
}
