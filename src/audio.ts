import { foilIds, type GameState } from "./contract.ts";

export type Cue = "start" | "grip" | "step" | "spill" | "won" | "lost";

const notes: Record<Cue, number[]> = {
  start: [392, 587],
  grip: [220],
  step: [494, 622, 740],
  spill: [175, 130],
  won: [392, 494, 587, 784],
  lost: [247, 196, 147],
};

type Texture = "crease" | "powder" | "open" | "close";
const durations = { crease: 0.115, powder: 0.145, open: 0.16, close: 0.18 };
const tau = 2 * Math.PI;

// Short mono recordings synthesized once per context. The noise bed is shaped
// into paper-thin crackles, fine grains, or the rub of a sliding glass panel.
function synthesize(ctx: AudioContext, texture: Texture) {
  const duration = durations[texture];
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  let previousNoise = 0;
  let softNoise = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / ctx.sampleRate;
    const noise = Math.random() * 2 - 1;
    const bright = (noise - previousNoise) * 0.5;
    softNoise += (noise - softNoise) * 0.22;
    previousNoise = noise;
    let value: number;
    if (texture === "crease") {
      // A cluster of tiny snaps, then the softer release of the bent sheet.
      const snaps = Math.exp(-t * 44) * (0.3 + 0.7 * Math.cos(t * 139) ** 12);
      value = (0.32 * bright + 0.035 * Math.sin(tau * 2870 * t)) * snaps;
    } else if (texture === "powder") {
      const flow = softNoise * 0.22 * Math.exp(-t * 23);
      const landing = Math.max(0, t - 0.04);
      const taps = t < 0.04 ? 0 : (0.5 + 0.5 * Math.cos(landing * 365)) ** 9;
      const impact = bright * 0.19 + 0.035 * Math.sin(tau * 1590 * landing);
      value = flow + taps * Math.exp(-landing * 37) * impact;
    } else {
      const opening = texture === "open";
      const slide = Math.sin(Math.PI * t / duration) ** 2;
      const click = t - (opening ? 0.012 : 0.103);
      const fundamental = opening ? 1770 : 1230;
      const ring = click < 0 ? 0 : Math.exp(-click * 71) * (
        Math.sin(tau * fundamental * click) + 0.36 * Math.sin(tau * 3310 * click)
      );
      value = 0.15 * softNoise * slide + (opening ? 0.058 : 0.09) * ring;
    }
    samples[i] = value * Math.min(1, t / 0.002, (duration - t) / 0.009);
  }
  return buffer;
}

export class LabAudio {
  private context?: AudioContext;
  private textures = new Map<Texture, AudioBuffer>();
  private active = new Set<AudioScheduledSourceNode>();
  private folds = new Uint8Array(foilIds.length);
  private shieldOpen = false;
  private transferSeq = 0;
  private nextGrain = 0;
  private paused = false;

  enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  silence() {
    for (const source of this.active) {
      source.disconnect();
      source.stop();
    }
    this.active.clear();
  }

  setPaused(value: boolean) {
    this.paused = value;
    if (value) this.silence();
  }

  reset(state: GameState) {
    this.silence();
    for (let i = 0; i < foilIds.length; i++) this.folds[i] = state.objects[foilIds[i]].foldCount;
    this.shieldOpen = state.objects.scale.open;
    this.transferSeq = state.transferSeq;
    this.nextGrain = 0;
  }

  observe(state: GameState) {
    for (let i = 0; i < foilIds.length; i++) {
      const count = state.objects[foilIds[i]].foldCount;
      if (count > this.folds[i]) this.texture("crease", count === 1 ? 0.92 : 1.16);
      this.folds[i] = count;
    }
    const open = state.objects.scale.open;
    if (this.shieldOpen !== open) this.texture(open ? "open" : "close");
    this.shieldOpen = open;

    if (state.transferSeq === this.transferSeq) return;
    this.transferSeq = state.transferSeq;
    const ctx = this.context;
    const packet = state.powderTransfers.at(-1);
    if (ctx?.state !== "running" || !packet || ctx.currentTime < this.nextGrain) return;
    if (!this.enabled || this.paused) return;
    this.nextGrain = ctx.currentTime + 0.105;
    const pitch = packet.to === "mortar" ? 0.81 : packet.to === "vial" ? 1.22 : 1;
    this.texture("powder", pitch * (0.95 + Math.random() * 0.1));
  }

  private texture(name: Texture, rate = 1) {
    const ctx = this.context;
    if (!this.enabled || this.paused || ctx?.state !== "running") return;
    let buffer = this.textures.get(name);
    if (!buffer) {
      buffer = synthesize(ctx, name);
      this.textures.set(name, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(ctx.destination);
    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
    };
    source.start();
  }

  unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended") void this.context.resume().catch(() => {});
    } catch {
      /* Audio is optional when the device has no sound output. */
    }
  }

  play(cue: Cue) {
    const ctx = this.context;
    if (!this.enabled || this.paused || ctx?.state !== "running") return;
    notes[cue].forEach((frequency, i) => {
      const start = ctx.currentTime + i * 0.085;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = cue === "spill" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.065, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain).connect(ctx.destination);
      this.active.add(oscillator);
      oscillator.start(start);
      oscillator.stop(start + 0.15);
      oscillator.onended = () => {
        this.active.delete(oscillator);
        gain.disconnect();
        oscillator.disconnect();
      };
    });
  }

  close() {
    this.silence();
    this.textures.clear();
    void this.context?.close().catch(() => {});
  }
}
