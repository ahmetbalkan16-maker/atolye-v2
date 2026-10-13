import type {CharacterJoints,Point} from '../CharacterRig';
import type {HandProp} from '../PropLibrary';
import type {V3,VolumeFace} from './CharacterVolume';
import type {SceneBlocking} from '../SceneBlocking';

/** Only a single explicit held prop changes the lead actor. Ambiguous or
 * negated equipment retains the established blocking, never a guessed weapon. */
export function volumeSceneEquipment(text:string,blocking:SceneBlocking):SceneBlocking {
  const s=text.slice(0,8192).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu,'').replace(/ı/g,'i');
  if(/\b(degil|olmayan|silahsiz|without|not)\b/.test(s))return blocking;
  const matches:HandProp[]=[];
  if(/\b(kilic\w*|sword\w*)\b/.test(s))matches.push('SWORD');
  if(/\b(mizra[kg]\w*|spear\w*)\b/.test(s))matches.push('SPEAR');
  if(/\b(kalkan\w*|shield\w*)\b/.test(s))matches.push('SHIELD');
  if(/\b(yay\w*\s+(?:tut\w*|tas\w*)|bow and arrow)\b/.test(s))matches.push('BOW');
  return matches.length===1?{...blocking,characters:blocking.characters.map((c,i)=>i===0?{...c,handProp:matches[0]!}:c)}:blocking;
}

/** Readable, bounded equipment for V2 assets only. Grip and wrist orientation
 * come from the actual animated forearm, rather than a guessed pose angle. */
export function volumeEquipmentGrip(joints:CharacterJoints,back=false) {
  const hand=back?joints.handBack:joints.handFront,elbow=back?joints.elbowBack:joints.elbowFront;
  const side=back?-1:1;
  const anchor:V3=[(hand.x+side*39)/100,-hand.y/100,side*.10+.18];
  const angle=Math.atan2(hand.x-elbow.x,hand.y-elbow.y);
  const at=(v:V3):V3=>[anchor[0]+v[0]*Math.cos(angle)-v[1]*Math.sin(angle),anchor[1]+v[0]*Math.sin(angle)+v[1]*Math.cos(angle),anchor[2]+v[2]];
  return {anchor,angle,at};
}

export function createVolumeEquipment(joints:CharacterJoints,prop:HandProp,back=false):VolumeFace[] {
  const {at}=volumeEquipmentGrip(joints,back),faces:VolumeFace[]=[];
  const tri=(a:V3,b:V3,c:V3,color:string,metallic=false)=>faces.push({vertices:[at(a),at(b),at(c)],color,...(metallic?{metallic:true}:{})});
  const rod=(a:Point,b:Point,r:number,color:string,metallic=false,z=0)=>{
    const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
    for(let i=0;i<12;i++) {
      const p=i*Math.PI/6,q=(i+1)*Math.PI/6;
      const ring=(v:Point,t:number):V3=>[v.x-r*dy/l*Math.cos(t),v.y+r*dx/l*Math.cos(t),z+r*Math.sin(t)];
      const aa=ring(a,p),ab=ring(a,q),ba=ring(b,p),bb=ring(b,q);
      tri(aa,ab,ba,color,metallic);tri(ab,bb,ba,color,metallic);
      tri([a.x,a.y,z],ab,aa,color,metallic);tri([b.x,b.y,z],ba,bb,color,metallic);
    }
  };
  const grip=()=>{rod({x:0,y:-.18},{x:0,y:.14},.065,'#473329');for(let i=0;i<5;i++)rod({x:-.060,y:-.14+i*.052},{x:.060,y:-.14+i*.052},.010,'#c9b084',false,.045);};
  if(prop==='SPEAR'||prop==='FLAG'||prop==='TORCH') {
    const top=prop==='SPEAR'?2.10:1.48;
    rod({x:0,y:-.72},{x:0,y:top},.045,'#573b26');grip();
    rod({x:0,y:top-.12},{x:0,y:top+.06},.058,'#c0cdd6',true);
    if(prop==='SPEAR') {
      // Raised central ridge and contrasting steel facets read at scene scale.
      const a:V3=[0,top,0],b:V3=[-.16,top+.21,0],c:V3=[0,top+.57,0],d:V3=[.16,top+.21,0],ridge:V3=[0,top+.21,.065];
      tri(a,b,ridge,'#657887',true);tri(b,c,ridge,'#e8eff4',true);tri(c,d,ridge,'#a9bccb',true);tri(d,a,ridge,'#dae4eb',true);
      tri(a,c,b,'#6e8494',true);tri(a,d,c,'#8b9eaa',true);
    } else if(prop==='FLAG') {
      for(let i=0;i<4;i++){const x=i*.15,x2=(i+1)*.15,z=i%2?.05:.01,z2=(i+1)%2?.05:.01;
        tri([x,top, z],[x2,top,z2],[x2,top-.46,z2],i%2?'#9b2436':'#be3944');tri([x,top,z],[x2,top-.46,z2],[x,top-.46,z],i%2?'#9b2436':'#be3944');}
    } else {rod({x:0,y:top-.12},{x:0,y:top+.12},.10,'#a16a30');tri([-.12,top,0],[.01,top+.48,.02],[.14,top,0],'#efa83d');}
  } else if(prop==='SWORD') {
    grip();rod({x:-.24,y:.18},{x:.24,y:.18},.038,'#bb994d',true);
    const ridge:V3=[0,.72,.07];
    tri([-.115,.22,0],[0,1.30,0],ridge,'#e6edf2',true);tri([0,1.30,0],[.115,.22,0],ridge,'#a1b3c0',true);
    tri([.115,.22,0],[-.115,.22,0],ridge,'#cbd8e1',true);tri([-.115,.22,0],[.115,.22,0],[0,1.30,0],'#718591',true);
    rod({x:0,y:-.25},{x:0,y:-.20},.09,'#bd9c55',true);
  } else if(prop==='BOW') {
    const points=[{x:0,y:-.72},{x:.23,y:-.36},{x:.29,y:0},{x:.23,y:.36},{x:0,y:.72}];
    for(let i=1;i<points.length;i++)rod(points[i-1]!,points[i]!, .045,'#705038');
    rod(points[0]!,points[4]!, .010,'#dfd7bc');rod({x:-.55,y:0},{x:.62,y:0},.018,'#bea273',false,.075);
    tri([-.55,0,.075],[-.38,.07,.075],[-.38,-.07,.075],'#9fadb6',true);
  } else if(prop==='SHIELD') {
    for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;tri([0,0,.16],[.37*Math.cos(a),.50*Math.sin(a),.02],[.37*Math.cos(b),.50*Math.sin(b),.02],'#763746');rod({x:.37*Math.cos(a),y:.50*Math.sin(a)},{x:.37*Math.cos(b),y:.50*Math.sin(b)},.024,'#b29c63',true,.02);}
    rod({x:0,y:-.1},{x:0,y:.1},.10,'#a8b6bf',true,.16);
  } else if(prop==='SCROLL') {
    tri([-.28,.22,.08],[.28,.22,.08],[.28,-.22,.08],'#fff3cf');tri([-.28,.22,.08],[.28,-.22,.08],[-.28,-.22,.08],'#fff3cf');
    rod({x:-.28,y:.22},{x:.28,y:.22},.045,'#e6c99f',false,.08);rod({x:-.28,y:-.22},{x:.28,y:-.22},.045,'#e6c99f',false,.08);
  }
  return faces;
}
