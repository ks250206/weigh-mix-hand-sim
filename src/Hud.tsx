import { memo, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { LABELS, mass, powders, bottles, recipe } from './contract'
import type { GameState } from './contract'
import './style.css'

type Control = 'door' | 'grip' | 'action' | 'left' | 'right'

interface HudProps {
  state: GameState
  scene: ReactNode
  onStart: () => void
  onRestart: () => void
  sound: boolean
  onSound: () => void
  best: number
  onControl: (control: Control, down: boolean) => void
  onPause: (paused: boolean) => void
}

function clock(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
}

const portrait = [
  '       dddddd       ',
  '     ddwwwwwwdd     ',
  '   ddwwwwwwwwwwd d  ',
  '  dwwwwwwwwwwwwwdd  ',
  '  dwwdddwwwwwddwwd  ',
  ' dwwdsssddwddssdwwd ',
  ' dwwdssssssssssdwwd ',
  ' dwwddddddddddddwwd ',
  '  dwdwddwddwddwdwd  ',
  '  dsdwddwddwddwdsd  ',
  '  dssddddssddddssd  ',
  '   ddssssssssssdd   ',
  '    dssswwwwsssd    ',
  '     dssmmmmssd     ',
  '      ddssssdd      ',
  '    ddwwddddwwdd    ',
  '  ddwwwwwsswwwwwdd  ',
  ' dwwwwdwddddwdwwwwd ',
  'dwwwwwdwdddddwwwwwwd',
]

const Professor = memo(function Professor({ mood }: { mood: 'angry' | 'tense' | 'calm' }) {
  const colors: Record<string, string> = { d: '#1c3177', w: '#ffffff', s: mood === 'angry' ? '#f49472' : mood === 'tense' ? '#e9b884' : '#d7c9a0', m: '#765546' }
  const pixels: string[] = []
  const expression = [...portrait]
  if (mood === 'angry') {
    expression[6] = ' dwwdddssssssdddwwd '
    expression[7] = ' dwwdssddddddssdwwd '
    expression[13] = '     dsmdwwdmsd     '
  } else if (mood === 'tense') {
    expression[6] = ' dwwdsddssssddsdwwd '
    expression[13] = '     dsssmmsssd     '
  }
  expression.forEach((row, y) => Array.from(row).forEach((pixel, x) => {
    if (pixel !== ' ') pixels.push(x + 'em ' + y + 'em ' + colors[pixel])
  }))
  return <div className={'portrait ' + mood} aria-hidden="true">
    <span className="portrait-sprite"><i style={{ boxShadow: pixels.join(',') }} /></span>
    {mood !== 'calm' && <b>{mood === 'angry' ? '!!' : '!'}</b>}
  </div>
})

function Readout({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="readout"><dt>{label}</dt><dd>{value}<small>{unit}</small></dd></div>
}

function Recipe({ readings }: { readings?: GameState['readings'] }) {
  return <table className="recipe-list" aria-label="各原料の秤量累計と目標">
    <thead><tr><th scope="col">原料</th>{readings && <th scope="col">秤量累計 / g</th>}<th scope="col">目標 / g</th></tr></thead>
    <tbody>{powders.map(powder => <tr key={powder}>
      <th scope="row">{LABELS[bottles[powder]]}</th>
      {readings && <td>{readings[powder] > 0 ? readings[powder].toFixed(3) : '—'}</td>}
      <td>{recipe[powder].toFixed(3)}</td>
    </tr>)}</tbody>
  </table>
}

const instructions = [
  ['移動', '作業台の上でマウスを動かすか、画面をなぞります。WASD・矢印キーでも移動できます。'],
  ['つかむ・放す', '器具に手を重ねてクリック、または F キー。もう一度押すと放します。タッチでは「つかむ」を使います。'],
  ['道具を使う', 'Space または「操作」を押します。粉を移す・混ぜるなどの連続操作は長押しします。'],
  ['天秤の風防', '左奥の天秤の前で R または「天秤の扉」。開けてホイルを置き、閉めて Space で風袋を引きます。粉を入れる時は再び開き、読み取る時は閉じます。'],
  ['すくう', '原料瓶を手前の作業面へ運び、開栓します。スパチュラを持ち、瓶口で Space を押しながら手前へ短く引きます。粉をホイルに注ぐ操作は Space ＋ Q または E です。'],
  ['傾ける', 'Q / E または左右の傾きボタンを長押しします。急な動きや傾けすぎは粉をこぼす原因になります。'],
]

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog className="hud-dialog" ref={ref} aria-labelledby="dialog-heading"
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="dialog-heading"><h2 id="dialog-heading">{title}</h2><button type="button" onClick={onClose} aria-label="閉じる">×</button></div>
    {children}
  </dialog>
}

export default function Hud({ state, scene, onStart, onRestart, sound, onSound, best, onControl, onPause }: HudProps) {
  const [dialog, setDialog] = useState<'help' | 'restart' | null>(null)
  const playing = state.status === 'playing'
  const title = state.status === 'title'
  const result = state.status === 'won' || state.status === 'lost'
  const anger = Math.round(state.anger)
  const pausedForDialog = useRef(false)
  const openDialog = (kind: 'help' | 'restart') => {
    pausedForDialog.current = playing
    if (playing) onPause(true)
    setDialog(kind)
  }
  const closeDialog = () => {
    if (pausedForDialog.current) onPause(false)
    pausedForDialog.current = false
    setDialog(null)
  }
  const stepText = String(Math.min(state.stage + 1, state.stageCount)).padStart(2, '0')
  const target = state.target && LABELS[state.target]
  const held = state.hand.held
  const load = held ? mass(state.objects[held]) : 0
  const tilt = Math.round(state.hand.tilt * 180 / Math.PI)
  const mood = anger >= 75 ? 'angry' : anger >= 40 ? 'tense' : 'calm'
  const quip = anger >= 75 ? '……君、その手を一度止めなさい。' : anger >= 40 ? '落ち着いて。試料は貴重だよ。' : '手元をよく見て。焦らずいこう。'

  function pad(control: Control, label: string, key: string) {
    return <button type="button" className="pad-button" disabled={!playing || !!dialog}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        onControl(control, true)
      }}
      onLostPointerCapture={() => onControl(control, false)}
      onClick={event => { if (event.detail === 0) { onControl(control, true); onControl(control, false) } }}>
      <kbd>{key}</kbd>{label}
    </button>
  }

  return <main className="hud">
    <header className="mast">
      <div className="wordmark"><span className="brand-icon" aria-hidden="true" /><h1>GLOVEBOX <em>PANIC</em></h1></div>
      <nav aria-label="ゲーム設定">
        <button type="button" className="utility" onClick={onSound} aria-pressed={sound}><span className={'sound-icon' + (sound ? ' enabled' : '')} aria-hidden="true"><i /><i /><i /></span>音声 {sound ? 'ON' : 'OFF'}</button>
        <button type="button" className="utility" onClick={() => openDialog('help')}><b className="help-icon" aria-hidden="true">?</b>遊び方</button>
        {playing && <button type="button" className="utility" onClick={() => openDialog('restart')}>やり直す</button>}
      </nav>
    </header>

    <div className="console">
      <section className="bench" aria-label="グローブボックス作業台">
        <div className="bench-head"><h2>作業台</h2><span className="view-state"><i className={'lamp' + (playing ? ' live' : '')} />{title ? 'STANDBY' : playing ? 'LIVE' : 'END'}</span></div>
        <div className="viewport">{scene}</div>
        <div className="bench-foot"><span>グローブ</span><strong>{held ? LABELS[held] : '手ぶら'}</strong>
          {held && <span className="held-load">{load.toFixed(3)} g</span>}
          <span className="balance-state">風防 {state.objects.scale.open ? '開' : '閉'} ・ {state.tared ? '風袋引き済' : '総量表示'}</span>
          <span className="tilt">傾き <b>{tilt > 0 ? '+' : ''}{tilt}°</b></span></div>
        {playing && <p className="feedback" role="status">{state.message}</p>}
      </section>

      <aside className="rail" aria-label="実験情報">
        <div className={'timer' + (state.remaining <= 60 ? ' urgent' : '')}>
          <div><span className="eyebrow">TIME LIMIT</span><h2>残り時間</h2></div>
          <strong>{clock(state.remaining)}</strong>
        </div>

        <section className={'mission' + (title ? ' opening' : '')}>
          <div className="mission-meta"><span className="eyebrow">{result ? 'RESULT' : title ? 'MISSION BRIEF' : 'PROCEDURE'}</span>{playing && <div className="step-count"><b>{stepText}</b><span> / {String(state.stageCount).padStart(2, '0')}</span></div>}</div>
          {title ? <>
            <h2><span>LGPS 原料の</span>秤量・混合</h2>
            <p>Li₁₀GeP₂S₁₂ 用の混合原料を 2.000 g 調製する。原料瓶と道具を両腕の間に運び、左奥の天秤で量ろう。</p>
            <Recipe />
            <button type="button" className="primary" onClick={onStart}>実験を始める <span aria-hidden="true">▶</span></button>
          </> : result ? <>
            <h2>{state.status === 'won' ? '実験完了' : '実験終了'}</h2>
            <p>{state.message}</p>
            <dl className="report">
              <div><dt>総合評価</dt><dd>{state.status === 'lost' ? '未完了' : state.score >= 9000 ? 'S' : state.score >= 7500 ? 'A' : state.score >= 6000 ? 'B' : 'C'}</dd></div>
              <div><dt>評価点</dt><dd>{state.score} 点</dd></div>
              <div><dt>残り時間</dt><dd>{clock(state.remaining)}</dd></div>
              <div><dt>回収率</dt><dd>{state.recovery.toFixed(1)} %</dd></div>
              <div><dt>先生の怒り</dt><dd>{anger} %</dd></div>
              <div><dt>自己ベスト</dt><dd>{best} 点</dd></div>
            </dl>
            <button type="button" className="primary" onClick={onRestart}>もう一度挑戦 <span aria-hidden="true">↻</span></button>
          </> : <>
            <h2>{state.stageName}</h2>
            <p>{state.hint}</p>
            {target && <div className="target"><span>対象</span>{target}</div>}
            <Recipe readings={state.readings} />
            <progress aria-label="現在の工程の進捗" value={state.progress} max={1} />
          </>}
        </section>

        <section className="professor" data-mood={mood}>
          <Professor mood={mood} />
          <div className="prof-info"><div className="prof-name"><h2>指導教員</h2><span>怒り <b>{anger}%</b></span></div>
            <meter aria-label="指導教員の怒り" min={0} max={100} value={anger} low={40} high={75} optimum={0} />
            <p>{quip}</p></div>
        </section>
      </aside>

      <section className="metrics" aria-label="試料の測定値">
        <div className="metrics-label"><span className="eyebrow">READOUT</span><h2>計測値</h2></div>
        <dl><Readout label={state.tared?"天秤・正味":"天秤・総量"} value={state.scaleMass.toFixed(3)} unit="g" /><Readout label="混合度" value={Math.round(state.mixed).toString()} unit="%" /><Readout label="回収量" value={state.vialMass.toFixed(3)} unit="g" /><Readout label="こぼれ" value={state.spilled.toFixed(3)} unit="g" /></dl>
      </section>
      <div className="control-dock" aria-label="操作パネル">
        <span className="move-tip"><kbd>WASD</kbd> / マウス・タッチで移動</span>
        <div className="pads">{pad('door','天秤の扉','R')}{pad('grip', 'つかむ／放す', 'F')}{pad('action', '操作', 'Space')}{pad('left', '左へ傾ける', 'Q')}{pad('right', '右へ傾ける', 'E')}</div>
      </div>
    </div>
    {dialog === 'help' && <Dialog title="操作マニュアル" onClose={closeDialog}>
      <p>作業台でグローブを動かし、工程欄の指示に沿って試料を瓶に回収します。</p>
      <dl className="manual">{instructions.map(([label, description]) => <div key={label}><dt>{label}</dt><dd>{description}</dd></div>)}</dl>
      <button type="button" className="primary" onClick={closeDialog}>{playing ? '実験に戻る' : '閉じる'} <span aria-hidden="true">→</span></button>
    </Dialog>}
    {dialog === 'restart' && <Dialog title="最初からやり直す？" onClose={closeDialog}>
      <p>現在の実験を終了し、残り時間 6:00 から始めます。</p>
      <div className="confirm-actions"><button type="button" className="secondary" onClick={closeDialog}>実験に戻る</button>
      <button type="button" className="primary" onClick={() => { closeDialog(); onRestart() }}>やり直す</button></div>
    </Dialog>}
  </main>
}
