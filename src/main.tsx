import { createRoot } from 'react-dom/client'
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Hud from './Hud'
import { loadGraphics, saveGraphics } from './graphics'
import { createGame, startGame, stepGame } from './game'
import { createScene } from './scene'
import { LabAudio } from './audio'
import { foilIds } from './contract'
import type { GameInput, GameState, Station } from './contract'
import { Controls, validBindings, type Control, type ControlSettings, type RoundSummary } from './input'
import './style.css'

const SOUND = 'glovebox-panic.sound.v1'
const LOUPE = 'glovebox-panic.loupe.v1'
const SETTINGS = 'glovebox-panic.controls.v2'
const HISTORY = 'glovebox-panic.history.v2'
const read = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const save = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* private session */ } }
const coarsePointer = () => window.matchMedia('(pointer: coarse)').matches
function loadControls(): ControlSettings {
  let value: Partial<ControlSettings> = {}
  try { value = JSON.parse(read(SETTINGS) || '{}') || {} } catch { /* use defaults */ }
  return {
    holdMode: value.holdMode === 'hold' || value.holdMode === 'toggle' ? value.holdMode : coarsePointer() ? 'toggle' : 'hold',
    keyboardSpeed: [0.3, 0.6, 0.9].includes(value.keyboardSpeed ?? 0) ? value.keyboardSpeed! : 0.6,
    bindings: validBindings(value.bindings),
  }
}
function loadHistory(): RoundSummary[] {
  try {
    const value: unknown = JSON.parse(read(HISTORY) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((r): r is RoundSummary => !!r && typeof r === 'object'
      && ['standard', 'practice'].includes(r.mode) && typeof r.won === 'boolean'
      && ['score', 'elapsed', 'spilled', 'completedSteps'].every(k => Number.isFinite(r[k]) && r[k] >= 0)
      && typeof r.at === 'string').slice(-20)
  } catch { return [] }
}
const neutral = (s: GameState): GameInput => ({ targetX: s.hand.x, targetY: s.hand.y, gripPressed: false, action: false, tilt: 0, support: false, discard: false })
const clamp = (v: number) => Math.min(1, Math.max(0, v))
const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'])
const openable = ['jarA', 'jarB', 'jarC', 'vial'] as const
type Scene = Awaited<ReturnType<typeof createScene>>
type PendingGrip = Station & { screenX: number; screenY: number }

function App() {
  const [graphics, setGraphics] = useState(loadGraphics)
  const graphicsRef = useRef(graphics)
  const [initial] = useState(createGame)
  const game = useRef(initial)
  const [view, setView] = useState(initial)
  const [sound, setSound] = useState(() => read(SOUND) !== 'off')
  const [audio] = useState(() => new LabAudio(sound))
  const [history, setHistory] = useState(loadHistory)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState('')
  const [sceneGeneration, setSceneGeneration] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene | null>(null)
  const redraw = useRef(true)
  const [loupe, setLoupe] = useState(() => read(LOUPE) === 'on')
  const loupeRef = useRef(loupe)
  const [settings, setSettings] = useState(loadControls)
  const settingsRef = useRef(settings)
  const [touchDevice, setTouchDevice] = useState(coarsePointer)
  const [controls] = useState(() => new Controls())
  const [activeControls, setActiveControls] = useState<Control[]>([])
  const input = useRef(neutral(initial))
  const keys = useRef(new Set<string>())
  const paused = useRef(false)
  const manualPause = useRef(false)
  const dialogPause = useRef(false)
  const [pauseReason, setPauseReason] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [pending, setPending] = useState<PendingGrip | null>(null)
  const pendingGrip = useRef<PendingGrip | null>(null)
  const touchPointer = useRef<number | null>(null)
  const clearInput = useCallback(() => {
    input.current = neutral(game.current)
    keys.current.clear()
    controls.clear()
    setActiveControls([])
    pendingGrip.current = null
    setPending(null)
    touchPointer.current = null
  }, [controls])
  const updatePause = useCallback(() => {
    const value = manualPause.current || dialogPause.current
    const resuming = paused.current && !value
    paused.current = value
    setIsPaused(value)
    audio.setPaused(value)
    scene.current?.setPaused(value)
    clearInput()
    redraw.current = true
    if (resuming) requestAnimationFrame(() => host.current?.focus({ preventScroll: true }))
  }, [audio, clearInput])
  const pauseForDialog = useCallback((value: boolean) => {
    dialogPause.current = value
    updatePause()
  }, [updatePause])
  const stop = useCallback((reason = 'ひと休み。再開するまで時間も操作も止まります。') => {
    if (game.current.status !== 'playing') return
    manualPause.current = true
    setPauseReason(reason)
    updatePause()
  }, [updatePause])
  const resume = useCallback(() => {
    manualPause.current = false
    setPauseReason('')
    audio.unlock()
    updatePause()
  }, [audio, updatePause])
  const cancelPending = useCallback(() => {
    pendingGrip.current = null
    setPending(null)
    input.current.targetX = game.current.hand.x
    input.current.targetY = game.current.hand.y
  }, [])
  const toggleLoupe = useCallback(() => {
    const enabled = !loupeRef.current
    loupeRef.current = enabled
    setLoupe(enabled)
    scene.current?.setLoupe(enabled)
    redraw.current = true
    save(LOUPE, enabled ? 'on' : 'off')
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)')
    const change = () => setTouchDevice(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let frame = 0
    let previousTime = 0
    let debt = 0
    let publishTime = 0
    let lastDraw = 0
    let lastSpillCue = -Infinity
    let published: GameState | null = null
    const fail = (error: unknown) => {
      if (disposed) return
      console.error(error)
      setReady(false)
      setFailure('作業台を描画できませんでした。下の「描画を再試行」を押してください。')
      stop('描画が中断されたため、実験を停止しました。')
    }
    const update = (time: number) => {
      if (disposed) return
      const s = game.current
      const dt = Math.min(0.25, Math.max(0, (time - (previousTime || time)) / 1000))
      previousTime = time
      const running = s.status === 'playing' && !paused.current && !document.hidden
      if (running) {
        debt += dt
        const i = input.current, k = keys.current
        const axis = (a: boolean, b: boolean) => Number(b) - Number(a)
        const dx = axis(k.has('KeyA') || k.has('ArrowLeft'), k.has('KeyD') || k.has('ArrowRight'))
        const dy = axis(k.has('KeyW') || k.has('ArrowUp'), k.has('KeyS') || k.has('ArrowDown'))
        const oldStage = s.stage, oldSpill = s.spilled, oldGrip = s.hand.held
        const tick = 1 / 60
        while (debt >= tick && s.status === 'playing') {
          const speed = settingsRef.current.keyboardSpeed / Math.max(1, Math.hypot(dx, dy))
          i.targetX = clamp(i.targetX + dx * speed * tick)
          i.targetY = clamp(i.targetY + dy * speed * tick)
          Object.assign(i, controls.sample(k, settingsRef.current.bindings))
          const point = pendingGrip.current
          if (point && Math.hypot(s.hand.x - point.x, s.hand.y - point.y) < 0.032) {
            i.gripPressed = true
            pendingGrip.current = null
            setPending(null)
          }
          // Context actions may prepare any foil, even ahead of the suggested stage.
          const oldFoils = foilIds.map(id => ({ count: s.objects[id].foldCount, unfolded: s.objects[id].unfolded }))
          const oldOpen = openable.map(id => s.objects[id].open)
          const oldHygiene = s.toolHygiene.state
          const previousStage = s.stage
          stepGame(s, point ? { ...i, targetX: point.x, targetY: point.y } : i, tick)
          audio.observe(s, i.action)
          if (previousStage !== s.stage
            || foilIds.some((id, index) => oldFoils[index].count !== s.objects[id].foldCount || oldFoils[index].unfolded !== s.objects[id].unfolded)
            || openable.some((id, index) => oldOpen[index] !== s.objects[id].open)
            || oldHygiene !== 'wet' && s.toolHygiene.state === 'wet') {
            controls.releaseActions()
            setActiveControls(controls.activeList())
          }
          i.gripPressed = false
          i.doorPressed = false
          debt -= tick
        }
        const outcome: GameState['status'] = game.current.status
        if (outcome === 'won' || outcome === 'lost') {
          audio.play(outcome)
          setHistory(last => {
            const next = [...last, {
              mode: s.mode, won: outcome === 'won', score: s.score, elapsed: s.elapsed,
              spilled: s.spilled, completedSteps: s.stats.completedSteps, at: new Date().toISOString(),
            }].slice(-20)
            save(HISTORY, JSON.stringify(next))
            return next
          })
          clearInput()
          publishTime = 0
        } else if (oldStage !== s.stage) {
          audio.play('step')
          publishTime = 0
        } else if (s.spilled > oldSpill && time - lastSpillCue > 450) {
          audio.play('spill')
          lastSpillCue = time
        } else if (oldGrip !== s.hand.held) audio.play('grip')
      } else debt = 0
      const interval = 1000 / graphicsRef.current.fps
      if (!document.hidden && (redraw.current || running && time - lastDraw >= interval - 0.5)) {
        lastDraw = time
        redraw.current = false
        try { scene.current?.draw(s) } catch (error) { fail(error); return }
      }
      if (published !== s || running && time - publishTime >= 80) {
        setView({ ...s })
        published = s
        publishTime = time
      }
      frame = requestAnimationFrame(update)
    }
    setReady(false)
    setFailure('')
    void createScene(el, graphicsRef.current).then(created => {
      if (disposed) { created.destroy(); return }
      scene.current = created
      created.setGraphics(graphicsRef.current)
      created.setLoupe(loupeRef.current)
      created.setPaused(paused.current)
      setReady(true)
      redraw.current = true
      frame = requestAnimationFrame(update)
    }).catch(fail)

    const handleKey = (e: KeyboardEvent, down: boolean) => {
      const bindings = settingsRef.current.bindings
      if (!down) { keys.current.delete(e.code); return }
      if (e.target instanceof Element && e.target.closest('input,select,textarea,dialog,[role="dialog"]')) return
      if (e.code === 'Escape' && game.current.status === 'playing') {
        e.preventDefault()
        if (e.repeat) return
        if (pendingGrip.current) cancelPending()
        else if (manualPause.current) resume()
        else stop()
        return
      }
      if (game.current.status !== 'playing' || paused.current || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return
      const known = movementKeys.has(e.code) || Object.values(bindings).includes(e.code)
        || (bindings.support === 'ShiftLeft' && e.code === 'ShiftRight')
      if (!known) return
      e.preventDefault()
      host.current?.focus({ preventScroll: true })
      if (e.code === bindings.loupe) { if (!e.repeat) toggleLoupe(); return }
      keys.current.add(e.code)
      if (e.code === bindings.door && !e.repeat) input.current.doorPressed = true
      if (e.code === bindings.grip && !e.repeat) {
        cancelPending()
        input.current.gripPressed = true
      }
    }
    const keydown = (e: KeyboardEvent) => handleKey(e, true)
    const keyup = (e: KeyboardEvent) => handleKey(e, false)
    const blur = () => {
      previousTime = 0; debt = 0
      stop('画面から離れたため、一時停止しました。準備ができたら再開してください。')
    }
    const visibility = () => {
      previousTime = 0; debt = 0
      if (document.hidden) stop('画面を閉じたため、一時停止しました。')
      else redraw.current = true
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      scene.current?.destroy()
      scene.current = null
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [audio, cancelPending, clearInput, controls, resume, sceneGeneration, stop, toggleLoupe])
  useEffect(() => () => audio.close(), [audio])

  const start = (mode: 'standard' | 'practice' = game.current.mode) => {
    if (!ready || failure) return
    audio.unlock()
    game.current = startGame(mode)
    audio.reset(game.current)
    manualPause.current = false
    dialogPause.current = false
    setPauseReason('')
    updatePause()
    audio.play('start')
    setView({ ...game.current })
    redraw.current = true
    host.current?.focus({ preventScroll: true })
    if (touchDevice) window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const control = (c: Control, down: boolean, source: string) => {
    if (!down) {
      controls.release(source)
      setActiveControls(controls.activeList())
      return
    }
    if (paused.current || game.current.status !== 'playing') return
    audio.unlock()
    if (c === 'grip') { cancelPending(); input.current.gripPressed = true }
    else if (c === 'door') input.current.doorPressed = true
    else if (source.startsWith('virtual:') || (source.startsWith('pointer:') && (settingsRef.current.holdMode === 'toggle' || c === 'support'))) controls.toggle(c)
    else controls.press(c, source)
    setActiveControls(controls.activeList())
  }
  const aim = (clientX: number, clientY: number) => {
    const p = scene.current?.pick(clientX, clientY)
    if (!p || paused.current || game.current.status !== 'playing') return
    input.current.targetX = clamp(p.x)
    input.current.targetY = clamp(p.y)
  }
  const surface = <div className="scene-host-wrap">
    <div ref={host} tabIndex={-1} role="application" aria-label="グローブボックス作業台" data-testid="workbench" className="scene-host"
      onPointerMove={e => {
        if (e.pointerType === 'touch' && touchPointer.current !== e.pointerId) return
        aim(e.clientX, e.clientY)
      }}
      onPointerDown={e => {
        if (e.button !== 0 || paused.current || game.current.status !== 'playing') return
        if (e.pointerType === 'touch' && touchPointer.current !== null) return
        host.current?.focus({ preventScroll: true })
        aim(e.clientX, e.clientY)
        if (e.pointerType === 'touch') {
          touchPointer.current = e.pointerId
          e.currentTarget.setPointerCapture(e.pointerId)
        } else {
          const s = game.current
          if (controls.sample(keys.current, settingsRef.current.bindings).action) return
          const rect = e.currentTarget.getBoundingClientRect()
          const point = { x: input.current.targetX, y: input.current.targetY, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top }
          if (Math.hypot(s.hand.x - point.x, s.hand.y - point.y) < 0.032) input.current.gripPressed = true
          else { pendingGrip.current = point; setPending(point) }
        }
      }}
      onLostPointerCapture={e => { if (touchPointer.current === e.pointerId) touchPointer.current = null }}
    />
    {pending && <span className="grip-reservation" data-testid="pending-grip" style={{ left: pending.screenX, top: pending.screenY }} aria-hidden="true"><i />つかむ／放す予約</span>}
    {!ready && <div className="render-message" role={failure ? 'alert' : 'status'}>
      <strong>{failure || '作業台を準備しています…'}</strong>
      {failure && <button type="button" className="secondary" data-testid="retry-render" onClick={() => { setFailure(''); setSceneGeneration(v => v + 1) }}>描画を再試行</button>}
    </div>}
  </div>
  return <Hud state={view} scene={surface} onStart={start} onRestart={start} ready={ready && !failure}
    loupe={loupe} onLoupe={toggleLoupe} graphics={graphics}
    onGraphics={next => { graphicsRef.current = next; setGraphics(next); scene.current?.setGraphics(next); redraw.current = true; saveGraphics(next) }}
    settings={settings} onSettings={next => {
      const valid = { ...next, bindings: validBindings(next.bindings) }
      settingsRef.current = valid; setSettings(valid); clearInput(); save(SETTINGS, JSON.stringify(valid))
    }} touchDevice={touchDevice} activeControls={activeControls} onControl={control}
    sound={sound} onSound={() => {
      const enabled = !sound
      audio.enabled = enabled
      if (!enabled) audio.silence()
      setSound(enabled); save(SOUND, enabled ? 'on' : 'off')
      if (enabled) { audio.unlock(); audio.play('grip') }
    }} history={history} onPause={pauseForDialog} paused={isPaused} pauseReason={pauseReason}
    onManualPause={() => stop()} onResume={resume} pendingGrip={!!pending} onCancelPending={cancelPending}
  />
}

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error(error) }
  render() {
    if (this.state.failed) return <main className="fatal-error" role="alert"><h1>画面の表示が中断されました</h1><p>再読み込みすると、保存済みの設定と記録を保ったまま新しく始められます。</p><button type="button" onClick={() => location.reload()}>再読み込み</button></main>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<AppBoundary><App /></AppBoundary>)
