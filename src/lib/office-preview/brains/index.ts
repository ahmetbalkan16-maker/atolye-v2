import type { PreviewBrainId, PreviewBrainProfile } from "../roleTypes";
import { ayasBrain } from "./ayas";
import { arastirmaBrain } from "./arastirma";
import { cirakBrain } from "./cirak";
import { denetciBrain } from "./denetci";
import { gelistiriciBrain } from "./gelistirici";
import { kaliteBrain } from "./kalite";
import { kostumBrain } from "./kostum";
import { kurguBrain } from "./kurgu";
import { mizahBrain } from "./mizah";
import { muhasebeBrain } from "./muhasebe";
import { onarimBrain } from "./onarim";
import { ortamBrain } from "./ortam";
import { sesBrain } from "./ses";
import { tarihBrain } from "./tarih";
import { yayinciBrain } from "./yayinci";
import { analistBrain } from "./analist";
import { gozcuBrain } from "./gozcu";
import { radarBrain } from "./radar";
import { guvenlikBrain } from "./guvenlik";

export const PREVIEW_BRAINS: readonly PreviewBrainProfile[] = [
  ayasBrain,
  arastirmaBrain,
  kurguBrain,
  mizahBrain,
  kostumBrain,
  ortamBrain,
  sesBrain,
  kaliteBrain,
  onarimBrain,
  gelistiriciBrain,
  cirakBrain,
  denetciBrain,
  muhasebeBrain,
  tarihBrain,
  yayinciBrain,
  analistBrain,
  gozcuBrain,
  radarBrain,
  guvenlikBrain,
];

export const PREVIEW_BRAIN_BY_ID: Readonly<Record<PreviewBrainId, PreviewBrainProfile>> =
  Object.fromEntries(PREVIEW_BRAINS.map((brain) => [brain.id, brain])) as Record<PreviewBrainId, PreviewBrainProfile>;

export function getPreviewBrain(id: PreviewBrainId): PreviewBrainProfile {
  return PREVIEW_BRAIN_BY_ID[id];
}
