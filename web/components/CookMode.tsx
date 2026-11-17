"use client";
import { useEffect, useRef, useState } from "react";
import type { RecipeLine, RecipeRow } from "@/lib/api";

export const COOK_KEY = "pk-cook"; // slug recepta koji se trenutno kuha
const doneKey = (slug: string) => `pk-cook-done-${slug}`;
const TIMER_KEY = "pk-cook-timer"; // { end: ms, total: s }

type WakeLock = { release: () => Promise<void> };

function beep() {
  try {
    const A = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new A();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch {}
  navigator.vibrate?.([300, 150, 300, 150, 300]);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Timer() {
  const [t, setT] = useState<{ end: number; total: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const rang = useRef(false);
  useEffect(() => {
    try { const s = localStorage.getItem(TIMER_KEY); if (s) setT(JSON.parse(s)); } catch {}
  }, []);
  useEffect(() => {
    if (!t) return;
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, [t]);
  const save = (v: typeof t) => {
    setT(v); rang.current = false;
    try { v ? localStorage.setItem(TIMER_KEY, JSON.stringify(v)) : localStorage.removeItem(TIMER_KEY); } catch {}
  };
  const left = t ? Math.max(0, Math.round((t.end - now) / 1000)) : 0;
  useEffect(() => {
    if (t && left === 0 && !rang.current) { rang.current = true; beep(); }
  }, [t, left]);
  const start = (min: number) => save({ end: Date.now() + min * 60_000, total: min * 60 });
  const add = (min: number) => t && save({ end: Math.max(Date.now(), t.end) + min * 60_000, total: t.total + min * 60 });

  if (!t)
    return (
      <div className="timer">
        <span className="tl">⏱ Minutaža</span>
        <div className="tbtns">
          {[1, 5, 10, 15, 30, 45].map((m) => <button key={m} className="pill" onClick={() => start(m)}>{m} min</button>)}
        </div>
      </div>
    );
  const done = left === 0;
  return (
    <div className={"timer run" + (done ? " done" : "")}>
      <div className="tring" style={{ ["--p" as string]: `${t.total ? (1 - left / t.total) * 100 : 100}%` }}>
        <b>{done ? "Gotovo!" : fmt(left)}</b>
      </div>
      <div className="tbtns">
        <button className="pill" onClick={() => add(1)}>+1 min</button>
        <button className="pill" onClick={() => add(5)}>+5 min</button>
        <button className="pill" onClick={() => save(null)}>{done ? "OK" : "Poništi"}</button>
      </div>
    </div>
  );
}

export default function CookMode({ recipe, lines, onClose }: { recipe: RecipeRow; lines: RecipeLine[]; onClose: () => void }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const [awake, setAwake] = useState<boolean | null>(null);
  const lock = useRef<WakeLock | null>(null);
  const ingr = lines.filter((l) => !l.is_header);

  // stanje kvačica po receptu (preživi odlazak na Coolinariku)
  useEffect(() => {
    try { setDone(new Set(JSON.parse(localStorage.getItem(doneKey(recipe.slug)) ?? "[]"))); } catch {}
    try { localStorage.setItem(COOK_KEY, recipe.slug); } catch {}
  }, [recipe.slug]);
  const toggle = (pos: number) => {
    const s = new Set(done);
    if (s.has(pos)) s.delete(pos); else s.add(pos);
    setDone(s);
    try { localStorage.setItem(doneKey(recipe.slug), JSON.stringify([...s])); } catch {}
  };

  // zaslon ostaje upaljen; ponovno zatraži nakon povratka u aplikaciju
  useEffect(() => {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } }).wakeLock;
    if (!wl) { setAwake(false); return; }
    const req = () => wl.request("screen").then((l) => { lock.current = l; setAwake(true); }).catch(() => setAwake(false));
    req();
    const vis = () => document.visibilityState === "visible" && req();
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); lock.current?.release().catch(() => {}); };
  }, []);

  // tipka "natrag" na mobitelu zatvara način kuhanja, a ne aplikaciju
  useEffect(() => {
    history.pushState({ cook: 1 }, "");
    const pop = () => { try { localStorage.removeItem(COOK_KEY); } catch {} onClose(); };
    window.addEventListener("popstate", pop);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("popstate", pop); document.body.style.overflow = ""; };
  }, [onClose]);

  const close = () => {
    try { localStorage.removeItem(COOK_KEY); } catch {}
    history.state?.cook ? history.back() : onClose();
  };
  const reset = () => { setDone(new Set()); try { localStorage.removeItem(doneKey(recipe.slug)); } catch {} };
  const n = ingr.filter((l) => done.has(l.pos)).length;

  return (
    <div className="cook" role="dialog" aria-modal="true" aria-label={"Kuhanje: " + recipe.title}>
      <header className="cook-h">
        <button className="cook-x" onClick={close} aria-label="Zatvori">✕</button>
        <div className="grow">
          <b className="ell">{recipe.title}</b>
          <span className="muted xs">{awake ? "🔆 Zaslon ostaje upaljen" : recipe.servings ? `🍽 ${recipe.servings}` : "Način kuhanja"}</span>
        </div>
      </header>

      <div className="cook-body">
        <a className="cook-open" href={recipe.url} target="_blank" rel="noreferrer">
          {recipe.image && <img src={recipe.image} alt="" />}
          <span className="grow">
            <b>📖 Otvori pripremu</b>
            <span className="small">Postupak na Coolinarici — vrati se ovdje kad trebaš sastojke ili minutažu.</span>
          </span>
          <span className="arr">↗</span>
        </a>

        <Timer />

        <div className="cook-prog">
          <span><b>Pripremljeno {n}/{ingr.length}</b></span>
          {n > 0 && <button className="link muted" onClick={reset}>Poništi</button>}
        </div>
        <div className="bar big"><i style={{ width: `${ingr.length ? (n / ingr.length) * 100 : 0}%` }} /></div>

        <ul className="cook-list">
          {lines.map((l) =>
            l.is_header ? (
              <li key={l.pos} className="hdr">{l.line}</li>
            ) : (
              <li key={l.pos}>
                <button className={done.has(l.pos) ? "on" : ""} onClick={() => toggle(l.pos)} aria-pressed={done.has(l.pos)}>
                  <span className="ck">{done.has(l.pos) ? "✓" : ""}</span>
                  <span className="grow">{l.line}</span>
                </button>
              </li>
            ),
          )}
        </ul>
        {n === ingr.length && ingr.length > 0 && <p className="cook-ok">🎉 Sve je spremno — dobar tek!</p>}
      </div>
    </div>
  );
}
