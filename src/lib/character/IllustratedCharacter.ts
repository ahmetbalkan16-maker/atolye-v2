import { computeCharacterJoints, type CharacterJoints, type Point } from "./CharacterRig";
import { POSE_ANGLES } from "./CharacterPose";
import type { BlockedCharacter } from "./SceneBlocking";
import type { CharacterArtDirection, CharacterFrameOverride } from "./SvgSceneRenderer";

const ink = "#242332", gold = "#e6b54d", paleGold = "#ffe5a0";
const n = (v: number) => String(Math.round(v * 100) / 100);
const path = (d: string, fill: string, stroke = ink, w = 3) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
const ell = (x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, w = 3) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(w)}"/>`;
const line = (a: Point, b: Point, color: string, w: number) => path(`M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`, "none", color, w);

export function renderIllustratedThrone(x: number, depth: number, culture: CharacterArtDirection["culture"]): string {
  const s=1-0.5*depth, color=culture==="BYZANTINE"?"#663268":culture==="EGYPTIAN"?"#23558d":"#982636";
  const crest=culture==="EGYPTIAN"?"M-75-234H75L83-86H-83Z":"M-75-214Q-77-253 0-271Q77-253 75-214L83-86H-83Z";
  const parts=[path("M-88-15L-93 0H-80L-72-15M72-15L80 0H93L88-15",gold,ink,4),path(crest,gold,ink,4),path("M-65-214Q0-259 65-214L70-85H-70Z",color,ink,3),path("M-54-210Q0-245 54-210","none",paleGold,3),path("M-85-80H85L101-25H-101Z",color,ink,4),path("M-103-35H103V-18H-103Z",gold,ink,3)];
  for(const side of [-1,1]) {
    const cx=side*92;
    parts.push(path(`M${cx-9}-99H${cx+9}V-25H${cx-9}Z`,gold),ell(cx,-102,18,11,gold,ink,3),ell(cx,-107,11,4,paleGold,"none"));
    for(const y of [-215,-174,-133]) parts.push(ell(side*74,y,5,5,paleGold,ink,1));
    parts.push(path(`M${side*20} -245Q${side*52} -270 ${side*67} -248Q${side*60} -236 ${side*47} -248`,"none","#b98029",4));
  }
  parts.push(ell(0,-254,11,14,gold),ell(0,-254,6,8,culture==="EGYPTIAN"?"#3b9eb0":"#b9314a",ink,1.5));
  return `<g data-throne-culture="${culture}" data-throne-version="4" transform="translate(${n(x*1920)} ${n(900-260*depth)}) scale(${n(s)})">${parts.join("")}</g>`;
}

/** Version 4: complete cartoon tailoring, face and glove shapes on the existing
 * pose rig. Pure local SVG; no asset URL, filter, font download, or GPU call.
 * Previous character versions continue through their unchanged renderer.
 */
export function renderIllustratedCharacter(item: BlockedCharacter, frame: CharacterFrameOverride | undefined, prop: (j: CharacterJoints, scale: number) => string, art: CharacterArtDirection): string {
  const ordinal = /^c([1-8])$/.exec(item.id);
  let hash = 0; for (const c of item.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const identity = ordinal ? Number(ordinal[1]) - 1 : hash % 8;
  const role = art.roles.find(r => r.id === item.id)?.role ?? "CITIZEN";
  const ruler = role === "RULER", advisor = role === "ADVISOR", guard = role === "GUARD";
  const historical = ruler || advisor || guard;
  const culture = art.culture;
  const s = 1.38 * (1 - 0.5 * item.depth);
  const ground = { x: (frame?.x ?? item.x) * 1920, y: 900 - 260 * item.depth };
  const pose = frame?.pose ?? POSE_ANGLES[item.pose];
  const base = computeCharacterJoints({ id: "illustrated-v4", headRadius: 61, neck: 11, torso: 110, upperArm: 57, lowerArm: 53, upperLeg: 64, lowerLeg: 60, stroke: 12 }, pose, ground, s);
  const shift = (p: Point, x: number) => ({ x: p.x + x * s, y: p.y });
  const j: CharacterJoints = { ...base, elbowBack: shift(base.elbowBack, -39), handBack: shift(base.handBack, -39), elbowFront: shift(base.elbowFront, 39), handFront: shift(base.handFront, 39), kneeBack: shift(base.kneeBack, -13), footBack: shift(base.footBack, -13), kneeFront: shift(base.kneeFront, 13), footFront: shift(base.footFront, 13) };
  const shoulderBack = shift(j.shoulder, -39), shoulderFront = shift(j.shoulder, 39);
  const p = (a: Point, x: number, y: number) => ({ x: a.x + x * s, y: a.y + y * s });
  const localPath = (anchor: Point, d: string, fill: string, stroke = ink, w = 3) => `<g transform="translate(${n(anchor.x)} ${n(anchor.y)}) scale(${n(s)})">${path(d, fill, stroke, w)}</g>`;
  const ellipse = (a: Point, x: number, y: number, rx: number, ry: number, fill: string, stroke = ink, w = 3) => ell(a.x + x * s, a.y + y * s, rx * s, ry * s, fill, stroke, w * s);
  const palette = ["#edb93f", "#447c86", "#9e6376", "#719175", "#796693", "#b56c47", "#44829e", "#81694e"];
  const coat = historical ? culture === "OTTOMAN" ? ruler ? "#af283d" : advisor ? "#245659" : "#3c4051" : culture === "BYZANTINE" ? ruler ? "#6e326f" : advisor ? "#353446" : "#8b9bab" : culture === "ROMAN" ? "#fff0d7" : culture === "EGYPTIAN" ? "#fff4dd" : culture === "STEPPE" ? "#3b6273" : "#6a3c78" : palette[identity]!;
  const shade = historical ? culture === "OTTOMAN" ? ruler ? "#7f1c32" : advisor ? "#193e43" : "#272d3a" : culture === "BYZANTINE" ? ruler ? "#492453" : advisor ? "#212331" : "#617487" : "#cfb18c" : "#9b743c";
  const robe = historical && !(guard && ["ROMAN", "BYZANTINE"].includes(culture));
  const designedHem = robe ? culture === "EGYPTIAN" && !advisor ? 45 : culture === "ROMAN" && ruler ? 40 : 101 : 23;
  // Kneeling/sitting must not push a long robe through the floor.
  const hem = Math.max(0, Math.min(designedHem, (ground.y-j.hip.y)/s-14));
  const parts: string[] = [ellipse(ground, 0, 7, 79, 12, "#60594f", "none")];
  // Capes have their own silhouette; sleeves and gloves follow each joint.
  if (ruler && ["ROMAN", "BYZANTINE", "WESTERN"].includes(culture)) {
    parts.push(localPath(j.shoulder, `M-41 -5Q-77 34 -79 ${110 + hem}Q-10 ${142 + hem} 69 ${116 + hem}L39 -5Z`, culture === "BYZANTINE" ? "#914e95" : "#a82b3e"));
    parts.push(localPath(j.shoulder, `M-61 35Q-57 117 -68 ${108 + hem}L-44 ${118 + hem}Q-32 73 -30 15Z`, culture === "BYZANTINE" ? "#693876" : "#792035", "none"));
  }
  for (const [hip, knee, foot] of [[shift(j.hip, -13), j.kneeBack, j.footBack], [shift(j.hip, 13), j.kneeFront, j.footFront]] as const) {
    parts.push(line(hip, knee, ink, 17 * s), line(knee, foot, ink, 17 * s));
    parts.push(ellipse(foot, 10, -3, 28, 13, "#fffdf5"), ellipse(foot, 10, 4, 27, 4, "#dddad2", "none"), line(p(foot, -15, 7), p(foot, 35, 7), ink, 2.5 * s));
  }
  const sleeve = (shoulder: Point, elbow: Point, hand: Point) => {
    const cuff = { x: elbow.x + 0.58 * (hand.x - elbow.x), y: elbow.y + 0.58 * (hand.y - elbow.y) };
    const result = [line(shoulder, elbow, ink, 36 * s), line(elbow, cuff, ink, 33 * s), line(shoulder, elbow, coat, 30 * s), line(elbow, cuff, coat, 27 * s), line(p(shoulder, -4, 4), p(elbow, -4, 0), shade, 6 * s), line(cuff, hand, ink, 11 * s), ellipse(cuff, 0, 0, 17, 9, historical ? gold : "#ffe2a2")];
    result.push(localPath(hand, "M-15 -11Q-19 -7 -17 4Q-14 19 0 20Q16 20 19 7Q23-7 9-13Q1-17-6-11Q-10-22-16-19Q-21-16-15-11Z", "#fffcf1"));
    result.push(localPath(hand, "M-9 4Q-3 10 9 8M-6-3Q0 2 11 0", "none", "#c8c1ad", 1.8));
    return result.join("");
  };
  parts.push(sleeve(shoulderBack, j.elbowBack, j.handBack));
  // Tailored garment outline with a real collar, flared skirt and inset panels.
  const topLeft = p(j.shoulder, -43, -5), topRight = p(j.shoulder, 43, -5);
  const lowerLeft = p(j.hip, -58, hem), lowerRight = p(j.hip, 58, hem);
  parts.push(path(`M${n(topLeft.x)} ${n(topLeft.y)}Q${n(j.shoulder.x)} ${n(j.shoulder.y - 15*s)} ${n(topRight.x)} ${n(topRight.y)}Q${n(j.hip.x + 45*s)} ${n(j.hip.y)} ${n(lowerRight.x)} ${n(lowerRight.y)}Q${n(j.hip.x)} ${n(j.hip.y + (hem+12)*s)} ${n(lowerLeft.x)} ${n(lowerLeft.y)}Q${n(j.hip.x-45*s)} ${n(j.hip.y)} ${n(topLeft.x)} ${n(topLeft.y)}Z`, coat, ink, 3.3*s));
  parts.push(path(`M${n(topLeft.x+9*s)} ${n(topLeft.y+10*s)}Q${n(j.hip.x-39*s)} ${n(j.hip.y)} ${n(lowerLeft.x+11*s)} ${n(lowerLeft.y-3*s)}L${n(j.hip.x-25*s)} ${n(j.hip.y+(hem+4)*s)}Q${n(j.hip.x-20*s)} ${n(j.hip.y)} ${n(j.shoulder.x-22*s)} ${n(j.shoulder.y+8*s)}Z`, shade, "none"));
  if (historical) {
    for (const x of [-27, 27]) {
      const a = p(j.shoulder, x, 10), b = p(j.hip, x*1.3, hem-6);
      parts.push(line(a, b, gold, 9*s), line(p(a, -1, 0), p(b, -1, 0), paleGold, 2*s));
      for (let y = 23; y < 100 + hem; y += 29) {
        const center = y <= 110 ? { x: j.shoulder.x+(j.hip.x-j.shoulder.x)*y/110, y:j.shoulder.y+(j.hip.y-j.shoulder.y)*y/110 } : p(j.hip,0,y-110);
        parts.push(localPath(p(center, x + (x>0?12:-12), 0), "M0-8Q-9-4-4 2Q-8 7 0 11Q8 7 4 2Q9-4 0-8ZM0-5V8M-4 1L4 5", "none", gold, 1.7));
      }
    }
    parts.push(path(`M${n(lowerLeft.x+4*s)} ${n(lowerLeft.y-8*s)}Q${n(j.hip.x)} ${n(j.hip.y+(hem-2)*s)} ${n(lowerRight.x-4*s)} ${n(lowerRight.y-8*s)}`, "none", gold, 8*s));
  } else {
    parts.push(line(p(j.shoulder, 0, 14), p(j.hip, 0, 22), "#fff1c7", 4*s));
    for (const y of [29, 52, 75]) parts.push(ellipse(j.shoulder, 11, y, 3.2, 3.2, "#fff2b8", "none"));
  }
  if (historical) {
    parts.push(line(p(j.hip,-42,-13),p(j.hip,42,-13),shade,16*s), line(p(j.hip,-42,-16),p(j.hip,42,-16),gold,11*s), ellipse(j.hip,0,-16,15,14,paleGold),ellipse(j.hip,0,-16,8,8,"#a33540",gold,2));
    parts.push(localPath(j.shoulder, "M-19-8L0 10L19-8L14 24L0 31L-14 24Z", paleGold));
  }
  // Roman breastplate and Egyptian broad collar replace a generic robe accent.
  if (culture === "ROMAN" && (ruler || guard)) {
    parts.push(localPath(j.shoulder,"M-36 8Q0 22 36 8L32 88Q0 107-32 88Z",ruler?"#d4aa54":"#a7b3be"));
    for (const y of [31,52,73]) parts.push(localPath(j.shoulder,`M-29 ${y}Q0 ${y+12} 29 ${y}`,"none",ruler?paleGold:"#e1e6e8",4));
    for(const x of [-25,-8,9,26]) parts.push(localPath(j.hip,`M${x-7} 0L${x+7} 0L${x+10} 42Q${x} 51 ${x-10} 42Z`,ruler?gold:"#925344"));
  }
  if (culture === "EGYPTIAN" && historical) {
    parts.push(localPath(j.shoulder,"M-45-5Q0 58 45-5L37 25Q0 67-37 25Z","#327b9b",gold,4));
    for(const x of [-30,-15,0,15,30]) parts.push(localPath(j.shoulder,`M${x} 10L${x*0.76}35`,"none",gold,3));
  }
  parts.push(sleeve(shoulderFront,j.elbowFront,j.handFront));
  // A large white face keeps the owner's mascot family; cast members are not clones.
  parts.push(ellipse(j.head,0,0,61,62,"#fffdf7",ink,3.5));
  parts.push(localPath(j.head,"M-48 26Q-24 60 22 56Q-16 72-43 49Z","#ece6d9","none"));
  const faceMood = guard ? "DETERMINED" : item.expression;
  if (faceMood === "SURPRISED") {
    for(const x of [-21,21]) parts.push(ellipse(j.head,x,-6,13,19,"#fff"),ellipse(j.head,x,-3,6,10,ink,"none"));
  } else if (faceMood === "HAPPY") {
    for(const x of [-21,21]) parts.push(ellipse(j.head,x,-7,9,15,ink,"none"),ellipse(j.head,x-2,-12,3,5,"#fff","none"));
  } else {
    for(const x of [-21,21]) parts.push(ellipse(j.head,x,-4,8,12,ink,"none"),ellipse(j.head,x-2,-9,2.5,4,"#fff","none"));
  }
  const angry = faceMood === "ANGRY" || faceMood === "DETERMINED";
  parts.push(localPath(j.head,angry?"M-36-27L-11-20M11-20L36-27":"M-35-28Q-23-33-12-29M12-29Q23-33 35-28","none",ink,3.5));
  for(const x of [-40,40]) parts.push(ellipse(j.head,x,15,9,4,"#efb4a1","none"));
  if (frame?.mouthOpen || (faceMood === "HAPPY" && frame === undefined)) {
    parts.push(localPath(j.head,"M-24 24Q0 31 24 24Q17 53 0 52Q-17 50-24 24Z",ink));
    parts.push(localPath(j.head,"M-19 27Q0 32 19 27L15 34Q0 38-15 34Z","#fff","none"),localPath(j.head,"M-11 46Q0 39 11 46Q0 55-11 46Z","#e96572","none"));
  } else if(faceMood === "SURPRISED") parts.push(ellipse(j.head,0,33,9,12,ink));
  else parts.push(localPath(j.head,angry?"M-16 33Q0 28 16 33":"M-21 27Q0 44 21 27","none",ink,3.5));
  if(advisor || (!historical && identity%3===1)) {
    for(const x of [-21,21]) parts.push(ellipse(j.head,x,-6,20,23,"none",ink,2.6));
    parts.push(localPath(j.head,"M-1-6H1M-58-9L-42-6M42-6L58-9","none",ink,2.6));
  }
  if(advisor && culture === "OTTOMAN") parts.push(localPath(j.head,"M-37 37Q-17 58 0 51Q17 58 37 37Q30 81 0 86Q-30 81-37 37Z","#e0ded3"));
  // Headwear changes with both culture and role, never a random universal crown.
  if(historical && culture === "OTTOMAN") {
    parts.push(localPath(j.head,guard?"M-57-35Q-60-67 0-66Q60-67 57-35Z":"M-64-37Q-84-62-57-80Q0-108 57-80Q84-62 64-37Q0-17-64-37Z","#fff3d5"));
    for(const y of [-43,-55,-67]) parts.push(localPath(j.head,`M-57 ${y}Q0 ${y-22} 57 ${y-4}`,"none","#bfa878",2));
    if(ruler) parts.push(localPath(j.head,"M3-83Q5-114 30-115Q21-97 15-83Z",gold),ellipse(j.head,8,-52,12,16,gold),ellipse(j.head,8,-52,7,11,"#b5253c",ink,1.5));
  } else if(historical && culture === "EGYPTIAN") {
    parts.push(localPath(j.head,ruler?"M-55-35L-70-7L-68 56L-42 54L-40-31Q0-53 40-31L42 54L68 56L70-7L55-35Q0-73-55-35Z":"M-52-35Q0-65 52-35L57 39L42 39L40-27Q0-40-40-27L-42 39L-57 39Z",ruler?"#2d6693":"#263950",gold,3));
    if(ruler) for(const y of [-17,0,17,34]) parts.push(localPath(j.head,`M-66 ${y}L-45 ${y+3}M45 ${y+3}L66 ${y}`,"none",gold,6));
    parts.push(localPath(j.head,"M-51-36Q0-53 51-36","none",gold,8),ellipse(j.head,0,-43,6,10,gold));
  } else if(ruler && culture === "ROMAN") {
    for(const x of [-50,-36,-20,20,36,50]) parts.push(ellipse(j.head,x,-49+Math.abs(x)*0.36,9,5,"#548641",ink,1.5));
    parts.push(localPath(j.head,"M-54-28Q-36-61-5-56M5-56Q36-61 54-28","none","#416933",3));
  } else if(ruler && ["BYZANTINE","WESTERN"].includes(culture)) {
    parts.push(localPath(j.head,"M-55-38L-55-77L-28-58L0-87L28-58L55-77L55-38Q0-22-55-38Z",gold));
    parts.push(localPath(j.head,"M-52-43Q0-30 52-43","none",paleGold,6));
    for(const x of [-36,0,36]) parts.push(ellipse(j.head,x,-48,5,7,x===0?"#c64146":"#3f87a3",ink,1));
    if(culture==="BYZANTINE" && art.faith==="CHRISTIANITY") parts.push(localPath(j.head,"M0-88V-109M-8-101H8","none",gold,5));
  } else if(guard && ["ROMAN","BYZANTINE","WESTERN"].includes(culture)) {
    parts.push(localPath(j.head,"M-52-34Q-54-88 0-91Q54-88 52-34L39-34L35-50Q0-62-35-50L-39-34Z","#a8b7c3"));
    parts.push(localPath(j.head,"M-7-91Q-13-121 23-124Q45-121 54-101L29-86Q9-99-7-91Z","#ac3242"),localPath(j.head,"M-50-35H50","none","#e0e6e8",7));
  } else if(advisor && ["ROMAN","BYZANTINE"].includes(culture)) {
    if(culture==="BYZANTINE") parts.push(localPath(j.head,"M-59 34Q-79-63 0-75Q79-63 59 34L45 36Q58-41 0-49Q-58-41-45 36Z","#363445"));
    else parts.push(localPath(j.head,"M-53-28Q-37-71 0-67Q41-74 55-26Q10-54-53-28Z","#5f473c"));
  } else {
    parts.push(localPath(j.head,identity%2===0?"M-45-37L-28-66L-9-50L9-74L27-48L45-58L50-34Z":"M-52-34Q-25-83 22-65Q48-57 55-30Q11-59-52-34Z",identity%2===0?"#343c4b":"#77523b"));
  }
  if(!historical) {
    parts.push(localPath(j.neck,"M-26-7Q0 4 28-7L24 11Q0 20-24 11Z",identity===0?gold:"#c6a994"));
    parts.push(localPath(j.neck,"M15 9L30 9L40 62L18 53Z",identity===0?"#f1c14b":"#c6a994"));
  }
  parts.push(prop(j,s));
  const transforms = [];
  if(item.facing==="LEFT") transforms.push(`translate(${n(ground.x*2)} 0) scale(-1 1)`);
  if(pose.bodyRotation) transforms.push(`rotate(${n(pose.bodyRotation)} ${n(ground.x)} ${n(ground.y)})`);
  return `<g data-character="${item.id}" data-art-version="4" data-art-identity="${identity}" data-art-culture="${culture}" data-art-role="${role}"${transforms.length?` transform="${transforms.join(" ")}"`:""}>${parts.join("")}</g>`;
}
