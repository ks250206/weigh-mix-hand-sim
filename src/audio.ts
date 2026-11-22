export type Cue = "start" | "grip" | "step" | "spill" | "won" | "lost";

const notes: Record<Cue, number[]> = {
  start: [392, 587],
  grip: [220],
  step: [494, 622, 740],
  spill: [175, 130],
  won: [392, 494, 587, 784],
  lost: [247, 196, 147],
};

export class LabAudio {
  private context?: AudioContext;
  enabled = false;

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
    if (!this.enabled || ctx?.state !== "running") return;
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
      oscillator.start(start);
      oscillator.stop(start + 0.15);
      oscillator.onended = () => {
        gain.disconnect();
        oscillator.disconnect();
      };
    });
  }

  close() {
    void this.context?.close().catch(() => {});
  }
}
