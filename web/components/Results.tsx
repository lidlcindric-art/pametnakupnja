"use client";
import { useEffect, useState } from "react";
import { api, eur, sizeLabel, type BasketResp, type ChainTotal, type Combo, type Item, type Line, type Meta } from "@/lib/api";
import type { Basket } from "@/app/page";
import LocationBar from "@/components/LocationBar";
import Qty from "@/components/Qty";
import { directionsUrl, type LocState } from "@/lib/location";
import { catEmoji, encodeBasket } from "@/lib/ui";

/** Slika proizvoda (Open Food Facts preko /api/img) — učitava se tek kad je vidljiva, ne sprema se u bazu. */
function ProductImg({ ean, fallback }: { ean?: string | null; fallback: string }) {
  const [bad, setBad] = useState(!ean);
  return (
    <span className="pimg" aria-hidden>
      {bad ? fallback : <img src={`/api/img/${ean}?v=2`} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />}
    </span>
  );
}

function Lines({ lines, byId, showChain, names }: { lines: Line[]; byId: Map<number, Item>; showChain?: boolean; names: Map<string, string> }) {
  return (
    <ul className="lines-p">
      {lines.map((l) => {
        const size = sizeLabel(l, byId.get(l.item_id)?.unit);
        return (
          <li key={l.item_id + l.chain}>
            <ProductImg ean={l.ean} fallback={catEmoji(byId.get(l.item_id)?.category ?? "")} />
            <div className="grow">
              <b>{l.item_name}</b>
              <div className="muted small">
                {l.product}{l.brand && !l.product.toLowerCase().includes(l.brand.toLowerCase()) ? ` · ${l.brand}` : ""}
                {size ? ` · ${size}` : ""}
                {showChain ? <> · <span className="tag">{names.get(l.chain) ?? l.chain}</span></> : null}
              </div>
              {l.min_price != null && l.max_price != null && l.max_price - l.min_price > 0.009 && (
                <div className="muted xs">{eur(l.min_price)}–{eur(l.max_price)} ovisno o poslovnici</div>
              )}
            </div>
            <div className="r">
              <b>{eur(l.cost)}</b>
              {l.packs > 1 && <div className="muted xs">{l.packs} × {eur(l.price)}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ComboCard({ icon, title, hint, c, byId, names }: { icon: string; title: string; hint: string; c: Combo; byId: Map<number, Item>; names: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"card combo" + (open ? " open" : "")}>
      <button className="row-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="cic">{icon}</span>
        <span className="grow">
          <b>{title}</b>
          <span className="muted small">{c.chains.map((x) => names.get(x) ?? x).join(" + ")}</span>
        </span>
        <span className="r">
          <b className="total">{eur(c.total)}</b>
          <span className="save">{hint}</span>
        </span>
      </button>
      {open && <Lines lines={c.lines} byId={byId} showChain names={names} />}
    </div>
  );
}

function km(c: ChainTotal) {
  if (!c.nearest) return null;
  return `${c.nearest.geo === "city" ? "~" : ""}${c.nearest.dist_km.toFixed(1)} km`;
}

export default function Results({
  basket, byId, meta, names, chains, setChains, setQty, L, clear, goCatalog, goRecipes, say,
}: {
  L: LocState; basket: Basket; byId: Map<number, Item>; meta: Meta | null; names: Map<string, string>;
  chains: string[]; setChains: (c: string[]) => void; setQty: (id: number, q: number) => void;
  clear: () => void; goCatalog: () => void; goRecipes: () => void; say: (m: string) => void;
}) {
  const [res, setRes] = useState<(BasketResp & { offline?: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const count = Object.keys(basket).length;

  useEffect(() => {
    const items = Object.entries(basket).map(([id, qty]) => ({ id: +id, qty }));
    if (!items.length) { setRes(null); return; }
    if (L.enabled && !L.loc) { setLoading(true); return; } // čekamo prvu poziciju
    setLoading(true); setErr(null);
    const where = L.loc ? { lat: L.loc.lat, lon: L.loc.lon, radius_km: L.radius } : null;
    const t = setTimeout(() => {
      api.basket(items, chains, where)
        .then((r) => { setRes(r); setOpen(null); })
        .catch((e) => setErr(String(e.message ?? e)))
        .finally(() => setLoading(false));
    }, 250); // debounce dok se mijenjaju količine
    return () => clearTimeout(t);
  }, [basket, chains, L.enabled, L.loc, L.radius]);

  const toggleChain = (code: string) => {
    const all = (meta?.chains ?? []).map((c) => c.code);
    const cur = chains.length ? chains : all;
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    setChains(next.length === all.length ? [] : next);
  };

  const share = async () => {
    const url = `${location.origin}/#k=${encodeBasket(basket)}`;
    try {
      if (navigator.share) await navigator.share({ title: "Moja košarica — PametnaKupnja", url });
      else { await navigator.clipboard.writeText(url); say("Poveznica kopirana"); }
    } catch {}
  };

  if (!count)
    return (
      <div className="empty big">
        <span>🧺</span>
        <h2>Košarica je prazna</h2>
        <p>Dodaj namirnice ili odaberi recept — izračunat ćemo u kojoj je trgovini cijela kupnja najjeftinija.</p>
        <div className="row-gap">
          <button className="btn primary" onClick={goCatalog}>🥕 Namirnice</button>
          <button className="btn" onClick={goRecipes}>🍲 Recepti</button>
        </div>
      </div>
    );

  const best = res?.chains[0];
  const full = res?.chains.filter((c) => c.found === best?.found) ?? [];
  const worst = full.at(-1);
  const maxTotal = Math.max(...(res?.chains.map((c) => c.total) ?? [1]));
  const nSel = chains.length || (meta?.chains.length ?? 0);

  return (
    <div className={"results" + (loading ? " busy" : "")}>
      {/* sažetak košarice */}
      <div className="card bsum">
        <button className="row-btn" onClick={() => setShowList(!showList)} aria-expanded={showList}>
          <span className="cic">🛒</span>
          <span className="grow">
            <b>Košarica · {count} {count === 1 ? "namirnica" : "namirnica"}</b>
            <span className="muted small ell">
              {Object.keys(basket).map((id) => byId.get(+id)?.name).filter(Boolean).join(", ")}
            </span>
          </span>
          <span className={"chev" + (showList ? " up" : "")}>⌄</span>
        </button>
        {showList && (
          <>
            <ul className="mini">
              {Object.entries(basket).map(([id, q]) => {
                const it = byId.get(+id);
                return (
                  <li key={id}>
                    <span className="em">{catEmoji(it?.category)}</span>
                    <span className="grow">{it?.name ?? id}</span>
                    <Qty n={q} set={(n) => setQty(+id, n)} size="sm" />
                  </li>
                );
              })}
            </ul>
            <div className="row-gap">
              <button className="btn sm" onClick={goCatalog}>+ Dodaj još</button>
              <button className="btn sm" onClick={share}>↗ Podijeli</button>
              <button className="link danger" onClick={clear}>Isprazni</button>
            </div>
          </>
        )}
      </div>

      <LocationBar L={L} names={names} />

      <details className="card filt">
        <summary>
          <span>🏪 Trgovine u usporedbi</span>
          <span className="muted small">{chains.length ? `${nSel} odabrano` : "sve"}</span>
        </summary>
        <div className="wrapchips">
          {(meta?.chains ?? []).map((c) => (
            <button key={c.code} className={"pill" + (!chains.length || chains.includes(c.code) ? " on" : "")} onClick={() => toggleChain(c.code)}>
              {c.name}
            </button>
          ))}
        </div>
        {chains.length > 0 && <button className="link" onClick={() => setChains([])}>Uključi sve</button>}
      </details>

      {res?.offline && <div className="alert note">📴 Offline — prikazujem zadnji izračun za ovu košaricu.</div>}
      {err && <div className="alert error">Izračun nije uspio: {err}</div>}
      {res && res.radius_km != null && !res.chains.length && (
        <div className="alert note">
          U krugu {res.radius_km} km nema trgovina s ovim namirnicama. Povećaj radijus iznad.
        </div>
      )}

      {!res && loading && (
        <>
          <div className="hero skel" />
          {[0, 1, 2].map((i) => <div key={i} className="card skel row" />)}
        </>
      )}

      {res && best && (
        <>
          <div className="hero">
            <div className="hero-top">
              <span className="eyebrow">🏆 Najpovoljnije</span>
              {worst && worst !== best && worst.total - best.total > 0.05 && (
                <span className="save-badge">−{eur(worst.total - best.total)} od najskuplje</span>
              )}
            </div>
            <div className="hero-main">
              <h2>{best.name}</h2>
              <div className="big">{eur(best.total)}</div>
            </div>
            <p className="hero-sub">
              {best.found === res.requested ? "Sve namirnice" : `${best.found}/${res.requested} namirnica`}
              {best.missing.length > 0 && ` · nema: ${best.missing.map((i) => byId.get(i)?.name).join(", ")}`}
            </p>
            {best.nearest && (
              <a className="nav-btn" href={directionsUrl(best.nearest.lat, best.nearest.lon)} target="_blank" rel="noreferrer">
                <span>🧭</span>
                <span className="grow">{best.nearest.address}, {best.nearest.city}</span>
                <b>{km(best)}</b>
              </a>
            )}
          </div>

          {(res.best_pair || (res.cherry_pick.chains.length > 1 && res.cherry_pick.total < best.total - 0.01)) && (
            <div className="combos">
              {res.best_pair && (
                <ComboCard icon="✌️" title="Kupi u dvije trgovine" hint={`−${eur(Math.max(0, best.total - res.best_pair.total))}`} c={res.best_pair} byId={byId} names={names} />
              )}
              {res.cherry_pick.chains.length > 1 && (
                <ComboCard icon="🎯" title="Svaku namirnicu najjeftinije" hint={`${res.cherry_pick.chains.length} trgovine`} c={res.cherry_pick} byId={byId} names={names} />
              )}
            </div>
          )}

          <h3 className="sec">Sve trgovine</h3>
          <ol className="rank">
            {res.chains.map((c, i) => {
              const diff = c.total - best.total;
              const isOpen = open === c.code;
              return (
                <li key={c.code} className={"card" + (isOpen ? " open" : "")}>
                  <button className="row-btn" onClick={() => setOpen(isOpen ? null : c.code)} aria-expanded={isOpen}>
                    <span className={"pos" + (i === 0 ? " gold" : "")}>{i + 1}</span>
                    <span className="grow">
                      <b>{c.name}</b>
                      <span className="muted small">
                        {c.found === res.requested ? "sve" : `${c.found}/${res.requested}`}
                        {c.nearest ? ` · 📍 ${km(c)}` : ` · ${c.stores} posl.`}
                        {c.nearby > 1 ? ` · ${c.nearby} u krugu` : ""}
                      </span>
                      <span className="bar"><i style={{ width: `${Math.max(6, (c.total / maxTotal) * 100)}%` }} /></span>
                    </span>
                    <span className="r">
                      <b className="total">{eur(c.total)}</b>
                      {i > 0 && c.found === best.found && diff > 0.005 && <span className="diff">+{eur(diff)}</span>}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="det">
                      {c.nearest && (
                        <a className="nav-btn light" href={directionsUrl(c.nearest.lat, c.nearest.lon)} target="_blank" rel="noreferrer">
                          <span>🧭</span>
                          <span className="grow">{c.nearest.address}, {c.nearest.city}</span>
                          <b>{km(c)}</b>
                        </a>
                      )}
                      <Lines lines={c.lines} byId={byId} names={names} />
                      {c.missing.length > 0 && (
                        <p className="muted small">Nema u ponudi: {c.missing.map((i) => byId.get(i)?.name).join(", ")}</p>
                      )}
                      <p className="muted xs">Cijene od {new Date(c.price_date).toLocaleDateString("hr-HR")}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="muted xs fine">
            {res.radius_km != null && <>Samo trgovine s poslovnicom unutar {res.radius_km} km. </>}
            Cijena je medijan po poslovnicama lanca (akcije uključene). Za svaku namirnicu bira se najjeftiniji
            odgovarajući proizvod i broj pakiranja za traženu količinu.
          </p>
        </>
      )}
    </div>
  );
}
