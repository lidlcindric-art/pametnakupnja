"use client";
import { useEffect, useRef, useState } from "react";
import { api, type NearStore } from "@/lib/api";
import { directionsUrl, type LocState } from "@/lib/location";

const RADII = [2, 5, 10, 20];

function statusText(L: LocState) {
  switch (L.status) {
    case "waiting": return "Tražim lokaciju…";
    case "denied": return "Pristup lokaciji je odbijen — dopusti ga u postavkama preglednika.";
    case "error": return "Lokacija trenutno nije dostupna.";
    case "unsupported": return "Uređaj ne podržava lokaciju.";
    default: return null;
  }
}

function Radii({ L }: { L: LocState }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Radijus">
      {RADII.map((r) => (
        <button key={r} role="radio" aria-checked={L.radius === r} className={L.radius === r ? "on" : ""} onClick={() => L.setRadius(r)}>
          {r} km
        </button>
      ))}
    </div>
  );
}

/** Gumb u zaglavlju: uključi lokaciju / promijeni radijus. */
export function LocationPill({ L }: { L: LocState }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);

  if (!L.enabled)
    return <button className="pillbtn" onClick={L.enable} title="Prikaži trgovine u blizini">📍 <span className="hide-xs">U blizini</span></button>;
  return (
    <div className="pop-wrap" ref={ref}>
      <button className={"pillbtn on" + (L.status !== "ok" ? " warn" : "")} onClick={() => setOpen(!open)} aria-expanded={open}>
        📍 {L.status === "ok" ? `${L.radius} km` : L.status === "waiting" ? "…" : "!"}
      </button>
      {open && (
        <div className="pop card">
          <b>Trgovine u krugu</b>
          {statusText(L) && <p className="muted small">{statusText(L)}</p>}
          <Radii L={L} />
          <button className="link danger" onClick={() => { L.disable(); setOpen(false); }}>Isključi lokaciju</button>
        </div>
      )}
    </div>
  );
}

/** Traka u košarici + popis poslovnica u krugu. */
export default function LocationBar({ L, names }: { L: LocState; names: Map<string, string> }) {
  const [stores, setStores] = useState<NearStore[] | null>(null);
  useEffect(() => {
    if (!L.loc) { setStores(null); return; }
    api.stores(L.loc.lat, L.loc.lon, L.radius).then((r) => setStores(r.stores)).catch(() => setStores(null));
  }, [L.loc, L.radius]);

  if (!L.enabled)
    return (
      <div className="loc card">
        <div className="loc-ic">📍</div>
        <div className="grow">
          <b>Samo trgovine u blizini</b>
          <p className="muted small">Usporedi lance koji imaju poslovnicu do 5 km od tebe.</p>
        </div>
        <button className="btn primary sm" onClick={L.enable}>Uključi</button>
      </div>
    );

  const byChain = new Map<string, NearStore[]>();
  for (const s of stores ?? []) byChain.set(s.chain, [...(byChain.get(s.chain) ?? []), s]);

  return (
    <div className="loc card col">
      <div className="loc-row">
        <div className="loc-ic on">📍</div>
        <div className="grow">
          <b>{L.status === "ok" ? "Trgovine u krugu" : statusText(L)}</b>
          {stores && <p className="muted small">{stores.length} poslovnica · {byChain.size} lanaca</p>}
        </div>
        <button className="link muted" onClick={L.disable} aria-label="Isključi lokaciju">✕</button>
      </div>
      {L.status === "ok" && <Radii L={L} />}
      {stores && stores.length > 0 && (
        <details className="near">
          <summary>Prikaži poslovnice</summary>
          <ul>
            {[...byChain.entries()].map(([chain, list]) => (
              <li key={chain}>
                <b>{names.get(chain) ?? chain}</b>
                {list.slice(0, 3).map((s) => (
                  <a key={s.store_id} href={directionsUrl(s.lat, s.lon)} target="_blank" rel="noreferrer">
                    <span>{s.address}, {s.city}</span>
                    <span className="km">{s.geo === "city" ? "~" : ""}{s.dist_km.toFixed(1)} km</span>
                  </a>
                ))}
                {list.length > 3 && <small className="muted">+ još {list.length - 3}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
