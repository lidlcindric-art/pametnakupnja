"use client";
import { useEffect, useState } from "react";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Gumb "Instaliraj aplikaciju" (Android/Chrome/Edge) ili uputa za iOS Safari. */
export default function InstallButton() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);
  const [hint, setHint] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
    setInstalled(!!standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => { setEvt(null); setInstalled(true); });
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (installed && !evt) return null;
  if (evt)
    return (
      <button className="install" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null); }}>
        ⬇ <span className="hide-xs">Instaliraj</span>
      </button>
    );
  if (ios)
    return (
      <span className="install-wrap">
        <button className="install" onClick={() => setHint(!hint)}>⬇ <span className="hide-xs">Instaliraj</span></button>
        {hint && <span className="hint small">U Safariju: <b>Dijeli</b> ⎋ → <b>Dodaj na početni zaslon</b></span>}
      </span>
    );
  return null;
}
