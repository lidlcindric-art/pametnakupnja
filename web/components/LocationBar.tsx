"use client";
import { useEffect, useState } from "react";
import { api, type NearStore } from "@/lib/api";
import { directionsUrl, type LocState } from "@/lib/location";

const RADII = [2, 5, 10, 20];

export default function LocationBar({ L, names, showList = false }: { L: LocState; names: Map<string, string>; showList?: boolean }) {
  const [stores, setStores] = useState<NearStore[] | null>(null);
  useEffect(() => {
    if (!showList || !L.loc) { setStores(null); return; }
    api.stores(L.loc.lat, L.loc.lon, L.radius).then((r) => setStores(r.stores)).catch(() => setStores(null));
  }, [showList, L.loc, L.radius]);

  if (!L.enabled)
    return (
      <div className="locbar card">
        <span>📍 Prikaži samo trgovine u mojoj blizini</span>
        <button className="primary sm" onClick={L.enable}>Uključi lokaciju</button>
      </div>
    );

  const byChain = new Map<string, NearStore[]>();
  for (const s of stores ?? []) byChain.set(s.chain, [...(byChain.get(s.chain) ?? []), s]);

  return (
    <div className="locbar card col">
      <div className="row">
        <span>
          📍{" "}
          {L.status === "waiting" && "Tražim lokaciju…"}
          {L.status === "ok" && L.loc && <>Trgovine u krugu</>}
          {L.status === "denied" && "Pristup lokaciji je odbijen — dopusti ga u postavkama preglednika."}
          {L.status === "error" && "Lokacija trenutno nije dostupna."}
          {L.status === "unsupported" && "Uređaj ne podržava lokaciju."}
        </span>
        {L.status === "ok" && (
          <span className="radii">
            {RADII.map((r) => (
              <button key={r} className={"chip" + (L.radius === r ? " on" : "")} onClick={() => L.setRadius(r)}>{r} km</button>
            ))}
          </span>
        )}
        <button className="link" onClick={L.disable}>Isključi</button>
      </div>
      {showList && stores && (
        <details>
          <summary className="muted small">
            {stores.length} poslovnica u krugu {L.radius} km ({byChain.size} lanaca)
          </summary>
          <ul className="stores">
            {[...byChain.entries()].map(([chain, list]) => (
              <li key={chain}>
                <b>{names.get(chain) ?? chain}</b>
                {list.slice(0, 3).map((s) => (
                  <div key={s.store_id} className="small">
                    <a href={directionsUrl(s.lat, s.lon)} target="_blank" rel="noreferrer">{s.address}, {s.city}</a>{" "}
                    <span className="muted">· {s.dist_km.toFixed(1)} km{s.geo === "city" ? " (približno)" : ""}</span>
                  </div>
                ))}
                {list.length > 3 && <div className="muted small">+ još {list.length - 3}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
