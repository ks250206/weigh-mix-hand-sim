export interface GraphicsSettings {
  /** Rendered pixels per CSS pixel of the workbench. */
  resolution: 0.75 | 1 | 1.5 | 2
  fps: 30 | 60
  antialiasing: 'off' | 'fxaa'
  showFps: boolean
  shadows: boolean
  particles: 'low' | 'normal' | 'high'
}

const storageKey = 'glovebox-panic.graphics.v1'

export function defaultGraphics(): GraphicsSettings {
  const browser = typeof window !== 'undefined' ? window : undefined
  const compact = browser && (browser.matchMedia?.('(pointer: coarse)').matches || browser.innerWidth <= 600)
  if (compact) return { resolution: 1, fps: 30, shadows: false, particles: 'low', antialiasing: 'off', showFps: false }
  return {
    resolution: (browser?.devicePixelRatio ?? 1) >= 1.5 ? 1.5 : 1,
    fps: 60,
    antialiasing: 'off',
    showFps: false,
    shadows: true,
    particles: 'normal',
  }
}

function validated(value: unknown, defaults: GraphicsSettings): GraphicsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const { resolution, fps, shadows, particles, antialiasing, showFps } = value as Record<string, unknown>
  return {
    resolution: resolution === 0.75 || resolution === 1 || resolution === 1.5 || resolution === 2
      ? resolution : defaults.resolution,
    fps: fps === 30 || fps === 60 ? fps : defaults.fps,
    antialiasing: antialiasing === 'fxaa' || antialiasing === 'off' ? antialiasing : defaults.antialiasing,
    showFps: typeof showFps === 'boolean' ? showFps : defaults.showFps,
    shadows: typeof shadows === 'boolean' ? shadows : defaults.shadows,
    particles: particles === 'low' || particles === 'normal' || particles === 'high'
      ? particles : defaults.particles,
  }
}

export function loadGraphics(): GraphicsSettings {
  const defaults = defaultGraphics()
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? validated(JSON.parse(raw), defaults) : defaults
  } catch {
    return defaults
  }
}

export function saveGraphics(value: GraphicsSettings): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(validated(value, defaultGraphics())))
  } catch {
    // Blocked site storage or a full quota still allows live adjustments.
  }
}
