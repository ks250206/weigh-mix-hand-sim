export type ObjectId =
  | "foil"
  | "foil2"
  | "jarA"
  | "jarB"
  | "scale"
  | "mortar"
  | "spatula"
  | "pestle"
  | "vial"
  | "cap";
export type Station = { x: number; y: number };
export const HOME: Record<ObjectId, Station> = {
  jarA: { x: 0.13, y: 0.25 },
  jarB: { x: 0.32, y: 0.25 },
  scale: { x: 0.55, y: 0.26 },
  mortar: { x: 0.81, y: 0.33 },
  foil: { x: 0.17, y: 0.68 },
  spatula: { x: 0.38, y: 0.65 },
  foil2: { x: 0.59, y: 0.71 },
  pestle: { x: 0.82, y: 0.6 },
  vial: { x: 0.91, y: 0.84 },
  cap: { x: 0.76, y: 0.87 },
};
export const LABELS: Record<ObjectId, string> = {
  jarA: "試薬 A",
  jarB: "試薬 B",
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
  toppled: boolean;
  open: boolean;
  folded: boolean;
  a: number; // grams of powder A
  b: number; // grams of powder B
}
export interface GameInput {
  targetX: number;
  targetY: number;
  gripPressed: boolean;
  action: boolean;
  tilt: number;
}
export interface Grain extends Station {
  vx: number;
  vy: number;
  life: number;
  kind: "a" | "b";
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
