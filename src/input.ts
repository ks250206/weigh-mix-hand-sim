import type { GameInput } from './contract.ts'

export type Control = 'door' | 'grip' | 'action' | 'pour' | 'left' | 'right' | 'support' | 'discard'
export type HoldMode = 'hold' | 'toggle'
export interface ControlSettings {
  holdMode: HoldMode
  keyboardSpeed: number
  bindings: KeyBindings
}
export interface RoundSummary {
  mode: 'standard' | 'practice'
  won: boolean
  score: number
  elapsed: number
  spilled: number
  completedSteps: number
  at: string
}
export type KeyBindings = Record<'action' | 'grip' | 'door' | 'left' | 'right' | 'support' | 'discard' | 'loupe', string>
export const defaultBindings: KeyBindings = {
  action: 'Space', grip: 'KeyF', door: 'KeyR', left: 'KeyQ', right: 'KeyE',
  support: 'ShiftLeft', discard: 'KeyX', loupe: 'KeyZ',
}
export function keyLabel(code: string) {
  return code === 'Space' ? 'Space' : code.startsWith('Shift') ? 'Shift' : code.replace(/^(Key|Digit)/, '')
}
export function validBindings(value: unknown): KeyBindings {
  if (!value || typeof value !== 'object') return { ...defaultBindings }
  const next = { ...defaultBindings }
  const taken = new Set<string>()
  for (const name of Object.keys(next) as (keyof KeyBindings)[]) {
    const key = (value as Record<string, unknown>)[name]
    const valid = typeof key === 'string' && /^(Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight)$/.test(key)
      && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(key) && !taken.has(key)
    next[name] = valid ? key : defaultBindings[name]
    if (taken.has(next[name])) return { ...defaultBindings }
    taken.add(next[name])
  }
  return next
}

/** Keep each held input separate: releasing one finger must not release another. */
export class Controls {
  private held = new Map<string, Control>()
  private latched = new Set<Control>()

  press(control: Control, source: string) { this.held.set(source, control) }
  release(source: string) { this.held.delete(source) }
  toggle(control: Control) {
    if (this.latched.has(control)) this.latched.delete(control)
    else {
      if (control === 'left') this.latched.delete('right')
      if (control === 'right') this.latched.delete('left')
      this.latched.add(control)
    }
  }
  active(control: Control) { return this.latched.has(control) || [...this.held.values()].includes(control) }
  activeList(): Control[] {
    return [...new Set<Control>([...this.held.values(), ...this.latched])]
  }
  clear() { this.held.clear(); this.latched.clear() }
  releaseActions() {
    for (const [source, control] of this.held) if (control !== 'support') this.held.delete(source)
    for (const control of this.latched) if (control !== 'support') this.latched.delete(control)
  }
  sample(keys: ReadonlySet<string>, bindings: KeyBindings = defaultBindings): Pick<GameInput, 'action' | 'tilt' | 'support' | 'discard'> {
    const on = (control: Exclude<Control, 'door' | 'grip'>) => this.active(control)
      || (control !== 'pour' && keys.has(bindings[control]))
      || (control === 'support' && bindings.support === 'ShiftLeft' && keys.has('ShiftRight'))
    const pour = on('pour')
    const direction = Number(on('right')) - Number(on('left'))
    return {
      action: on('action') || pour,
      tilt: direction || (pour ? 0.55 : 0),
      support: on('support'),
      discard: on('discard'),
    }
  }
}
