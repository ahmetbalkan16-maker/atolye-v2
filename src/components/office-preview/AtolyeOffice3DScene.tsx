"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getPreviewBrain } from "@/lib/office-preview/brains";
import { roomHref, type OfficeRoomSlug } from "@/lib/office-preview/officeRoster";
import type { PreviewBrainId } from "@/lib/office-preview/roleTypes";

type Props = {
  selectedBrainId: PreviewBrainId;
  onSelectBrain: (id: PreviewBrainId) => void;
  /** Sample status per brain from the scripted flow; brains not listed are shown as "bekliyor". */
  statuses?: Partial<Record<PreviewBrainId, OfficeWorkerStatus>>;
  /** Where the statuses come from (live system or the sample flow), shown in the scene corner. */
  sourceLabel?: string;
};

type Stage = "work" | "rest" | "rise" | "walk-out" | "inspect" | "wait" | "talk" | "coffee" | "lounge" | "meeting" | "walk-back" | "sit";
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
  tripKind: "task" | "lounge" | "meeting";
  meetingSeatIndex?: number;
  meetingRoute?: THREE.Vector3[];
  /** The pose last drawn (joint values) and the pose key it came from, for cross-fading a pose change. */
  pose?: Float32Array;
  poseKey?: string;
  poseFrom?: Float32Array;
  poseBlendAt?: number;
  /** A facing the worker turns toward smoothly while standing or sitting (never snapped). */
  yawGoal?: number;
};

const FLOOR_Y = 0;
const AISLE_Z = 1.1;
// Ambient walks are rare so desks are mostly occupied; a worker the sample flow marks busy never leaves its desk.
const PERIOD = 64;
const PAIR_TALK_DISTANCE = 2.45;
const TASK_TRIPS_BEFORE_BREAK = 2;
const LOUNGE_BREAK_SECONDS = 12;
// Owner 2026-11-26: idle workers "masasında oturabilir toplantı yapabilir yada dinlenebilir". The meeting room table
// (addMeetingTable at 1.95, 5.25) has three chairs per side; a seated worker faces the table.
const MEETING_SECONDS = 16;
const MEETING_SEATS = [
  { x: 0.65, z: 6.32, yaw: Math.PI }, { x: 1.95, z: 6.32, yaw: Math.PI }, { x: 3.25, z: 6.32, yaw: Math.PI },
  { x: 0.65, z: 4.18, yaw: 0 }, { x: 1.95, z: 4.18, yaw: 0 }, { x: 3.25, z: 4.18, yaw: 0 },
] as const;
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
  // Owner 2026-11-26 "yeni ajanlar eklemen gerekiyorsa ekle … gerekli odalara ekle": real parts of the system that
  // had no seat yet — the history gate, the update radar, the publisher, the channel analyst and the observer.
  { key: "historian", brainId: "tarih", x: 3.85, z: -5.55, deskX: 3.85, deskZ: -6.25, accent: "#c99a52", focusX: 4.9, focusZ: -4.4, firstMove: 31 },
  { key: "radar", brainId: "radar", x: -7.0, z: -5.55, deskX: -7.0, deskZ: -6.25, accent: "#5fb8d8", focusX: -7.6, focusZ: -4.2, firstMove: 35 },
  { key: "publisher", brainId: "yayinci", x: -3.4, z: -0.65, deskX: -3.4, deskZ: -1.5, accent: "#e8604a", focusX: -2.4, focusZ: 0.0, firstMove: 39 },
  { key: "analyst", brainId: "analist", x: 3.3, z: -0.65, deskX: 3.3, deskZ: -1.5, accent: "#f0a060", focusX: 2.3, focusZ: 0.0, firstMove: 43 },
  { key: "watcher", brainId: "gozcu", x: 7.2, z: 1.25, deskX: 7.2, deskZ: 0.45, accent: "#6f7fa6", focusX: 6.2, focusZ: 1.55, firstMove: 47 },
  // Owner 2026-11-26: the security brain (Bekçi) sits by the entrance in the meeting & audit room.
  { key: "security", brainId: "guvenlik", x: 4.3, z: 7.45, deskX: 4.3, deskZ: 6.7, accent: "#c0392b", focusX: 0.6, focusZ: 7.2, firstMove: 51 },
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
  tarih: "Tarih Hakemi", yayinci: "Yayıncı", analist: "Kanal Analisti", gozcu: "Gözcü", radar: "Radar", guvenlik: "Bekçi",
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
const ROOMS: readonly { slug: OfficeRoomSlug; name: string; x: number; z: number; sx: number; sz: number; floor: string; gold?: boolean; labelDx?: number; labelDz?: number }[] = [
  { slug: "arastirma", name: "ARAŞTIRMA", x: -8.9, z: -5.3, sx: 5.75, sz: 5.15, floor: "#dbe7f1" },
  { slug: "kurgu-mizah", name: "KURGU & MİZAH", x: -1.7, z: -5.3, sx: 8.05, sz: 5.15, floor: "#f3e2cf" },
  { slug: "kostum-kalite", name: "KOSTÜM & KALİTE", x: 7.2, z: -5.3, sx: 9.0, sz: 5.15, floor: "#f1dde2" },
  { slug: "ortam-gorsel", name: "ORTAM & GÖRSEL", x: -8.9, z: -0.25, sx: 5.75, sz: 4.3, floor: "#dcebdc" },
  { slug: "yonetim", name: "AYAS · YÖNETİM & YAYIN", x: -0.45, z: -0.25, sx: 10.65, sz: 4.3, floor: "#efe5c9", gold: true },
  { slug: "muhasebe", name: "MUHASEBE", x: 8.45, z: -1.25, sx: 6.55, sz: 2.25, floor: "#ece5cc", labelDx: 1.9, labelDz: -0.9 },
  { slug: "onarim-nobet", name: "ONARIM & NÖBET", x: 8.45, z: 1.05, sx: 6.55, sz: 1.75, floor: "#e1e5e8" },
  { slug: "dinlenme", name: "DİNLENME", x: -8.9, z: 5.05, sx: 5.75, sz: 5.8, floor: "#eee2cf" },
  { slug: "ses", name: "SES STÜDYOSU", x: -3.5, z: 5.05, sx: 4.55, sz: 5.8, floor: "#e4dff1" },
  { slug: "toplanti", name: "TOPLANTI & DENETİM", x: 1.95, z: 5.05, sx: 5.85, sz: 5.8, floor: "#e8e3d7" },
  { slug: "gelistirme", name: "GELİŞİM MERKEZİ", x: 8.45, z: 5.05, sx: 6.55, sz: 5.8, floor: "#dce5f0" },
];

const PAIR_TARGETS: Record<string, readonly [readonly [number, number], readonly [number, number]]> = {
  "research-review": [[-10, -3.25], [-8.5, -3.25]],
  "creative-review": [[-3.1, -4.2], [-1.25, -4.2]],
  "costume-review": [[7.2, -4.2], [8.9, -4.2]],
  development: [[7, 6.15], [9.55, 6.15]],
  "sound-review": [[-2.8, 5.9], [-0.9, 5.9]],
};

const PARTITION_WALL = new THREE.MeshStandardMaterial({ color: "#f3eee5", roughness: 0.85 });
const PARTITION_CAP = new THREE.MeshStandardMaterial({ color: "#b98f62", roughness: 0.55 });
const mat = (color: THREE.ColorRepresentation, roughness = 0.78, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** Owner 2026-11-26 ("yerler parke"): oak plank parquet, staggered boards with grain, one tile = 2.4 m square. */
function makeParquetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    const boardHeight = 32;
    const boardLength = 192;
    const tones = ["#c99a68", "#bf8f5d", "#d0a474", "#c4945f", "#b98955", "#cc9d6b"];
    for (let row = 0; row < canvas.height / boardHeight; row += 1) {
      const shift = (row * 71) % boardLength;
      for (let start = -shift; start < canvas.width; start += boardLength) {
        const y = row * boardHeight;
        const tone = tones[(row * 5 + Math.floor((start + shift) / boardLength) * 3) % tones.length]!;
        context.fillStyle = tone;
        context.fillRect(start, y, boardLength, boardHeight);
        // Grain: long thin streaks along the board.
        for (let streak = 0; streak < 7; streak += 1) {
          const sy = y + 3 + ((streak * 11 + row * 7) % (boardHeight - 6));
          context.strokeStyle = streak % 2 ? "rgba(92, 58, 28, 0.13)" : "rgba(255, 236, 200, 0.12)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(start + 4, sy);
          context.bezierCurveTo(start + boardLength * 0.3, sy + 1.5, start + boardLength * 0.7, sy - 1.5, start + boardLength - 4, sy);
          context.stroke();
        }
        context.strokeStyle = "rgba(70, 44, 22, 0.42)";
        context.lineWidth = 1.2;
        context.strokeRect(start + 0.5, y + 0.5, boardLength - 1, boardHeight - 1);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Owner 2026-11-26 ("karşı duvar tuğla örme"): running-bond red brick with light mortar; one tile = 1.2 m × 0.6 m. */
function makeBrickTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#d8cfc2";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const rows = 8;
    const brickHeight = canvas.height / rows;
    const brickWidth = canvas.width / 4;
    const mortar = 5;
    const tones = ["#a4533b", "#9a4a34", "#b05f43", "#8f4530", "#a85a3e", "#9d5039", "#b4664a"];
    for (let row = 0; row < rows; row += 1) {
      const offset = row % 2 ? brickWidth / 2 : 0;
      for (let column = -1; column < 5; column += 1) {
        const x = column * brickWidth + offset;
        const y = row * brickHeight;
        context.fillStyle = tones[(row * 3 + column * 5 + 14) % tones.length]!;
        context.fillRect(x + mortar / 2, y + mortar / 2, brickWidth - mortar, brickHeight - mortar);
        // A little speckle and a darker lower edge so each brick reads as fired clay.
        for (let dot = 0; dot < 18; dot += 1) {
          context.fillStyle = dot % 2 ? "rgba(60, 25, 15, 0.16)" : "rgba(255, 210, 180, 0.12)";
          context.fillRect(x + 4 + ((dot * 37 + row * 13 + column * 7) % (brickWidth - 10)), y + 4 + ((dot * 17 + column * 5) % (brickHeight - 10)), 2, 2);
        }
        context.fillStyle = "rgba(50, 20, 10, 0.18)";
        context.fillRect(x + mortar / 2, y + brickHeight - mortar / 2 - 3, brickWidth - mortar, 3);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** City facade: one bay = one window with a sill on a light wall (tinted per building by the material colour). */
function makeFacadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f4f2ee";
    context.fillRect(0, 0, 128, 128);
    const glassGradient = context.createLinearGradient(0, 30, 0, 98);
    glassGradient.addColorStop(0, "#5f7d93");
    glassGradient.addColorStop(1, "#2f4252");
    context.fillStyle = "#9a958c";
    context.fillRect(26, 26, 76, 76);
    context.fillStyle = glassGradient;
    context.fillRect(30, 30, 68, 68);
    context.fillStyle = "rgba(255, 255, 255, 0.28)";
    context.fillRect(34, 34, 18, 60);
    context.fillStyle = "#9a958c";
    context.fillRect(62, 30, 4, 68);
    context.fillStyle = "#d4cfc6";
    context.fillRect(22, 100, 84, 7);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
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
  const parquet = carpetTexture.clone();
  parquet.repeat.set(sx / 2.4, sz / 2.4);
  parquet.needsUpdate = true;
  textures.push(parquet);
  // Wood everywhere; the department colour is only a faint tint so rooms still read apart.
  const tint = new THREE.Color("#ffffff").lerp(new THREE.Color(color), 0.3);
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshStandardMaterial({ color: tint, map: parquet, roughness: 0.62, metalness: 0 }),
  );
  surface.name = "oak parquet office floor";
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
  for (let i = 0; i < 7; i += 1) {
    const x = -10.6 + i * 3.5;
    const foliage = mat(i % 2 ? "#75966d" : "#5e815f", 0.96);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.68 + (i % 3) * 0.08, 10, 7), foliage);
    crown.name = "garden tree beyond the windows";
    crown.position.set(x, 1.55 + (i % 2) * 0.2, -8.22);
    parent.add(crown);
  }
  // Owner 2026-11-26 ("karşı duvar tuğla örme"): the far wall is laid brick with four framed windows on the garden.
  const brick = makeBrickTexture();
  const brickWall = (name: string, x: number, y: number, sx: number, sy: number) => {
    const map = brick.clone();
    map.repeat.set(sx / 1.2, sy / 0.6);
    map.needsUpdate = true;
    box(parent, name, x, y, -8.1, sx, sy, 0.24, new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0 }));
  };
  const wallFrom = -11.98;
  const wallTo = 11.98;
  const wallHeight = 4.04;
  const sillY = 0.95;
  const headY = 3.25;
  const windows = [-8.4, -2.8, 2.8, 8.4];
  const windowWidth = 3.1;
  let cursor = wallFrom;
  for (const wx of windows) {
    const left = wx - windowWidth / 2;
    const right = wx + windowWidth / 2;
    brickWall("brick wall pier", (cursor + left) / 2, wallHeight / 2, left - cursor, wallHeight);
    brickWall("brick wall under window", wx, sillY / 2, windowWidth, sillY);
    brickWall("brick wall over window", wx, (headY + wallHeight) / 2, windowWidth, wallHeight - headY);
    box(parent, "office window glass", wx, (sillY + headY) / 2, -8.1, windowWidth, headY - sillY, 0.05, glass);
    box(parent, "window frame upright", left + 0.06, (sillY + headY) / 2, -8.0, 0.12, headY - sillY, 0.16, frame);
    box(parent, "window frame upright", right - 0.06, (sillY + headY) / 2, -8.0, 0.12, headY - sillY, 0.16, frame);
    box(parent, "window frame mullion", wx, (sillY + headY) / 2, -8.0, 0.08, headY - sillY, 0.14, frame);
    box(parent, "window frame crossbar", wx, 2.45, -8.0, windowWidth, 0.08, 0.14, frame);
    box(parent, "window frame head", wx, headY - 0.05, -8.0, windowWidth, 0.1, 0.16, frame);
    box(parent, "window stone sill", wx, sillY + 0.03, -7.93, windowWidth + 0.2, 0.07, 0.26, mat("#cfc6b6", 0.7));
    cursor = right;
  }
  brickWall("brick wall pier", (cursor + wallTo) / 2, wallHeight / 2, wallTo - cursor, wallHeight);
  brick.dispose();
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
    // Solid lower wall + glass above, like a real office partition (also gives the scene depth and shadows).
    box(parent, "partition lower wall", (fromX + toX) / 2, 0.45, z, toX - fromX, 0.9, 0.12, PARTITION_WALL);
    box(parent, "partition wall cap", (fromX + toX) / 2, 0.915, z, toX - fromX, 0.03, 0.16, PARTITION_CAP);
    box(parent, "glass room wall panel", (fromX + toX) / 2, 1.43, z, toX - fromX, 1.0, 0.05, glass);
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
    box(parent, "partition lower wall", x, 0.45, (fromZ + toZ) / 2, 0.12, 0.9, toZ - fromZ, PARTITION_WALL);
    box(parent, "partition wall cap", x, 0.915, (fromZ + toZ) / 2, 0.16, 0.03, toZ - fromZ, PARTITION_CAP);
    box(parent, "glass room wall panel", x, 1.43, (fromZ + toZ) / 2, 0.05, 1.0, toZ - fromZ, glass);
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

/** A perimeter of framed glass along x (at `at` = z) or along z (at `at` = x), with an optional door gap. */
function addFramedGlassWall(
  box: ReturnType<typeof makeBoxFactory>, parent: THREE.Object3D, axis: "x" | "z", at: number, from: number, to: number,
  door: number | null, doorWidth: number, glass: THREE.Material, frame: THREE.Material,
) {
  const height = 1.7;
  const piece = (name: string, center: number, length: number, y: number, sy: number, depth: number, material: THREE.Material) => {
    if (axis === "x") box(parent, name, center, y, at, length, sy, depth, material);
    else box(parent, name, at, y, center, depth, sy, length, material);
  };
  const runs: [number, number][] = door === null ? [[from, to]] : [[from, door - doorWidth / 2], [door + doorWidth / 2, to]];
  for (const [start, end] of runs) {
    piece("perimeter glass base rail", (start + end) / 2, end - start, 0.06, 0.12, 0.16, frame);
    piece("perimeter framed glass", (start + end) / 2, end - start, height / 2 + 0.06, height - 0.1, 0.04, glass);
    piece("perimeter glass top rail", (start + end) / 2, end - start, height, 0.08, 0.14, frame);
    const panels = Math.max(1, Math.round((end - start) / 2));
    for (let i = 0; i <= panels; i += 1) piece("perimeter glass mullion", start + ((end - start) * i) / panels, 0.07, height / 2, height, 0.12, frame);
  }
  if (door !== null) {
    for (const post of [door - doorWidth / 2, door + doorWidth / 2]) piece("entrance door post", post, 0.12, 1.1, 2.2, 0.16, frame);
    piece("entrance door header", door, doorWidth + 0.12, 2.2, 0.12, 0.16, frame);
    piece("entrance mat", door, doorWidth - 0.2, 0.012, 0.02, 0.9, mat("#4d4a45", 0.95));
  }
}

/** A small hatchback/sedan, length along local x. Wheels, glass cabin, lights. */
function makeCar(box: ReturnType<typeof makeBoxFactory>, color: string): THREE.Group {
  const car = new THREE.Group();
  car.name = "car";
  const paint = mat(color, 0.32, 0.45);
  const glassDark = mat("#26323b", 0.15, 0.6);
  const tyre = mat("#1d1e20", 0.9);
  const rim = mat("#b9bcc0", 0.35, 0.7);
  box(car, "car body", 0, 0.5, 0, 3.9, 0.55, 1.7, paint);
  box(car, "car cabin", -0.2, 1.0, 0, 2.1, 0.5, 1.5, glassDark);
  box(car, "car roof", -0.2, 1.27, 0, 1.9, 0.06, 1.46, paint);
  box(car, "car bumper", 1.97, 0.38, 0, 0.08, 0.22, 1.66, mat("#2b2d30", 0.6));
  box(car, "car bumper", -1.97, 0.38, 0, 0.08, 0.22, 1.66, mat("#2b2d30", 0.6));
  for (const side of [-0.6, 0.6]) {
    box(car, "car headlight", 1.96, 0.6, side, 0.05, 0.13, 0.32, mat("#fff8dc", 0.2));
    box(car, "car tail light", -1.96, 0.6, side, 0.05, 0.13, 0.3, mat("#c8282a", 0.3));
  }
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
  const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.25, 10);
  for (const wx of [-1.25, 1.25]) for (const wz of [-0.78, 0.78]) {
    const t = new THREE.Mesh(wheel, tyre);
    t.name = "car tyre";
    t.rotation.x = Math.PI / 2;
    t.position.set(wx, 0.34, wz);
    car.add(t);
    const h = new THREE.Mesh(hub, rim);
    h.name = "car wheel rim";
    h.rotation.x = Math.PI / 2;
    h.position.set(wx, 0.34, wz);
    car.add(h);
  }
  return car;
}

/**
 * Owner 2026-11-26 ("dışına yol otopark araba falan, daha gerçekçi olur"): lawn around the building, a street with
 * a sidewalk in front, a striped car park on the right with parked cars, and cars driving along the street.
 * Returns the moving cars; the frame loop drives them.
 */
/**
 * Bakes every mesh of a still group into one mesh per material (positions in the group's frame). The merged mesh
 * keeps the first part's name, so the shadow rules that read names still apply.
 */
function mergeStaticMeshes(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<THREE.Material, { name: string; parts: THREE.BufferGeometry[] }>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const geometry = (object.geometry as THREE.BufferGeometry).clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toGroup, object.matrixWorld));
    const bucket = buckets.get(object.material) ?? { name: object.name, parts: [] };
    bucket.parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
    buckets.set(object.material, bucket);
  });
  const merged = new THREE.Group();
  merged.name = group.name;
  for (const [material, bucket] of buckets) {
    const geometry = mergeGeometries(bucket.parts, false);
    for (const part of bucket.parts) part.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = bucket.name;
    merged.add(mesh);
  }
  return merged;
}

/** Names of the meshes that only receive shadows (floors, rugs, flat labels, glows); everything else casts one. */
const SHADOWLESS_NAME = /floor|carpet|rug|aisle|path|shadow|glow|ring|glass|slab|trim|lawn|asphalt|stripe|sidewalk|curb|mat$/i;

/** Materials that draw the same: `mat()` makes a new material per call, so identity alone merges almost nothing. */
function materialSignature(material: THREE.Material): string | null {
  if (material.type !== "MeshStandardMaterial" || material.transparent) return null;
  const m = material as THREE.MeshStandardMaterial;
  return [m.color.getHexString(), m.roughness, m.metalness, m.emissive.getHexString(), m.emissiveIntensity, m.envMapIntensity,
    m.map?.uuid ?? "", m.normalMap?.uuid ?? "", m.roughnessMap?.uuid ?? "", m.side, m.flatShading, m.vertexColors, m.opacity,
    m.alphaTest, m.depthWrite, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits].join("|");
}

/**
 * Owner 2026-11-27 ("hareketler çok kasıyor"): the office drew ~2,650 separate meshes every frame, a CPU load a phone
 * cannot carry at 60 fps. Every still, opaque mesh of the room (not the workers, their chairs or the driving cars) is
 * baked into one mesh per look and shadow rule. A bucket whose geometries cannot be merged keeps its original meshes.
 */
function mergeRoomStatics(room: THREE.Group) {
  room.updateMatrixWorld(true);
  const toRoom = new THREE.Matrix4().copy(room.matrixWorld).invert();
  const buckets = new Map<string, { material: THREE.Material; casts: boolean; meshes: THREE.Mesh[] }>();
  const moving = (object: THREE.Object3D): boolean => {
    for (let o: THREE.Object3D | null = object; o && o !== room; o = o.parent) if (o.userData.moving) return true;
    return false;
  };
  room.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || moving(object)) return;
    const signature = materialSignature(object.material);
    if (!signature) return;
    const casts = !SHADOWLESS_NAME.test(object.name);
    const key = `${signature}|${casts}`;
    const bucket = buckets.get(key) ?? { material: object.material, casts, meshes: [] as THREE.Mesh[] };
    bucket.meshes.push(object);
    buckets.set(key, bucket);
  });
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) continue;
    const parts = bucket.meshes.map((mesh) => {
      const geometry = (mesh.geometry as THREE.BufferGeometry).clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoom, mesh.matrixWorld));
      return geometry.index ? geometry.toNonIndexed() : geometry;
    });
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, bucket.material);
    merged.name = bucket.casts ? "merged still solids" : "merged floor surfaces";
    for (const mesh of bucket.meshes) mesh.removeFromParent();
    room.add(merged);
  }
}

/**
 * The same for an articulated figure (a worker, a chair): the leaf meshes under one joint move together, so those that
 * look alike are merged into one mesh in that joint's own frame. The hierarchy — and so every animation — is unchanged;
 * meshes the frame loop changes by themselves (`keep`: mouth, rings, status disc) stay apart.
 */
function mergeRigidParts(root: THREE.Object3D, keep: ReadonlySet<THREE.Object3D>) {
  const joints: THREE.Object3D[] = [];
  root.traverse((object) => { if (!(object instanceof THREE.Mesh)) joints.push(object); });
  for (const joint of joints) {
    const buckets = new Map<string, { material: THREE.Material; casts: boolean; meshes: THREE.Mesh[] }>();
    for (const child of joint.children) {
      if (!(child instanceof THREE.Mesh) || child.children.length || keep.has(child) || Array.isArray(child.material)) continue;
      const signature = materialSignature(child.material);
      if (!signature) continue;
      const casts = !SHADOWLESS_NAME.test(child.name);
      const key = `${signature}|${casts}`;
      const bucket = buckets.get(key) ?? { material: child.material, casts, meshes: [] as THREE.Mesh[] };
      bucket.meshes.push(child);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      if (bucket.meshes.length < 2) continue;
      const parts = bucket.meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = (mesh.geometry as THREE.BufferGeometry).clone().applyMatrix4(mesh.matrix);
        return geometry.index ? geometry.toNonIndexed() : geometry;
      });
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!geometry) continue;
      const merged = new THREE.Mesh(geometry, bucket.material);
      merged.name = bucket.casts ? bucket.meshes[0]!.name : "merged flat part";
      for (const mesh of bucket.meshes) mesh.removeFromParent();
      joint.add(merged);
    }
  }
}

function addSiteAndStreet(box: ReturnType<typeof makeBoxFactory>, scenePart: THREE.Object3D) {
  const parent = new THREE.Group();
  parent.name = "city site";
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), mat("#93ad7c", 0.98));
  lawn.name = "site lawn ground";
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(4, -0.02, 4);
  parent.add(lawn);
  const asphalt = mat("#4d5156", 0.9);
  const lotAsphalt = mat("#5b5f64", 0.92);
  const paint = mat("#f2f0e6", 0.7);
  const yellow = mat("#e9c14c", 0.7);
  const curb = mat("#c9c6be", 0.85);
  // Owner 2026-11-26 ("diğer tarafına da yol yap, ofis şehir içindeymiş hissi versin"): the building sits on a city
  // block — streets on all four sides with crossings, and city blocks beyond them (tall behind and on the left, low
  // shops on the two sides facing the camera so nothing hides the office).
  const ROAD_FROM = -48;
  const ROAD_TO = 52;
  const xRoads = [12.4, -12.8];
  const zRoads = [-16.6, 25.6];
  const roadX = (z: number) => {
    box(parent, "street asphalt road", (ROAD_FROM + ROAD_TO) / 2, 0.01, z, ROAD_TO - ROAD_FROM, 0.02, 3.6, asphalt);
    for (const side of [-1, 1]) box(parent, "street sidewalk", (ROAD_FROM + ROAD_TO) / 2, 0.03, z + side * 2.4, ROAD_TO - ROAD_FROM, 0.06, 1.2, curb);
    for (let x = ROAD_FROM + 1; x <= ROAD_TO - 1; x += 3) {
      if (zRoads.some((rx) => Math.abs(x - rx) < 3.2)) continue;
      box(parent, "street lane stripe", x, 0.025, z, 1.6, 0.01, 0.12, paint);
    }
  };
  const roadZ = (x: number) => {
    box(parent, "street asphalt road", x, 0.012, (ROAD_FROM + ROAD_TO) / 2, 3.6, 0.02, ROAD_TO - ROAD_FROM, asphalt);
    for (const side of [-1, 1]) box(parent, "street sidewalk", x + side * 2.4, 0.031, (ROAD_FROM + ROAD_TO) / 2, 1.2, 0.06, ROAD_TO - ROAD_FROM, curb);
    for (let z = ROAD_FROM + 1; z <= ROAD_TO - 1; z += 3) {
      if (xRoads.some((rz) => Math.abs(z - rz) < 3.2)) continue;
      box(parent, "street lane stripe", x, 0.027, z, 0.12, 0.01, 1.6, paint);
    }
  };
  for (const z of xRoads) roadX(z);
  for (const x of zRoads) roadZ(x);
  // Zebra crossings on every side of each corner.
  for (const rz of xRoads) for (const rx of zRoads) {
    for (const dir of [-1, 1]) {
      for (let i = -3; i <= 3; i += 1) {
        box(parent, "zebra crossing stripe", rx + dir * 3.6, 0.03, rz + i * 0.5, 1.4, 0.01, 0.28, paint);
        box(parent, "zebra crossing stripe", rx + i * 0.5, 0.03, rz + dir * 3.6, 0.28, 0.01, 1.4, paint);
      }
    }
  }
  // City blocks: a facade texture of window rows, tinted per building; deterministic so every visit looks the same.
  const facade = makeFacadeTexture();
  const roofMat = mat("#6f7275", 0.85);
  const unitMat = mat("#a9adb0", 0.6, 0.3);
  const tones = ["#e9e1d3", "#d8c6ad", "#c9d3da", "#e3d2c2", "#bfc8bf", "#d9b9a4", "#cfd6e3", "#efe8dc"];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const building = (x: number, z: number, sx: number, sz: number, height: number) => {
    const map = facade.clone();
    map.repeat.set(Math.max(1, Math.round(sx / 1.6)), Math.max(1, Math.round(height / 1.4)));
    map.needsUpdate = true;
    box(parent, "city building", x, height / 2, z, sx, height, sz, new THREE.MeshStandardMaterial({ color: tones[Math.floor(rand() * tones.length)]!, map, roughness: 0.82 }));
    box(parent, "city building roof", x, height + 0.06, z, sx + 0.12, 0.12, sz + 0.12, roofMat);
    if (sx > 3 && sz > 3) box(parent, "rooftop unit", x + (rand() - 0.5) * sx * 0.4, height + 0.4, z + (rand() - 0.5) * sz * 0.4, 1.1, 0.6, 0.9, unitMat);
  };
  // A row of buildings along x (between z0..z1) or along z (between x0..x1), from..to, skipping the cross streets.
  const rowAlongX = (z0: number, z1: number, from: number, to: number, minH: number, maxH: number) => {
    for (let x = from; x < to;) {
      const width = 4 + rand() * 5;
      const end = Math.min(to, x + width);
      if (!zRoads.some((rx) => end > rx - 3.2 && x < rx + 3.2) && end - x > 2) {
        building((x + end) / 2, (z0 + z1) / 2 + (rand() - 0.5) * 0.8, end - x - 0.5, z1 - z0 - rand() * 1.5, minH + rand() * (maxH - minH));
      }
      x = end + 0.3;
    }
  };
  const rowAlongZ = (x0: number, x1: number, from: number, to: number, minH: number, maxH: number) => {
    for (let z = from; z < to;) {
      const depth = 4 + rand() * 5;
      const end = Math.min(to, z + depth);
      if (!xRoads.some((rz) => end > rz - 3.2 && z < rz + 3.2) && end - z > 2) {
        building((x0 + x1) / 2 + (rand() - 0.5) * 0.8, (z + end) / 2, x1 - x0 - rand() * 1.5, end - z - 0.5, minH + rand() * (maxH - minH));
      }
      z = end + 0.3;
    }
  };
  rowAlongX(-24.5, -16.6, -46, 50, 5, 15); // behind the back street: tall
  rowAlongZ(-27, -20, -9.4, 9.2, 4, 13); // beyond the left street: tall
  rowAlongX(16.6, 22, -46, 50, 1.8, 3.2); // across the front street: low shops
  rowAlongZ(29.4, 35, -9.4, 9.2, 1.8, 3.4); // beyond the right street: low
  // Street trees on the back and left sidewalks.
  const bark = mat("#5f4a37", 0.95);
  const leaf = mat("#5f8a52", 0.95);
  for (let x = -12; x <= 22; x += 4.5) {
    box(parent, "street tree trunk", x, 0.7, -10.25, 0.16, 1.4, 0.16, bark);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 7), leaf);
    crown.name = "street tree crown";
    crown.position.set(x, 1.75, -10.25);
    parent.add(crown);
  }
  facade.dispose();
  // Car park on the right, its driveway joining the street.
  box(parent, "car park asphalt", 18.6, 0.012, -0.4, 9.2, 0.02, 16.4, lotAsphalt);
  box(parent, "car park driveway asphalt", 20.9, 0.011, 9.4, 4.6, 0.02, 3.2, lotAsphalt);
  box(parent, "car park curb", 14.0, 0.06, -0.4, 0.16, 0.12, 16.4, curb);
  const stallWidth = 2.6;
  const stalls = 6;
  const firstZ = -7.6;
  for (let i = 0; i <= stalls; i += 1) box(parent, "car park stall stripe", 16.6, 0.026, firstZ + i * stallWidth, 4.8, 0.01, 0.1, paint);
  box(parent, "car park stall end stripe", 14.25, 0.026, firstZ + (stalls * stallWidth) / 2, 0.1, 0.01, stalls * stallWidth, paint);
  for (let i = 0; i < 3; i += 1) box(parent, "car park arrow stripe", 21.2, 0.026, -5 + i * 4.2, 0.12, 0.01, 1.6, yellow);
  const parkedColors = ["#c43d3a", "#e8e8e6", "#2f5f8f", "#3c3f44", "#7f8c8d"];
  const taken = [0, 1, 3, 4, 5];
  taken.forEach((stall, index) => {
    const car = makeCar(box, parkedColors[index % parkedColors.length]!);
    car.position.set(16.7, 0.02, firstZ + stall * stallWidth + stallWidth / 2);
    car.rotation.y = index % 2 ? Math.PI : 0;
    parent.add(car);
  });
  // Street lamps along the sidewalk.
  const pole = mat("#3d4248", 0.5, 0.4);
  for (const x of [-12, -4, 6, 16]) {
    box(parent, "street lamp pole", x, 1.6, 9.55, 0.1, 3.2, 0.1, pole);
    box(parent, "street lamp arm", x, 3.15, 9.85, 0.08, 0.08, 0.7, pole);
    box(parent, "street lamp head", x, 3.08, 10.2, 0.3, 0.1, 0.42, mat("#fff4d0", 0.3));
  }
  // Traffic: cars on all four streets, keeping to their lane, looping along the street.
  const traffic: { axis: "x" | "z"; lane: number; dir: 1 | -1; speed: number; offset: number; color: string }[] = [
    { axis: "x", lane: 11.55, dir: 1, speed: 3.4, offset: 0, color: "#d9a238" },
    { axis: "x", lane: 13.25, dir: -1, speed: 2.8, offset: 30, color: "#4b7a5a" },
    { axis: "x", lane: 11.55, dir: 1, speed: 3.0, offset: 55, color: "#8e3b57" },
    { axis: "x", lane: -13.65, dir: -1, speed: 3.1, offset: 12, color: "#e6e6e3" },
    { axis: "x", lane: -11.95, dir: 1, speed: 2.6, offset: 64, color: "#2f6ea5" },
    { axis: "z", lane: -15.75, dir: 1, speed: 3.2, offset: 20, color: "#c0392b" },
    { axis: "z", lane: -17.45, dir: -1, speed: 2.9, offset: 70, color: "#34383d" },
    { axis: "z", lane: 24.75, dir: 1, speed: 2.7, offset: 45, color: "#7d8c4a" },
    { axis: "z", lane: 26.45, dir: -1, speed: 3.3, offset: 5, color: "#b7b9bc" },
  ];
  const moving = traffic.map((item) => {
    const car = mergeStaticMeshes(makeCar(box, item.color));
    // Local +x is the car's front: +x → 0, −x → π, +z → −π/2, −z → π/2.
    car.rotation.y = item.axis === "x" ? (item.dir > 0 ? 0 : Math.PI) : (item.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    car.position.set(item.axis === "x" ? 0 : item.lane, 0.02, item.axis === "x" ? item.lane : 0);
    car.userData.moving = true;
    scenePart.add(car);
    return { ...item, car };
  });
  // Everything above stands still: merged per material into a few meshes (hundreds of boxes cost a phone its frames).
  scenePart.add(mergeStaticMeshes(parent));
  const span = ROAD_TO - ROAD_FROM - 4;
  return (now: number) => {
    for (const item of moving) {
      const travelled = (now * item.speed + item.offset) % span;
      const along = item.dir > 0 ? ROAD_FROM + 2 + travelled : ROAD_TO - 2 - travelled;
      if (item.axis === "x") item.car.position.x = along;
      else item.car.position.z = along;
    }
  };
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
  // Owner 2026-11-26 ("diğer yerler cam çerçeve"): the two sides facing the camera are framed glass. Kept lower than
  // the far side (1.7 m) and very clear so the people inside stay visible; the front has the entrance doors.
  const frontGlass = new THREE.MeshStandardMaterial({ color: "#cfe6ec", transparent: true, opacity: 0.16, roughness: 0.08, metalness: 0.1, depthWrite: false });
  const darkFrame = mat("#3b4148", 0.45, 0.35);
  addFramedGlassWall(box, parent, "x", 8.05, -11.98, 11.98, 0, 1.8, frontGlass, darkFrame);
  addFramedGlassWall(box, parent, "z", 11.92, -8.05, 8.05, null, 0, frontGlass, darkFrame);
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
  // The cap is tilted back so it meets the nape hair; untilted, a strip of scalp showed between them from behind.
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.166, 18, 14, 0, Math.PI * 2, 0, 1.5), hair);
  hairCap.name = "human hairstyle";
  hairCap.position.set(0, 0.018, -0.005);
  hairCap.rotation.x = -0.36;
  head.add(hairCap);
  if (index % 4 === 1) elliptical(head, "side-swept fringe", -0.055, 0.105, 0.094, [0.105, 0.055, 0.064], hair);
  if (index % 4 === 2) elliptical(head, "short side-part fringe", 0.065, 0.1, 0.09, [0.09, 0.05, 0.062], hair);
  if (index % 4 === 3) elliptical(head, "small hair bun", 0.04, -0.015, -0.15, [0.07, 0.075, 0.08], hair);
  for (const side of [-1, 1]) elliptical(head, "short sideburn", side * 0.137, -0.035, 0.005, [0.028, 0.07, 0.1], hair);
  for (const side of [-1, 1]) elliptical(head, "human ear", side * 0.15, -0.012, 0, [0.023, 0.035, 0.026], skin);
  elliptical(head, "human nose", 0, -0.024, 0.139, [0.018, 0.022, 0.024], skin);
  // Eyes and brows are drawn a little larger than life so faces still read at office distance.
  const eyeGeometry = new THREE.SphereGeometry(0.02, 12, 10);
  const eyes: THREE.Group[] = [];
  for (const eyeX of [-0.049, 0.049]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.name = "blinking human eye";
    eyeGroup.position.set(eyeX, 0.018, 0.124);
    head.add(eyeGroup);
    const eyeWhite = new THREE.Mesh(eyeGeometry, eyesWhite);
    eyeWhite.name = "human eye white";
    eyeGroup.add(eyeWhite);
    elliptical(eyeGroup, "human eye pupil", 0, 0, 0.017, [0.011, 0.013, 0.006], pupil);
    elliptical(eyeGroup, "eye catchlight", -0.004, 0.005, 0.022, [0.004, 0.004, 0.002], mat("#fff8e8", 0.22));
    eyes.push(eyeGroup);
    const brow = box(head, "human eyebrow", eyeX, 0.056, 0.135, 0.046, 0.013, 0.012, hair);
    brow.rotation.z = eyeX < 0 ? 0.12 : -0.12;
  }
  for (const side of [-1, 1]) elliptical(head, "subtle cheek", side * 0.085, -0.043, 0.119, [0.033, 0.022, 0.012], mat(index % 2 ? "#d9a892" : "#dcae93", 0.84));
  const mouth = box(head, "human mouth", 0, -0.074, 0.137, 0.046, 0.009, 0.008, mouthMaterial);
  if (spec.brainId === "ayas" || spec.brainId === "onarim") {
    // A trimmed jaw beard below the mouth (the old half-sphere covered the whole lower face like a mask).
    const beardMat = spec.brainId === "ayas" ? mat("#5e5650", 0.95) : hair;
    elliptical(head, "trimmed chin beard", 0, -0.112, 0.07, [0.1, 0.055, 0.08], beardMat);
    for (const side of [-1, 1]) elliptical(head, "trimmed jaw beard", side * 0.1, -0.075, 0.045, [0.04, 0.06, 0.07], beardMat);
    elliptical(head, "human moustache", 0, -0.055, 0.137, [0.044, 0.012, 0.012], beardMat);
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
    // Sleeves run to the wrist; only the hands show skin.
    elliptical(elbow, "jacket elbow", 0, 0, 0, [0.056, 0.056, 0.056], jacket);
    capsule(elbow, "jacket forearm sleeve", 0, -0.115, 0, 0.05, 0.13, jacket);
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

/**
 * Owner 2026-11-27: "ofiste hareket eden beyinlerin hareketleri çok kasıyor, akıcı değil". Each stage used to write its
 * pose straight onto the joints, so a change of stage (walk → talk, sit → meeting speaker, talk ↔ listen) jumped in one
 * frame. `setPose` now computes the stage's target pose and, for POSE_BLEND_S after the pose changes, cross-fades from
 * the pose last drawn. Within one pose nothing is smoothed, so the walk cycle keeps its full swing.
 */
const POSE_BLEND_S = 0.32;

function poseJoints(w: WorkerRig): number[] {
  return [
    w.body.rotation.x, w.body.rotation.y, w.body.rotation.z, w.head.rotation.x, w.head.rotation.y,
    w.leftArm.rotation.x, w.leftArm.rotation.y, w.leftArm.rotation.z, w.rightArm.rotation.x, w.rightArm.rotation.y, w.rightArm.rotation.z,
    w.leftElbow.rotation.x, w.leftElbow.rotation.z, w.rightElbow.rotation.x, w.rightElbow.rotation.z,
    w.leftLeg.rotation.x, w.rightLeg.rotation.x, w.leftLeg.position.y, w.rightLeg.position.y,
    w.leftKnee.rotation.x, w.rightKnee.rotation.x, w.mouth.scale.y, w.root.position.y,
  ];
}

function writePoseJoints(w: WorkerRig, v: ArrayLike<number>) {
  let i = 0;
  w.body.rotation.set(v[i++]!, v[i++]!, v[i++]!);
  w.head.rotation.x = v[i++]!; w.head.rotation.y = v[i++]!;
  w.leftArm.rotation.set(v[i++]!, v[i++]!, v[i++]!);
  w.rightArm.rotation.set(v[i++]!, v[i++]!, v[i++]!);
  w.leftElbow.rotation.x = v[i++]!; w.leftElbow.rotation.z = v[i++]!;
  w.rightElbow.rotation.x = v[i++]!; w.rightElbow.rotation.z = v[i++]!;
  w.leftLeg.rotation.x = v[i++]!; w.rightLeg.rotation.x = v[i++]!;
  w.leftLeg.position.y = v[i++]!; w.rightLeg.position.y = v[i++]!;
  w.leftKnee.rotation.x = v[i++]!; w.rightKnee.rotation.x = v[i++]!;
  w.mouth.scale.y = v[i++]!; w.root.position.y = v[i++]!;
}

function setPose(worker: WorkerRig, stage: Stage, progress: number, now: number, gait: number) {
  const key = computePose(worker, stage, progress, now, gait);
  const target = poseJoints(worker);
  if (worker.pose && worker.poseKey !== undefined && worker.poseKey !== key) {
    worker.poseFrom = Float32Array.from(worker.pose);
    worker.poseBlendAt = now;
  }
  worker.poseKey = key;
  const since = worker.poseBlendAt === undefined ? Infinity : now - worker.poseBlendAt;
  if (worker.poseFrom && since < POSE_BLEND_S) {
    const t = ease(since / POSE_BLEND_S);
    const from = worker.poseFrom;
    for (let i = 0; i < target.length; i += 1) target[i] = from[i]! + (target[i]! - from[i]!) * t;
    writePoseJoints(worker, target);
  } else {
    worker.poseFrom = undefined;
  }
  worker.pose = Float32Array.from(target);
}

/** Turns a standing or seated worker toward `yawGoal` at a natural speed (shortest way round). */
function turnTowardGoal(worker: WorkerRig, dt: number) {
  if (worker.yawGoal === undefined) return;
  const diff = Math.atan2(Math.sin(worker.yawGoal - worker.root.rotation.y), Math.cos(worker.yawGoal - worker.root.rotation.y));
  if (Math.abs(diff) < 0.004) { worker.root.rotation.y = worker.yawGoal; worker.yawGoal = undefined; return; }
  worker.root.rotation.y += diff * Math.min(1, dt * 6);
}

/** Writes the stage's target pose onto the joints; returns the pose key (a change starts a cross-fade). */
function computePose(worker: WorkerRig, stage: Stage, progress: number, now: number, gait: number): string {
  let key: string = stage;
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
  } else if (stage === "meeting") {
    sitPose(worker, 1);
    // Seated discussion: speakers take turns; the speaker gestures and talks, the others nod.
    const speaking = Math.floor((now + worker.gait * 3.1) / 2.6) % 3 === 0;
    key = speaking ? "meeting:speaks" : "meeting:listens";
    worker.body.rotation.x = speaking ? 0.05 : 0.02;
    worker.head.rotation.x = Math.sin(now * (speaking ? 3 : 1.1) + worker.gait) * (speaking ? 0.08 : 0.05);
    worker.leftArm.rotation.x = -0.75 + (speaking ? Math.sin(now * 3.4 + worker.gait) * 0.3 : 0);
    worker.rightArm.rotation.x = -0.7 + (speaking ? Math.sin(now * 3 + worker.gait + 1.2) * 0.28 : 0);
    worker.leftElbow.rotation.x = -0.45;
    worker.rightElbow.rotation.x = -0.5;
    worker.mouth.scale.y = speaking ? 1 + Math.abs(Math.sin(now * 7 + worker.gait)) * 3 : 1;
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
  else if (stage === "rest" || stage === "work" || stage === "meeting") worker.root.position.y = FLOOR_Y + seatOffset;
  else if (stage === "rise") worker.root.position.y = FLOOR_Y + seatOffset * (1 - ease(progress));
  else if (stage === "sit") worker.root.position.y = FLOOR_Y + seatOffset * ease(progress);
  // The walk keeps its own small step bob (set above); it used to be overwritten here.
  else if (stage !== "walk-out" && stage !== "walk-back") worker.root.position.y = FLOOR_Y;
  if (worker.chair) worker.chair.position.z = worker.spec.z + (stage === "rise" ? ease(progress) * 0.4 : stage === "sit" ? (1 - ease(progress)) * 0.4 : 0);
  return key;
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

/** Doors from a worker's desk to the meeting table seat (reverse it to walk back). */
function meetingRoute(spec: WorkerSpec, seat: { x: number; z: number }): THREE.Vector3[] {
  const pts: [number, number][] = [];
  const near = seat.z < 5.25;
  if (spec.z > 2.05) {
    // Front row: the development room and the sound studio open straight into the meeting room.
    const side = spec.x >= 5 ? 4.4 : -0.5;
    pts.push(spec.x >= 5 ? [5, 5.1] : [-1.1, 5.9], [side, spec.x >= 5 ? 5.1 : 5.9], [side, near ? 3.4 : 6.95]);
  } else {
    if (spec.z < -2.55) {
      if (spec.x < -5.9) pts.push([-8.85, -2.55], [-8.85, AISLE_Z], [-5.9, AISLE_Z]);
      else if (spec.x < 2.5) pts.push([-1.7, -2.55], [-1.7, AISLE_Z]);
      else pts.push([7.2, -2.55], [6.1, 0.05], [5, AISLE_Z]);
    } else if (spec.x < -5.9) pts.push([spec.x, AISLE_Z], [-5.9, AISLE_Z]);
    else if (spec.x < 5) pts.push([spec.x, AISLE_Z]);
    else pts.push(...(spec.z < 0.05 ? [[6.1, 0.05] as [number, number]] : []), [5, AISLE_Z]);
    pts.push([0.75, AISLE_Z], [0.75, 2.05], [0.75, 3.4]);
    if (!near) pts.push([-0.5, 3.4], [-0.5, 6.95]);
  }
  pts.push([seat.x, near ? 3.4 : 6.95]);
  return pts.map(([x, z]) => new THREE.Vector3(x, FLOOR_Y, z));
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
  worker.yawGoal = undefined;
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
  // The camera looks at `viewTarget` from a fixed iso offset; wheel zoom and drag panning move only these two.
  const CAMERA_OFFSET = new THREE.Vector3(18, 25, 25);
  const HOME_VIEW = new THREE.Vector3(0, 0.6, -0.9);
  const viewTarget = HOME_VIEW.clone();
  // Goals the camera glides toward each frame (wheel, worker focus, double-click reset).
  const viewGoal = HOME_VIEW.clone();
  let zoomGoal = 1;
  const aimCamera = () => {
    camera.position.copy(viewTarget).add(CAMERA_OFFSET);
    camera.lookAt(viewTarget);
    camera.updateMatrixWorld();
  };
  aimCamera();
  // Bright, soft daylight: the key light sits on the camera side so the faces we see are lit, not the backs.
  scene.add(new THREE.HemisphereLight("#fffaf0", "#b9ad98", 1.75));
  const keyLight = new THREE.DirectionalLight("#fff1dc", 1.7);
  keyLight.position.set(14, 26, 12);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(4096, 4096);
  Object.assign(keyLight.shadow.camera, { left: -17, right: 17, top: 14, bottom: -14, near: 1, far: 80 });
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight("#dfe9ff", 0.55);
  fillLight.position.set(-14, 12, 6);
  scene.add(fillLight);

  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: "low-power", depth: true, stencil: false });
  // Owner 2026-11-26: "görüntü kalitesini arttır gerçekçi gözüksün … linkteki gibi": full device resolution (max 2),
  // soft real-time shadows and an image-based environment so materials pick up soft reflections.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.className = "oop-office-3d-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  // Screen overlay for room names and worker name tags: crisp text at any size, never mirrored like a 3D plaque.
  const overlay = document.createElement("div");
  overlay.className = "oop-office-overlay";
  container.replaceChildren(renderer.domElement, overlay);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = environment;
  scene.environmentIntensity = 0.42;

  const box = makeBoxFactory();
  const sphere = makeSphereFactory();
  const textures: THREE.Texture[] = [];
  const carpetTexture = makeParquetTexture();
  textures.push(carpetTexture);
  const addContactShadow = makeContactShadowFactory(textures);
  const room = new THREE.Group();
  scene.add(room);
  addFloorAndZones(box, room, textures, carpetTexture);
  addPlantAndWindows(box, room);
  addCourtyardDecoration(box, sphere, room);
  const driveStreet = addSiteAndStreet(box, room);

  // One level only: low open partitions, an uncluttered walking aisle, and a bright window line.
  const plantPositions = [
    [-11, -7.1], [-4.7, -7.1], [3.7, -7.1], [11, -7.1],
    [-11, -0.3], [-4.8, -0.3], [5.55, -1.65], [11, -0.6],
    [-11, 7.1], [-4.8, 7.1], [2.0, 7.1], [11, 7.1],
  ] as const;
  for (const [x, z] of plantPositions) addPlant(box, sphere, room, x, z);

  // Room names sit on the floor at each room's front edge (projected every frame into the overlay).
  const roomTags = ROOMS.map((item) => {
    // A room name is a link to that room's page (its workers, their limits and auditors).
    const tag = document.createElement("a");
    tag.href = roomHref(item.slug);
    tag.className = "oop-room-tag" + (item.gold ? " is-gold" : "");
    tag.textContent = item.name;
    overlay.append(tag);
    return { tag, at: new THREE.Vector3(item.x + (item.labelDx ?? 0), 0.05, item.z + item.sz / 2 - 0.42 + (item.labelDz ?? 0)) };
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
  addDesk(box, room, 3.85, -6.15, "#c99a52", { ledgers: true });
  addDesk(box, room, -7.0, -6.15, "#5fb8d8");
  addDesk(box, room, -3.4, -1.5, "#e8604a");
  addDesk(box, room, 3.3, -1.5, "#f0a060");
  addDesk(box, room, 7.2, 0.35, "#6f7fa6");
  addDesk(box, room, 4.3, 6.6, "#c0392b");
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
  for (const worker of workers) {
    mergeRigidParts(worker.root, new Set<THREE.Object3D>([worker.mouth, worker.selectedRing, worker.statusDisc]));
    if (worker.chair) mergeRigidParts(worker.chair, new Set());
  }
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
  // The overlay's size is measured on resize only: reading clientWidth every frame after the previous frame's style
  // writes forced a layout per frame. A transform that did not change is not written again.
  let overlayWidth = Math.max(1, container.clientWidth);
  let overlayHeight = Math.max(1, container.clientHeight);
  const lastTransform = new WeakMap<HTMLElement, string>();
  const place = (element: HTMLElement, world: THREE.Vector3, width: number, height: number) => {
    projected.copy(world).project(camera);
    const x = ((projected.x + 1) / 2) * width;
    const y = ((1 - projected.y) / 2) * height;
    const transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    if (lastTransform.get(element) === transform) return;
    lastTransform.set(element, transform);
    element.style.transform = transform;
  };
  const updateOverlay = () => {
    const width = overlayWidth;
    const height = overlayHeight;
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
      const selected = entry.worker.spec.brainId === selectedRef.current;
      if (entry.tag.classList.contains("is-selected") !== selected) entry.tag.classList.toggle("is-selected", selected);
      entry.worker.head.getWorldPosition(headPoint);
      headPoint.y += 0.42;
      place(entry.tag, headPoint, width, height);
    }
  };
  mergeRoomStatics(room);
  // Everything standing on the floor casts a shadow; floors, rugs, flat labels and glows only receive them.
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = !SHADOWLESS_NAME.test(object.name);
    object.receiveShadow = true;
  });
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
    // A narrow (phone) frame keeps the whole office width in view instead of cutting its sides off.
    const frustumHeight = Math.max(16.9, 25.4 / aspect);
    camera.left = (-frustumHeight * aspect) / 2;
    camera.right = (frustumHeight * aspect) / 2;
    camera.top = frustumHeight / 2;
    camera.bottom = -frustumHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    overlayWidth = width;
    overlayHeight = height;
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

  const meetingAssignments = new Map<number, WorkerRig>();
  const makeTrip = (worker: WorkerRig, now: number) => {
    // Second idle trip of a cycle: join the meeting table when a chair is free.
    const freeSeat = MEETING_SEATS.findIndex((_, index) => !meetingAssignments.has(index));
    // Half of the staff (odd first-move) meet on their first idle trip, the rest on their second, so the meeting
    // room is in use soon after the page opens rather than only after a minute and a half.
    const meetingTrip = worker.spec.firstMove % 2 === 1 ? 0 : 1;
    if (worker.loungeSeatIndex === undefined && worker.taskTripsSinceBreak === meetingTrip && freeSeat >= 0) {
      const seat = MEETING_SEATS[freeSeat]!;
      meetingAssignments.set(freeSeat, worker);
      worker.meetingSeatIndex = freeSeat;
      worker.meetingRoute = meetingRoute(worker.spec, seat);
      worker.destination = new THREE.Vector3(seat.x, FLOOR_Y, seat.z);
      worker.tripKind = "meeting";
      const points = [worker.root.position.clone(), ...worker.meetingRoute, worker.destination.clone()];
      worker.path = points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]!) > 0.14);
      worker.pathIndex = 1;
      worker.stage = "rise";
      worker.stageAt = now;
      worker.talkStarted = false;
      if (worker.chair) worker.chair.visible = true;
      return;
    }
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
    if (worker.tripKind === "meeting") {
      const points = [worker.root.position.clone(), ...[...(worker.meetingRoute ?? [])].reverse(), home];
      worker.path = points.filter((point, index) => index === 0 || point.distanceTo(points[index - 1]!) > 0.14);
      worker.pathIndex = 1;
      worker.stage = "walk-back";
      worker.stageAt = now;
      return;
    }
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
      // Both turn to each other over the first frames of the talk (the talk stage turns them), never in one frame.
    } else {
      worker.stage = "wait";
      worker.stageAt = now;
    }
  };

  const updateWorker = (worker: WorkerRig, now: number, dt: number) => {
    if (worker.stage !== "walk-out" && worker.stage !== "walk-back") turnTowardGoal(worker, dt);
    // Work given to a worker away from its desk (meeting, break, chat) calls it straight back to the desk.
    const called = statusRef.current[worker.spec.brainId];
    if ((called === "calisiyor" || called === "denetliyor" || called === "yonetiyor")
      && (worker.stage === "meeting" || worker.stage === "lounge" || worker.stage === "talk" || worker.stage === "wait"
        || worker.stage === "inspect" || worker.stage === "coffee")) {
      beginReturn(worker, now);
      return;
    }
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
      // Turns toward the first step while standing up; the walk finishes any turn that is left.
      if (worker.path[1]) worker.yawGoal = facingYaw(worker.path[1].x - worker.root.position.x, worker.path[1].z - worker.root.position.z);
      if (progress >= 1) {
        worker.stage = "walk-out";
        worker.stageAt = now;
      }
      return;
    }
    if (worker.stage === "walk-out") {
      const arrived = moveOnPath(worker, dt);
      setPose(worker, "walk-out", 1, now, worker.gait);
      if (arrived) {
        if (worker.tripKind === "meeting") {
          const seat = MEETING_SEATS[worker.meetingSeatIndex ?? 0]!;
          worker.stage = "meeting";
          worker.stageAt = now;
          worker.root.position.x = seat.x;
          worker.root.position.z = seat.z;
          worker.yawGoal = seat.yaw;
        } else if (worker.tripKind === "lounge") {
          worker.stage = "lounge";
          worker.stageAt = now;
          worker.yawGoal = 0;
        } else if (worker.spec.pair) startPairTalk(worker, now);
        else { worker.stage = "inspect"; worker.stageAt = now; }
      }
      return;
    }
    if (worker.stage === "meeting") {
      setPose(worker, "meeting", 1, now, 0);
      if (now - worker.stageAt > MEETING_SECONDS) beginReturn(worker, now);
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
        worker.yawGoal = worker.spec.homeYaw ?? Math.PI;
        if (worker.tripKind === "meeting") {
          if (worker.meetingSeatIndex !== undefined) meetingAssignments.delete(worker.meetingSeatIndex);
          worker.meetingSeatIndex = undefined;
          worker.meetingRoute = undefined;
          worker.taskTripsSinceBreak += 1;
        } else if (worker.tripKind === "lounge") {
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

  const onDoubleClick = () => { viewGoal.copy(HOME_VIEW); zoomGoal = 1; };
  const glideCamera = () => {
    const zoomStep = (zoomGoal - camera.zoom) * 0.14;
    const moved = viewTarget.distanceToSquared(viewGoal) > 1e-6;
    if (Math.abs(zoomStep) > 1e-4) { camera.zoom += zoomStep; camera.updateProjectionMatrix(); }
    if (moved && !drag?.moved) { viewTarget.lerp(viewGoal, 0.1); aimCamera(); }
  };
  const updateSelection = () => {
    if (selectedRef.current === lastSelected) return;
    lastSelected = selectedRef.current;
    // The camera glides to the newly selected worker so the owner sees who is acting.
    const focus = workers.find((worker) => worker.spec.brainId === lastSelected);
    if (focus) {
      viewGoal.set(focus.root.position.x, 0.6, focus.root.position.z);
      zoomGoal = Math.max(zoomGoal, 1.9);
    }
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
  // Wheel zooms toward detail (1×–3.5×); dragging pans across the floor. A drag never counts as a click.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomGoal = THREE.MathUtils.clamp(zoomGoal * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 0.5, 3.5);
  };
  const onPointerDown = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY, moved: false }; };
  const onPointerUp = () => { suppressClick = drag?.moved ?? false; drag = null; renderer.domElement.style.cursor = "grab"; };
  const onDragMove = (event: PointerEvent) => {
    if (!drag || (event.buttons & 1) === 0) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    renderer.domElement.style.cursor = "grabbing";
    const rect = renderer.domElement.getBoundingClientRect();
    const unitsPerPx = (camera.right - camera.left) / camera.zoom / Math.max(1, rect.width);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    viewTarget.addScaledVector(right, -dx * unitsPerPx).addScaledVector(up, dy * unitsPerPx);
    viewTarget.x = THREE.MathUtils.clamp(viewTarget.x, -22, 22);
    viewTarget.z = THREE.MathUtils.clamp(viewTarget.z, -18, 18);
    viewTarget.y = 0.6;
    viewGoal.copy(viewTarget);
    aimCamera();
  };
  const onClick = (event: MouseEvent) => {
    if (suppressClick) { suppressClick = false; return; }
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
  renderer.domElement.addEventListener("pointermove", onDragMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("click", onClick);
  renderer.domElement.addEventListener("dblclick", onDoubleClick);

  // Owner 2026-11-27 ("hareketler çok kasıyor"): the loop used to skip frames under 33 ms, which on a 60 Hz screen drew
  // at uneven 33/50 ms steps. Now every display frame is drawn and motion follows the real frame time. The costly
  // part — the 4096² soft shadow map — is redrawn at most every SHADOW_EVERY_MS (walking shadows lag invisibly), and a
  // machine that cannot keep up lowers the drawing resolution step by step instead of stuttering.
  const SHADOW_EVERY_MS = 32;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  let lastShadowAt = 0;
  const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let pixelRatio = maxPixelRatio;
  let slowFrames = 0;
  let fastFrames = 0;
  const adaptResolution = (frameMs: number) => {
    if (frameMs > 24) { slowFrames += 1; fastFrames = 0; } else if (frameMs < 14) { fastFrames += 1; slowFrames = Math.max(0, slowFrames - 1); }
    if (slowFrames >= 45 && pixelRatio > 1) {
      pixelRatio = Math.max(1, Math.round((pixelRatio - 0.25) * 100) / 100);
      slowFrames = 0;
      renderer.setPixelRatio(pixelRatio);
      resize();
    } else if (fastFrames >= 240 && pixelRatio < maxPixelRatio) {
      pixelRatio = Math.min(maxPixelRatio, pixelRatio + 0.25);
      fastFrames = 0;
      renderer.setPixelRatio(pixelRatio);
      resize();
    }
  };
  const animate = (timestamp: number) => {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    if (!visible || document.hidden) { previous = 0; return; }
    const frameMs = previous ? timestamp - previous : 1000 / 60;
    const dt = Math.min(0.05, frameMs / 1000);
    previous = timestamp;
    if (frameMs < 100) adaptResolution(frameMs);
    const now = (performance.now() - clockStart) / 1000;
    driveStreet(now);
    updateSelection();
    glideCamera();
    dispatchLoungeBreaks(now);
    for (const worker of workers) updateWorker(worker, now, dt);
    if (timestamp - lastShadowAt >= SHADOW_EVERY_MS) { renderer.shadowMap.needsUpdate = true; lastShadowAt = timestamp; }
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
    renderer.domElement.removeEventListener("pointermove", onDragMove);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("click", onClick);
    renderer.domElement.removeEventListener("dblclick", onDoubleClick);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material?.dispose?.();
      }
    });
    for (const texture of textures) texture.dispose();
    environment.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    container.replaceChildren();
  };
}

const LEGEND: readonly OfficeWorkerStatus[] = ["calisiyor", "denetliyor", "yonetiyor", "bitti", "bekliyor"];

export function AtolyeOffice3DScene({ selectedBrainId, onSelectBrain, statuses = {}, sourceLabel = "ÖRNEK" }: Props) {
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
      <span key={status}><i style={{ background: STATUS_COLOR[status] }} />{OFFICE_STATUS_LABEL[status]}</span>)}<span className="oop-legend-hint">tekerlek: yakınlaş/uzaklaş · sürükle: gez · çift tık: genel görünüm</span></div>
    <div className="oop-office-3d-note">{new Set(WORKERS.map((worker) => worker.brainId)).size} ÇALIŞAN · {sourceLabel}</div>
    <div className="oop-office-sr-list" aria-label="Ofisteki çalışan profilleri">{WORKERS.map((worker) => {
      const profile = getPreviewBrain(worker.brainId);
      return <button key={worker.key} type="button" onClick={() => onSelectBrain(worker.brainId)}>{profile.name} — {worker.key}</button>;
    })}</div>
  </>;
}
