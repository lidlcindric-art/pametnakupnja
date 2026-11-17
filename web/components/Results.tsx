"use client";
import { useEffect, useState } from "react";
import { api, eur, sizeLabel, type BasketResp, type Combo, type Item, type Line, type Meta } from "@/lib/api";
import type { Basket } from "@/app/page";
import LocationBar from "@/components/LocationBar";
import { directionsUrl, type LocState } from "@/lib/location";

function Lines({ lines, byId, showChain, names }: { lines: Line[]; byId: Map<number, Item>; showChain?: boolean; names: Map<string, string> }) {
  return (
    <table className="lt">
      <tbody>
        {lines.map((l) => (
          <tr key={l.item_id + l.chain}>
            <td>
              <b>{l.item_name}</b>
              <div className="muted small">
                {l.product}{l.brand && !l.product.toLowerCase().includes(l.brand.toLowerCase()) ? ` · ${l.brand}` : ""}
                {sizeLabel(l, byId.get(l.item_id)?.unit) ? ` · ${sizeLabel(l, byId.get(l.item_id)?.unit)}` : ""}
                {showChain ? <> · <span className="tag">{names.get(l.chain) ?? l.chain}</span></> : null}
                {l.min_price != null && l.max_price != null && l.max_price - l.min_price > 0.009
                  ? ` · ${eur(l.min_price)}–${eur(l.max_price)} ovisno o poslovnici`
                  : ""}
              </div>
            </td>
            <td className="r">
              {l.packs > 1 && <span className="muted small">{l.packs} × {eur(l.price)}<br /></span>}
              <b>{eur(l.cost)}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ComboCard({ title, hint, c, byId, names }: { title: string; hint: string; c: Combo; byId: Map<number, Item>; names: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card combo">
      <div className="ch" onClick={() => setOpen(!open)}>
        <div>
          <b>{title}</b>
          <div className="muted small">{hint} · {c.chains.map((x) => names.get(x) ?? x).join(" + ")}</div>
        </div>
        <div className="r"><span className="total">{eur(c.total)}</span><div className="muted small">{c.found} namirnica</div></div>
      </div>
      {open && <Lines lines={c.lines} byId={byId} showChain names={names} />}
    </div>
  );
}

export default function Results({
  basket, byId, meta, chains, setChains, setQty, L,
}: {
  L: LocState;
  basket: Basket; byId: Map<number, Item>; meta: Meta | null;
  chains: string[]; setChains: (c: string[]) => void; setQty: (id: number, q: number) => void;
}) {
  const [res, setRes] = useState<(BasketResp & { offline?: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const names = new Map((meta?.chains ?? []).map((c) => [c.code, c.name]));

  useEffect(() => {
    const items = Object.entries(basket).map(([id, qty]) => ({ id: +id, qty }));
    if (!items.length) { setRes(null); return; }
    setLoading(true); setErr(null);
    if (L.enabled && !L.loc) return; // čekamo prvu poziciju
    const where = L.loc ? { lat: L.loc.lat, lon: L.loc.lon, radius_km: L.radius } : null;
    api.basket(items, chains, where)
      .then((r) => { setRes(r); setOpen((o) => o ?? r.chains[0]?.code ?? null); })
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [basket, chains, L.enabled, L.loc, L.radius]);

  const toggleChain = (code: string) => {
    const all = (meta?.chains ?? []).map((c) => c.code);
    const cur = chains.length ? chains : all;
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    setChains(next.length === all.length ? [] : next);
  };

  const best = res?.chains[0];
  return (
    <div>
      <div className="basketlist card">
        <h3>Košarica ({Object.keys(basket).length})</h3>
        <div className="chips">
          {Object.entries(basket).map(([id, q]) => (
            <span key={id} className="chip on">
              {byId.get(+id)?.name ?? id}
              <span className="qty sm">
                <button onClick={() => setQty(+id, q - 1)}>−</button><b>{q}</b><button onClick={() => setQty(+id, q + 1)}>+</button>
              </span>
            </span>
          ))}
        </div>
        <details>
          <summary className="muted small">Trgovine koje uzimam u obzir</summary>
          <div className="chips">
            {(meta?.chains ?? []).map((c) => (
              <button key={c.code} className={"chip" + (!chains.length || chains.includes(c.code) ? " on" : "")} onClick={() => toggleChain(c.code)}>
                {c.name} <small>({c.stores})</small>
              </button>
            ))}
          </div>
        </details>
      </div>

      <LocationBar L={L} names={names} showList />

      {loading && <p className="muted">Računam…</p>}
      {res?.offline && <div className="note">Offline — prikazujem zadnji izračun za ovu košaricu.</div>}
      {res && res.radius_km != null && !res.chains.length && (
        <div className="error">
          U krugu {res.radius_km} km nema poslovnica s ovim namirnicama ({res.stores_in_radius} poslovnica u krugu). Povećaj radijus.
        </div>
      )}
      {err && <div className="error">{err}</div>}

      {res && best && (
        <>
          <div className="winner">
            <div>
              <div className="muted small">Najpovoljnije za cijelu košaricu</div>
              <h2>{best.name}</h2>
              <div className="muted small">
                {best.found}/{res.requested} namirnica{best.missing.length ? ` (nema: ${best.missing.map((i) => byId.get(i)?.name).join(", ")})` : ""}
              </div>
              {best.nearest && (
                <a className="nav" href={directionsUrl(best.nearest.lat, best.nearest.lon)} target="_blank" rel="noreferrer">
                  📍 {best.nearest.address}, {best.nearest.city} · {best.nearest.geo === "city" ? "~" : ""}{best.nearest.dist_km.toFixed(1)} km — upute ↗
                </a>
              )}
            </div>
            <div className="total big">{eur(best.total)}</div>
          </div>

          {(res.best_pair || (res.cherry_pick.chains.length > 1 && res.cherry_pick.total < best.total - 0.01)) && (
            <div className="combos">
              {res.best_pair && (
                <ComboCard title="Kupnja u dvije trgovine" hint={`ušteda ${eur(Math.max(0, best.total - res.best_pair.total))}`} c={res.best_pair} byId={byId} names={names} />
              )}
              {res.cherry_pick.chains.length > 1 && (
                <ComboCard title="Svaka namirnica tamo gdje je najjeftinija" hint={`${res.cherry_pick.chains.length} trgovine`} c={res.cherry_pick} byId={byId} names={names} />
              )}
            </div>
          )}

          <h3>Sve trgovine, od najpovoljnije</h3>
          <ol className="rank">
            {res.chains.map((c, i) => {
              const full = c.found === res.requested;
              const diff = c.total - best.total;
              return (
                <li key={c.code} className={"card" + (open === c.code ? " open" : "")}>
                  <div className="ch" onClick={() => setOpen(open === c.code ? null : c.code)}>
                    <span className="pos">{i + 1}.</span>
                    <div className="grow">
                      <b>{c.name}</b>
                      <div className="muted small">
                        {full ? "sve namirnice" : `${c.found}/${res.requested} namirnica`} ·{" "}
                        {c.nearest
                          ? <>najbliža {c.nearest.geo === "city" ? "~" : ""}{c.nearest.dist_km.toFixed(1)} km ({c.nearest.address}){c.nearby > 1 ? ` · ${c.nearby} u krugu` : ""}</>
                          : <>{c.stores} poslovnica</>}
                        {" "}· cijene {new Date(c.price_date).toLocaleDateString("hr-HR")}
                      </div>
                    </div>
                    <div className="r">
                      <span className="total">{eur(c.total)}</span>
                      {i > 0 && c.found === best.found && diff > 0.005 && <div className="muted small">+{eur(diff)}</div>}
                    </div>
                  </div>
                  {open === c.code && (
                    <>
                      {c.nearest && (
                        <p className="small" style={{ padding: "0 14px" }}>
                          <a href={directionsUrl(c.nearest.lat, c.nearest.lon)} target="_blank" rel="noreferrer">
                            📍 Upute do {c.name}, {c.nearest.address}, {c.nearest.city} ↗
                          </a>
                        </p>
                      )}
                      <Lines lines={c.lines} byId={byId} names={names} />
                      {c.missing.length > 0 && (
                        <p className="muted small">Nema u ponudi: {c.missing.map((i) => byId.get(i)?.name).join(", ")}</p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="muted small">
            {res.radius_km != null && <>Uzete su u obzir samo trgovine s poslovnicom unutar {res.radius_km} km od tebe. </>}
            Cijena je medijan po poslovnicama lanca (akcije uključene); raspon po poslovnicama vidi se uz svaki proizvod.
            Za svaku namirnicu bira se najjeftiniji odgovarajući proizvod i broj pakiranja potreban za traženu količinu.
          </p>
        </>
      )}
    </div>
  );
}
