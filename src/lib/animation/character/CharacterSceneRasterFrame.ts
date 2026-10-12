import { characterAnimationFrame } from "./CharacterAnimation";
import { characterDirectedFrame } from "./CharacterSceneDirection";
import { findCharacterSceneAssetPayloadProblems,renderCharacterSceneAssetFrame,type CharacterSceneAssetPayload } from "./CharacterSceneAsset";
import { rasterizeCharacterSceneSvg,type CharacterSceneRasterOptions,type CharacterSceneRasterResult } from "../../character/CharacterSceneRasterizer";
import { EDITORIAL_RENDER_STYLE,renderCharacterSceneFrameSvg } from "../../character/SvgSceneRenderer";
import { createVolumeCharacter,rasterizeVolumeCharacter } from "../../character/volume/CharacterVolume";
import {volumePerformanceFrame,volumeCameraZoom} from "../../character/volume/VolumePerformance";
import {periodSettingOverlay} from "../../character/volume/PeriodDesign";

/** Single raster entry for gallery/provider/video. Old PNGs retain their exact
 * SVG path; new assets reconstruct bounded CPU geometry from the same rig cues.
 */
export async function rasterizeCharacterSceneAssetFrame(payload: CharacterSceneAssetPayload,t: number,durationSeconds=6,options: CharacterSceneRasterOptions={}): Promise<CharacterSceneRasterResult> {
  if(!payload.volume) return rasterizeCharacterSceneSvg(renderCharacterSceneAssetFrame(payload,t,durationSeconds),options);
  if(findCharacterSceneAssetPayloadProblems(payload).length||!Number.isFinite(t)||t<0||!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>600) return {ok:false,reason:"SVG_REJECTED"};
  const direction=payload.direction!,blocking=payload.request.blocking;
  const frames=characterDirectedFrame(blocking,payload.animation,direction.beats,t,durationSeconds);
  const art={...direction.art,roles:[]};
  const plate=renderCharacterSceneFrameSvg({...blocking,characters:[],props:[],arrows:[],caption:null}, {},{reenactmentLabel:null,fontFamily:payload.fontFamily,renderStyle:EDITORIAL_RENDER_STYLE,artDirection:art,transparentBackdrop:payload.background!==undefined,floorLayout:payload.background?.stageLayout});
  const base=await rasterizeCharacterSceneSvg(plate,options);if(!base.ok) return base;
  try {
    const sharp=(await import("sharp")).default;
    const layers: {depth:number;order:number;overlays:import("sharp").OverlayOptions[]}[]=[];
    if(payload.volume.design) layers.push({depth:2,order:0,overlays:[{input:Buffer.from(periodSettingOverlay(payload.volume.design.setting))}]});
    for(const [index,prop] of blocking.props.entries()) {
      const svg=renderCharacterSceneFrameSvg({...blocking,characters:[],props:[prop],arrows:[],caption:null},{},{reenactmentLabel:null,fontFamily:payload.fontFamily,renderStyle:EDITORIAL_RENDER_STYLE,artDirection:art,transparentBackdrop:true,floorLayout:payload.background?.stageLayout});
      layers.push({depth:prop.depth,order:index,overlays:[{input:Buffer.from(svg)}]});
    }
    for(const [index,c] of blocking.characters.entries()) {
      let frame=frames[c.id]??characterAnimationFrame(blocking,payload.animation,t)[c.id]!;
      const role=direction.art.roles.find(r=>r.id===c.id)?.role??"CITIZEN";
      const wardrobe=payload.volume.wardrobes.find(w=>w.actorId===c.id)!.brief;
      const identity=/^c[1-8]$/.test(c.id)?Number(c.id.slice(1))-1:index%8;
      const scale=138*(1-.5*c.depth)*(role==="ADVISOR"?.94:1),y=900-260*c.depth+(payload.background?.stageLayout?140+160*c.depth:0);
      const performance=payload.volume.design?volumePerformanceFrame(c,payload.animation.actors.find(a=>a.id===c.id),frame,t,scale):undefined;
      if(performance){frame={...frame,x:performance.x,pose:performance.pose};frames[c.id]=frame;}
      const designProfile=payload.volume.design?.actors.find(a=>a.actorId===c.id)?.profile;
      let mesh=createVolumeCharacter({culture:direction.art.culture,role,faith:direction.art.faith,pose:c.pose,poseAngles:frame.pose,mouthOpen:frame.mouthOpen,expression:c.expression,identity,handProp:c.handProp,costume:c.costume,...(wardrobe.recipe?{wardrobe}:{}),...(performance?{joints:performance.joints,designProfile}:{})});
      if(c.facing==="LEFT") mesh=mesh.map(f=>({...f,vertices:f.vertices.map(v=>[-v[0],v[1],v[2]] as const) as unknown as typeof f.vertices,...(f.normals?{normals:f.normals.map(v=>[-v[0],v[1],v[2]] as const) as unknown as typeof f.normals}:{})}));
      const shadow=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><ellipse cx="${frame.x*1920}" cy="${y+4}" rx="${scale*.60}" ry="${scale*.07}" fill="#353139" opacity=".18"/></svg>`);
      const raw=rasterizeVolumeCharacter(mesh,{width:1920,height:1080,x:frame.x*1920,y,scale,yaw:c.facing==="LEFT"?12:-12});
      layers.push({depth:c.depth,order:100+index,overlays:[{input:shadow},{input:await sharp(Buffer.from(raw),{raw:{width:1920,height:1080,channels:4}}).png({compressionLevel:1}).toBuffer()}]});
    }
    const overlays=layers.sort((a,b)=>b.depth-a.depth||a.order-b.order).flatMap(l=>l.overlays);
    let scene=await sharp(base.png).composite(overlays).png({compressionLevel:1}).toBuffer();
    // A modest speaker-focused move, with the label kept outside the camera crop.
    // Cues are scene-relative estimates; no claim of word/phoneme alignment.
    const phase=t%12,zoom=payload.volume.design?volumeCameraZoom(t,durationSeconds):durationSeconds>=7&&phase>=3&&phase<9?1.18:1;
    if(zoom>1&&blocking.characters.length) {
      const speaker=blocking.characters[0]!,focus=(frames[speaker.id]?.x??speaker.x)*1920;
      const width=Math.floor(1920/zoom),height=Math.floor(1080/zoom);
      scene=await sharp(scene).extract({left:Math.max(0,Math.min(1920-width,Math.round(focus-width/2))),top:Math.min(1080-height,50),width,height}).resize(1920,1080).png({compressionLevel:1}).toBuffer();
    }
    const label=renderCharacterSceneFrameSvg({...blocking,characters:[],props:[]},{},{reenactmentLabel:payload.request.language,fontFamily:payload.fontFamily,renderStyle:EDITORIAL_RENDER_STYLE,artDirection:art,transparentBackdrop:true});
    const year=payload.volume.sceneYears.length===1?payload.volume.sceneYears[0]:undefined;
    const yearBadge=year===undefined?[]:[{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect x="1480" y="60" width="380" height="68" rx="12" fill="#242433" opacity=".85"/><text x="1510" y="106" font-family="Arial" font-size="36" fill="#fff">${year<0?`MÖ ${Math.abs(year)}`:`MS ${year}`}</text></svg>`)}];
    const image=sharp(scene).composite([{input:Buffer.from(label)},...yearBadge]);
    const png=await (options.fast?image.png({compressionLevel:1}):image.png()).toBuffer();
    return {ok:true,png,width:1920,height:1080,rasterizer:"sharp"};
  } catch { return {ok:false,reason:"RASTERIZE_FAILED"}; }
}
