"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Item, type RecipeLine, type RecipeRow } from "@/lib/api";
import type { Basket } from "@/app/page";

export default function Recipes({
  byId, basket, addMany, goBasket,
}: { byId: Map<number, Item>; basket: Basket; addMany: (ids: number[]) => void; goBasket: () => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<RecipeRow[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ recipe: RecipeRow; lines: RecipeLine[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = (query: string, offset: number) => {
    setLoading(true);
    api.recipes(query, offset)
      .then((r) => { setList((l) => (offset ? [...l, ...r] : r)); setMore(r.length === 24); })
      .catch(() => setMore(false))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => load(q, 0), 250);
  }, [q]);

  const openRecipe = (slug: string) =>
    api.recipe(slug).then((r) => {
      setOpen(r);
      setPicked(new Set(r.lines.filter((l) => l.item_id).map((l) => l.item_id!)));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  if (open) {
    const r = open.recipe;
    const mapped = open.lines.filter((l) => l.item_id);
    return (
      <div className="recipe">
        <button className="back" onClick={() => setOpen(null)}>← Recepti</button>
        <div className="rhead">
          {r.image && <img src={r.image} alt="" />}
          <div>
            <h2>{r.title}</h2>
            <p className="muted small">
              {r.servings && <>🍽 {r.servings} · </>}
              <a href={r.url} target="_blank" rel="noreferrer">Priprema na Coolinarici ↗</a>
            </p>
            {r.description && <p className="desc">{r.description}</p>}
          </div>
        </div>
        <h3 className="sec">Sastojci</h3>
        <p className="muted small">
          Kvačicom su označeni sastojci iz kataloga. Makni ono što već imaš doma (sol, ulje…).
        </p>
        <ul className="lines">
          {open.lines.map((l) =>
            l.is_header ? (
              <li key={l.pos} className="hdr">{l.line}</li>
            ) : (
              <li key={l.pos} className={l.item_id ? "ok" : "no"}>
                {l.item_id ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={picked.has(l.item_id)}
                      onChange={(e) => {
                        const s = new Set(picked);
                        if (e.target.checked) s.add(l.item_id!); else s.delete(l.item_id!);
                        setPicked(s);
                      }}
                    />
                    <span>{l.line}</span>
                    <em>→ {l.item_name}{basket[l.item_id] ? " ✓ u košarici" : ""}</em>
                  </label>
                ) : (
                  <span>{l.line} <em className="muted">(nije u katalogu)</em></span>
                )}
              </li>
            ),
          )}
        </ul>
        <div className="actions sticky">
          <span className="muted xs">{mapped.length}/{open.lines.filter((l) => !l.is_header).length} sastojaka prepoznato</span>
          <button
            className="btn primary block"
            disabled={!picked.size}
            onClick={() => { addMany([...picked]); goBasket(); }}
          >
            Dodaj {picked.size} i usporedi trgovine →
          </button>
          <button className="btn block" disabled={!picked.size} onClick={() => { addMany([...picked]); setOpen(null); }}>
            Samo dodaj u košaricu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="searchbar">
        <div className="search">
          <span aria-hidden>🔍</span>
          <input
            type="search" enterKeyHint="search" aria-label="Traži recept"
            placeholder="Traži recept — sarma, piletina, palačinke…" value={q} onChange={(e) => setQ(e.target.value)}
          />
          {q && <button className="x" onClick={() => setQ("")} aria-label="Obriši">✕</button>}
        </div>
      </div>
      <div className="rgrid">
        {list.map((r) => (
          <button key={r.slug} className="card rcard" onClick={() => openRecipe(r.slug)}>
            {r.image ? <img loading="lazy" src={r.image} alt="" /> : <div className="noimg">🍲</div>}
            <div className="rt">
              <b>{r.title}</b>
              <small className="muted">🛒 {r.n_items} {r.n_items === 1 ? "namirnica" : "namirnica"}</small>
            </div>
          </button>
        ))}
      </div>
      {loading && !list.length && (
        <div className="rgrid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="card rcard skel tall" />)}</div>
      )}
      {!loading && !list.length && <p className="muted">Nema recepata za taj upit.</p>}
      {more && list.length > 0 && !loading && (
        <button className="btn block" onClick={() => load(q, list.length)}>Učitaj još</button>
      )}
    </div>
  );
}
