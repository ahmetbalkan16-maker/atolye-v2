import React from "react";
import type { V3Accessory, V3CastMember } from "../../../src/lib/v3/render/RenderPlanTypes";
import { Arm } from "./Arms";
import { HairBack, HairTop, Head } from "./Face";
import { CapeBack, CapeFront, GarmentBody, Legs, sleeveFor } from "./Garments";
import { fallTransform, type PerformerState } from "./motion";
import { HEAD_CY, HIP_Y, INK, NECK_Y, SHOULDER_Y } from "./rig";

/** How far a seated torso drops onto the seat. */
export const SEAT_DROP = 58;

export type AccessoryIndex = ReadonlyMap<string, V3Accessory>;

export function accessoryKey(pack: string, ref: string): string {
  return ref.includes("/") ? ref : `${pack}/${ref}`;
}

function markup(index: AccessoryIndex, pack: string, ref: string | undefined): V3Accessory | undefined {
  return ref ? index.get(accessoryKey(pack, ref)) : undefined;
}

/** A full character in character space (feet at the origin, facing +x). Placement and mirroring are the caller's. */
/** `cheap`: no blurred contact shadow (crowds of extras; forty blur filters per frame are slow to render). */
export function Character({ member, state, accessories, cheap = false }: { member: V3CastMember; state: PerformerState; accessories: AccessoryIndex; cheap?: boolean }) {
  const { costume, style } = member;
  const { pose } = state;
  const head = markup(accessories, costume.pack, costume.head);
  const beard = markup(accessories, costume.pack, costume.beard);
  const mustache = markup(accessories, costume.pack, costume.mustache);
  const back = markup(accessories, costume.pack, costume.back);
  const front = markup(accessories, costume.pack, costume.handFront);
  const rear = markup(accessories, costume.pack, costume.handBack);
  // A drawn haircut replaces the parametric hair; a chest piece (chain, sash, medals) goes over the garment.
  const hairPart = markup(accessories, costume.pack, costume.hairPart);
  const chest = markup(accessories, costume.pack, costume.chest);
  const hair = hairPart ? undefined : costume.hair;
  const sleeve = sleeveFor(costume);
  const drop = state.seated ? SEAT_DROP : 0;
  const inv = 1 / Math.sqrt(pose.squash);
  // Contact shadow keeps the feet on the floor; it shrinks and fades while the body is in the air.
  const lift = Math.max(0, -pose.bob);
  const shadowK = Math.max(0.5, 1 - lift / 150);
  // The Byzantine robe draws its own imperial cape.
  const cape = style === "kukla" && costume.cape && costume.garment !== "bizans" ? costume.cape : undefined;
  const bodyTransform = `translate(0 ${pose.bob + drop}) rotate(${pose.lean} 0 ${HIP_Y})`;
  // Struck down: the whole figure topples over backwards about its heels; the shadow stretches under the lying body.
  const fallen = state.fallen ?? 0;

  return (
    <g>
      <g transform={`translate(${-fallen * 25} 0) scale(${shadowK * (1 + fallen * 1.9)} ${shadowK})`} opacity={shadowK}>
        {cheap ? null : <ellipse cx={4} cy={0} rx={128} ry={26} fill="#120c18" opacity={0.32} filter="url(#v3-golge)" />}
        <ellipse cx={2} cy={-1} rx={84} ry={13} fill="#120c18" opacity={0.42} />
      </g>
      <g transform={`${fallen > 0 ? `${fallTransform(fallen)} ` : ""}scale(${inv} ${pose.squash})`}>
        {cape ? (
          <g transform={bodyTransform}>
            <CapeBack color={cape} seated={state.seated} />
          </g>
        ) : null}
        {/* Small bobs (walking, talking) move only the body; the feet leave the floor only in a real jump. */}
        <g transform={`translate(0 ${lift > 14 ? pose.bob : 0})`}>
          <Legs costume={costume} pose={pose} style={style} seated={state.seated} />
        </g>
        <g transform={bodyTransform}>
          {back ? <g transform={`translate(0 ${SHOULDER_Y})`} dangerouslySetInnerHTML={{ __html: back.markup }} /> : null}
          <GarmentBody costume={costume} style={style} seated={state.seated} />
          {cape ? <CapeFront color={cape} /> : null}
          {chest ? <g transform={`translate(0 ${SHOULDER_Y})`} dangerouslySetInnerHTML={{ __html: chest.markup }} /> : null}
          {style === "cop" ? <path d={`M0 ${SHOULDER_Y - 4} L0 ${NECK_Y - 8}`} stroke={INK} strokeWidth={12} strokeLinecap="round" /> : null}
          <g transform={`rotate(${pose.headTilt} 0 ${NECK_Y}) translate(0 ${HEAD_CY})`}>
            {head?.behind ? <g dangerouslySetInnerHTML={{ __html: head.markup }} /> : null}
            {hairPart?.behind ? <g dangerouslySetInnerHTML={{ __html: hairPart.markup }} /> : null}
            {hair ? <HairBack hair={hair} /> : null}
            <Head emotion={state.emotion} viseme={state.viseme} eyesClosed={state.eyesClosed} brows={state.brows} beard={beard?.markup} mustache={mustache?.markup} {...(costume.look ? { look: costume.look } : {})} />
            {hair ? <HairTop hair={hair} /> : null}
            {hairPart && !hairPart.behind ? <g dangerouslySetInnerHTML={{ __html: hairPart.markup }} /> : null}
            {head && !head.behind ? <g dangerouslySetInnerHTML={{ __html: head.markup }} /> : null}
          </g>
          <Arm side={-1} angles={pose.armBack} hand={pose.handBack} sleeve={sleeve} style={style} item={rear?.markup} grip={rear?.grip} />
          <Arm side={1} angles={pose.armFront} hand={pose.handFront} sleeve={sleeve} style={style} item={front?.markup} grip={front?.grip} />
        </g>
      </g>
    </g>
  );
}
