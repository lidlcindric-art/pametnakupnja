"use client";
import { useMemo, useState } from "react";
import { fold, type Item } from "@/lib/api";
import type { Basket } from "@/app/page";
import Qty from "@/components/Qty";
import { catEmoji } from "@/lib/ui";

export default function Catalog({
  items, basket, add, setQty,
}: { items: Item[]; basket: Basket; add: (id: number) => void; setQty: (id: number, q: number) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);
  const shown = useMemo(() => {
    const f = fold(q.trim());
    return items.filter((i) => (!cat || i.category === cat) && (!f || fold(i.name).includes(f) || i.slug.includes(f)));
  }, [items, q, cat]);
  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of shown) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [shown]);

  return (
    <div>
      <div className="searchbar">
        <div className="search">
          <span aria-hidden>🔍</span>
          <input
            type="search" inputMode="search" enterKeyHint="search"
            placeholder="Traži namirnicu — mlijeko, brašno, piletina…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Traži namirnicu"
          />
          {q && <button className="x" onClick={() => setQ("")} aria-label="Obriši">✕</button>}
        </div>
        <div className="scroller" role="tablist">
          <button className={"pill" + (!cat ? " on" : "")} onClick={() => setCat("")}>Sve</button>
          {cats.map((c) => (
            <button key={c} className={"pill" + (cat === c ? " on" : "")} onClick={() => setCat(cat === c ? "" : c)}>
              {catEmoji(c)} {c}
            </button>
          ))}
        </div>
      </div>

      {!items.length && (
        <div className="grid">{Array.from({ length: 12 }, (_, i) => <div key={i} className="item card skel" />)}</div>
      )}
      {grouped.map(([c, list]) => (
        <section key={c} className="group">
          <h4>{catEmoji(c)} {c} <span>{list.length}</span></h4>
          <div className="grid">
            {list.map((i) => {
              const n = basket[i.id];
              return (
                <div
                  key={i.id} className={"item card" + (n ? " in" : "")}
                  onClick={() => !n && add(i.id)} role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && !n && add(i.id)}
                >
                  <span className="name">{i.name}</span>
                  {n ? <Qty n={n} set={(x) => setQty(i.id, x)} /> : <span className="add" aria-label={"Dodaj " + i.name}>+</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {items.length > 0 && !shown.length && (
        <div className="empty">
          <span>🤷</span>
          <p>Nema „{q}“ u katalogu. Pokušaj općenitiji naziv (npr. „sir“ umjesto marke).</p>
        </div>
      )}
    </div>
  );
}
