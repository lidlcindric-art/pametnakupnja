"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type Item, type Meta } from "@/lib/api";
import Catalog from "@/components/Catalog";
import Recipes from "@/components/Recipes";
import Results from "@/components/Results";

export type Basket = Record<number, number>; // item_id -> količina (u "kataloškim" jedinicama)
type Tab = "katalog" | "recepti" | "rezultat";

const KEY = "pk-basket-v1";

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [basket, setBasket] = useState<Basket>({});
  const [tab, setTab] = useState<Tab>("katalog");
  const [err, setErr] = useState<string | null>(null);
  const [chains, setChains] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([api.items(), api.meta()])
      .then(([i, m]) => { setItems(i); setMeta(m); })
      .catch((e) => setErr(String(e.message ?? e)));
    try {
      const s = localStorage.getItem(KEY);
      if (s) setBasket(JSON.parse(s));
      const c = localStorage.getItem(KEY + "-chains");
      if (c) setChains(JSON.parse(c));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(basket)); } catch {} }, [basket]);
  useEffect(() => { try { localStorage.setItem(KEY + "-chains", JSON.stringify(chains)); } catch {} }, [chains]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const count = Object.keys(basket).length;

  const add = (id: number, q = 1) => setBasket((b) => ({ ...b, [id]: Math.min(99, (b[id] ?? 0) + q) }));
  const setQty = (id: number, q: number) =>
    setBasket((b) => {
      const n = { ...b };
      if (q <= 0) delete n[id]; else n[id] = Math.min(99, q);
      return n;
    });
  const addMany = (ids: number[]) => {
    setBasket((b) => {
      const n = { ...b };
      for (const id of ids) if (!n[id]) n[id] = 1;
      return n;
    });
  };

  const priceDate = meta?.chains.map((c) => c.price_date).sort().at(-1);

  return (
    <main>
      <header className="top">
        <div className="brand">
          <span className="logo">🛒</span>
          <div>
            <h1>PametnaKupnja</h1>
            <p className="sub">
              Najjeftinija košarica u hrvatskim trgovinama
              {priceDate ? <> · cijene od {new Date(priceDate).toLocaleDateString("hr-HR")}</> : null}
            </p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "katalog" ? "on" : ""} onClick={() => setTab("katalog")}>Namirnice</button>
          <button className={tab === "recepti" ? "on" : ""} onClick={() => setTab("recepti")}>
            Recepti{meta?.recipes ? <small> {meta.recipes}</small> : null}
          </button>
          <button className={"cta " + (tab === "rezultat" ? "on" : "")} onClick={() => setTab("rezultat")} disabled={!count}>
            Košarica <b className="badge">{count}</b>
          </button>
        </nav>
      </header>

      {err && <div className="error">Greška pri učitavanju: {err}</div>}

      <div className="layout">
        <section className="main">
          {tab === "katalog" && <Catalog items={items} basket={basket} add={add} setQty={setQty} />}
          {tab === "recepti" && (
            <Recipes byId={byId} basket={basket} addMany={(ids) => { addMany(ids); }} goBasket={() => setTab("rezultat")} />
          )}
          {tab === "rezultat" && (
            <Results basket={basket} byId={byId} meta={meta} chains={chains} setChains={setChains} setQty={setQty} />
          )}
        </section>
        {tab !== "rezultat" && (
          <aside className="side">
            <h3>Moja košarica</h3>
            {!count && <p className="muted">Dodaj namirnice iz kataloga ili iz recepta.</p>}
            <ul className="mini">
              {Object.entries(basket).map(([id, q]) => {
                const it = byId.get(+id);
                if (!it) return null;
                return (
                  <li key={id}>
                    <span>{it.name}</span>
                    <span className="qty">
                      <button onClick={() => setQty(+id, q - 1)}>−</button>
                      <b>{q}</b>
                      <button onClick={() => setQty(+id, q + 1)}>+</button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {count > 0 && (
              <>
                <button className="primary wide" onClick={() => setTab("rezultat")}>Usporedi trgovine →</button>
                <button className="link" onClick={() => setBasket({})}>Isprazni košaricu</button>
              </>
            )}
          </aside>
        )}
      </div>

      <footer>
        Cijene: <a href="https://cijene.dev" target="_blank" rel="noreferrer">cijene.dev</a> (javno objavljeni cjenici
        trgovaca prema Odluci o objavi cjenika). Recepti:{" "}
        <a href="https://www.coolinarika.com" target="_blank" rel="noreferrer">Coolinarika</a> — prikazujemo samo popis
        sastojaka i poveznicu na izvorni recept. Cijene su informativne; provjerite u trgovini.
        {" · "}
        <a href="https://github.com/lidlcindric-art/pametnakupnja" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </main>
  );
}
