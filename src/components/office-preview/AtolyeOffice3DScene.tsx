"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { getPreviewBrain } from "@/lib/office-preview/brains";
import type { PreviewBrainId } from "@/lib/office-preview/roleTypes";

type Props = {
  selectedBrainId: PreviewBrainId;
  onSelectBrain: (id: PreviewBrainId) => void;
  /** Sample status per brain from the scripted flow; brains not listed are shown as "bekliyor". */
  statuses?: Partial<Record<PreviewBrainId, OfficeWorkerStatus>>;
};

type Stage = "work" | "rest" | "rise" | "walk-out" | "inspect" | "wait" | "talk" | "coffee" | "lounge" | "walk-back" | "sit";
type WorkerSpec = {
  key: string;
  brainId: PreviewBrainId;
  x: number;
  z: number;
  deskX?: number;
  deskZ?: number;
  accent: string;
  pair?: string;
  pairSlot?: number;
  focusX?: number;
  focusZ?: number;
  homeYaw?: number;
  seatOffset?: number;
  firstMove: number;
};

type WorkerRig = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group[];
  mouth: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  chair?: THREE.Group;
  selectedRing: THREE.Mesh;
  statusDisc: THREE.Mesh;
  spec: WorkerSpec;
  stage: Stage;
  stageAt: number;
  nextMoveAt: number;
  path: THREE.Vector3[];
  pathIndex: number;
  gait: number;
  talkStarted: boolean;
  destination?: THREE.Vector3;
  taskTripsSinceBreak: number;
  loungeQueued: boolean;
  loungeSeatIndex?: number;
  tripKind: "task" | "lounge";
};

const FLOOR_Y = 0;
const AISLE_Z = 1.1;
// Ambient walks are rare so desks are mostly occupied; a worker the sample flow marks busy never leaves its desk.
const PERIOD = 64;
const PAIR_TALK_DISTANCE = 2.45;
const TASK_TRIPS_BEFORE_BREAK = 2;
const LOUNGE_BREAK_SECONDS = 12;
const LOUNGE_SEATS = [
  { x: -10.05, z: 5.05 },
  { x: -8.28, z: 5.05 },
] as const;

const WORKERS: readonly WorkerSpec[] = [
  { key: "ayas-director", brainId: "ayas", x: 0, z: -0.65, deskX: 0, deskZ: -1.5, accent: "#41d9de", focusX: 1.65, focusZ: -0.4, firstMove: 9 },
  { key: "researcher", brainId: "arastirma", x: -9, z: -5.55, deskX: -9, deskZ: -6.25, accent: "#6dd7ff", pair: "research-review", pairSlot: 0, firstMove: 7 },
  { key: "editor", brainId: "kurgu", x: -2.9, z: -5.55, deskX: -2.9, deskZ: -6.25, accent: "#ffbd70", pair: "creative-review", pairSlot: 0, firstMove: 13 },
  { key: "humorist", brainId: "mizah", x: -0.9, z: -5.55, deskX: -0.9, deskZ: -6.25, accent: "#ed76d5", pair: "creative-review", pairSlot: 1, firstMove: 13 },
  { key: "costumer", brainId: "kostum", x: 8, z: -5.55, deskX: 8, deskZ: -6.25, accent: "#f3a58e", pair: "costume-review", pairSlot: 0, firstMove: 18 },
  { key: "environment", brainId: "ortam", x: -9, z: -0.3, deskX: -9, deskZ: -1.05, accent: "#81d49c", pair: "research-review", pairSlot: 1, firstMove: 7 },
  { key: "accountant", brainId: "muhasebe", x: 9, z: -0.3, deskX: 9, deskZ: -1.05, accent: "#e2c578", focusX: 10.45, focusZ: -0.25, firstMove: 19 },
  { key: "developer", brainId: "gelistirici", x: 7, z: 4.85, deskX: 7, deskZ: 4.1, accent: "#82b4ff", pair: "development", pairSlot: 0, firstMove: 15 },
  { key: "apprentice", brainId: "cirak", x: 9.7, z: 4.85, deskX: 9.7, deskZ: 4.1, accent: "#a5a7ff", pair: "development", pairSlot: 1, firstMove: 15 },
  { key: "sound", brainId: "ses", x: -3.5, z: 5.05, deskX: -3.5, deskZ: 4.25, accent: "#8ed5d2", pair: "sound-review", pairSlot: 0, firstMove: 23 },
  { key: "auditor", brainId: "denetci", x: -0.45, z: 5.05, deskX: -0.45, deskZ: 4.25, accent: "#70e4c0", pair: "sound-review", pairSlot: 1, firstMove: 23 },
  { key: "quality", brainId: "kalite", x: 5.85, z: -5.55, deskX: 5.85, deskZ: -6.25, accent: "#54d8ad", pair: "costume-review", pairSlot: 1, firstMove: 18 },
  { key: "repair", brainId: "onarim", x: 10, z: 1.25, deskX: 10, deskZ: 0.45, accent: "#f0a85f", focusX: 11.05, focusZ: 1.55, firstMove: 27 },
];

/** Sample-only status shown above each worker; the preview page derives it from the scripted scenario step. */
export type OfficeWorkerStatus = "bekliyor" | "calisiyor" | "denetliyor" | "yonetiyor" | "bitti";
export const OFFICE_STATUS_LABEL: Record<OfficeWorkerStatus, string> = {
  bekliyor: "bekliyor",
  calisiyor: "çalışıyor",
  denetliyor: "denetliyor",
  yonetiyor: "yönetiyor",
  bitti: "bitti",
};
const SHORT_NAME: Record<PreviewBrainId, string> = {
  ayas: "AYAS", arastirma: "Araştırma", kurgu: "Kurgu", mizah: "Mizah", kostum: "Kostüm", ortam: "Ortam", ses: "Ses",
  kalite: "Kalite", onarim: "Onarım", gelistirici: "Geliştirici", cirak: "Çırak", denetci: "Denetçi", muhasebe: "Muhasebe",
};
const STATUS_COLOR: Record<OfficeWorkerStatus, string> = {
  bekliyor: "#9aa4ad",
  calisiyor: "#3b8ef3",
  denetliyor: "#f2b630",
  yonetiyor: "#a66cf0",
  bitti: "#34c472",
};

// One floor colour and one floor-level name per room. Names are drawn as screen overlays (never mirrored, always
// readable) at the room's front edge; floor tints follow the department accent so rooms read apart at a glance.
const ROOMS: readonly { name: string; x: number; z: number; sx: number; sz: number; floor: string; gold?: boolean }[] = [
  { name: "ARAŞTIRMA", x: -8.9, z: -5.3, sx: 5.75, sz: 5.15, floor: "#dbe7f1" },
  { name: "KURGU & MİZAH", x: -1.7, z: -5.3, sx: 8.05, sz: 5.15, floor: "#f3e2cf" },
  { name: "KOSTÜM & KALİTE", x: 7.2, z: -5.3, sx: 9.0, sz: 5.15, floor: "#f1dde2" },
  { name: "ORTAM & GÖRSEL", x: -8.9, z: -0.25, sx: 5.75, sz: 4.3, floor: "#dcebdc" },
  { name: "AYAS · YÖNETİM", x: -0.45, z: -0.25, sx: 10.65, sz: 4.3, floor: "#efe5c9", gold: true },
  { name: "MUHASEBE", x: 8.45, z: -1.25, sx: 6.55, sz: 2.25, floor: "#ece5cc" },
  { name: "MONTAJ & ONARIM", x: 8.45, z: 1.05, sx: 6.55, sz: 1.75, floor: "#e1e5e8" },
  { name: "DİNLENME", x: -8.9, z: 5.05, sx: 5.75, sz: 5.8, floor: "#eee2cf" },
  { name: "SES STÜDYOSU", x: -3.5, z: 5.05, sx: 4.55, sz: 5.8, floor: "#e4dff1" },
  { name: "TOPLANTI & DENETİM", x: 1.95, z: 5.05, sx: 5.85, sz: 5.8, floor: "#e8e3d7" },
  { name: "YAZILIM & GELİŞTİRME", x: 8.45, z: 5.05, sx: 6.55, sz: 5.8, floor: "#dce5f0" },
];

const PAIR_TARGETS: Record<string, readonly [readonly [number, number], readonly [number, number]]> = {
  "research-review": [[-10, -3.25], [-8.5, -3.25]],
  "creative-review": [[-3.1, -4.2], [-1.25, -4.2]],
  "costume-review": [[7.2, -4.2], [8.9, -4.2]],
  development: [[7, 6.15], [9.55, 6.15]],
  "sound-review": [[-2.8, 5.9], [-0.9, 5.9]],
};

const mat = (color: THREE.ColorRepresentation, roughness = 0.78, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function makeCarpetTileTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    const tileSize = 128;
    const tileColors = ["#f3f0e8", "#f5f2eb", "#f1eee6", "#f4f1e9"];
    context.fillStyle = "#f3f0e8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const tileX = column * tileSize;
        const tileY = row * tileSize;
        context.fillStyle = tileColors[(row * 3 + column) % tileColors.length]!;
        context.fillRect(tileX, tileY, tileSize, tileSize);
        for (let fiber = 0; fiber < 80; fiber += 1) {
          const x = tileX + ((fiber * 37 + row * 17 + column * 29) % tileSize);
          const y = tileY + ((fiber * 61 + row * 31 + column * 11) % tileSize);
          context.strokeStyle = fiber % 3 === 0 ? "rgba(110, 101, 87, 0.055)" : "rgba(255, 255, 255, 0.14)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x + 3 + (fiber % 6), y + ((fiber % 3) - 1));
          context.stroke();
        }
      }
    }
    context.strokeStyle = "rgba(104, 94, 78, 0.16)";
    context.lineWidth = 1.5;
    for (let seam = 0; seam <= 4; seam += 1) {
      const offset = seam * tileSize;
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset, canvas.height);
      context.moveTo(0, offset);
      context.lineTo(canvas.width, offset);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function makeContactShadowFactory(textures: THREE.Texture[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 10, 64, 64, 62);
    gradient.addColorStop(0, "rgba(43, 36, 29, 0.24)");
    gradient.addColorStop(0.48, "rgba(43, 36, 29, 0.13)");
    gradient.addColorStop(1, "rgba(43, 36, 29, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  textures.push(texture);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  return (parent: THREE.Object3D, x: number, z: number, width: number, depth: number) => {
    const shadow = new THREE.Mesh(geometry, material);
    shadow.name = "soft furniture contact shadow";
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, FLOOR_Y + 0.032, z);
    shadow.scale.set(width, depth, 1);
    shadow.renderOrder = 1;
    parent.add(shadow);
  };
}

function rounded(value: number): string {
  return value.toFixed(2);
}

function makeBoxFactory() {
  const geometries = new Map<string, THREE.BoxGeometry>();
  return (parent: THREE.Object3D, name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material) => {
    const key = `${rounded(sx)}:${rounded(sy)}:${rounded(sz)}`;
    let geometry = geometries.get(key);
    if (!geometry) {
      geometry = new THREE.BoxGeometry(sx, sy, sz);
      geometries.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  };
}

function makeSphereFactory() {
  const geometries = new Map<string, THREE.SphereGeometry>();
  return (parent: THREE.Object3D, name: string, x: number, y: number, z: number, radius: number, material: THREE.Material, widthSegments = 12, heightSegments = 8) => {
    const key = `${rounded(radius)}:${widthSegments}:${heightSegments}`;
    let geometry = geometries.get(key);
    if (!geometry) {
      geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
      geometries.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
}

function addRoomPanel(
  box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, textures: THREE.Texture[], carpetTexture: THREE.Texture,
  x: number, z: number, sx: number, sz: number, color: string,
) {
  box(parent, "soft department floor base", x, FLOOR_Y + 0.012, z, sx, 0.024, sz, mat(color, 0.97));
  const carpet = carpetTexture.clone();
  carpet.repeat.set(sx / 4.8, sz / 4.8);
  carpet.needsUpdate = true;
  textures.push(carpet);
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshStandardMaterial({ color, map: carpet, roughness: 0.98, metalness: 0 }),
  );
  surface.name = "textured modular office carpet";
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(x, FLOOR_Y + 0.027, z);
  parent.add(surface);
}

function addPlant(box: ReturnType<typeof makeBoxFactory>, sphere: ReturnType<typeof makeSphereFactory>, parent: THREE.Object3D, x: number, z: number) {
  const pot = mat("#b8a48c", 0.82);
  const soil = mat("#554032", 1);
  const leaves = ["#507c53", "#638b5b", "#3e6848"].map((color) => mat(color, 0.88));
  box(parent, "plant pot", x, 0.23, z, 0.43, 0.44, 0.43, pot);
  box(parent, "plant soil", x, 0.46, z, 0.35, 0.05, 0.35, soil);
  const stem = mat("#476b4d", 1);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const leaf = sphere(parent, "plant leaf", x + Math.cos(angle) * 0.18, 0.77 + (i % 2) * 0.12, z + Math.sin(angle) * 0.18, 0.2, leaves[i % leaves.length]!);
    leaf.scale.set(0.78, 1.45, 0.62);
    leaf.rotation.z = Math.cos(angle) * -0.28;
    leaf.rotation.x = Math.sin(angle) * 0.22;
  }
  box(parent, "plant stem", x, 0.68, z, 0.07, 0.48, 0.07, stem);
  const crown = sphere(parent, "plant crown", x, 1.05, z, 0.24, leaves[1]!);
  crown.scale.set(0.85, 1.15, 0.86);
}

function addDesk(
  box: ReturnType<typeof makeBoxFactory>,
  parent: THREE.Object3D,
  x: number,
  z: number,
  accent: string,
  options: { wide?: boolean; ledgers?: boolean; audio?: boolean; costume?: boolean } = {},
) {
  const wood = mat("#805d42", 0.64);
  const edge = mat("#b88d61", 0.54);
  const leg = mat("#443c35", 0.46, 0.18);
  const screen = mat("#122630", 0.34, 0.15);
  const brass = mat("#7d6a4e", 0.48, 0.34);
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.34, roughness: 0.46 });
  const width = options.wide ? 1.95 : 1.45;
  box(parent, "work desk top", x, 0.88, z, width, 0.13, 0.74, wood);
  box(parent, "desk front edge", x, 0.84, z + 0.37, width, 0.07, 0.06, edge);
  for (const dx of [-width / 2 + 0.08, width / 2 - 0.08]) {
    for (const dz of [-0.27, 0.27]) box(parent, "desk leg", x + dx, 0.43, z + dz, 0.07, 0.82, 0.07, leg);
  }
  if (options.ledgers) {
    box(parent, "accounting ledger", x - 0.32, 0.97, z + 0.14, 0.47, 0.045, 0.34, mat("#d8c89e", 0.95));
    box(parent, "accounting calculator", x + 0.42, 0.99, z + 0.1, 0.3, 0.08, 0.22, screen);
    box(parent, "accounting receipt stack", x - 0.55, 1.0, z + 0.21, 0.28, 0.035, 0.2, mat("#f2ead5", 0.92));
    box(parent, "accounting folder tab", x - 0.52, 1.025, z + 0.12, 0.14, 0.012, 0.035, mat("#d1a95e", 0.76));
  }
  if (options.audio) {
    box(parent, "audio mixer", x - 0.2, 1.02, z + 0.02, 0.58, 0.16, 0.32, screen);
    for (let i = 0; i < 5; i += 1) box(parent, "mixer fader", x - 0.4 + i * 0.1, 1.12, z + 0.02, 0.026, 0.12 + (i % 2) * 0.05, 0.035, glow);
  } else {
    box(parent, "monitor stand foot", x, 0.975, z - 0.2, 0.34, 0.035, 0.2, leg);
    box(parent, "monitor stand neck", x, 1.035, z - 0.2, 0.07, 0.11, 0.055, leg);
    box(parent, "monitor case", x, 1.3, z - 0.2, options.wide ? 0.95 : 0.74, 0.46, 0.08, leg);
    box(parent, "monitor glass", x, 1.31, z - 0.15, options.wide ? 0.84 : 0.64, 0.37, 0.012, screen);
    box(parent, "monitor status light", x, 1.073, z - 0.14, 0.26, 0.014, 0.014, glow);
  }
  box(parent, "keyboard", x, 0.98, z + 0.18, 0.56, 0.035, 0.18, screen);
  const paper = mat("#e9e4d8", 0.9);
  const lamp = new THREE.MeshStandardMaterial({ color: "#f1d9a8", emissive: "#d2964c", emissiveIntensity: 0.2, roughness: 0.56 });
  box(parent, "desk paper tray", x - width / 2 + 0.25, 0.98, z + 0.16, 0.34, 0.045, 0.24, paper);
  box(parent, "desk notebook", x - width / 2 + 0.26, 1.015, z + 0.15, 0.29, 0.025, 0.2, mat("#9aa99a", 0.94));
  box(parent, "desk blotter", x + 0.39, 0.963, z + 0.18, 0.45, 0.018, 0.29, mat("#45524d", 0.94));
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 7), mat("#cbc6b9", 0.52, 0.04));
  mouse.name = "ergonomic desk mouse";
  mouse.position.set(x + 0.43, 1.025, z + 0.19);
  mouse.scale.set(0.7, 0.34, 1.0);
  parent.add(mouse);
  const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 6), mat("#455e67", 0.38, 0.22));
  pen.name = "desk pen";
  pen.rotation.x = Math.PI / 2;
  pen.position.set(x - width / 2 + 0.52, 1.04, z + 0.31);
  parent.add(pen);
  const lampX = x + width / 2 - 0.2;
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.045, 10), brass);
  lampBase.name = "brass desk lamp base";
  lampBase.position.set(lampX, 0.99, z - 0.18);
  parent.add(lampBase);
  box(parent, "desk lamp lower arm", lampX, 1.105, z - 0.18, 0.032, 0.22, 0.032, brass);
  const lampUpperArm = box(parent, "desk lamp adjustable upper arm", lampX - 0.075, 1.32, z - 0.18, 0.027, 0.23, 0.027, brass);
  lampUpperArm.rotation.z = 0.38;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.13, 10, 1, true), lamp);
  shade.name = "warm desk lamp shade";
  shade.position.set(lampX - 0.16, 1.43, z - 0.18);
  shade.rotation.z = -0.18;
  parent.add(shade);
  const mugX = x - width / 2 + 0.23;
  const mugZ = z - 0.19;
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.065, 0.14, 10), mat("#ece4d5", 0.5));
  mug.name = "desk coffee mug";
  mug.position.set(mugX, 1.07, mugZ);
  parent.add(mug);
  const mugHandle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10), mat("#ece4d5", 0.5));
  mugHandle.name = "desk coffee mug handle";
  mugHandle.position.set(mugX - 0.075, 1.075, mugZ);
  parent.add(mugHandle);
  if (options.costume) {
    box(parent, "cutting mat", x + 1.28, 0.63, z - 0.55, 0.95, 0.06, 0.72, mat("#5e8580", 0.88));
    box(parent, "fabric roll", x + 1.22, 0.96, z - 0.55, 0.62, 0.11, 0.16, mat("#e8d7be", 0.95));
    box(parent, "tailor's folded fabric swatches", x + 0.02, 1.0, z + 0.1, 0.28, 0.045, 0.22, mat("#b28b77", 0.96));
    box(parent, "sewing machine base", x - 0.2, 1.0, z - 0.25, 0.54, 0.09, 0.28, mat("#ddd7ca", 0.48, 0.08));
    box(parent, "sewing machine head", x - 0.05, 1.17, z - 0.27, 0.19, 0.28, 0.1, mat("#e9e5dc", 0.42, 0.08));
    box(parent, "sewing machine arm", x + 0.06, 1.25, z - 0.27, 0.34, 0.08, 0.1, mat("#e9e5dc", 0.42, 0.08));
    const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.15, 8), mat("#d7bd8a", 0.86));
    thread.name = "tailor thread spool";
    thread.position.set(x + 0.26, 1.09, z - 0.24);
    parent.add(thread);
  }
  if (options.audio) {
    const headphoneBand = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14, Math.PI), mat("#252c31", 0.48, 0.12));
    headphoneBand.name = "studio monitoring headphones";
    headphoneBand.rotation.z = Math.PI;
    headphoneBand.position.set(x + 0.43, 1.1, z + 0.18);
    parent.add(headphoneBand);
    for (const side of [-1, 1]) box(parent, "headphone ear cup", x + 0.43 + side * 0.15, 1.08, z + 0.18, 0.08, 0.12, 0.07, mat("#37454b", 0.44, 0.18));
  }
}

function addOfficeLinearLight(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x: number, z: number) {
  // Light housings hang above the rooms; a pale finish keeps them from reading as black bars in the top-down view.
  const housing = mat("#ece6da", 0.5, 0.1);
  const diffuser = new THREE.MeshStandardMaterial({ color: "#fff6dd", emissive: "#ffd894", emissiveIntensity: 0.55, roughness: 0.34 });
  for (const dx of [-0.56, 0.56]) box(parent, "suspended light cable", x + dx, 3.68, z, 0.025, 0.34, 0.025, housing);
  box(parent, "suspended office light housing", x, 3.49, z, 1.38, 0.1, 0.32, housing);
  box(parent, "warm linear light diffuser", x, 3.425, z, 1.2, 0.035, 0.22, diffuser);
}

function addFilingCabinet(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x: number, z: number, labelColor: string) {
  const body = mat("#77786f", 0.62, 0.18);
  const drawer = mat("#9a9a8c", 0.54, 0.12);
  const handle = mat("#4d514e", 0.36, 0.52);
  box(parent, "steel office filing cabinet", x, 0.72, z, 0.9, 1.42, 0.56, body);
  for (let i = 0; i < 3; i += 1) {
    const y = 0.28 + i * 0.43;
    box(parent, "filing cabinet drawer face", x, y, z + 0.29, 0.78, 0.38, 0.05, drawer);
    box(parent, "filing cabinet label slot", x - 0.22, y + 0.04, z + 0.322, 0.16, 0.055, 0.012, mat(labelColor, 0.72));
    box(parent, "filing cabinet pull handle", x + 0.12, y + 0.04, z + 0.33, 0.19, 0.035, 0.035, handle);
  }
  for (const dx of [-0.2, 0.05, 0.3]) box(parent, "folder peeking from cabinet", x + dx, 1.48, z - 0.08, 0.17, 0.22, 0.24, mat(dx < 0 ? "#bb9a63" : "#7c9b91", 0.9));
}

function addWardrobeRail(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x: number, z: number) {
  const metal = mat("#5a554d", 0.42, 0.36);
  box(parent, "wardrobe rail post left", x - 0.82, 0.88, z, 0.055, 1.72, 0.055, metal);
  box(parent, "wardrobe rail post right", x + 0.82, 0.88, z, 0.055, 1.72, 0.055, metal);
  box(parent, "wardrobe rail crossbar", x, 1.68, z, 1.72, 0.055, 0.055, metal);
  for (let i = 0; i < 4; i += 1) {
    const garmentX = x - 0.57 + i * 0.38;
    const colors = ["#546c76", "#b08b6b", "#687c68", "#9c7367"];
    box(parent, "tailored hanging garment", garmentX, 1.04, z + 0.02, 0.3, 0.78, 0.13, mat(colors[i]!, 0.91));
    box(parent, "garment collar", garmentX, 1.39, z + 0.095, 0.15, 0.1, 0.025, mat("#d6c9b5", 0.95));
    box(parent, "clothes hanger hook", garmentX, 1.52, z - 0.01, 0.03, 0.17, 0.03, metal);
  }
  box(parent, "wardrobe rack base left", x - 0.82, 0.08, z, 0.1, 0.1, 0.58, metal);
  box(parent, "wardrobe rack base right", x + 0.82, 0.08, z, 0.1, 0.1, 0.58, metal);
}

function addAcousticPanels(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D) {
  const panelColors = ["#48535a", "#58615e", "#414d54"];
  for (const [i, z] of [2.85, 4.1, 7.2].entries()) {
    box(parent, "sound studio acoustic panel", -1.14, 1.32, z, 0.08, 0.94, 0.7, mat(panelColors[i]!, 0.96));
    for (let rib = -1; rib <= 1; rib += 1) box(parent, "acoustic panel rib", -1.085, 1.32, z + rib * 0.18, 0.035, 0.82, 0.035, mat("#313a3f", 0.98));
  }
}

function addCoffeeCorner(box: ReturnType<typeof makeBoxFactory>, sphere: ReturnType<typeof makeSphereFactory>, parent: THREE.Object3D) {
  const wood = mat("#806147", 0.65);
  const machine = mat("#ece6da", 0.37, 0.08);
  const dark = mat("#26353a", 0.42);
  const steam = new THREE.MeshBasicMaterial({ color: "#f8f3e4", transparent: true, opacity: 0.52 });
  const x = -10.4;
  const z = 2.9;
  box(parent, "coffee counter", x, 0.48, z, 2.1, 0.96, 0.62, wood);
  box(parent, "coffee counter top", x, 0.99, z, 2.18, 0.1, 0.7, mat("#c7a47b", 0.56));
  box(parent, "coffee machine", x - 0.25, 1.45, z - 0.08, 0.67, 0.77, 0.52, machine);
  box(parent, "coffee machine display", x - 0.25, 1.55, z - 0.37, 0.28, 0.16, 0.025, dark);
  box(parent, "coffee cup", x + 0.23, 1.16, z - 0.23, 0.16, 0.27, 0.16, mat("#f0e9dc", 0.5));
  sphere(parent, "coffee steam", x + 0.22, 1.38, z - 0.23, 0.035, steam);
}

function addSofa(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x: number, z: number) {
  const leather = mat("#8c553b", 0.82);
  const cushion = mat("#b37d58", 0.92);
  const leg = mat("#5c4638", 0.64);
  box(parent, "sofa base", x, 0.29, z, 3.6, 0.42, 1.15, leather);
  box(parent, "sofa back", x, 0.79, z - 0.48, 3.6, 0.82, 0.24, leather);
  box(parent, "sofa arm left", x - 1.68, 0.56, z, 0.24, 0.6, 1.15, leather);
  box(parent, "sofa arm right", x + 1.68, 0.56, z, 0.24, 0.6, 1.15, leather);
  box(parent, "sofa cushion left", x - 0.83, 0.565, z + 0.06, 1.36, 0.13, 0.82, cushion);
  box(parent, "sofa cushion right", x + 0.83, 0.565, z + 0.06, 1.36, 0.13, 0.82, cushion);
  const pillow = mat("#d7c5a7", 0.94);
  const leftPillow = box(parent, "lounge sofa accent pillow left", x - 1.12, 0.88, z - 0.29, 0.48, 0.36, 0.16, pillow);
  leftPillow.rotation.z = -0.12;
  const rightPillow = box(parent, "lounge sofa accent pillow right", x + 1.12, 0.88, z - 0.29, 0.48, 0.36, 0.16, mat("#82928a", 0.94));
  rightPillow.rotation.z = 0.12;
  for (const dx of [-1.4, 1.4]) box(parent, "sofa foot", x + dx, 0.07, z + 0.35, 0.12, 0.14, 0.12, leg);
  box(parent, "coffee table top", x, 0.48, z + 1.35, 1.55, 0.12, 0.78, mat("#8f6647", 0.56));
  for (const dx of [-0.58, 0.58]) box(parent, "coffee table leg", x + dx, 0.24, z + 1.35, 0.08, 0.42, 0.08, leg);
  box(parent, "lounge magazines", x - 0.32, 0.56, z + 1.32, 0.42, 0.025, 0.28, mat("#e4d9c6", 0.92));
  box(parent, "magazine cover", x - 0.32, 0.578, z + 1.32, 0.4, 0.012, 0.26, mat("#738e86", 0.88));
  const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12), mat("#ded4c3", 0.48));
  saucer.name = "lounge coffee saucer";
  saucer.position.set(x + 0.4, 0.56, z + 1.32);
  parent.add(saucer);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.12, 10), mat("#eee7d9", 0.42));
  cup.name = "lounge tea cup";
  cup.position.set(x + 0.4, 0.63, z + 1.32);
  parent.add(cup);
  box(parent, "lounge cup handle", x + 0.49, 0.64, z + 1.32, 0.07, 0.035, 0.035, mat("#ded4c3", 0.45));
}

function addRug(parent: THREE.Object3D, x: number, z: number, radiusX: number, radiusZ: number, color: string) {
  const width = radiusX * 2;
  const depth = radiusZ * 2;
  const corner = Math.min(0.24, radiusX * 0.18, radiusZ * 0.18);
  const shape = new THREE.Shape();
  shape.moveTo(-radiusX + corner, -radiusZ);
  shape.lineTo(radiusX - corner, -radiusZ);
  shape.quadraticCurveTo(radiusX, -radiusZ, radiusX, -radiusZ + corner);
  shape.lineTo(radiusX, radiusZ - corner);
  shape.quadraticCurveTo(radiusX, radiusZ, radiusX - corner, radiusZ);
  shape.lineTo(-radiusX + corner, radiusZ);
  shape.quadraticCurveTo(-radiusX, radiusZ, -radiusX, radiusZ - corner);
  shape.lineTo(-radiusX, -radiusZ + corner);
  shape.quadraticCurveTo(-radiusX, -radiusZ, -radiusX + corner, -radiusZ);
  const geometry = new THREE.ShapeGeometry(shape, 4);
  geometry.rotateX(-Math.PI / 2);
  const rug = new THREE.Mesh(geometry, mat(color, 0.98));
  rug.name = "rounded rectangular office rug";
  rug.scale.set(width / (radiusX * 2), 1, depth / (radiusZ * 2));
  rug.position.set(x, 0.045, z);
  parent.add(rug);
}

function addFloorLamp(box: ReturnType<typeof makeBoxFactory>, sphere: ReturnType<typeof makeSphereFactory>, parent: THREE.Object3D, x: number, z: number) {
  const metal = mat("#6b6a5e", 0.42, 0.34);
  const shade = mat("#d9c19a", 0.62);
  const bulb = new THREE.MeshStandardMaterial({ color: "#ffe3a5", emissive: "#ffbb5d", emissiveIntensity: 0.42, roughness: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 10), metal);
  base.position.set(x, 0.08, z);
  parent.add(base);
  box(parent, "warm floor lamp stem", x, 0.84, z, 0.065, 1.5, 0.065, metal);
  box(parent, "floor lamp shade", x, 1.58, z, 0.52, 0.22, 0.48, shade);
  sphere(parent, "floor lamp warm bulb", x, 1.43, z, 0.12, bulb, 8, 6);
}

function addMeetingTable(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x = 7.4, z = 5.25) {
  const top = mat("#8d684d", 0.56);
  const chair = mat("#536c67", 0.82);
  const leg = mat("#514b43", 0.4, 0.2);
  box(parent, "meeting table top", x, 0.88, z, 3.35, 0.15, 1.22, top);
  for (const dx of [-1.35, 1.35]) for (const dz of [-0.4, 0.4]) box(parent, "meeting table leg", x + dx, 0.44, z + dz, 0.08, 0.84, 0.08, leg);
  for (const dx of [-1.3, 0, 1.3]) {
    box(parent, "meeting chair seat", x + dx, 0.47, z + 1.07, 0.58, 0.13, 0.55, chair);
    box(parent, "meeting chair back", x + dx, 0.88, z + 1.31, 0.58, 0.7, 0.14, chair);
    box(parent, "meeting chair stem", x + dx, 0.22, z + 1.07, 0.08, 0.42, 0.08, leg);
    box(parent, "meeting chair seat opposite", x + dx, 0.47, z - 1.07, 0.58, 0.13, 0.55, chair);
    box(parent, "meeting chair back opposite", x + dx, 0.88, z - 1.31, 0.58, 0.7, 0.14, chair);
    box(parent, "meeting chair stem opposite", x + dx, 0.22, z - 1.07, 0.08, 0.42, 0.08, leg);
  }
  const laptop = mat("#4c514f", 0.34, 0.38);
  const laptopScreen = mat("#18262a", 0.3, 0.16);
  box(parent, "meeting laptop keyboard base", x - 0.82, 0.99, z - 0.15, 0.68, 0.045, 0.48, laptop);
  const laptopDisplay = box(parent, "meeting laptop open display", x - 0.82, 1.24, z - 0.35, 0.66, 0.48, 0.045, laptopScreen);
  laptopDisplay.rotation.x = -0.12;
  box(parent, "meeting agenda papers", x + 0.54, 0.99, z + 0.12, 0.62, 0.035, 0.42, mat("#eee6d6", 0.92));
  box(parent, "meeting agenda folder", x + 0.56, 1.015, z + 0.1, 0.48, 0.025, 0.34, mat("#81928a", 0.86));
  box(parent, "meeting water carafe", x + 1.18, 1.11, z - 0.12, 0.17, 0.34, 0.17, mat("#94b9b2", 0.2, 0.12));
  for (const dx of [-0.25, 0.85]) box(parent, "meeting water glass", x + dx, 1.04, z + 0.37, 0.1, 0.16, 0.1, mat("#c7ded7", 0.2, 0.08));
  const whiteboardX = x + 1.55;
  box(parent, "meeting-room planning board", whiteboardX, 1.55, z - 2.9, 2.2, 1.2, 0.1, mat("#d2c9b6", 0.86));
  const noteColors = ["#e7c66f", "#78c8bd", "#db8e77", "#93adcf"];
  for (let i = 0; i < noteColors.length; i += 1) {
    box(parent, "meeting planning note", whiteboardX - 0.65 + (i % 2) * 0.52, 1.72 - Math.floor(i / 2) * 0.35, z - 2.95, 0.25, 0.2, 0.02, mat(noteColors[i]!));
  }
  box(parent, "whiteboard marker tray", whiteboardX, 0.94, z - 2.82, 0.78, 0.07, 0.12, mat("#6c6b62", 0.56, 0.2));
  for (let i = 0; i < 3; i += 1) box(parent, "whiteboard marker", whiteboardX - 0.22 + i * 0.22, 1.0, z - 2.82, 0.15, 0.025, 0.025, mat(["#4a6e78", "#a05f55", "#51565a"][i]!, 0.54));
}

function addPlantAndWindows(box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D) {
  const frame = mat("#5b4c3e", 0.5, 0.14);
  const glass = new THREE.MeshStandardMaterial({ color: "#98b8aa", transparent: true, opacity: 0.38, roughness: 0.26, metalness: 0.08 });
  box(parent, "soft garden view outside the windows", 0, 2.1, -8.38, 24.2, 4.2, 0.08, mat("#a9c0b5", 0.98));
  box(parent, "garden hedge beyond the windows", 0, 0.82, -8.32, 24.1, 1.25, 0.08, mat("#6f8b67", 0.95));
  box(parent, "distant garden path", 0, 0.33, -8.28, 24.1, 0.12, 0.08, mat("#b8a58a", 0.96));
  for (let i = 0; i < 7; i += 1) {
    const x = -10.6 + i * 3.5;
    const foliage = mat(i % 2 ? "#75966d" : "#5e815f", 0.96);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.68 + (i % 3) * 0.08, 10, 7), foliage);
    crown.name = "garden tree beyond the windows";
    crown.position.set(x, 1.55 + (i % 2) * 0.2, -8.22);
    parent.add(crown);
  }
  for (let i = 0; i < 6; i += 1) {
    const x = -10 + i * 4;
    box(parent, "office window glass", x, 2.02, -8.1, 3.8, 4.04, 0.12, glass);
    box(parent, "window frame upright", x - 1.95, 2.02, -8.02, 0.12, 4.12, 0.2, frame);
    box(parent, "window frame upright", x + 1.95, 2.02, -8.02, 0.12, 4.12, 0.2, frame);
    box(parent, "window frame crossbar", x, 2.1, -8.02, 3.9, 0.1, 0.2, frame);
  }
}

function addCourtyardDecoration(
  box: ReturnType<typeof makeBoxFactory>, sphere: ReturnType<typeof makeSphereFactory>, parent: THREE.Object3D,
) {
  const paving = mat("#b7aa91", 0.94);
  const planterStone = mat("#8c8271", 0.86);
  const soil = mat("#4c4335", 1);
  const bark = mat("#68513d", 0.96);
  const foliage = ["#567b4c", "#6f8d57", "#3f6849"].map((color) => mat(color, 0.97));
  for (const side of [-1, 1] as const) {
    const x = side * 12.48;
    box(parent, "side courtyard stone path", x, 0.035, 0, 0.82, 0.07, 15.9, paving);
    box(parent, "side raised planting bed", side * 13.08, 0.31, 0, 0.52, 0.62, 15.5, planterStone);
    box(parent, "side planting soil", side * 13.08, 0.64, 0, 0.43, 0.06, 15.35, soil);
    for (const z of [-6.2, -2.15, 2.15, 6.2]) {
      const treeX = side * 13.08;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.17, 1.3, 7), bark);
      trunk.name = "courtyard tapered tree trunk";
      trunk.position.set(treeX, 1.26, z);
      parent.add(trunk);
      const crown = sphere(parent, "courtyard tree crown", treeX, 2.1, z, 0.72, foliage[1]!, 10, 7);
      crown.scale.set(1.12, 0.92, 0.88);
      const leftCrown = sphere(parent, "courtyard layered tree foliage", treeX - side * 0.34, 1.92, z + 0.3, 0.48, foliage[0]!, 9, 6);
      leftCrown.scale.set(1.08, 0.88, 1.0);
      const rightCrown = sphere(parent, "courtyard layered tree foliage", treeX + side * 0.31, 2.0, z - 0.25, 0.45, foliage[2]!, 9, 6);
      rightCrown.scale.set(0.92, 1.05, 1.08);
      sphere(parent, "courtyard young foliage", treeX + side * 0.08, 2.42, z + 0.04, 0.38, foliage[z < 0 ? 0 : 1]!, 9, 6);
    }
  }

  box(parent, "front courtyard walking path", 0, 0.035, 8.82, 22, 0.07, 1.35, paving);
  for (const x of [-9.1, 9.1]) {
    box(parent, "front courtyard planter", x, 0.34, 8.72, 1.5, 0.64, 0.76, planterStone);
    box(parent, "front planter soil", x, 0.68, 8.72, 1.34, 0.06, 0.62, soil);
    let shrubIndex = 0;
    for (const dx of [-0.45, 0, 0.45]) {
      sphere(parent, "front planter shrub", x + dx, 0.98, 8.72, 0.34, foliage[shrubIndex % foliage.length]!, 9, 6);
      shrubIndex += 1;
    }
  }

  const wood = mat("#75543c", 0.72);
  const metal = mat("#4f5149", 0.48, 0.2);
  for (const x of [-4.3, 4.3]) {
    box(parent, "courtyard bench seat", x, 0.48, 8.78, 1.9, 0.13, 0.54, wood);
    box(parent, "courtyard bench back", x, 0.9, 8.52, 1.9, 0.68, 0.12, wood);
    for (const dx of [-0.68, 0.68]) box(parent, "courtyard bench leg", x + dx, 0.25, 8.82, 0.1, 0.48, 0.1, metal);
  }
}

function addGlassDividerAlongX(
  box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, z: number, startX: number, endX: number,
  doorX: number, glass: THREE.Material, frame: THREE.Material, doorWidth = 1.45,
) {
  const leftDoor = doorX - doorWidth / 2;
  const rightDoor = doorX + doorWidth / 2;
  const addPane = (fromX: number, toX: number) => {
    if (toX - fromX < 0.12) return;
    box(parent, "glass room wall panel", (fromX + toX) / 2, 1.02, z, toX - fromX, 1.9, 0.075, glass);
  };
  addPane(startX, leftDoor);
  addPane(rightDoor, endX);
  box(parent, "glass wall upper frame", (startX + endX) / 2, 2.0, z, endX - startX, 0.09, 0.12, frame);
  for (const x of [leftDoor, rightDoor]) box(parent, "glass doorway frame post", x, 1.02, z, 0.075, 2.02, 0.12, frame);
}

function addGlassDividerAlongZ(
  box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x: number, startZ: number, endZ: number,
  doorZ: number, glass: THREE.Material, frame: THREE.Material, doorWidth = 1.45,
) {
  const nearDoor = doorZ - doorWidth / 2;
  const farDoor = doorZ + doorWidth / 2;
  const addPane = (fromZ: number, toZ: number) => {
    if (toZ - fromZ < 0.12) return;
    box(parent, "glass room wall panel", x, 1.02, (fromZ + toZ) / 2, 0.075, 1.9, toZ - fromZ, glass);
  };
  addPane(startZ, nearDoor);
  addPane(farDoor, endZ);
  box(parent, "glass wall upper frame", x, 2.0, (startZ + endZ) / 2, 0.12, 0.09, endZ - startZ, frame);
  for (const z of [nearDoor, farDoor]) box(parent, "glass doorway frame post", x, 1.02, z, 0.12, 2.02, 0.075, frame);
}

function addGlassEnclosureWallAlongZ(
  box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, x: number, startZ: number, endZ: number,
  glass: THREE.Material, frame: THREE.Material,
) {
  const panelLength = 3.9;
  for (let start = startZ; start < endZ - 0.01; start += panelLength) {
    const end = Math.min(endZ, start + panelLength);
    const length = end - start;
    box(parent, "full-height perimeter glass", x, 2.02, (start + end) / 2, 0.08, 4.04, length - 0.1, glass);
    box(parent, "perimeter glass mullion", x, 2.02, start, 0.14, 4.12, 0.09, frame);
  }
  box(parent, "perimeter glass end mullion", x, 2.02, endZ, 0.14, 4.12, 0.09, frame);
  box(parent, "perimeter glass top rail", x, 4.04, (startZ + endZ) / 2, 0.14, 0.12, endZ - startZ, frame);
  box(parent, "perimeter glass base rail", x, 0.06, (startZ + endZ) / 2, 0.14, 0.12, endZ - startZ, frame);
}

function addFloorAndZones(
  box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, textures: THREE.Texture[], carpetTexture: THREE.Texture,
) {
  const slab = mat("#d9d0c0", 0.92);
  const trim = mat("#9c8a72", 0.62, 0.06);
  box(parent, "single open-plan office floor", 0, -0.12, 0, 24, 0.24, 16.4, slab);
  box(parent, "floor front trim", 0, -0.22, 8.05, 24, 0.11, 0.16, trim);
  box(parent, "floor left trim", -11.92, -0.22, 0, 0.16, 0.11, 16.2, trim);
  box(parent, "floor right trim", 11.92, -0.22, 0, 0.16, 0.11, 16.2, trim);
  // Each team has a room on one aligned grid. Transparent full-height partitions and door gaps keep it open-plan.
  for (const room of ROOMS) addRoomPanel(box, parent, textures, carpetTexture, room.x, room.z, room.sx, room.sz, room.floor);

  const glass = new THREE.MeshStandardMaterial({ color: "#d4ebe8", transparent: true, opacity: 0.2, roughness: 0.18, metalness: 0.05, depthWrite: false });
  const frame = mat("#cfc5b4", 0.5, 0.08);
  const wallStart = -11.82;
  const wallEnd = 11.82;
  for (const [start, end, door] of [[wallStart, -5.9, -8.85], [-5.9, 2.5, -1.7], [2.5, wallEnd, 7.2]] as const) {
    addGlassDividerAlongX(box, parent, -2.55, start, end, door, glass, frame);
  }
  for (const [start, end, door] of [[wallStart, -5.9, -8.85], [-5.9, -1.1, -3.5], [-1.1, 5, 0.75], [5, wallEnd, 7.4]] as const) {
    addGlassDividerAlongX(box, parent, 2.05, start, end, door, glass, frame, 1.65);
  }
  for (const [x, start, end, door] of [[-5.9, -8.05, -2.55, -5.3], [2.5, -8.05, -2.55, -5.3], [-5.9, -2.55, 2.05, 1.1], [5, -2.55, 2.05, 1.1], [-5.9, 2.05, 7.95, 5.1], [-1.1, 2.05, 7.95, 5.9], [5, 2.05, 7.95, 5.1]] as const) {
    addGlassDividerAlongZ(box, parent, x, start, end, door, glass, frame, 1.55);
  }
  // Separate accounting from assembly while leaving their door beside the main aisle.
  addGlassDividerAlongX(box, parent, 0.05, 5.05, wallEnd, 6.1, glass, frame, 1.55);
  // Doll-house cut: the far (left) side keeps full-height glass; the two sides facing the camera are low sills so
  // nothing tall stands between the viewer and the people inside.
  addGlassEnclosureWallAlongZ(box, parent, -11.92, -8.05, 8.05, glass, frame);
  const sill = mat("#e7dfd0", 0.7);
  box(parent, "front low sill", 0, 0.28, 8.05, 23.84, 0.56, 0.16, sill);
  box(parent, "right low sill", 11.92, 0.28, 0, 0.16, 0.56, 16.1, sill);
  box(parent, "front sill cap", 0, 0.575, 8.05, 23.9, 0.05, 0.24, frame);
  box(parent, "right sill cap", 11.92, 0.575, 0, 0.24, 0.05, 16.16, frame);
  // A clear cross-shaped aisle is reserved for walking routes.
  const aisle = mat("#cdbfa6", 0.94);
  box(parent, "main walking aisle", 0, 0.008, 1.1, 23.6, 0.015, 1.28, aisle);
  box(parent, "cross walking aisle", 0, 0.009, -0.1, 1.22, 0.016, 5.0, aisle);
}

function makeHumanWorker(
  box: ReturnType<typeof makeBoxFactory>,
  sphere: ReturnType<typeof makeSphereFactory>,
  parent: THREE.Object3D,
  spec: WorkerSpec,
  index: number,
  now: number,
): WorkerRig {
  const root = new THREE.Group();
  root.name = `worker:${spec.key}`;
  root.position.set(spec.x, FLOOR_Y, spec.z);
  root.scale.setScalar([1.16, 1.2, 1.24, 1.19, 1.22][index % 5]!);
  root.rotation.y = spec.homeYaw ?? Math.PI;
  parent.add(root);

  const skinPalette = ["#e9c6a1", "#dcb08a", "#cf9f76", "#e4bc95", "#d6a67c"];
  const hairPalette = ["#2b1e17", "#3a2a20", "#1e1b1a", "#4a3527", "#2f2620"];
  const trouserPalette = ["#2f3542", "#3b3f4a", "#4b4338", "#283244"];
  const skin = mat(skinPalette[index % skinPalette.length]!, 0.68);
  const hair = mat(index === 0 ? "#6b625b" : hairPalette[index % hairPalette.length]!, 0.95);
  // Each role wears its own accent so people read apart from the furniture; AYAS keeps the dark manager suit.
  const jacketColor = spec.brainId === "ayas" ? "#24365e"
    : "#" + new THREE.Color(spec.accent).lerp(new THREE.Color("#3a4250"), 0.3).getHexString();
  const jacket = mat(jacketColor, 0.86);
  const shirt = mat("#f4f2ee", 0.78);
  const trousers = mat(trouserPalette[index % trouserPalette.length]!, 0.91);
  const shoes = mat(index % 2 ? "#3a2a1f" : "#1c1c1e", 0.58);
  const eyesWhite = mat("#f7eee0", 0.46);
  const pupil = mat("#2a2018", 0.4);
  const mouthMaterial = mat("#9a5b4c", 0.7);
  const badge = mat(spec.accent, 0.52, 0.04);
  const shadowMat = new THREE.MeshBasicMaterial({ color: "#453c33", transparent: true, opacity: 0.14, depthWrite: false });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 14), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  root.add(shadow);

  const capsule = (parent: THREE.Object3D, name: string, x: number, y: number, z: number, radius: number, length: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 3, 10), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const elliptical = (parent: THREE.Object3D, name: string, x: number, y: number, z: number, scale: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(...scale);
    parent.add(mesh);
    return mesh;
  };

  elliptical(root, "human waist", 0, 0.47, 0, [0.17, 0.12, 0.13], trousers);
  const body = new THREE.Group();
  body.position.set(0, 0.54, 0);
  root.add(body);
  const torsoShape = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.145, 0), new THREE.Vector2(0.16, 0.07),
    new THREE.Vector2(0.145, 0.18), new THREE.Vector2(0.16, 0.32), new THREE.Vector2(0.19, 0.45),
    new THREE.Vector2(0.17, 0.53), new THREE.Vector2(0.1, 0.59), new THREE.Vector2(0, 0.59),
  ], 16);
  const torso = new THREE.Mesh(torsoShape, jacket);
  torso.name = "tailored human jacket";
  torso.position.y = -0.015;
  body.add(torso);
  const shirtFront = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape().setFromPoints([
    new THREE.Vector2(-0.055, 0.57), new THREE.Vector2(0.055, 0.57), new THREE.Vector2(0.035, 0.39),
    new THREE.Vector2(0, 0.34), new THREE.Vector2(-0.035, 0.39),
  ])), shirt);
  shirtFront.name = "human shirt front";
  shirtFront.position.z = 0.145;
  body.add(shirtFront);
  if (spec.brainId === "ayas" || spec.brainId === "muhasebe") {
    capsule(body, "shirt collar", 0, 0.53, 0.04, 0.034, 0.025, shirt);
    const tie = box(body, "manager necktie", 0, 0.405, 0.154, 0.035, 0.19, 0.014, spec.brainId === "ayas" ? mat("#7a2630", 0.68) : jacket);
    tie.rotation.x = -0.08;
  }
  if (spec.brainId === "ayas") {
    box(body, "suit lapel left", -0.064, 0.425, 0.139, 0.035, 0.2, 0.018, jacket);
    box(body, "suit lapel right", 0.064, 0.425, 0.139, 0.035, 0.2, 0.018, jacket);
  }
  box(body, "tailored jacket front seam", 0, 0.245, 0.157, 0.012, 0.32, 0.012, mat("#c6bba7", 0.92));
  box(body, "jacket breast pocket", 0.092, 0.33, 0.15, 0.075, 0.09, 0.012, mat(jacketColor, 0.9));
  for (const buttonY of [0.16, 0.23, 0.3]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat("#c2a66f", 0.46, 0.34));
    button.name = "jacket front button";
    button.position.set(-0.045, buttonY, 0.158);
    body.add(button);
  }
  box(body, "employee identification card", -0.112, 0.13, 0.157, 0.085, 0.105, 0.018, mat("#e6e1d6", 0.5, 0.04));
  box(body, "employee badge color strip", -0.112, 0.16, 0.169, 0.075, 0.018, 0.008, badge);
  if (spec.brainId === "onarim") {
    box(body, "repair utility belt", 0, 0.06, 0.012, 0.29, 0.055, 0.22, mat("#4a4033", 0.86));
    box(body, "repair vest reflective stripe", 0, 0.29, 0.16, 0.25, 0.035, 0.012, mat("#c8b777", 0.7, 0.08));
  }
  if (spec.brainId === "kostum") {
    box(body, "tailor apron", 0, 0.205, 0.151, 0.25, 0.32, 0.018, mat("#936741", 0.92));
    box(body, "apron pocket", 0, 0.235, 0.163, 0.1, 0.065, 0.008, mat("#705034", 0.96));
  }
  if (spec.brainId === "kurgu" || spec.brainId === "gelistirici") {
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.032, 6, 16), jacket);
    hood.name = "soft hoodie collar";
    hood.position.set(0, 0.49, -0.018);
    hood.rotation.x = 1.3;
    body.add(hood);
  }
  elliptical(body, "small role pin", 0.14, 0.26, 0.155, [0.022, 0.022, 0.012], badge);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.13, 12), skin);
  neck.name = "human neck";
  neck.position.set(0, 0.545, 0.005);
  body.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.61, 0.012);
  body.add(head);
  elliptical(head, "human face", 0, 0, 0, [0.155, 0.18, 0.145], skin);
  const hairBack = elliptical(head, "human hair at nape", 0, -0.045, -0.025, [0.16, 0.145, 0.14], hair);
  hairBack.name = "human hair";
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.166, 16, 12, 0, Math.PI * 2, 0, 1.25), hair);
  hairCap.name = "human hairstyle";
  hairCap.position.set(0, 0.018, -0.005);
  head.add(hairCap);
  if (index % 4 === 1) elliptical(head, "side-swept fringe", -0.055, 0.105, 0.094, [0.105, 0.055, 0.064], hair);
  if (index % 4 === 2) elliptical(head, "short side-part fringe", 0.065, 0.1, 0.09, [0.09, 0.05, 0.062], hair);
  if (index % 4 === 3) elliptical(head, "small hair bun", 0.04, -0.015, -0.15, [0.07, 0.075, 0.08], hair);
  for (const side of [-1, 1]) elliptical(head, "short sideburn", side * 0.137, -0.035, 0.005, [0.028, 0.07, 0.1], hair);
  for (const side of [-1, 1]) elliptical(head, "human ear", side * 0.15, -0.012, 0, [0.023, 0.035, 0.026], skin);
  elliptical(head, "human nose", 0, -0.024, 0.139, [0.018, 0.022, 0.024], skin);
  const eyeGeometry = new THREE.SphereGeometry(0.012, 10, 8);
  const eyes: THREE.Group[] = [];
  for (const eyeX of [-0.049, 0.049]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.name = "blinking human eye";
    eyeGroup.position.set(eyeX, 0.018, 0.13);
    head.add(eyeGroup);
    const eyeWhite = new THREE.Mesh(eyeGeometry, eyesWhite);
    eyeWhite.name = "human eye white";
    eyeGroup.add(eyeWhite);
    elliptical(eyeGroup, "human eye pupil", 0, 0, 0.013, [0.006, 0.008, 0.005], pupil);
    elliptical(eyeGroup, "eye catchlight", -0.002, 0.004, 0.018, [0.0025, 0.003, 0.002], mat("#fff8e8", 0.22));
    eyes.push(eyeGroup);
    box(head, "human eyebrow", eyeX, 0.049, 0.137, 0.035, 0.008, 0.009, hair);
  }
  for (const side of [-1, 1]) elliptical(head, "subtle cheek", side * 0.085, -0.043, 0.119, [0.033, 0.022, 0.012], mat(index % 2 ? "#d9a892" : "#dcae93", 0.84));
  const mouth = box(head, "human mouth", 0, -0.078, 0.135, 0.039, 0.006, 0.006, mouthMaterial);
  if (spec.brainId === "ayas" || spec.brainId === "onarim") {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.151, 14, 10, 0, Math.PI * 2, 1.55, 1.42), spec.brainId === "ayas" ? mat("#827a71", 0.95) : hair);
    beard.name = "short human beard";
    beard.scale.set(0.98, 1.02, 0.98);
    beard.position.z = 0.008;
    head.add(beard);
    elliptical(head, "human moustache", 0, -0.054, 0.135, [0.045, 0.014, 0.012], spec.brainId === "ayas" ? mat("#827a71", 0.95) : hair);
  }
  if (["muhasebe", "arastirma", "denetci", "kalite"].includes(spec.brainId)) {
    const frame = mat("#392f2a", 0.42, 0.08);
    for (const eyeX of [-0.049, 0.049]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.004, 5, 14), frame);
      lens.name = "subtle eyeglass frame";
      lens.position.set(eyeX, 0.018, 0.147);
      head.add(lens);
    }
    box(head, "eyeglass bridge", 0, 0.018, 0.149, 0.018, 0.005, 0.005, frame);
  }

  const makeArm = (side: -1 | 1) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.28, 0.38, 0.01);
    body.add(arm);
    const upper = capsule(arm, "jacket sleeve", 0, -0.14, 0, 0.066, 0.17, jacket);
    elliptical(arm, "human shoulder", 0, 0, 0, [0.078, 0.078, 0.075], jacket);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    arm.add(elbow);
    elliptical(elbow, "human elbow", 0, 0, 0, [0.052, 0.052, 0.052], skin);
    capsule(elbow, "human forearm", 0, -0.115, 0, 0.047, 0.13, skin);
    box(elbow, "shirt cuff", 0, -0.205, 0.008, 0.095, 0.045, 0.098, shirt);
    elliptical(elbow, "human hand", 0, -0.25, 0.025, [0.047, 0.06, 0.036], skin);
    for (let finger = -1; finger <= 1; finger += 1) capsule(elbow, "human finger", finger * 0.022, -0.31, 0.04, 0.012, 0.035, skin);
    capsule(elbow, "human thumb", side * -0.045, -0.27, 0.045, 0.012, 0.03, skin);
    upper.position.x = side * 0.015;
    return { arm, elbow };
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  const makeLeg = (side: -1 | 1) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.11, 0.65, 0);
    root.add(leg);
    capsule(leg, "trouser leg upper", 0, -0.16, 0, 0.074, 0.18, trousers);
    const knee = new THREE.Group();
    knee.position.set(0, -0.31, 0);
    leg.add(knee);
    elliptical(knee, "trouser knee", 0, 0, 0, [0.074, 0.074, 0.07], trousers);
    capsule(knee, "trouser leg lower", 0, -0.15, 0, 0.063, 0.19, trousers);
    elliptical(knee, "human shoe", 0, -0.32, 0.09, [0.09, 0.043, 0.14], shoes);
    return { leg, knee };
  };
  const leftLeg = makeLeg(-1);
  const rightLeg = makeLeg(1);

  let chair: THREE.Group | undefined;
  if (spec.deskX !== undefined) {
    chair = new THREE.Group();
    chair.name = `seat:${spec.key}`;
    chair.position.set(spec.x, 0, spec.z);
    chair.rotation.y = Math.PI;
    parent.add(chair);
    const chairMaterial = mat("#536c67", 0.82);
    const chairLeg = mat("#514b43", 0.42, 0.16);
    box(chair, "worker chair seat", 0, 0.47, 0, 0.55, 0.13, 0.54, chairMaterial);
    box(chair, "worker chair back", 0, 0.87, -0.23, 0.55, 0.7, 0.14, chairMaterial);
    for (const side of [-1, 1]) {
      box(chair, "office chair arm support", side * 0.35, 0.66, 0, 0.065, 0.32, 0.065, chairLeg);
      box(chair, "office chair padded arm", side * 0.35, 0.82, 0, 0.1, 0.08, 0.42, chairMaterial);
    }
    box(chair, "worker chair stem", 0, 0.22, 0, 0.08, 0.42, 0.08, chairLeg);
    for (let spoke = 0; spoke < 5; spoke += 1) {
      const angle = (spoke / 5) * Math.PI * 2;
      const wheelX = Math.cos(angle) * 0.26;
      const wheelZ = Math.sin(angle) * 0.26;
      const foot = box(chair, "five-star chair base spoke", wheelX / 2, 0.09, wheelZ / 2, 0.32, 0.045, 0.055, chairLeg);
      foot.rotation.y = angle;
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 8), chairLeg);
      caster.name = "office chair caster";
      caster.rotation.x = Math.PI / 2;
      caster.position.set(wheelX, 0.045, wheelZ);
      chair.add(caster);
    }
  }
  const ringMaterial = new THREE.MeshBasicMaterial({ color: spec.accent, transparent: true, opacity: 0.5, depthWrite: false });
  const selectedRing = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.018, 4, 30), ringMaterial);
  selectedRing.rotation.x = Math.PI / 2;
  selectedRing.position.y = 0.035;
  selectedRing.visible = false;
  root.add(selectedRing);
  // Floor glow under the worker in the colour of its sample status (grey while idle).
  const statusDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 28),
    new THREE.MeshBasicMaterial({ color: STATUS_COLOR.bekliyor, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  statusDisc.name = "worker status floor glow";
  statusDisc.rotation.x = -Math.PI / 2;
  statusDisc.position.y = 0.04;
  statusDisc.renderOrder = 2;
  root.add(statusDisc);
  root.userData.brainId = spec.brainId;
  root.userData.workerKey = spec.key;
  root.userData.selectable = true;

  const initialStage: Stage = spec.deskX === undefined ? "rest" : "work";
  const worker: WorkerRig = {
    root, body, head, eyes, mouth, leftArm: leftArm.arm, rightArm: rightArm.arm,
    leftElbow: leftArm.elbow, rightElbow: rightArm.elbow,
    leftLeg: leftLeg.leg, rightLeg: rightLeg.leg,
    leftKnee: leftLeg.knee, rightKnee: rightLeg.knee,
    chair, selectedRing, statusDisc, spec, stage: initialStage, stageAt: now,
    nextMoveAt: now + spec.firstMove + (index % 4) * 0.35,
    path: [], pathIndex: 0, gait: index * 0.7, talkStarted: false,
    taskTripsSinceBreak: 0, loungeQueued: false, tripKind: "task",
  };
  setPose(worker, initialStage, 1, now, 0);
  return worker;
}

function ease(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function angleBlend(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function sitPose(worker: WorkerRig, blend: number) {
  worker.leftLeg.position.y = angleBlend(0.65, 0.51, blend);
  worker.rightLeg.position.y = angleBlend(0.65, 0.51, blend);
  worker.leftLeg.rotation.x = angleBlend(0, -1.08, blend);
  worker.rightLeg.rotation.x = angleBlend(0, -1.08, blend);
  worker.leftKnee.rotation.x = angleBlend(0, 1.28, blend);
  worker.rightKnee.rotation.x = angleBlend(0, 1.28, blend);
  worker.body.rotation.x = -0.06 * blend;
}

function setPose(worker: WorkerRig, stage: Stage, progress: number, now: number, gait: number) {
  const blinkPhase = (now + worker.gait * 0.17) % 4.4;
  const blink = blinkPhase < 0.13 ? Math.sin((blinkPhase / 0.13) * Math.PI) : 0;
  const eyeOpening = 1 - blink * 0.9;
  for (const eye of worker.eyes) eye.scale.y = eyeOpening;
  worker.head.rotation.x = 0;
  worker.head.rotation.y = 0;
  worker.body.rotation.set(0, 0, 0);
  worker.leftArm.rotation.set(0.02, 0, -0.07);
  worker.rightArm.rotation.set(0.02, 0, 0.07);
  worker.leftElbow.rotation.x = -0.12;
  worker.rightElbow.rotation.x = -0.12;
  worker.leftElbow.rotation.z = 0;
  worker.rightElbow.rotation.z = 0;
  worker.leftLeg.position.y = 0.65;
  worker.rightLeg.position.y = 0.65;
  worker.mouth.scale.y = 1;

  if (stage === "work") {
    sitPose(worker, 1);
    worker.body.rotation.x = -0.08 + Math.sin(now * 1.1 + worker.gait) * 0.012;
    worker.head.rotation.x = 0.08 + Math.sin(now * 1.8 + worker.gait) * 0.025;
    if (worker.spec.brainId === "kostum" || worker.spec.brainId === "kalite") {
      worker.head.rotation.x = 0.18 + Math.sin(now * 1.4 + worker.gait) * 0.035;
      worker.leftArm.rotation.x = -0.48 + Math.sin(now * 2.8 + worker.gait) * 0.12;
      worker.rightArm.rotation.x = -0.72 + Math.sin(now * 3.2 + worker.gait + 1) * 0.14;
      worker.leftElbow.rotation.x = 0.7;
      worker.rightElbow.rotation.x = 0.95;
    } else if (worker.spec.brainId === "ses") {
      worker.head.rotation.y = Math.sin(now * 0.72 + worker.gait) * 0.1;
      worker.leftArm.rotation.x = -0.7 + Math.sin(now * 3.7 + worker.gait) * 0.11;
      worker.rightArm.rotation.x = -0.76 + Math.sin(now * 3.4 + worker.gait + 1) * 0.1;
      worker.leftElbow.rotation.x = 0.88;
      worker.rightElbow.rotation.x = 0.92;
    } else if (worker.spec.brainId === "muhasebe") {
      worker.head.rotation.x = 0.16 + Math.sin(now * 1.2 + worker.gait) * 0.025;
      worker.leftArm.rotation.x = -0.56 + Math.sin(now * 1.8 + worker.gait) * 0.035;
      worker.rightArm.rotation.x = -0.78 + Math.sin(now * 4.6 + worker.gait + 1) * 0.08;
      worker.leftElbow.rotation.x = 0.92;
      worker.rightElbow.rotation.x = 1.08;
    } else {
      worker.leftArm.rotation.x = -0.75 + Math.sin(now * 4.1 + worker.gait) * 0.045;
      worker.rightArm.rotation.x = -0.78 + Math.sin(now * 4.4 + worker.gait + 1) * 0.055;
      worker.leftElbow.rotation.x = 1.05;
      worker.rightElbow.rotation.x = 1.1;
    }
  } else if (stage === "rest") {
    sitPose(worker, 1);
    worker.body.rotation.x = 0.08 + Math.sin(now * 0.7 + worker.gait) * 0.012;
    worker.head.rotation.x = -0.06 + Math.sin(now * 1.1 + worker.gait) * 0.035;
    worker.leftArm.rotation.x = -0.16 + Math.sin(now * 0.8 + worker.gait) * 0.05;
    worker.rightArm.rotation.x = -0.2 + Math.sin(now * 0.8 + worker.gait + 1) * 0.05;
  } else if (stage === "rise" || stage === "sit") {
    const t = ease(progress);
    sitPose(worker, stage === "rise" ? 1 - t : t);
    worker.leftArm.rotation.x = angleBlend(-0.58, 0.02, stage === "rise" ? t : 1 - t);
    worker.rightArm.rotation.x = angleBlend(-0.58, 0.02, stage === "rise" ? t : 1 - t);
    worker.head.rotation.x = -0.04 * (1 - t);
  } else if (stage === "walk-out" || stage === "walk-back") {
    const swing = Math.sin(gait);
    const lift = Math.max(0, Math.cos(gait));
    worker.leftLeg.rotation.x = swing * 0.46;
    worker.rightLeg.rotation.x = -swing * 0.46;
    worker.leftKnee.rotation.x = 0.08 + lift * 0.28;
    worker.rightKnee.rotation.x = 0.08 + Math.max(0, Math.cos(gait + Math.PI)) * 0.28;
    worker.leftArm.rotation.x = -swing * 0.34;
    worker.rightArm.rotation.x = swing * 0.34;
    worker.body.rotation.z = Math.sin(gait * 0.5) * 0.035;
    worker.body.rotation.y = Math.sin(gait * 0.5) * 0.025;
    worker.leftElbow.rotation.x = -0.15;
    worker.rightElbow.rotation.x = -0.15;
    worker.head.rotation.x = Math.sin(now * 2.3 + worker.gait) * 0.025;
    worker.root.position.y = FLOOR_Y + Math.abs(Math.cos(gait)) * 0.026;
  } else if (stage === "inspect") {
    const beat = Math.sin(now * 1.6 + worker.gait);
    worker.body.rotation.x = -0.035 + Math.sin(now * 0.9 + worker.gait) * 0.018;
    worker.head.rotation.x = worker.spec.brainId === "muhasebe" ? 0.16 + beat * 0.035 : beat * 0.045;
    worker.head.rotation.y = Math.sin(now * 0.65 + worker.gait) * 0.11;
    if (worker.spec.brainId === "ayas" || worker.spec.brainId === "denetci" || worker.spec.brainId === "kalite") {
      worker.rightArm.rotation.z = -0.32 + Math.sin(now * 1.7 + worker.gait) * 0.16;
      worker.rightElbow.rotation.x = -0.56;
      worker.leftArm.rotation.x = -0.2;
    } else if (worker.spec.brainId === "onarim") {
      worker.leftArm.rotation.x = -0.82 + Math.sin(now * 2.2 + worker.gait) * 0.12;
      worker.rightArm.rotation.x = -0.9 + Math.sin(now * 2.2 + worker.gait + 1.1) * 0.12;
      worker.leftElbow.rotation.x = -0.4;
      worker.rightElbow.rotation.x = -0.4;
    } else {
      worker.leftArm.rotation.x = -0.18 + Math.sin(now * 1.2 + worker.gait) * 0.12;
      worker.rightArm.rotation.x = -0.3 + Math.sin(now * 1.6 + worker.gait + 1.1) * 0.16;
      worker.rightElbow.rotation.x = -0.28;
    }
  } else if (stage === "talk" || stage === "wait") {
    worker.leftLeg.rotation.x = 0;
    worker.rightLeg.rotation.x = 0;
    const listener = stage === "wait";
    worker.leftArm.rotation.x = -0.2 + Math.sin(now * 3.5 + worker.gait) * (listener ? 0.045 : 0.36);
    worker.rightArm.rotation.x = -0.14 + Math.sin(now * 3.1 + worker.gait + 1.2) * (listener ? 0.045 : 0.32);
    worker.leftElbow.rotation.x = listener ? 0 : -0.3;
    worker.rightElbow.rotation.x = listener ? 0 : -0.35;
    worker.head.rotation.x = Math.sin(now * (listener ? 1.1 : 3.2) + worker.gait) * (listener ? 0.055 : 0.1);
    worker.mouth.scale.y = listener ? 1 : 1 + Math.abs(Math.sin(now * 7 + worker.gait)) * 4;
  } else if (stage === "coffee") {
    worker.leftArm.rotation.x = -0.12;
    worker.rightArm.rotation.x = -0.95 + Math.sin(now * 1.5) * 0.08;
    worker.rightElbow.rotation.x = -0.82;
    worker.head.rotation.x = Math.sin(now * 1.2 + worker.gait) * 0.08;
  } else if (stage === "lounge") {
    sitPose(worker, 1);
    worker.body.rotation.x = 0.07 + Math.sin(now * 0.55 + worker.gait) * 0.012;
    worker.head.rotation.x = -0.08 + Math.sin(now * 0.8 + worker.gait) * 0.035;
    worker.leftArm.rotation.x = -0.24 + Math.sin(now * 0.7 + worker.gait) * 0.045;
    worker.rightArm.rotation.x = -0.72 + Math.sin(now * 0.8 + worker.gait + 1) * 0.06;
    worker.leftElbow.rotation.x = 0.32;
    worker.rightElbow.rotation.x = 0.38;
  }
  const seatOffset = worker.spec.seatOffset ?? 0.01;
  if (stage === "lounge") worker.root.position.y = FLOOR_Y + 0.105;
  else if (stage === "rest" || stage === "work") worker.root.position.y = FLOOR_Y + seatOffset;
  else if (stage === "rise") worker.root.position.y = FLOOR_Y + seatOffset * (1 - ease(progress));
  else if (stage === "sit") worker.root.position.y = FLOOR_Y + seatOffset * ease(progress);
  else worker.root.position.y = FLOOR_Y;
  if (worker.chair) worker.chair.position.z = worker.spec.z + (stage === "rise" ? ease(progress) * 0.4 : stage === "sit" ? (1 - ease(progress)) * 0.4 : 0);
}

function pathBetween(from: THREE.Vector3, to: THREE.Vector3, spec?: WorkerSpec): THREE.Vector3[] {
  if (spec?.key === "developer" || spec?.key === "apprentice") {
    const meetingEdgeX = 9.55;
    const meetingRearZ = 6.9;
    const startsAtBoard = from.z < 4.5;
    const endsAtChairs = to.z > 5.8;
    const points = startsAtBoard && endsAtChairs
      ? [from.clone(), new THREE.Vector3(meetingEdgeX, FLOOR_Y, from.z), new THREE.Vector3(meetingEdgeX, FLOOR_Y, meetingRearZ), new THREE.Vector3(to.x, FLOOR_Y, meetingRearZ), to.clone()]
      : [from.clone(), new THREE.Vector3(from.x, FLOOR_Y, meetingRearZ), new THREE.Vector3(meetingEdgeX, FLOOR_Y, meetingRearZ), new THREE.Vector3(meetingEdgeX, FLOOR_Y, to.z), to.clone()];
    return points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]!) > 0.14);
  }
  if (spec?.key === "environment") {
    const deskX = -9;
    const deskSideX = -10.35;
    const crossesDesk = Math.min(from.z, to.z) < -1.42 && Math.max(from.z, to.z) > -0.62
      && Math.max(from.x, to.x) > deskX - 0.98 && Math.min(from.x, to.x) < deskX + 0.98;
    if (crossesDesk) {
      const doorX = -8.85;
      const points = [
        from.clone(),
        new THREE.Vector3(deskSideX, FLOOR_Y, from.z),
        new THREE.Vector3(deskSideX, FLOOR_Y, -1.82),
        new THREE.Vector3(doorX, FLOOR_Y, -1.82),
        new THREE.Vector3(doorX, FLOOR_Y, to.z),
        to.clone(),
      ];
      return points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]!) > 0.14);
    }
  }
  if (spec?.pair === "research-review" && spec.key === "researcher") {
    return [from.clone(), to.clone()];
  }
  if (spec?.pair === "creative-review" || spec?.pair === "costume-review" || spec?.pair === "sound-review") {
    return [from.clone(), to.clone()];
  }
  if (from.distanceTo(to) < 3) return [from.clone(), to.clone()];
  const points = [
    from.clone(),
    new THREE.Vector3(from.x, FLOOR_Y, AISLE_Z),
    new THREE.Vector3(to.x, FLOOR_Y, AISLE_Z),
    to.clone(),
  ];
  return points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]!) > 0.14);
}

function loungePortals(spec: WorkerSpec): readonly (readonly [number, number])[] {
  if (spec.z < -2.55) {
    if (spec.x < -5.9) return [[-8.85, -2.55], [-8.85, 2.05]];
    if (spec.x < 2.5) return [[-1.7, -2.55], [-5.9, 1.1], [-8.85, 1.1], [-8.85, 2.05]];
    return [[7.2, -2.55], [6.1, 0.05], [5, 1.1], [-5.9, 1.1], [-8.85, 1.1], [-8.85, 2.05]];
  }
  if (spec.z <= 2.05) {
    if (spec.x < -5.9) return [[-8.85, 2.05]];
    if (spec.x < 5) return [[-5.9, 1.1], [-8.85, 1.1], [-8.85, 2.05]];
    return [...(spec.z < 0.05 ? [[6.1, 0.05] as const] : []), [5, 1.1], [-5.9, 1.1], [-8.85, 1.1], [-8.85, 2.05]];
  }
  if (spec.x >= 5) return [[5, 5.1], [-1.1, 5.9], [-5.9, 5.1]];
  if (spec.x >= -1.1) return [[-1.1, 5.9], [-5.9, 5.1]];
  if (spec.x >= -5.9) return [[-5.9, 5.1]];
  return [];
}

function pathViaLounge(from: THREE.Vector3, to: THREE.Vector3, spec: WorkerSpec, returning = false): THREE.Vector3[] {
  const portals = [...loungePortals(spec)];
  if (returning) portals.reverse();
  const points = [from, ...portals.map(([x, z]) => new THREE.Vector3(x, FLOOR_Y, z)), to];
  return points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]!) > 0.14);
}

function facingYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function moveOnPath(worker: WorkerRig, dt: number): boolean {
  let remaining = dt * 1.25;
  while (remaining > 0 && worker.pathIndex < worker.path.length) {
    const next = worker.path[worker.pathIndex]!;
    const dx = next.x - worker.root.position.x;
    const dz = next.z - worker.root.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.03) {
      const desired = facingYaw(dx, dz);
      const diff = Math.atan2(Math.sin(desired - worker.root.rotation.y), Math.cos(desired - worker.root.rotation.y));
      worker.root.rotation.y += diff * Math.min(1, dt * 4);
    }
    const travel = Math.min(distance, remaining);
    if (distance <= remaining) {
      worker.root.position.x = next.x;
      worker.root.position.z = next.z;
      worker.pathIndex += 1;
    } else {
      worker.root.position.x += (dx / Math.max(distance, 0.001)) * travel;
      worker.root.position.z += (dz / Math.max(distance, 0.001)) * travel;
    }
    worker.gait += travel * 8;
    remaining -= travel;
  }
  return worker.pathIndex >= worker.path.length;
}

function buildOfficeScene(
  container: HTMLDivElement,
  selectedRef: { current: PreviewBrainId },
  onSelectRef: { current: (id: PreviewBrainId) => void },
  statusRef: { current: Partial<Record<PreviewBrainId, OfficeWorkerStatus>> },
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e9ede6");
  const camera = new THREE.OrthographicCamera(-12, 12, 6.75, -6.75, 0.1, 120);
  camera.position.set(18, 25, 25);
  camera.lookAt(0, 0.6, -0.2);
  // Bright, soft daylight: the key light sits on the camera side so the faces we see are lit, not the backs.
  scene.add(new THREE.HemisphereLight("#fffaf0", "#b9ad98", 1.75));
  const keyLight = new THREE.DirectionalLight("#fff1dc", 1.55);
  keyLight.position.set(14, 26, 12);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight("#dfe9ff", 0.55);
  fillLight.position.set(-14, 12, 6);
  scene.add(fillLight);

  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: "low-power", depth: true, stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.className = "oop-office-3d-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  // Screen overlay for room names and worker name tags: crisp text at any size, never mirrored like a 3D plaque.
  const overlay = document.createElement("div");
  overlay.className = "oop-office-overlay";
  container.replaceChildren(renderer.domElement, overlay);

  const box = makeBoxFactory();
  const sphere = makeSphereFactory();
  const textures: THREE.Texture[] = [];
  const carpetTexture = makeCarpetTileTexture();
  textures.push(carpetTexture);
  const addContactShadow = makeContactShadowFactory(textures);
  const room = new THREE.Group();
  scene.add(room);
  addFloorAndZones(box, room, textures, carpetTexture);
  addPlantAndWindows(box, room);
  addCourtyardDecoration(box, sphere, room);

  // One level only: low open partitions, an uncluttered walking aisle, and a bright window line.
  const plantPositions = [
    [-11, -7.1], [-4.7, -7.1], [3.7, -7.1], [11, -7.1],
    [-11, -0.3], [-4.8, -0.3], [5.55, -1.65], [11, -0.6],
    [-11, 7.1], [-4.8, 7.1], [2.0, 7.1], [11, 7.1],
  ] as const;
  for (const [x, z] of plantPositions) addPlant(box, sphere, room, x, z);

  // Room names sit on the floor at each room's front edge (projected every frame into the overlay).
  const roomTags = ROOMS.map((item) => {
    const tag = document.createElement("span");
    tag.className = "oop-room-tag" + (item.gold ? " is-gold" : "");
    tag.textContent = item.name;
    overlay.append(tag);
    return { tag, at: new THREE.Vector3(item.x, 0.05, item.z + item.sz / 2 - 0.42) };
  });

  addDesk(box, room, -9, -6.15, "#6dd7ff", { wide: true });
  addDesk(box, room, -2.9, -6.15, "#ffbd70");
  addDesk(box, room, -0.9, -6.15, "#ed76d5");
  addDesk(box, room, 8, -6.15, "#f3a58e", { costume: true });
  addDesk(box, room, -9, -1.0, "#81d49c", { wide: true });
  addDesk(box, room, 0, -1.5, "#41d9de", { wide: true });
  addDesk(box, room, 9, -1.0, "#e2c578", { ledgers: true });
  addDesk(box, room, 7, 4.1, "#82b4ff", { wide: true });
  addDesk(box, room, 9.7, 4.1, "#a5a7ff", { wide: true });
  addDesk(box, room, -3.5, 4.15, "#8ed5d2", { audio: true });
  addDesk(box, room, -0.45, 4.15, "#70e4c0");
  addDesk(box, room, 5.85, -6.15, "#54d8ad");
  addDesk(box, room, 10, 0.35, "#f0a85f", { wide: true });
  addContactShadow(room, -9.15, 4.65, 4.2, 1.65);
  addSofa(box, room, -9.15, 4.65);
  addRug(room, -9.15, 5.15, 2.7, 1.95, "#92785e");
  addRug(room, 1.95, 5.45, 2.7, 1.9, "#9aada0");
  addFloorLamp(box, sphere, room, -11.25, 3.9);
  addFloorLamp(box, sphere, room, 10.85, 6.55);
  addFloorLamp(box, sphere, room, 11.0, -2.25);
  addContactShadow(room, -10.4, 2.9, 2.7, 0.98);
  addCoffeeCorner(box, sphere, room);
  addContactShadow(room, 1.95, 5.25, 3.7, 1.85);
  addMeetingTable(box, room, 1.95, 5.25);
  addFilingCabinet(box, room, -11.05, -4.55, "#6dd7ff");
  addFilingCabinet(box, room, 11.0, -1.32, "#e2c578");
  addFilingCabinet(box, room, 11.0, 1.2, "#f0a85f");
  addWardrobeRail(box, room, 10.45, -4.75);
  addAcousticPanels(box, room);
  for (const [lightX, lightZ] of [
    [-8.7, -5.6], [-0.8, -5.6], [8.6, -5.6],
    [-8.7, -0.4], [0, -0.4], [8.7, -0.9],
    [-3.5, 3.5], [1.95, 3.45], [8.5, 3.7],
  ] as const) addOfficeLinearLight(box, room, lightX, lightZ);
  // Owner approval is shown as a single checkpoint at the edge of AYAS's room, not a separate floor/office.
  const gold = mat("#e5c578", 0.42, 0.16);
  box(room, "owner approval checkpoint", 1.65, 0.12, 0.16, 1.1, 0.12, 0.4, gold);
  box(room, "owner checkpoint light", 1.65, 0.23, 0.16, 0.13, 0.08, 0.13, mat("#fff2aa", 0.32, 0.1));

  const workerLayer = new THREE.Group();
  scene.add(workerLayer);
  const startedAt = performance.now() / 1000;
  const workers = WORKERS.map((spec, index) => makeHumanWorker(box, sphere, workerLayer, spec, index, startedAt));
  const pairMembers = new Map<string, WorkerRig[]>();
  for (const worker of workers) {
    if (!worker.spec.pair) continue;
    const members = pairMembers.get(worker.spec.pair) ?? [];
    members.push(worker);
    pairMembers.set(worker.spec.pair, members);
  }
  // A name tag with a status light above every worker; clicking it opens that brain's profile like clicking the body.
  const workerTags = workers.map((worker) => {
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "oop-worker-tag";
    const dot = document.createElement("i");
    const name = document.createElement("b");
    name.textContent = SHORT_NAME[worker.spec.brainId];
    const state = document.createElement("small");
    tag.append(dot, name, state);
    tag.addEventListener("click", () => onSelectRef.current(worker.spec.brainId));
    overlay.append(tag);
    return { worker, tag, state, status: "" as OfficeWorkerStatus | "" };
  });
  const headPoint = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const place = (element: HTMLElement, world: THREE.Vector3, width: number, height: number) => {
    projected.copy(world).project(camera);
    const x = ((projected.x + 1) / 2) * width;
    const y = ((1 - projected.y) / 2) * height;
    element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  };
  const updateOverlay = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    for (const { tag, at } of roomTags) place(tag, at, width, height);
    for (const entry of workerTags) {
      const status = statusRef.current[entry.worker.spec.brainId] ?? "bekliyor";
      if (status !== entry.status) {
        entry.status = status;
        entry.tag.dataset.status = status;
        entry.state.textContent = OFFICE_STATUS_LABEL[status];
        const disc = entry.worker.statusDisc.material as THREE.MeshBasicMaterial;
        disc.color.set(STATUS_COLOR[status]);
        disc.opacity = status === "bekliyor" ? 0 : 0.5;
      }
      entry.tag.classList.toggle("is-selected", entry.worker.spec.brainId === selectedRef.current);
      entry.worker.head.getWorldPosition(headPoint);
      headPoint.y += 0.42;
      place(entry.tag, headPoint, width, height);
    }
  };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const selectable = workers.map((worker) => worker.root);
  for (const worker of workers) worker.selectedRing.visible = worker.spec.brainId === selectedRef.current;
  let visible = true;
  let frame = 0;
  let previous = 0;
  let stopped = false;
  let lastSelected = selectedRef.current;
  const clockStart = performance.now();
  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    const frustumHeight = 16.9;
    camera.left = (-frustumHeight * aspect) / 2;
    camera.right = (frustumHeight * aspect) / 2;
    camera.top = frustumHeight / 2;
    camera.bottom = -frustumHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; });
  intersectionObserver.observe(container);

  const loungeAssignments = new Map<number, WorkerRig>();
  const loungeQueue: WorkerRig[] = [];
  const dispatchLoungeBreaks = (now: number) => {
    for (let seatIndex = 0; seatIndex < LOUNGE_SEATS.length; seatIndex += 1) {
      if (loungeAssignments.has(seatIndex)) continue;
      const worker = loungeQueue.shift();
      if (!worker) return;
      worker.loungeQueued = false;
      worker.loungeSeatIndex = seatIndex;
      worker.nextMoveAt = now;
      loungeAssignments.set(seatIndex, worker);
    }
  };

  const makeTrip = (worker: WorkerRig, now: number) => {
    const loungeSeatIndex = worker.loungeSeatIndex;
    const isLoungeTrip = loungeSeatIndex !== undefined && loungeAssignments.get(loungeSeatIndex) === worker;
    const pair = worker.spec.pair;
    const slot = worker.spec.pairSlot ?? 0;
    const pairedTarget = pair ? PAIR_TARGETS[pair]?.[slot] : undefined;
    const loungeSeat = isLoungeTrip ? LOUNGE_SEATS[loungeSeatIndex] : undefined;
    const target = loungeSeat
      ? [loungeSeat.x, loungeSeat.z] as const
      : pairedTarget ?? [worker.spec.focusX ?? worker.spec.x + 1.1, worker.spec.focusZ ?? worker.spec.z + 0.8] as const;
    worker.destination = new THREE.Vector3(target[0], FLOOR_Y, target[1]);
    worker.tripKind = isLoungeTrip ? "lounge" : "task";
    worker.path = isLoungeTrip
      ? pathViaLounge(worker.root.position, worker.destination, worker.spec)
      : pathBetween(worker.root.position, worker.destination, worker.spec);
    worker.pathIndex = 1;
    worker.stage = "rise";
    worker.stageAt = now;
    worker.talkStarted = false;
    if (worker.chair) worker.chair.visible = true;
  };

  const beginReturn = (worker: WorkerRig, now: number) => {
    const home = new THREE.Vector3(worker.spec.x, FLOOR_Y, worker.spec.z);
    worker.path = worker.tripKind === "lounge"
      ? pathViaLounge(worker.root.position, home, worker.spec, true)
      : pathBetween(worker.root.position, home, worker.spec);
    worker.pathIndex = 1;
    worker.stage = "walk-back";
    worker.stageAt = now;
  };

  const startPairTalk = (worker: WorkerRig, now: number) => {
    if (worker.talkStarted) return;
    const mate = (pairMembers.get(worker.spec.pair ?? "") ?? []).find((candidate) => candidate !== worker);
    if (!mate) {
      worker.stage = "coffee";
      worker.stageAt = now;
      return;
    }
    const distance = worker.root.position.distanceTo(mate.root.position);
    if (distance < PAIR_TALK_DISTANCE && mate.stage === "wait") {
      worker.stage = "talk";
      mate.stage = "talk";
      worker.stageAt = now;
      mate.stageAt = now;
      worker.talkStarted = true;
      mate.talkStarted = true;
      worker.root.rotation.y = facingYaw(mate.root.position.x - worker.root.position.x, mate.root.position.z - worker.root.position.z);
      mate.root.rotation.y = facingYaw(worker.root.position.x - mate.root.position.x, worker.root.position.z - mate.root.position.z);
    } else {
      worker.stage = "wait";
      worker.stageAt = now;
    }
  };

  const updateWorker = (worker: WorkerRig, now: number, dt: number) => {
    if (worker.stage === "work" || worker.stage === "rest") {
      const status = statusRef.current[worker.spec.brainId];
      if (status === "calisiyor" || status === "denetliyor" || status === "yonetiyor") {
        // Busy in the sample flow: stay seated and keep working; the ambient walk waits until it is over.
        worker.nextMoveAt = Math.max(worker.nextMoveAt, now + 6);
        setPose(worker, worker.stage, 1, now, 0);
        return;
      }
      if (worker.loungeSeatIndex !== undefined) {
        makeTrip(worker, now);
        return;
      }
      if (worker.taskTripsSinceBreak >= TASK_TRIPS_BEFORE_BREAK) {
        if (!worker.loungeQueued) {
          worker.loungeQueued = true;
          loungeQueue.push(worker);
        }
        setPose(worker, worker.stage, 1, now, 0);
        return;
      }
      if (now >= worker.nextMoveAt) makeTrip(worker, now);
      else setPose(worker, worker.stage, 1, now, 0);
      return;
    }
    if (worker.stage === "rise") {
      const progress = Math.min(1, (now - worker.stageAt) / 0.78);
      setPose(worker, "rise", progress, now, 0);
      if (progress >= 1) {
        worker.root.rotation.y = facingYaw(worker.path[1]!.x - worker.root.position.x, worker.path[1]!.z - worker.root.position.z);
        worker.stage = "walk-out";
        worker.stageAt = now;
      }
      return;
    }
    if (worker.stage === "walk-out") {
      const arrived = moveOnPath(worker, dt);
      setPose(worker, "walk-out", 1, now, worker.gait);
      if (arrived) {
        if (worker.tripKind === "lounge") {
          worker.stage = "lounge";
          worker.stageAt = now;
          worker.root.rotation.y = 0;
        } else if (worker.spec.pair) startPairTalk(worker, now);
        else { worker.stage = "inspect"; worker.stageAt = now; }
      }
      return;
    }
    if (worker.stage === "lounge") {
      setPose(worker, "lounge", 1, now, 0);
      if (now - worker.stageAt > LOUNGE_BREAK_SECONDS) beginReturn(worker, now);
      return;
    }
    if (worker.stage === "wait") {
      const mate = (pairMembers.get(worker.spec.pair ?? "") ?? []).find((candidate) => candidate !== worker);
      if (mate?.stage === "wait" && worker.root.position.distanceTo(mate.root.position) < PAIR_TALK_DISTANCE) {
        startPairTalk(worker, now);
      } else if (now - worker.stageAt > 12) {
        beginReturn(worker, now);
      }
      setPose(worker, worker.stage, 1, now, 0);
      return;
    }
    if (worker.stage === "talk") {
      const mate = (pairMembers.get(worker.spec.pair ?? "") ?? []).find((candidate) => candidate !== worker);
      if (mate) {
        const dx = mate.root.position.x - worker.root.position.x;
        const dz = mate.root.position.z - worker.root.position.z;
        const yaw = facingYaw(dx, dz);
        const diff = Math.atan2(Math.sin(yaw - worker.root.rotation.y), Math.cos(yaw - worker.root.rotation.y));
        worker.root.rotation.y += diff * Math.min(1, dt * 4);
      }
      const speakingTurn = Math.floor((now - worker.stageAt) / 2.4);
      const speaksNow = (speakingTurn + (worker.spec.pairSlot ?? 0)) % 2 === 0;
      setPose(worker, speaksNow ? "talk" : "wait", 1, now, 0);
      if (now - worker.stageAt > 9.6) beginReturn(worker, now);
      return;
    }
    if (worker.stage === "inspect") {
      setPose(worker, "inspect", 1, now, 0);
      if (now - worker.stageAt > 3.4) beginReturn(worker, now);
      return;
    }
    if (worker.stage === "coffee") {
      setPose(worker, "coffee", 1, now, 0);
      if (now - worker.stageAt > 4.3) beginReturn(worker, now);
      return;
    }
    if (worker.stage === "walk-back") {
      const arrived = moveOnPath(worker, dt);
      setPose(worker, "walk-back", 1, now, worker.gait);
      if (arrived) {
        worker.root.rotation.y = worker.spec.homeYaw ?? Math.PI;
        if (worker.tripKind === "lounge") {
          if (worker.loungeSeatIndex !== undefined) loungeAssignments.delete(worker.loungeSeatIndex);
          worker.loungeSeatIndex = undefined;
          worker.taskTripsSinceBreak = 0;
        } else {
          worker.taskTripsSinceBreak += 1;
        }
        worker.stage = "sit";
        worker.stageAt = now;
      }
      return;
    }
    if (worker.stage === "sit") {
      const progress = Math.min(1, (now - worker.stageAt) / 0.75);
      setPose(worker, "sit", progress, now, 0);
      if (progress >= 1) {
        worker.stage = worker.spec.deskX === undefined ? "rest" : "work";
        worker.stageAt = now;
        worker.nextMoveAt = now + PERIOD + ((worker.spec.pairSlot ?? 0) * 2.3);
        worker.talkStarted = false;
      }
    }
  };

  const updateSelection = () => {
    if (selectedRef.current === lastSelected) return;
    lastSelected = selectedRef.current;
    for (const worker of workers) {
      const active = worker.spec.brainId === lastSelected;
      worker.selectedRing.visible = active;
      (worker.selectedRing.material as THREE.MeshBasicMaterial).opacity = active ? 0.82 : 0.45;
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(selectable, true);
    renderer.domElement.style.cursor = hits.length ? "pointer" : "grab";
  };
  const onClick = (event: MouseEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(selectable, true)[0];
    let target: THREE.Object3D | null = hit?.object ?? null;
    while (target && !target.userData.selectable) target = target.parent;
    const brainId = target?.userData.brainId as PreviewBrainId | undefined;
    if (brainId) onSelectRef.current(brainId);
  };
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("click", onClick);

  const animate = (timestamp: number) => {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    if (!visible || document.hidden) return;
    if (timestamp - previous < 40) return;
    const dt = Math.min(0.06, previous ? (timestamp - previous) / 1000 : 1 / 30);
    previous = timestamp;
    const now = (performance.now() - clockStart) / 1000;
    updateSelection();
    dispatchLoungeBreaks(now);
    for (const worker of workers) updateWorker(worker, now, dt);
    renderer.render(scene, camera);
    updateOverlay();
  };
  frame = requestAnimationFrame(animate);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("click", onClick);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material?.dispose?.();
      }
    });
    for (const texture of textures) texture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    container.replaceChildren();
  };
}

const LEGEND: readonly OfficeWorkerStatus[] = ["calisiyor", "denetliyor", "yonetiyor", "bitti", "bekliyor"];

export function AtolyeOffice3DScene({ selectedBrainId, onSelectBrain, statuses = {} }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedBrainId);
  const onSelectRef = useRef(onSelectBrain);
  const statusRef = useRef(statuses);
  useEffect(() => { selectedRef.current = selectedBrainId; }, [selectedBrainId]);
  useEffect(() => { onSelectRef.current = onSelectBrain; }, [onSelectBrain]);
  useEffect(() => { statusRef.current = statuses; }, [statuses]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    try {
      return buildOfficeScene(container, selectedRef, onSelectRef, statusRef);
    } catch (error) {
      container.dataset.webgl = "unavailable";
      container.textContent = "Bu bilgisayarda 3D çizim başlatılamadı.";
      console.error("Atölye Ofisi 3D preview could not start", error);
    }
  }, []);

  return <>
    <div ref={mountRef} className="oop-office-3d-mount" role="img" aria-label="Tek katlı Atölye Ofisi; beyinler görev alanlarına yürür, boşta kaldıklarında sırayla dinlenme odasını kullanır ve masalarına döner." />
    <div className="oop-office-legend" aria-label="Durum renkleri">{LEGEND.map((status) =>
      <span key={status}><i style={{ background: STATUS_COLOR[status] }} />{OFFICE_STATUS_LABEL[status]}</span>)}</div>
    <div className="oop-office-3d-note">ÖRNEK · {new Set(WORKERS.map((worker) => worker.brainId)).size} ÇALIŞAN · CANLI SİSTEME BAĞLI DEĞİL</div>
    <div className="oop-office-sr-list" aria-label="Ofisteki çalışan profilleri">{WORKERS.map((worker) => {
      const profile = getPreviewBrain(worker.brainId);
      return <button key={worker.key} type="button" onClick={() => onSelectBrain(worker.brainId)}>{profile.name} — {worker.key}</button>;
    })}</div>
  </>;
}
