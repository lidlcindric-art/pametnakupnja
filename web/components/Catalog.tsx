"use client";
import { useMemo, useState } from "react";
import { fold, type Item } from "@/lib/api";
import type { Basket } from "@/app/page";

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
      <div className="toolbar">
        <input autoFocus placeholder="Traži namirnicu (npr. mlijeko, brašno, piletina)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips">
        <button className={!cat ? "chip on" : "chip"} onClick={() => setCat("")}>Sve</button>
        {cats.map((c) => (
          <button key={c} className={cat === c ? "chip on" : "chip"} onClick={() => setCat(cat === c ? "" : c)}>{c}</button>
        ))}
      </div>
      {!items.length && <p className="muted">Učitavanje kataloga…</p>}
      {grouped.map(([c, list]) => (
        <div key={c} className="group">
          <h4>{c}</h4>
          <div className="grid">
            {list.map((i) => {
              const n = basket[i.id];
              return (
                <div key={i.id} className={"card item" + (n ? " in" : "")}>
                  <span>{i.name}</span>
                  {n ? (
                    <span className="qty">
                      <button onClick={() => setQty(i.id, n - 1)}>−</button>
                      <b>{n}</b>
                      <button onClick={() => setQty(i.id, n + 1)}>+</button>
                    </span>
                  ) : (
                    <button className="add" onClick={() => add(i.id)} aria-label={"Dodaj " + i.name}>+</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {items.length > 0 && !shown.length && <p className="muted">Nema takve namirnice u katalogu.</p>}
    </div>
  );
}
