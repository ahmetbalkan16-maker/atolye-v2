import sharp, {type OverlayOptions} from "sharp";
import {preparePuppetSkin,puppetSkinPoint,DEFAULT_PUPPET_PROFILE,type PuppetSkinProfile} from "./PuppetSkinRenderer";
import {cinematicActorPerformance} from "./CinematicActorPerformance";
import type {CinematicShot,CinematicActor} from "./CinematicStoryPlan";
/** In-memory source-byte-checked artwork supplied by the intake caller. Explicit
 * preview only: no filesystem paths, production payloads or admission mutation. */
export interface CinematicPreviewArtwork {
 readonly admission:"PREVIEW_ONLY";
 readonly characters:ReadonlyMap<string,{readonly contentSha256:string;readonly designIdentitySha256:string;readonly poses:readonly Buffer[];readonly posesFaceRight?:boolean;readonly hasRearView?:boolean;readonly puppetProfile?:PuppetSkinProfile}>;
 readonly props?:ReadonlyMap<string,{readonly contentSha256:string;readonly png:Buffer}>;
 readonly environments:ReadonlyMap<string,{readonly contentSha256:string;readonly png:Buffer}>;
}
export function cinematicSpriteTop(floor:number,canvas:number,opaqueFootRow:number):number {
 if(![floor,canvas,opaqueFootRow].every(Number.isFinite)||canvas<1||canvas>1000||opaqueFootRow<1||opaqueFootRow>canvas)throw Error("CINEMATIC_SPRITE_FOOT");
 return floor-opaqueFootRow;
}
const escape=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
export async function prepareCinematicPreviewRenderer(art:CinematicPreviewArtwork,options:{motionMode?:"pose-atlas"|"grounded-skin"}={}){
 if(art.admission!=="PREVIEW_ONLY"||art.characters.size>12||art.environments.size>12)throw Error("CINEMATIC_PREVIEW_RESOURCES");
 const skins=new Map<string,Awaited<ReturnType<typeof preparePuppetSkin>>>(),propSprites=new Map<string,Buffer>();
 for(const[id,p]of art.props??[])propSprites.set(id,await sharp(p.png,{limitInputPixels:4_000_000}).trim({background:"#00000000",threshold:1}).resize(160,110,{fit:"contain",background:"#00000000"}).png().toBuffer());
 const stages=new Map<string,Buffer>(),sprites=new Map<string,Buffer>(),footRows=new Map<string,number>();
 for(const [id,a] of art.environments){
  const m=await sharp(a.png,{limitInputPixels:4_000_000}).metadata();
  if(m.format!=="png"||!m.width||!m.height||m.width<1600||m.height<900)throw Error("CINEMATIC_PREVIEW_BACKGROUND");
  stages.set(id,await sharp(a.png).resize(1960,1104,{fit:"cover"}).png().toBuffer());
 }
 for(const [id,a] of art.characters){
  if(a.poses.length!==9)throw Error("CINEMATIC_PREVIEW_POSES");
  for(const [i,b]of a.poses.entries()){
   if(options.motionMode==="grounded-skin"){let body=b;if(i===2&&!a.posesFaceRight)body=await sharp(body).flop().png().toBuffer();skins.set(id+":"+i,await preparePuppetSkin(body,a.puppetProfile));}
   const m=await sharp(b,{limitInputPixels:1_000_000}).metadata();
   if(m.format!=="png"||!m.hasAlpha||!m.width||!m.height)throw Error("CINEMATIC_PREVIEW_POSE_ALPHA");
   // Closed depth levels bound the cache; only atlas sampling/resizing, no repaint.
   for(const size of [400,560,760,840,1000]){
    let png=await sharp(b).resize(size,size,{fit:"contain",background:"#00000000"}).png().toBuffer();
    if(i===2&&!a.posesFaceRight)png=await sharp(png).flop().png().toBuffer();
    const raw=await sharp(png).ensureAlpha().raw().toBuffer();let foot=0;
    for(let y=0;y<size;y++){let solid=0;for(let x=0;x<size;x++)if(raw[(y*size+x)*4+3]!>200)solid++;if(solid>=8)foot=y+1;}
    if(!foot)throw Error("CINEMATIC_PREVIEW_EMPTY_POSE");footRows.set(id+":"+i+":"+size,foot);
    sprites.set(id+":"+i+":"+size+":right",png);
    sprites.set(id+":"+i+":"+size+":left",await sharp(png).flop().png().toBuffer());
   }
  }
 }
 async function overlay(png:Buffer,left:number,top:number):Promise<OverlayOptions|undefined>{
  const m=await sharp(png).metadata(),w=m.width!,h=m.height!,x=Math.round(left),y=Math.round(top);
  const sx=Math.max(0,-x),sy=Math.max(0,-y),width=Math.min(w-sx,1920-Math.max(0,x)),height=Math.min(h-sy,1080-Math.max(0,y));
  if(width<=0||height<=0)return;
  const input=sx||sy||width!==w||height!==h?await sharp(png).extract({left:sx,top:sy,width,height}).png().toBuffer():png;
  return {input,left:Math.max(0,x),top:Math.max(0,y)};
 }
 return async (shot:CinematicShot,time:number,speakingInstance:string|null=null):Promise<Buffer>=>{
  const elapsed=time-shot.startSeconds,duration=shot.endSeconds-shot.startSeconds;
  if(!Number.isFinite(time)||elapsed<0||elapsed>duration+1/15)throw Error("CINEMATIC_PREVIEW_TIME");
  const bg=art.environments.get(shot.environment.id);
  if(!bg||bg.contentSha256!==shot.environment.contentSha256)throw Error("CINEMATIC_PREVIEW_ENV_BINDING");
  for(const a of shot.actors){
   const p=art.characters.get(a.character.id);
   if(!p||p.contentSha256!==a.character.contentSha256||p.designIdentitySha256!==a.character.designIdentitySha256)throw Error("CINEMATIC_PREVIEW_CHARACTER_BINDING");
  }
  const progress=Math.min(1,elapsed/duration),pan=(progress-.5)*30;
  const background=sharp(stages.get(shot.environment.id)!).extract({left:Math.round(20+pan*.12),top:12,width:1920,height:1080});
  const overlays:OverlayOptions[]=[];
  const ordered=[...shot.actors].sort((a,b)=>a.depth-b.depth);
  const actorAnchors=new Map<string,{x:number;y:number}>();
  const frameActor=async (a:CinematicActor,foreground=false)=>{
   const size=foreground?1000:a.depth<.5?400:a.depth<.7?560:a.depth<.92?760:840;
   const moving=a.action==="walk",travel=moving?Math.min(.13,elapsed*.022)*(a.facing==="right"?1:-1):0;
   let pose=a.action==="listen"?2:a.action==="drill"?6:a.action==="serve"?7:a.emotion==="tired"?8:0;
   if(moving)pose=shot.camera==="over-shoulder"?3:4+Math.floor(elapsed/.45)%2;
   else if(a.action==="speak"&&a.instanceId===speakingInstance)pose=1;
   let png=sprites.get(a.character.id+":"+pose+":"+size+":"+a.facing)!;
   let actorX=a.x+travel,actorTop:number|undefined,actorWidth=size,handAnchor:{x:number;y:number}|undefined;
   if(options.motionMode==="grounded-skin"){
    const effective=(shot.propTransfers??[]).some(p=>p.from===a.instanceId||p.to===a.instanceId)?{...a,action:"serve" as const}:a;
    const perf=cinematicActorPerformance(effective,time,a.clockOriginSeconds??shot.startSeconds,size,a.instanceId===speakingInstance,a.reactionAtSeconds);
    pose=a.instanceId===speakingInstance?1:a.emotion==="tired"?8:0;
    if(moving&&shot.camera==="over-shoulder"&&art.characters.get(a.character.id)?.hasRearView)pose=3;
    png=await skins.get(a.character.id+":"+pose)!(perf.joints);
    if(a.facing==="left")png=await sharp(png).flop().png().toBuffer();
    actorWidth=Math.round(size*700/500);png=await sharp(png).resize(actorWidth,Math.round(size*550/500),{fit:"fill"}).png({compressionLevel:1}).toBuffer();
    actorX=perf.x;actorTop=735+(a.depth-.35)*400-footRows.get(a.character.id+":0:"+size)!;
    const profile=art.characters.get(a.character.id)?.puppetProfile??DEFAULT_PUPPET_PROFILE,hand=puppetSkinPoint(perf.joints,profile.frontHand,profile);
    handAnchor={x:actorX*1920+(a.facing==="right"?1:-1)*(hand.x-250)*size/500-pan*a.depth,y:actorTop+hand.y*size/500};
   }
   const floor=foreground?1225:735+(a.depth-.35)*400;
   const x=actorX*1920-pan*(foreground?1.35:a.depth);
   const shadow='<ellipse cx="'+Math.round(x)+'" cy="'+Math.round(floor-8)+'" rx="'+Math.round(size*.17)+'" ry="'+Math.round(size*.016)+'" fill="#21120a" opacity=".22"/>';
   if(!foreground)overlays.push({input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">'+shadow+'</svg>')});
   actorAnchors.set(a.instanceId,handAnchor??{x:x+(a.facing==="right"?1:-1)*size*.03,y:floor-size*.53});
   const layer=await overlay(png,x-actorWidth/2,actorTop??cinematicSpriteTop(floor,size,footRows.get(a.character.id+":"+pose+":"+size)!));
   if(layer)overlays.push(layer);
  };
  for(const a of ordered)await frameActor(a);
  // Foreground shoulder/hat comes from the actual rear-view sprite, at a
  // different parallax speed from middle-ground actors and background plate.
  if(shot.camera==="over-shoulder"&&ordered.length>1){
   const a=ordered.find(a=>art.characters.get(a.character.id)?.hasRearView)??ordered[0]!,png=sprites.get(a.character.id+":3:1000:right")!;
   const layer=await overlay(png,-420-pan*1.35,160);
   if(layer)overlays.push(layer);
  }
  for(const p of shot.propTransfers??[]){
   if(art.props?.get(p.asset.id)?.contentSha256!==p.asset.contentSha256)throw Error("CINEMATIC_PROP_BINDING");
   const from=actorAnchors.get(p.from)!,to=actorAnchors.get(p.to)!;
   const q=Math.max(0,Math.min(1,(time-p.startSeconds)/(p.endSeconds-p.startSeconds))),u=q*q*(3-2*q);
   const x=from.x+(to.x-from.x)*u,y=from.y+(to.y-from.y)*u-Math.sin(Math.PI*u)*12;
   const layer=await overlay(propSprites.get(p.asset.id)!,x-80,y-55);if(layer)overlays.push(layer);
  }
  const dust=Array.from({length:8},(_,i)=>'<circle cx="'+Math.round((time*12+i*241)%1920)+'" cy="'+(150+i*91)+'" r="2" fill="#f6dfb5" opacity=".12"/>').join("");
  overlays.push({input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">'+dust+'</svg>')});
  const pixels=await background.composite(overlays).ensureAlpha().raw().toBuffer();
  let scene=sharp(pixels,{raw:{width:1920,height:1080,channels:4}});
  const focus=ordered.at(-1)?.x??.5;
  const zoom=shot.camera==="feet"?2.5:shot.camera==="two-shot"?1.08:shot.camera==="over-shoulder"?1.07:shot.camera==="pull-back"?1.15-.15*progress:1.02;
  if(zoom>1){
   const w=Math.floor(1920/zoom),h=Math.floor(1080/zoom),cx=shot.camera==="two-shot"?.5:focus;
   const top=shot.camera==="feet"?1080-h:Math.round((1080-h)*.62);
   scene=scene.extract({left:Math.max(0,Math.min(1920-w,Math.round(cx*1920-w/2))),top,width:w,height:h}).resize(1920,1080);
  }
  let label='<rect x="40" y="32" width="225" height="36" rx="8" fill="#172027" opacity=".65"/><text x="55" y="57" font-family="Arial" font-size="19" fill="#fff2d9">Canlandırma · '+shot.year+'</text>';
  if(speakingInstance)label+='<text x="960" y="1038" text-anchor="middle" font-family="Arial" font-size="20" fill="#fff2d9" stroke="#1b1b25" stroke-width=".5">Dramatizasyon — tarihî alıntı değildir</text>';
  if(shot.camera==="context")label+='<rect x="1370" y="105" width="510" height="210" rx="18" fill="#14323a" opacity=".88"/><text x="1400" y="150" font-family="Arial" font-size="24" fill="#f4d7a2">'+escape(shot.narrationAnchor.slice(0,30))+'</text><line x1="1400" y1="200" x2="1845" y2="200" stroke="#cfa553" stroke-width="2"/><text x="1400" y="260" font-family="Arial" font-size="32" fill="#fff2d9">'+shot.year+'</text><text x="1400" y="293" font-family="Arial" font-size="18" fill="#fff2d9">Kaynak bağlamı · Temsili günlük yaşam</text>';
  return scene.composite([{input:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">'+label+'</svg>')}]).png({compressionLevel:1}).toBuffer();
 };
}
