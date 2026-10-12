import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { planCharacterScene } from "../../src/lib/animation/character/CharacterScenePlanner";
import { planCharacterSceneDirection } from "../../src/lib/animation/character/CharacterSceneDirection";
import { EDITORIAL_RENDER_STYLE, renderCharacterSceneSvg, type CharacterArtDirection } from "../../src/lib/character/SvgSceneRenderer";

/** Our own renderer provides composition, not an unlicensed external portrait. */
export async function createCharacterGuide(theme: string, role: "RULER" | "ADVISOR" | "GUARD", directory: string): Promise<string> {
  const words: Record<string, string> = { OTTOMAN: "Osmanlı padişahı sarayda", BYZANTINE: "Bizans imparatoru sarayda", ROMAN: "Roma imparatoru sarayda", EGYPTIAN: "Mısır firavunu sarayda" };
  if (!words[theme]) throw new Error("LOCAL_CHARACTER_GUIDE_THEME");
  const plan = planCharacterScene({ sceneId: 1, text: words[theme], contextualDirection: true });
  const original = plan.request.blocking.characters[0]!;
  const character = { ...original, id: role === "RULER" ? "c1" : role === "ADVISOR" ? "c2" : "c3", depth: 0, x: 0.5, expression: "HAPPY" as const, pose: "STAND" as const, handProp: null };
  const blocking = { ...plan.request.blocking, characters: [character], props: [], arrows: [], caption: null };
  const direction = planCharacterSceneDirection(words[theme]!, plan.request.blocking);
  const art: CharacterArtDirection = { ...direction.art, roles: [{ id: character.id, role }] };
  const svg = renderCharacterSceneSvg(blocking, { reenactmentLabel: null, renderStyle: EDITORIAL_RENDER_STYLE, artDirection: art, transparentBackdrop: true });
  const png = await sharp(Buffer.from(svg)).trim().resize(550, 860, { fit: "contain", background: "#ff00ff" }).extend({ left: 109, right: 109, top: 82, bottom: 82, background: "#ff00ff" }).flatten({ background: "#ff00ff" }).png().toBuffer();
  const file = path.join(directory, `${theme.toLowerCase()}-${role.toLowerCase()}-guide-${Date.now()}.png`);
  fs.writeFileSync(file, png, { flag: "wx" });
  return file;
}
