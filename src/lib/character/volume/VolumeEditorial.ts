import type {VolumeSentenceTiming} from './VolumeSentenceTiming';
export type EditorialEnvironment='BASE'|'COURTYARD'|'FOREST'|'HARBOR'|'LIBRARY'|'WORKSHOP'|'MARKET'|'MAP';
export interface VolumeEditorialPlan {readonly version:'1';readonly environment:EditorialEnvironment;readonly season:'NEUTRAL'|'AUTUMN'|'WINTER';readonly route:readonly ('ANKARA'|'BUSAN')[]}
const fold=(text:string)=>text.slice(0,8192).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i');
export function planVolumeEditorial(text:string):VolumeEditorialPlan {
 const s=fold(text),route:('ANKARA'|'BUSAN')[]=[];
 const found=[...s.matchAll(/\b(ankara|busan|pusan)\b/g)].map(m=>m[1]==='ankara'?'ANKARA' as const:'BUSAN' as const);
 for(const id of found)if(!route.includes(id))route.push(id);
 const environment:EditorialEnvironment=/\b(harita\w*|map|rota\w*)\b/.test(s)&&route.length===2?'MAP':/\b(orman\w*|forest|woodland)\b/.test(s)?'FOREST':/\b(liman\w*|harbor|harbour|port|iskele\w*)\b/.test(s)?'HARBOR':/\b(kutuphane\w*|library|arsiv\w*)\b/.test(s)?'LIBRARY':/\b(laboratuvar\w*|laboratory|bilgisayar\w*|computer|yazilim\w*)\b/.test(s)?'WORKSHOP':/\b(pazar\w*|market|carsi\w*)\b/.test(s)?'MARKET':/\b(meydan\w*|avlu\w*|kislada\w*|courtyard)\b/.test(s)?'COURTYARD':'BASE';
 return {version:'1',environment,season:/\b(kar|karli|karla|kisin|kis|kislik|winter|snow\w*)\b/.test(s)?'WINTER':/\b(sonbahar|autumn|fall)\b/.test(s)?'AUTUMN':'NEUTRAL',route:environment==='MAP'?route:[]};
}
export function isVolumeEditorial(value:unknown):value is VolumeEditorialPlan {
 const v=value as VolumeEditorialPlan;
 return !!v&&Object.keys(v).length===4&&v.version==='1'&&['BASE','COURTYARD','FOREST','HARBOR','LIBRARY','WORKSHOP','MARKET','MAP'].includes(v.environment)&&['NEUTRAL','AUTUMN','WINTER'].includes(v.season)&&Array.isArray(v.route)&&v.route.length<=2&&v.route.every(id=>id==='ANKARA'||id==='BUSAN')&&new Set(v.route).size===v.route.length&&(v.environment==='MAP'?v.route.length===2:v.route.length===0);
}
const rect=(x:number,y:number,w:number,h:number,color:string,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" ${extra}/>`;
const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=3)=>`<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const circle=(x:number,y:number,r:number,color:string)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const path=(d:string,color:string,stroke='#584a3e',width=3)=>`<path d="${d}" fill="${color}" stroke="${stroke}" stroke-width="${width}"/>`;

/** Original code-native scenery, reused by stills and every production frame.
 * The map is explicitly schematic, with no invented historical borders. The
 * two georeferenced points are GeoNames323786/1838524 (CC BY, see design doc). */
export function volumeEditorialBackdrop(plan:VolumeEditorialPlan,t=0,duration=6):string {
 if(!isVolumeEditorial(plan)||!Number.isFinite(t)||t<0||!Number.isFinite(duration)||duration<=0)throw Error('EDITORIAL_STAGE_INPUT');
 const winter=plan.season==='WINTER',autumn=plan.season==='AUTUMN',sky=winter?'#ccdce5':'#f2e8ce',stone='#cfb894',shadow='#aa9272',leaf=winter?'#778c85':autumn?'#a45f36':'#5f8061';
 let body=rect(0,0,1920,1080,sky);
 if(plan.environment==='MAP'){
  body=rect(0,0,1920,1080,'#eadbc0')+rect(220,175,1480,630,'#b9d6d4','rx="24" stroke="#716656" stroke-width="5"');
  for(let x=260;x<1700;x+=120)body+=line(x,180,x,800,'#a0bdbb',1);
  for(let y=220;y<800;y+=90)body+=line(225,y,1690,y,'#a0bdbb',1);
  // An authored coarse Europe/Africa/Asia silhouette, with no border claims.
  body+=path('M325 355L410 245 550 275 655 225 790 295 930 255 1020 225 1200 275 1340 220 1520 325 1610 425 1500 495 1370 455 1320 610 1210 600 1170 470 1040 465 970 420 875 480 800 440 735 365 645 420 560 355 470 410 400 390Z','#c0c79b');
  body+=path('M610 425L735 445 835 535 805 665 705 765 640 665 575 535Z','#c9b787');
  const places={ANKARA:{label:'Ankara',lat:39.91987,lon:32.85427},BUSAN:{label:'Busan (Pusan)',lat:35.10168,lon:129.03004}};
  const coords=plan.route.map(id=>{const p=places[id];return {x:260+(p.lon+25)/190*1380,y:200+(80-p.lat)/110*570,label:p.label};});
  const a=coords[0]!,b=coords[1]!,progress=Math.min(1,t/Math.max(1,duration*.8));
  body+=line(a.x,a.y,b.x,b.y,'#9b4b40',9);
  body+=`<path d="M${a.x} ${a.y}L${b.x} ${b.y}" fill="none" stroke="#f7edcd" stroke-width="3" stroke-dasharray="12 10"/>`;
  body+=circle(a.x+(b.x-a.x)*progress,a.y+(b.y-a.y)*progress,15,'#e4b552');
  for(const [i,p] of coords.entries())body+=circle(p.x,p.y,12,i?'#536e95':'#a34c3b')+`<text x="${p.x-45}" y="${p.y-28}" font-family="Arial" font-size="30" fill="#3c3934">${p.label}</text>`;
  body+=`<text x="250" y="850" font-family="Arial" font-size="25" fill="#5e5546">Şematik konum bağlantısı</text><text x="250" y="888" font-family="Arial" font-size="19" fill="#706453">Konumlar: GeoNames (CC BY 4.0)</text>`;
 }else if(['LIBRARY','WORKSHOP'].includes(plan.environment)){
  body=rect(0,0,1920,1080,'#d7c8b2')+rect(0,745,1920,335,'#ad9577');
  for(const x of [40,660,1320]){
   body+=rect(x,85,550,635,'#705c4b','rx="12" stroke="#453c34" stroke-width="9"');
   for(let row=0;row<4;row++){
    body+=rect(x+15,110+row*150,520,120,'#54473e');
    for(let col=0;col<14;col++){const w=23+(col%3)*8,c=['#8e4544','#44666e','#c5a773','#7a845d'][col%4]!;body+=rect(x+28+col*36,130+row*150+(col%3)*4,w,96-(col%3)*4,c)+line(x+30+col*36,150+row*150,x+30+col*36+w-4,150+row*150,'#dfcaa2',2);}
    body+=rect(x+10,232+row*150,530,13,'#937252');
   }
  }
  if(plan.environment==='WORKSHOP'){
   body+=rect(515,195,860,420,'#36566c','rx="28" stroke="#293c48" stroke-width="18"')+rect(550,230,790,335,'#d8e6df','rx="9"');
   for(let row=0;row<7;row++)body+=rect(595,270+row*36,240+(row%3)*140,8,['#517681','#c19150','#7d7197'][row%3]!,'rx="4"');
   body+=rect(930,625,65,85,'#394b53')+rect(760,700,390,20,'#47545a','rx="8"');
  }
 }else if(plan.environment==='FOREST'){
  body+=path('M0 485Q300 330 650 480T1350 415T1920 440V1080H0Z',winter?'#e3e8e5':'#829978','#829978',0);
  for(let i=0;i<12;i++){const x=i*181-60,y=180+(i%3)*90;body+=rect(x,y,35,540,'#75644f')+path(`M${x-130} ${y+300}L${x+17} ${y-95}L${x+165} ${y+300}Z`,leaf,leaf,0)+path(`M${x-105} ${y+145}L${x+17} ${y-180}L${x+135} ${y+145}Z`,leaf,leaf,0);if(winter)body+=path(`M${x-90} ${y+128}L${x+17} ${y-170}L${x+127} ${y+128}L${x+25} ${y+78}Z`,'#eef2ed','#eef2ed',0);}
  body+=path('M620 1080L1000 610 1130 610 1390 1080Z',winter?'#d7e0dc':'#d0b995','#d0b995',0);
 }else if(plan.environment==='HARBOR'){
  body+=rect(0,405,1920,510,'#759b9e');
  for(let row=0;row<16;row++)for(let col=0;col<9;col++)body+=line(col*250+(row%2)*80,430+row*28,col*250+120+(row%2)*80,430+row*28,'#b6ceca',2);
  for(const x of [170,1280])body+=path(`M${x} 600H${x+390}L${x+330} 690H${x+80}Z`,'#77664e')+line(x+190,265,x+190,600,'#745f45',10)+path(`M${x+200} 275L${x+200} 555L${x+370} 545Z`,'#efe8d5');
  body+=rect(0,870,1920,210,'#b59b74');for(let row=0;row<7;row++)body+=line(0,880+row*30,1920,880+row*30,'#8b7557',3);
  for(let x=40;x<1920;x+=220)body+=rect(x,765,30,125,'#7b634d','rx="6"')+line(x,810,x+220,810,'#d4c196',7);
 }else{
  body+=rect(0,580,1920,500,stone);
  for(let i=0;i<7;i++){
   const x=i*305-50,height=265+(i%3)*65,y=570-height;
   body+=rect(x,y,295,height,'#d2c4a6','stroke="#a49275" stroke-width="3"')+path(`M${x-14} ${y}L${x+150} ${y-105}L${x+310} ${y}Z`,'#88594b');
   for(let col=0;col<4;col++)body+=rect(x+25+col*65,y+45,36,90,'#526b70','rx="17" stroke="#ead7b4" stroke-width="7"');
   body+=rect(x+117,570-115,65,115,'#72634e','rx="25"');
  }
  body+=rect(0,600,1920,55,shadow);
  if(plan.environment==='MARKET')for(const x of [40,1420]){
   body+=rect(x,475,405,250,'#8e6d49');for(let i=0;i<8;i++)body+=rect(x+i*50,475,50,50,i%2?'#e3c895':'#934b43');
   body+=rect(x+15,580,375,110,'#b89b67');for(let i=0;i<10;i++)body+=circle(x+38+i*34,574+(i%2)*4,17,i%2?'#bda65b':'#915345');
  }
  for(let x=0;x<=1920;x+=240)body+=line(960,655,x,1080,'#b59d7b',2);
  for(let y=710;y<1080;y+=90)body+=line(0,y,1920,y,'#b59d7b',2);
 }
 // Small authored texture marks; bounded, stable between frames.
 for(let i=0;i<75;i++){const x=(i*263)%1920,y=940+(i*31)%125;body+=line(x,y,x+18+(i%4)*7,y,'#796f5b',1);}
 return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${body}</svg>`;
}

/** Camera moves follow measured sentence boundaries, eased at both ends. A
 * group action stays wide. This is a crop of the whole rendered stage. */
export function narrationCameraZoom(t:number,timing:VolumeSentenceTiming):number {
 const index=timing.sentences.findIndex(s=>t>=s.start&&t<s.end);if(index<0)return 1;
 const sentence=timing.sentences[index]!;if(!['TALK','POINT'].includes(sentence.action))return 1;
 const ease=(x:number)=>{const n=Math.max(0,Math.min(1,x));return n*n*(3-2*n);};
 return 1+([.12,.28,.18][index%3]!)*Math.min(ease((t-sentence.start)/.35),ease((sentence.end-t)/.35));
}
