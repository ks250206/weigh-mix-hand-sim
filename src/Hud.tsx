import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { LABELS, activePowder, bottles, foldingFoil, isFoil, mass, powders, recipe, weighFoils, type GameState, type Powder } from './contract'
import { defaultGraphics, type GraphicsSettings } from './graphics'
import { defaultBindings, keyLabel, type Control, type ControlSettings, type KeyBindings, type RoundSummary } from './input'

interface HudProps {
  state: GameState; scene: ReactNode; ready: boolean
  onStart: (mode: 'standard' | 'practice') => void
  onRestart: (mode: 'standard' | 'practice') => void
  sound: boolean; onSound: () => void
  graphics: GraphicsSettings; onGraphics: (settings: GraphicsSettings) => void
  loupe: boolean; onLoupe: () => void
  settings: ControlSettings; onSettings: (settings: ControlSettings) => void
  touchDevice: boolean; activeControls: Control[]
  onControl: (control: Control, down: boolean, source: string) => void
  history: RoundSummary[]
  onPause: (paused: boolean) => void
  paused: boolean; pauseReason: string; onManualPause: () => void; onResume: () => void
  pendingGrip: boolean; onCancelPending: () => void
}
function clock(seconds: number) {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const mg = (g: number) => `${Math.round(Math.abs(g) * 1000)} mg`
const modeLabel = (mode: 'standard' | 'practice') => mode === 'practice' ? '練習' : '6分チャレンジ'
const Professor = memo(function Professor({ anger, won }: { anger: number; won: boolean }) {
  const mood = won ? 'happy' : anger >= 75 ? 'angry' : anger >= 40 ? 'tense' : 'calm'
  return <svg className={`professor-face ${mood}`} viewBox="0 0 60 60" aria-hidden="true">
    <rect x="0" y="0" width="60" height="60" rx="12" fill="currentColor" opacity=".08" />
    <path d="M8 60Q10 43 30 43Q50 43 52 60" fill="#fff" stroke="#1c3177" strokeWidth="2" />
    <path d="M24 45L30 56L36 45" fill="#1c3177" />
    <path d="M13 24Q9 7 30 6Q52 8 48 29" fill="#cad4dd" stroke="#1c3177" strokeWidth="2" />
    <path d="M15 22Q13 42 30 45Q47 42 45 22" fill={mood === 'angry' ? '#f3ab94' : '#edd2b6'} stroke="#1c3177" strokeWidth="1.6" />
    <path d="M14 25H27V33H15ZM33 25H46L45 33H33ZM27 28H33" fill="none" stroke="#1c3177" strokeWidth="2" />
    <circle cx="21" cy="29" r="1.7" fill="#1c3177" /><circle cx="39" cy="29" r="1.7" fill="#1c3177" />
    <path d={mood === 'happy' ? 'M24 36Q30 43 36 36' : mood === 'angry' ? 'M23 40Q30 33 37 40M17 21L26 24M34 24L43 21' : mood === 'tense' ? 'M24 39H36M16 22H26M34 22H44' : 'M25 38Q30 40 35 38'} fill="none" stroke="#1c3177" strokeWidth="2" strokeLinecap="round" />
  </svg>
})

function FoldGuide({ count, unfolded }: { count: number; unfolded: boolean }) {
  const steps = ['正方形', '一度折る', '二度折る', '開いて使用']
  const active = unfolded ? 3 : count
  return <ol className="fold-guide" aria-label="ホイルは二度折り、折り目を付けてから開いて使います">
    {steps.map((label, i) => <li key={label} aria-current={active === i ? 'step' : undefined}>
      <svg viewBox="0 0 50 42" aria-hidden="true">
        <path d={i === 1 ? 'M7 5L43 37H7Z' : i === 2 ? 'M7 5L25 21L7 37Z' : 'M7 5H43V37H7Z'} fill="#e1e7ed" stroke="#64758b" strokeWidth="1.5" />
        {i === 0 && <path d="M7 5L43 37" stroke="#1c3177" strokeDasharray="3 2" />}
        {i === 1 && <path d="M7 37L25 21" stroke="#1c3177" strokeDasharray="3 2" />}
        {i === 3 && <path d="M7 5L43 37M43 5L7 37" stroke="#7f96c2" strokeDasharray="3 2" />}
      </svg><span>{label}</span>
    </li>)}
  </ol>
}

function Recipe({ state }: { state: GameState }) {
  const active = activePowder(state.stage)
  const amount = (p: Powder) => state.objects[weighFoils[p]][p] + state.objects.spatula[p]
    + state.objects.mortar[p] + state.objects.foil2[p] + state.objects.vial[p]
  return <div className="recipe-wrap"><table className="recipe-list" aria-label="原料の目標量、現在残っている量、秤量した累計">
    <thead><tr><th>原料</th><th>目標 / g</th><th>有効量 / g</th><th>秤量累計 / g</th></tr></thead>
    <tbody>{powders.map(p => <tr key={p} aria-current={active === p ? 'step' : undefined}>
      <th scope="row">{LABELS[bottles[p]]}</th><td>{recipe[p].toFixed(3)}</td>
      <td className={amount(p) > recipe[p] + 0.002 ? 'overweight' : ''}>{amount(p).toFixed(3)}</td>
      <td>{state.readings[p].toFixed(3)}</td>
    </tr>)}</tbody>
  </table><p className="table-note">有効量は器具・瓶内に残る粉の合計。こぼれた分も含む秤量累計とは異なります。許容差は原料ごと ±2 mg。</p></div>
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close() }, [])
  return <dialog className="hud-dialog" ref={ref} aria-labelledby="dialog-heading"
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="dialog-heading"><h2 id="dialog-heading">{title}</h2><button type="button" onClick={onClose} aria-label="閉じる">×</button></div>{children}
  </dialog>
}
const bindingNames: Record<keyof KeyBindings, string> = {
  action: '対象を操作', grip: 'つかむ・置く', door: '風防を開閉', left: '左へ傾ける',
  right: '右へ傾ける', support: '左手で支える', discard: '少量を廃棄', loupe: '手元拡大',
}
type DialogName = 'help' | 'restart' | 'graphics' | 'controls'

export default function Hud(props: HudProps) {
  const { state: s, scene, ready, onStart, onRestart, sound, onSound, graphics, onGraphics,
    loupe, onLoupe, settings, onSettings, touchDevice, activeControls, onControl, history,
    onPause, paused, pauseReason, onManualPause, onResume, pendingGrip, onCancelPending } = props
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [keyError, setKeyError] = useState('')
  const playing = s.status === 'playing', title = s.status === 'title', result = !playing && !title
  const held = s.hand.held
  const load = held ? mass(s.objects[held]) : 0
  const powder = activePowder(s.stage)
  const sheet = foldingFoil(s.stage)
  const anger = Math.round(s.anger)
  const best = Math.max(0, ...history.filter(r => r.mode === s.mode && r.won).map(r => r.score))
  const previous = history.filter(r => r.mode === s.mode).slice(-2, -1)[0]
  const hygiene = s.toolHygiene
  const hygieneText = hygiene.state === 'wet' ? `乾燥中 ${Math.ceil(hygiene.dryRemaining)} 秒` : hygiene.state === 'dirty' ? '残粉あり・清拭が必要' : '清潔・乾燥済み'
  const statusLabel = paused ? '一時停止中' : title ? '準備中' : result ? '終了' : modeLabel(s.mode)
  const targetId = s.interactionTarget ?? s.target
  const target = targetId ? LABELS[targetId] : ''
  const formatHint = (text: string) => {
    const key = (name: keyof KeyBindings, touchLabel: string) => touchDevice ? `「${touchLabel}」` : keyLabel(settings.bindings[name])
    const names: Record<string, string> = { Space: key('action', '操作'), Shift: key('support', '左手で支える'),
      F: key('grip', 'つかむ／置く'), R: key('door', '天秤の扉'), X: key('discard', '微量廃棄'),
      Q: key('left', '左へ傾ける'), E: key('right', '右へ傾ける') }
    const phrase = touchDevice ? text.replace(/Space\s*[＋+]\s*Q\s*\/\s*E/g, '「ゆっくり注ぐ」') : text
    return phrase.replace(/\b(Space|Shift|F|R|X|Q|E)\b/g, token => names[token])
  }
  const shownHint = formatHint(s.hint)
  const openDialog = (kind: DialogName) => { if (playing) onPause(true); setDialog(kind) }
  const closeDialog = () => { setDialog(null); if (playing) onPause(false) }
  const padKeys = useRef(new Set<string>())
  const releaseKey = (control: Control, code: string) => {
    padKeys.current.delete(`${control}:${code}`)
    onControl(control, false, `key:${control}:${code}`)
  }
  function pad(control: Control, label: string, testId: string, extraClass = '') {
    const active = activeControls.includes(control)
    const key = control === 'pour' ? '' : keyLabel(settings.bindings[control])
    const continuous = control !== 'grip' && control !== 'door'
    return <button type="button" className={`pad-button ${extraClass} ${active ? 'active' : ''}`} data-testid={testId}
      disabled={!playing || paused || !!dialog} aria-pressed={continuous ? active : undefined}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        onControl(control, true, `pointer:${event.pointerId}`)
      }}
      onLostPointerCapture={event => onControl(control, false, `pointer:${event.pointerId}`)}
      onKeyDown={event => {
        if (event.code !== 'Space' && event.code !== 'Enter') return
        event.preventDefault(); event.stopPropagation()
        if (event.repeat || padKeys.current.has(`${control}:${event.code}`)) return
        padKeys.current.add(`${control}:${event.code}`)
        onControl(control, true, `key:${control}:${event.code}`)
      }}
      onKeyUp={event => {
        if (event.code !== 'Space' && event.code !== 'Enter') return
        event.preventDefault(); event.stopPropagation(); releaseKey(control, event.code)
      }}
      onBlur={() => { releaseKey(control, 'Space'); releaseKey(control, 'Enter') }}
      onClick={event => { if (event.detail === 0 && padKeys.current.size === 0) onControl(control, true, `virtual:${control}`) }}>
      {!touchDevice && key && <kbd>{key}</kbd>}<span>{label}</span>{continuous && active && <b className="control-on">ON</b>}
    </button>
  }
  const slowest = s.stageTimes.map((seconds, index) => ({ seconds, name: s.stageNames[index] })).sort((a, b) => b.seconds - a.seconds).slice(0, 3)
  const tip = s.stats.topples > 1 ? '移動中に器具へ接触しています。空いた経路を通り、置く直前に手を止めましょう。'
    : s.spilled > 0.05 ? 'こぼれが大きいようです。受け口の中央で手を止め、左手で支えてから少しずつ注ぎましょう。'
    : s.stats.reweighs > 0 ? '移し替えの損失が再秤量につながりました。受け口を確認し、微量注ぎで仕上げましょう。'
    : s.status === 'lost' ? 'まず練習モードで、時間を気にせず一連の操作を確認しましょう。'
    : '次は器具を使う順に配置し、移動距離を短くしてみましょう。'

  return <main className={`hud ${playing ? 'in-game' : ''}`}>
    <header className="mast"><div className="wordmark"><span className="brand-icon" aria-hidden="true" /><h1>GLOVEBOX <em>PANIC</em></h1><span className="brand-sub">秤量ハンドシミュレーター</span></div>
      <nav aria-label="ゲーム設定">
        <button type="button" className="utility sound-toggle" onClick={onSound} aria-pressed={sound} aria-label={`音声 ${sound ? 'ON' : 'OFF'}`}>{sound ? '♪ ON' : '♪ OFF'}</button>
        <button type="button" className="utility" onClick={() => openDialog('help')}>遊び方</button>
        <button type="button" className="utility" onClick={() => openDialog('controls')}>操作設定</button>
        <button type="button" className="utility graphics-toggle" onClick={() => openDialog('graphics')}>画質</button>
        {playing && <button type="button" className="utility pause-button" data-testid="pause" onClick={paused ? onResume : onManualPause}>{paused ? '再開' : '一時停止'}</button>}
      </nav>
    </header>

    <div className="console">
      <section className="live-strip" aria-label="実験中の重要な数値">
        <div className={`live-time ${s.mode === 'standard' && s.remaining <= 60 ? 'urgent' : ''}`}><span>{s.mode === 'practice' ? '制限なし' : '残り時間'}</span><strong data-testid="time-readout">{s.mode === 'practice' ? '∞' : clock(s.remaining)}</strong><small>{statusLabel}</small></div>
        <div className="live-mass"><span>{s.tared ? '天秤・正味' : '天秤・総量'}</span><strong data-testid="mass-readout">{s.scaleMass.toFixed(3)} <small>g</small></strong><small>{powder ? `${LABELS[bottles[powder]]} 目標 ${recipe[powder].toFixed(3)} g` : `回収 ${s.vialMass.toFixed(3)} g`}</small></div>
        <div className={`live-anger ${anger >= 75 ? 'angry' : anger >= 40 ? 'tense' : ''}`}><Professor anger={anger} won={s.status === 'won'} /><div><span>先生の怒り <strong data-testid="anger-readout">{anger}%</strong></span><meter aria-label="指導教員の怒り" min={0} max={100} value={anger} low={40} high={75} optimum={0} /><small>{s.professorFeedback || '落ち着いて、手元を見よう。'}</small></div></div>
      </section>

      <section className="bench" aria-label="グローブボックス作業台">
        <div className="bench-head"><span className="stage-chip">{playing ? `${String(s.stage + 1).padStart(2, '0')} / ${s.stageCount}` : 'LAB'}</span><h2>{playing ? s.stageName : 'グローブボックス'}</h2><button type="button" className="loupe-toggle" aria-pressed={loupe} onClick={onLoupe}>{touchDevice ? '' : `${keyLabel(settings.bindings.loupe)} `}手元拡大</button></div>
        <div className="viewport">{scene}
          {playing && paused && !dialog && ready && <div className="pause-overlay" role="region" aria-label="実験を一時停止しています"><h2>一時停止</h2><p>{pauseReason || '再開するまで時間も操作も止まります。'}</p><button type="button" className="primary" data-testid="resume" onClick={onResume}>実験に戻る</button></div>}
        </div>
        <div className="hand-strip" data-testid="hand-readout"><span>右手 <strong>{held ? LABELS[held] : '手ぶら'}</strong>{held && <small>粉 {load.toFixed(3)} g</small>}</span><span>左手 <strong>{s.supportTarget ? `${LABELS[s.supportTarget]}を支持` : activeControls.includes('support') ? '支持先を探しています' : '待機'}</strong></span><span className="balance-state" data-scale-stable={s.scaleStable} title="風防を閉じ、手と粉が落ち着くと天秤の表示が安定します">風防 {s.objects.scale.open ? '開' : '閉'} · {s.scaleStable ? '安定' : '安定待ち'}</span><span>傾き <b>{Math.round(s.hand.tilt * 180 / Math.PI)}°</b></span><span className="hygiene-compact" data-testid="hygiene-readout" data-hygiene={hygiene.state}>スパチュラ: {hygieneText}</span>{powder && <span className="hand-deficit">{Math.abs(s.needs[powder]) <= 0.002 ? '目標量 ±2 mg以内' : s.needs[powder] > 0 ? `不足 ${mg(s.needs[powder])}` : `過量 ${mg(s.needs[powder])}`}</span>}</div>
        {playing && <div className={`next-action ${s.actionReady ? 'ready' : ''}`}>
          <div className="next-action-title"><span className="action-dot" /><strong>{formatHint(s.actionLabel) || '次の操作'}</strong><span className="action-target">{target}</span></div>
          <p data-testid="mission-hint">{s.actionReady ? shownHint : formatHint(s.actionReason) || shownHint}</p>
          {pendingGrip && <button type="button" className="pending-cancel" onClick={onCancelPending}>移動後につかむ／放す予定 · 取消 {touchDevice ? '' : '(Esc)'}</button>}
        </div>}
      </section>

      <section className="control-dock" aria-label="操作パネル">
        <div className="primary-controls">
          {pad('grip', held && s.objects[held].spent ? 'ホイルを廃棄' : held ? '置く' : 'つかむ', 'grip-control')}
          {pad('action', formatHint(s.actionLabel) || '操作', 'action-control', 'main-action')}
          {pad('pour', 'ゆっくり注ぐ', 'pour-control')}
          {pad('support', '左手で支える', 'support-control')}
        </div>
        <div className="secondary-controls">{pad('door', '天秤の扉', 'door-control')}{pad('left', '左へ傾ける', 'tilt-left')}{pad('right', '右へ傾ける', 'tilt-right')}{pad('discard', '微量廃棄', 'discard-control')}</div>
        <div className="input-caption"><span>{touchDevice ? '作業台をなぞって移動' : 'マウス / WASD / 矢印で移動'} · {settings.holdMode === 'toggle' ? 'タップで保持、もう一度で解除' : 'ボタンを押している間だけ操作'}</span><button type="button" data-testid="hold-mode-toggle" onClick={() => onSettings({ ...settings, holdMode: settings.holdMode === 'hold' ? 'toggle' : 'hold' })}>{settings.holdMode === 'hold' ? 'タップ保持に切替' : '長押しに切替'}</button></div>
      </section>

      <aside className="rail" aria-label="実験の案内">
        {title ? <section className="mission opening"><span className="eyebrow">WEIGH · MIX · SEAL</span><h2>手先の研究、<br />はじめよう。</h2><p>Li₂S・GeS₂・P₂S₅ から、LGPS 用の混合原料 2.000 g を調製。粉をこぼさず、先生の怒りを抑えて密栓できる？</p>
          <div className="start-options"><button type="button" className="primary" data-testid="start-practice" disabled={!ready} onClick={() => onStart('practice')}><span>まずは練習<small>時間・怒りによる終了なし</small></span><b>→</b></button><button type="button" className="secondary start-standard" data-testid="start-standard" disabled={!ready} onClick={() => onStart('standard')}>6分チャレンジを始める</button></div>
          {!ready && <p className="table-note">描画の準備が完了すると開始できます。</p>}
          <details className="lesson"><summary>最初の30秒で覚えること</summary><ol><li>Li₂S用ホイルをつかみ、手前の枠へ運んで置く。</li><li>操作を押し、破線の端から端をなぞる。指を離して二度目。</li><li>折ったホイルを開く。折り目を付けた一枚のシートを天秤で使う。</li></ol><FoldGuide count={0} unfolded={false} /></details>
        </section> : result ? <section className="mission result-panel"><span className="eyebrow">{modeLabel(s.mode)} · RESULT</span><h2>{s.status === 'won' ? '密栓、完了！' : '今回はここまで'}</h2><p>{s.message}</p>
          <div className="score-heading"><strong>{s.score.toLocaleString()}<small>点</small></strong><span>{s.status === 'won' ? s.score >= 9000 ? 'S' : s.score >= 7500 ? 'A' : s.score >= 6000 ? 'B' : 'C' : `${s.stats.completedSteps} 工程完了`}</span></div>
          <dl className="report"><div><dt>実験時間</dt><dd>{clock(s.elapsed)}</dd></div><div><dt>回収率</dt><dd>{s.recovery.toFixed(1)}%</dd></div><div><dt>こぼれ / 最大の一回</dt><dd>{mg(s.spilled)} / {mg(s.stats.maxSpill)}</dd></div><div><dt>適正廃棄した粉</dt><dd>{mg(powders.reduce((total, p) => total + s.discardedMass[p], 0))}</dd></div><div><dt>清拭に使用したワイプ</dt><dd>{s.toolHygiene.wipesUsed} 枚</dd></div><div><dt>転倒 / 再秤量</dt><dd>{s.stats.topples} / {s.stats.reweighs} 回</dd></div><div><dt>同じモードの自己ベスト</dt><dd>{best.toLocaleString()} 点</dd></div>{previous && <div><dt>前回との比較</dt><dd>{s.score >= previous.score ? '+' : ''}{s.score - previous.score} 点</dd></div>}</dl>
          <p className="next-tip"><strong>次のコツ</strong>{tip}</p>
          <details className="stage-report"><summary>時間がかかった工程</summary><ol>{slowest.filter(v => v.seconds > 0).map((v, i) => <li key={i}><span>{v.name}</span><b>{clock(v.seconds)}</b></li>)}</ol></details>
          <button type="button" className="primary" disabled={!ready} onClick={() => onRestart(s.mode)}>もう一度挑戦 <span>↻</span></button>{s.mode === 'standard' && s.status === 'lost' && <button type="button" className="secondary" onClick={() => onRestart('practice')}>練習モードに切り替える</button>}
        </section> : <>
          <section className="tool-status" data-hygiene={hygiene.state}><div><span className="eyebrow">SPATULA</span><strong>{hygieneText}</strong></div><p>{hygiene.state === 'dirty' ? `残粉: ${hygiene.residue.map(p => LABELS[bottles[p]]).join('・')}。別原料の前に、清拭台で無水エタノールを含ませた新しいワイプで清拭。` : hygiene.state === 'wet' ? '濡れたまま粉に触れないでください。乾燥が終わるまで待ちます。' : '清潔なスパチュラで、次の原料を扱えます。'}</p>{hygiene.wipeProgress > 0 && hygiene.wipeProgress < 1 && <progress max={1} value={hygiene.wipeProgress} aria-label="清拭の進捗" />}<small>使用したワイプ {hygiene.wipesUsed} 枚</small></section>
          <details className="procedure-details" open={!touchDevice}><summary>手順・配合を確認 <span>{s.stage + 1} / {s.stageCount}</span></summary><div className="procedure-content"><h3>{s.stageName}</h3><p>{shownHint}</p>{sheet && <FoldGuide count={s.objects[sheet].foldCount} unfolded={s.objects[sheet].unfolded} />}<progress value={s.progress} max={1} aria-label="現在の工程の進捗" /><Recipe state={s} /><ol className="procedure-list">{s.stageNames.map((name, i) => <li key={i} aria-current={i === s.stage ? 'step' : undefined} className={i < s.stage ? 'done' : ''}>{name}</li>)}</ol></div></details>
          <button type="button" className="restart-link" onClick={() => openDialog('restart')}>最初からやり直す</button>
        </>}
      </aside>

      {playing && <section className="experiment-detail" aria-label="試料の状態"><div className="sample-summary"><span>混合 <b>{Math.round(s.mixed)}%</b></span><span>回収 <b>{s.vialMass.toFixed(3)} g</b></span><span>こぼれ <b>{mg(s.spilled)}</b></span><span>適正廃棄 <b>{mg(powders.reduce((n, p) => n + s.discardedMass[p], 0))}</b></span></div>{powder && <div className="current-deficit">{LABELS[bottles[powder]]}: {Math.abs(s.needs[powder]) <= 0.002 ? '許容範囲内' : s.needs[powder] > 0 ? `あと ${mg(s.needs[powder])}` : `${mg(s.needs[powder])} 多い — 少量を取り除く`}</div>}<div className="mix-coverage" aria-label="乳鉢の8領域の混合状態">{s.mixCoverage.map((v, i) => <span key={i} title={`領域 ${i + 1}`} style={{ opacity: 0.2 + Math.min(1, v) * 0.8 }} />)}</div><p className="feedback" role="status">{s.message}</p></section>}
    </div>

    {dialog === 'help' && <Dialog title="手を動かして覚えよう" onClose={closeDialog}><p>まず練習モードで一工程ずつ。操作できないときは、作業台下に理由が表示されます。</p><FoldGuide count={0} unfolded={false} /><dl className="manual"><div><dt>1. つかむ・置く</dt><dd>{touchDevice ? '指で手を動かし「つかむ」。もう一度で置きます。' : '器具に手を合わせてクリック、または F。遠い地点のクリックは移動後に実行され、Escで取り消せます。'}空いている場所へ置くときは、手を止めましょう。</dd></div><div><dt>2. ホイルを二度折り、開く</dt><dd>手前で「操作」を押して破線の端から端へ。一度解除して二本目もなぞり、その後「開く」でシートに戻して使います。</dd></div><div><dt>3. 正確に量る</dt><dd>風防を開けてホイルを皿へ。閉じて風袋を引き、原料をすくいます。「ゆっくり注ぐ」は操作と傾きを一つのボタンで行えます。目標の±2 mgを狙い、入れすぎは少量ずつ取り除きます。</dd></div><div><dt>4. 原料を変える前に清拭</dt><dd>スパチュラを清拭台へ持っていき、無水エタノールを含ませた新しいワイプで清拭します。乾燥するまでは次の粉に触れません。清拭台では X /「微量廃棄」で余った粉を処理できます。</dd></div><div><dt>5. 両手で支え、全体を混ぜる</dt><dd>「左手で支える」または Shift で容器を支えます。乳鉢の8領域を小さく円を描くように混ぜ、回収ホイル、サンプル瓶の順に注いで密栓します。</dd></div><div><dt>6. 中断・操作の負担を減らす</dt><dd>一時停止 / Esc で止められます。画面を離れても自動停止。操作設定の「タップ保持」は、押し続けずに手を動かせます。再タップで解除し、工程が変わると自動解除します。</dd></div></dl><button type="button" className="primary" onClick={closeDialog}>{playing ? '実験に戻る' : 'わかった'}</button></Dialog>}
    {dialog === 'controls' && <Dialog title="操作設定" onClose={closeDialog}><div className="graphics-settings"><label>画面ボタン<select value={settings.holdMode} onChange={e => onSettings({ ...settings, holdMode: e.target.value as ControlSettings['holdMode'] })}><option value="hold">押している間だけ</option><option value="toggle">タップで保持・解除</option></select></label><label>キーでの移動速度<select value={settings.keyboardSpeed} onChange={e => onSettings({ ...settings, keyboardSpeed: Number(e.target.value) })}><option value={0.3}>ゆっくり・精密</option><option value={0.6}>標準</option><option value={0.9}>速い</option></select></label></div><h3 className="settings-subhead">キー割り当て</h3><p className="table-note">欄を選んで使いたいキーを押します。WASD・矢印は移動、Escは一時停止に固定です。</p><div className="key-bindings">{(Object.keys(bindingNames) as (keyof KeyBindings)[]).map(name => <label key={name}>{bindingNames[name]}<input aria-label={`${bindingNames[name]}のキー`} readOnly value={keyLabel(settings.bindings[name])} onKeyDown={e => {
      e.preventDefault(); e.stopPropagation()
      if (!/^(Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight)$/.test(e.code) || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { setKeyError('英字・数字・Space・Shiftを選んでください。WASDは移動に使います。'); return }
      if ((Object.keys(settings.bindings) as (keyof KeyBindings)[]).some(other => other !== name && settings.bindings[other] === e.code)) { setKeyError('そのキーは別の操作に割り当てられています。'); return }
      setKeyError(''); onSettings({ ...settings, bindings: { ...settings.bindings, [name]: e.code } })
    }} /></label>)}</div>{keyError && <p role="status" className="key-error">{keyError}</p>}<div className="confirm-actions"><button type="button" className="secondary" onClick={() => { setKeyError(''); onSettings({ holdMode: touchDevice ? 'toggle' : 'hold', keyboardSpeed: 0.6, bindings: { ...defaultBindings } }) }}>初期設定に戻す</button><button type="button" className="primary" onClick={closeDialog}>閉じる</button></div></Dialog>}
    {dialog === 'graphics' && <Dialog title="画質設定" onClose={closeDialog}><div className="graphics-settings"><label>描画解像度<select value={graphics.resolution} onChange={e => onGraphics({ ...graphics, resolution: Number(e.target.value) as GraphicsSettings['resolution'] })}>{[0.75, 1, 1.5, 2].map(scale => <option key={scale} value={scale}>{scale * 100}%</option>)}</select></label><label>FPS上限<select value={graphics.fps} onChange={e => onGraphics({ ...graphics, fps: Number(e.target.value) as GraphicsSettings['fps'] })}><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label><label>アンチエイリアス<select value={graphics.antialiasing} onChange={e => onGraphics({ ...graphics, antialiasing: e.target.value as GraphicsSettings['antialiasing'] })}><option value="off">なし</option><option value="fxaa">FXAA</option></select></label><label>粉の表示量<select value={graphics.particles} onChange={e => onGraphics({ ...graphics, particles: e.target.value as GraphicsSettings['particles'] })}><option value="low">少なめ</option><option value="normal">標準</option><option value="high">多め</option></select></label><label>道具の影<input type="checkbox" checked={graphics.shadows} onChange={e => onGraphics({ ...graphics, shadows: e.target.checked })} /></label><label>FPSを表示<input type="checkbox" checked={graphics.showFps} onChange={e => onGraphics({ ...graphics, showFps: e.target.checked })} /></label></div><div className="graphics-presets"><button type="button" className="secondary" onClick={() => onGraphics({ ...graphics, resolution: 0.75, fps: 30, shadows: false, particles: 'low', antialiasing: 'off' })}>軽量</button><button type="button" className="secondary" onClick={() => onGraphics({ ...graphics, resolution: 2, fps: 60, shadows: true, particles: 'high', antialiasing: 'fxaa' })}>高画質</button><button type="button" className="secondary" onClick={() => onGraphics(defaultGraphics())}>初期値</button></div><button type="button" className="primary" onClick={closeDialog}>閉じる</button></Dialog>}
    {dialog === 'restart' && <Dialog title="最初からやり直す？" onClose={closeDialog}><p>今回の途中経過を終了し、{modeLabel(s.mode)}を新しく始めます。</p><div className="confirm-actions"><button type="button" className="secondary" onClick={closeDialog}>続ける</button><button type="button" className="primary" onClick={() => { closeDialog(); onRestart(s.mode) }}>やり直す</button></div></Dialog>}
  </main>
}
