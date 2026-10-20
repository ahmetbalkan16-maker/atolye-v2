import { cancelRender, continueRender, delayRender } from "remotion";
import comicNeueBold from "../../fonts/ComicNeue-Bold.ttf";

/** Speech bubble lettering: Comic Neue Bold (SIL OFL 1.1, `remotion-v3/fonts/OFL-ComicNeue.txt`), bundled, no network. */
export const BUBBLE_FONT = "'Atolye Comic', 'Comic Sans MS', sans-serif";

const waiting = delayRender("Comic Neue yükleniyor");
const face = new FontFace("Atolye Comic", `url(${comicNeueBold}) format("truetype")`, { weight: "700" });
face
  .load()
  .then(() => {
    // FontFaceSet is a set of FontFace; this lib.dom version leaves out its add().
    (document.fonts as unknown as Set<FontFace>).add(face);
    continueRender(waiting);
  })
  .catch((e: unknown) => cancelRender(e));
