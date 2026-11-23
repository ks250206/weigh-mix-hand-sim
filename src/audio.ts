import { foilIds, type GameState } from "./contract.ts";
import { sceneDistance } from "./geometry.ts";

export type Cue = "start" | "grip" | "step" | "spill" | "won" | "lost" | "clean";

const notes: Record<Cue, number[]> = {
  start: [392, 587],
  grip: [220],
  step: [494, 622, 740],
  spill: [175, 130],
  won: [392, 494, 587, 784],
  lost: [247, 196, 147],
  clean: [880, 1175],
};

type Texture = "crease" | "powder" | "open" | "close" | "cap" | "impact" | "grind" | "wipe";
type LoopTexture = "grind" | "wipe";
const durations: Record<Texture, number> = { crease: 0.115, powder: 0.145, open: 0.16, close: 0.18, cap: 0.27, impact: 0.23, grind: 0.8, wipe: 0.65 };
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
    } else if (texture === "grind") {
      const rub = 0.45 + 0.55 * Math.sin(t * 34) ** 2;
      value = (softNoise * 0.25 + bright * 0.055 + Math.sin(tau * 840 * t) * 0.014) * rub;
    } else if (texture === "wipe") {
      value = (bright * 0.075 + softNoise * 0.13) * (0.45 + 0.55 * Math.sin(t * 22) ** 2);
    } else if (texture === "cap") {
      const scrape = softNoise * 0.16 * Math.sin(Math.PI * t / duration) ** 2;
      const ratchet = bright * 0.14 * (0.5 + 0.5 * Math.cos(t * 175)) ** 10;
      value = scrape + ratchet * Math.exp(-t * 6);
    } else if (texture === "impact") {
      value = (softNoise * 0.45 + Math.sin(tau * 210 * t) * 0.23 + Math.sin(tau * 670 * t) * 0.055) * Math.exp(-t * 32);
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
  private unfolded = new Uint8Array(foilIds.length);
  private lids = new Map<string, boolean>();
  private topples = 0;
  private hygiene: GameState['toolHygiene']['state'] = 'clean';
  private loops = new Map<LoopTexture, { source: AudioBufferSourceNode; gain: GainNode }>();
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
    this.loops.clear();
  }

  setPaused(value: boolean) {
    this.paused = value;
    if (value) this.silence();
  }

  reset(state: GameState) {
    this.silence();
    for (let i = 0; i < foilIds.length; i++) {
      this.folds[i] = state.objects[foilIds[i]].foldCount;
      this.unfolded[i] = Number(state.objects[foilIds[i]].unfolded);
    }
    for (const id of ['jarA', 'jarB', 'jarC', 'vial'] as const) this.lids.set(id, state.objects[id].open);
    this.topples = state.stats.topples;
    this.hygiene = state.toolHygiene.state;
    this.shieldOpen = state.objects.scale.open;
    this.transferSeq = state.transferSeq;
    this.nextGrain = 0;
  }

  observe(state: GameState, actionPressed = false) {
    for (let i = 0; i < foilIds.length; i++) {
      const count = state.objects[foilIds[i]].foldCount;
      if (count > this.folds[i]) this.texture("crease", count === 1 ? 0.92 : 1.16);
      this.folds[i] = count;
      const opened = Number(state.objects[foilIds[i]].unfolded);
      if (opened && !this.unfolded[i]) this.texture('crease', 0.72);
      this.unfolded[i] = opened;
    }
    const open = state.objects.scale.open;
    if (this.shieldOpen !== open) this.texture(open ? "open" : "close");
    this.shieldOpen = open;

    for (const id of ['jarA', 'jarB', 'jarC', 'vial'] as const) {
      const opened = state.objects[id].open;
      if (this.lids.has(id) && this.lids.get(id) !== opened) this.texture('cap', opened ? 1 : 0.85);
      this.lids.set(id, opened);
    }
    if (state.stats.topples > this.topples) this.texture('impact', 0.82);
    this.topples = state.stats.topples;
    if (this.hygiene === 'wet' && state.toolHygiene.state === 'clean') this.play('clean');
    this.hygiene = state.toolHygiene.state;
    const active = actionPressed && state.status === 'playing' && !this.paused;
    const speed = Math.hypot(state.hand.vx * 12, state.hand.vy * 6.5);
    const grinding = active && state.hand.held === 'pestle' && state.interactionTarget === 'mortar' &&
      state.actionReady && !state.objects.mortar.toppled && speed > 0.015;
    const wiping = active && state.hand.held === 'spatula' && state.toolHygiene.wipeProgress > 0 &&
      state.toolHygiene.state === 'dirty' && sceneDistance(state.hand, state.objects.cleaner) < 0.8;
    this.loop('grind', grinding, Math.min(0.9, 0.25 + speed * 0.32));
    this.loop('wipe', wiping, 0.7);

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

  private texture(name: Texture, rate = 1, level = 1) {
    const ctx = this.context;
    if (!this.enabled || this.paused || ctx?.state !== "running") return;
    let buffer = this.textures.get(name);
    if (!buffer) {
      buffer = synthesize(ctx, name);
      this.textures.set(name, buffer);
    }
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    gain.gain.value = level;
    source.connect(gain).connect(ctx.destination);
    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  private loop(name: LoopTexture, enabled: boolean, volume: number) {
    const ctx = this.context;
    enabled = enabled && this.enabled && !this.paused && ctx?.state === 'running';
    const current = this.loops.get(name);
    if (!enabled || !ctx) {
      if (current && ctx) {
        current.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.012);
        current.source.stop(ctx.currentTime + 0.05);
        this.loops.delete(name);
      }
      return;
    }
    if (current) {
      current.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.04);
      return;
    }
    let buffer = this.textures.get(name);
    if (!buffer) {
      buffer = synthesize(ctx, name);
      this.textures.set(name, buffer);
    }
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.025);
    source.connect(gain).connect(ctx.destination);
    this.active.add(source);
    this.loops.set(name, { source, gain });
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
      gain.disconnect();
      if (this.loops.get(name)?.source === source) this.loops.delete(name);
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
    if (cue === 'grip') { this.texture('impact', 1.45, 0.28); return; }
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
