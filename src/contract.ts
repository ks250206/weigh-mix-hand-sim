export type ObjectId =
  | "foil"
  | "foil2"
  | "jarA"
  | "jarB"
  | "jarC"
  | "work"
  | "scale"
  | "mortar"
  | "spatula"
  | "pestle"
  | "vial"
  | "cap";
export type Station = { x: number; y: number };
export const HOME: Record<ObjectId, Station> = {
  scale: { x: 0.15, y: 0.18 },
  jarA: { x: 0.42, y: 0.16 },
  jarB: { x: 0.59, y: 0.16 },
  jarC: { x: 0.76, y: 0.16 },
  mortar: { x: 0.89, y: 0.38 },
  foil: { x: 0.14, y: 0.49 },
  foil2: { x: 0.12, y: 0.75 },
  spatula: { x: 0.39, y: 0.4 },
  pestle: { x: 0.65, y: 0.4 },
  vial: { x: 0.89, y: 0.64 },
  cap: { x: 0.88, y: 0.83 },
  work: { x: 0.5, y: 0.75 },
};
export const LABELS: Record<ObjectId, string> = {
  jarA: "Li₂S",
  jarB: "GeS₂",
  jarC: "P₂S₅",
  work: "手前の作業面",
  scale: "電子天秤",
  mortar: "乳鉢",
  foil: "秤量ホイル",
  spatula: "スパチュラ",
  foil2: "回収ホイル",
  pestle: "乳棒",
  vial: "サンプル瓶",
  cap: "瓶の蓋",
};
export interface TableObject extends Station {
  tilt: number; // signed radians
  yaw?: number; // scene yaw from in-plane rigid-body rotation, radians
  toppled: boolean;
  open: boolean;
  folded: boolean;
  a: number; // Li2S, g
  b: number; // GeS2, g
  c: number; // P2S5, g
}
export interface GameInput {
  targetX: number;
  targetY: number;
  gripPressed: boolean;
  doorPressed?: boolean;
  action: boolean;
  tilt: number;
}
export interface Grain extends Station {
  vx: number;
  vy: number;
  life: number;
  kind: Powder;
}
export interface GameState {
  status: "title" | "playing" | "won" | "lost";
  stage: number; // zero-based; stageCount includes all required steps
  stageCount: number;
  stageName: string;
  hint: string;
  target: ObjectId | null;
  remaining: number;
  anger: number;
  mixed: number; // seconds, anger 0..100, uniformity 0..100
  scaleMass: number;
  tared: boolean;
  scoopDepth: number;
  readings: Record<Powder, number>;
  spilledMass: Record<Powder, number>;
  vialMass: number;
  spilled: number;
  recovery: number; // grams; recovery in percent
  score: number;
  message: string;
  progress: number; // stage progress 0..1
  hand: Station & { vx: number; vy: number; tilt: number; held: ObjectId | null };
  objects: Record<ObjectId, TableObject>;
  particles: Grain[];
}

export const powders = ["a", "b", "c"] as const;
export type Powder = (typeof powders)[number];
export const bottles = { a: "jarA", b: "jarB", c: "jarC" } as const;
// Nominal 2.000 g LGPS batch: 5 Li2S : 1 GeS2 : 1 P2S5 (moles), rounded to 1 mg.
export const recipe = { a: 0.78, b: 0.465, c: 0.755 };
export const foilWeight = 0.12;
export const workArea = { left: 0.25, right: 0.75, back: 0.53, front: 0.95 };
export function inWork(p: Station) {
  return (
    p.x >= workArea.left && p.x <= workArea.right && p.y >= workArea.back && p.y <= workArea.front
  );
}
export const workPositions = {
  foil: { x: 0.42, y: 0.82 },
  mortar: { x: 0.53, y: 0.82 },
  jarA: { x: 0.34, y: 0.62 },
  jarB: { x: 0.5, y: 0.62 },
  jarC: { x: 0.68, y: 0.62 },
  foil2: { x: 0.32, y: 0.85 },
  vial: { x: 0.71, y: 0.86 },
} as const;
export const mass = (o: TableObject) => o.a + o.b + o.c;
