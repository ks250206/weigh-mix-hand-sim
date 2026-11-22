import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import Hud from "./Hud";
import { createGame, startGame, stepGame } from "./game";
import { createScene } from "./scene";
import { LabAudio } from "./audio";
import type { GameInput, GameState, Station } from "./contract";
import "./style.css";

const BEST = "glovebox-panic.best.v1";
const SOUND = "glovebox-panic.sound.v1";
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private session */
  }
}
function neutral(s: GameState): GameInput {
  return { targetX: s.hand.x, targetY: s.hand.y, gripPressed: false, action: false, tilt: 0 };
}
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const playKeys = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
  "Space",
  "KeyQ",
  "KeyE",
  "KeyF",
  "KeyR",
]);
type Control = "door" | "grip" | "action" | "left" | "right";
type Scene = Awaited<ReturnType<typeof createScene>>;

function App() {
  const [initial] = useState(createGame);
  const game = useRef(initial);
  const [view, setView] = useState(initial);
  const [audio] = useState(() => new LabAudio());
  const [sound, setSound] = useState(() => read(SOUND) !== "off");
  audio.enabled = sound;
  const [best, setBest] = useState(() => Math.max(0, Number(read(BEST)) || 0));
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const input = useRef(neutral(initial));
  const keys = useRef(new Set<string>());
  const touch = useRef(new Set<Control>());
  const paused = useRef(false);
  const pendingGrip = useRef<Station | null>(null);
  const clearInput = useCallback(() => {
    input.current = neutral(game.current);
    keys.current.clear();
    touch.current.clear();
    pendingGrip.current = null;
  }, []);
  const pause = useCallback(
    (value: boolean) => {
      const resuming = paused.current && !value;
      paused.current = value;
      clearInput();
      if (resuming) {
        // Native dialogs restore their launch button's focus when they close.
        requestAnimationFrame(() => host.current?.focus({ preventScroll: true }));
      }
    },
    [clearInput],
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let frame = 0;
    let previousTime = 0;
    let debt = 0;
    let publishTime = 0;
    let lastSpillCue = -Infinity;
    const update = (time: number) => {
      if (disposed) return;
      const s = game.current;
      const dt = Math.min(0.25, Math.max(0, (time - (previousTime || time)) / 1000));
      previousTime = time;
      if (s.status === "playing" && !paused.current && !document.hidden) {
        debt += dt;
        const i = input.current,
          k = keys.current,
          t = touch.current;
        const axis = (negative: boolean, positive: boolean) => Number(positive) - Number(negative);
        const dx = axis(k.has("KeyA") || k.has("ArrowLeft"), k.has("KeyD") || k.has("ArrowRight"));
        const dy = axis(k.has("KeyW") || k.has("ArrowUp"), k.has("KeyS") || k.has("ArrowDown"));
        const oldStage = s.stage,
          oldSpill = s.spilled,
          oldGrip = s.hand.held;
        const tick = 1 / 60;
        while (debt >= tick && s.status === "playing") {
          const speed = 0.6 / Math.max(1, Math.hypot(dx, dy));
          i.targetX = clamp(i.targetX + dx * speed * tick);
          i.targetY = clamp(i.targetY + dy * speed * tick);
          i.action = k.has("Space") || t.has("action");
          i.tilt = axis(k.has("KeyQ") || t.has("left"), k.has("KeyE") || t.has("right"));
          // Finish a click at its original location even if the mouse has already moved on.
          const gripPoint = pendingGrip.current;
          if (gripPoint && Math.hypot(s.hand.x - gripPoint.x, s.hand.y - gripPoint.y) < 0.032) {
            i.gripPressed = true;
            pendingGrip.current = null;
          }
          const tickInput = gripPoint ? { ...i, targetX: gripPoint.x, targetY: gripPoint.y } : i;
          stepGame(s, tickInput, tick);
          i.gripPressed = false;
          i.doorPressed = false;
          debt -= tick;
        }
        const outcome: GameState["status"] = game.current.status;
        if (outcome === "won" || outcome === "lost") {
          audio.play(outcome);
          if (outcome === "won")
            setBest((last) => {
              const next = Math.max(last, s.score);
              save(BEST, String(next));
              return next;
            });
          clearInput();
          publishTime = 0;
        } else if (oldStage !== s.stage) {
          audio.play("step");
          publishTime = 0;
        } else if (s.spilled > oldSpill && time - lastSpillCue > 450) {
          audio.play("spill");
          lastSpillCue = time;
        } else if (oldGrip !== s.hand.held) audio.play("grip");
      } else {
        debt = 0;
      }
      scene.current?.draw(s);
      if (time - publishTime >= 80) {
        setView({ ...s });
        publishTime = time;
      }
      frame = requestAnimationFrame(update);
    };
    void createScene(el)
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        scene.current = created;
        setReady(true);
        frame = requestAnimationFrame(update);
      })
      .catch((error) => {
        if (!disposed) {
          console.error(error);
          setFailure("3D 描画を開始できませんでした。WebGL 2 を有効にして再読み込みしてください。");
        }
      });

    const handleKey = (e: KeyboardEvent, down: boolean) => {
      if (!playKeys.has(e.code)) return;
      if (!down) {
        keys.current.delete(e.code);
        return;
      }
      if (game.current.status !== "playing" || paused.current || e.altKey || e.ctrlKey || e.metaKey)
        return;
      if (
        e.target instanceof Element &&
        e.target.closest('input,select,textarea,dialog,[role="dialog"]')
      )
        return;
      if (e.target instanceof HTMLButtonElement && e.code === "Space") return;
      host.current?.focus({ preventScroll: true });
      e.preventDefault();
      keys.current.add(e.code);
      if (e.code === "KeyR" && !e.repeat) input.current.doorPressed = true;
      if (e.code === "KeyF" && !e.repeat) {
        pendingGrip.current = null;
        input.current.gripPressed = true;
      }
    };
    const keydown = (e: KeyboardEvent) => handleKey(e, true);
    const keyup = (e: KeyboardEvent) => handleKey(e, false);
    const reset = () => {
      clearInput();
      previousTime = 0;
      debt = 0;
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      scene.current?.destroy();
      scene.current = null;
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      audio.close();
    };
  }, [audio, clearInput]);

  const start = () => {
    if (failure) return;
    audio.unlock();
    audio.play("start");
    game.current = startGame();
    pause(false);
    setView({ ...game.current });
    host.current?.focus({ preventScroll: true });
  };
  const control = (c: Control, down: boolean) => {
    if (paused.current || game.current.status !== "playing") return;
    if (down) {
      audio.unlock();
      if (c === "grip") input.current.gripPressed = true;
      else if (c === "door") input.current.doorPressed = true;
      else touch.current.add(c);
    } else touch.current.delete(c);
    host.current?.focus({ preventScroll: true });
  };
  const aim = (clientX: number, clientY: number) => {
    const p = scene.current?.pick(clientX, clientY);
    if (!p || paused.current || game.current.status !== "playing") return;
    input.current.targetX = clamp(p.x);
    input.current.targetY = clamp(p.y);
  };
  const surface = (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
      <div
        ref={host}
        tabIndex={-1}
        role="application"
        aria-label="グローブボックス作業台"
        style={{
          width: "100%",
          height: "100%",
          touchAction: "none",
          outline: "none",
          overflow: "hidden",
        }}
        onPointerMove={(e) => aim(e.clientX, e.clientY)}
        onPointerDown={(e) => {
          if (e.button !== 0 || paused.current || game.current.status !== "playing") return;
          host.current?.focus({ preventScroll: true });
          aim(e.clientX, e.clientY);
          if (e.pointerType !== "touch") {
            pendingGrip.current = { x: input.current.targetX, y: input.current.targetY };
          } else e.currentTarget.setPointerCapture(e.pointerId);
        }}
      />
      {!ready && (
        <span
          role="status"
          style={{
            position: "absolute",
            inset: "40% 5% auto",
            textAlign: "center",
            color: "#ffffff",
            background: "#1c3177",
            padding: 12,
          }}
        >
          {failure || "作業台を準備しています…"}
        </span>
      )}
    </div>
  );
  return (
    <Hud
      state={view}
      scene={surface}
      onStart={start}
      onRestart={start}
      sound={sound}
      onSound={() => {
        const enabled = !sound;
        audio.enabled = enabled;
        setSound(enabled);
        save(SOUND, enabled ? "on" : "off");
        if (game.current.status === "playing") host.current?.focus({ preventScroll: true });
        if (enabled) {
          audio.unlock();
          audio.play("grip");
        }
      }}
      best={best}
      onControl={control}
      onPause={pause}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
