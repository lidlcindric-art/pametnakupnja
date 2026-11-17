"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Item, type Meta } from "@/lib/api";
import Catalog from "@/components/Catalog";
import Recipes from "@/components/Recipes";
import Results from "@/components/Results";
import InstallButton from "@/components/InstallButton";
import Toast from "@/components/Toast";
import Qty from "@/components/Qty";
import { LocationPill } from "@/components/LocationBar";
import { useLocation } from "@/lib/location";
import { catEmoji, decodeBasket } from "@/lib/ui";

export type Basket = Record<number, number>; // item_id -> količina (u "kataloškim" jedinicama)
type Tab = "katalog" | "recepti" | "kosarica";

const KEY = "pk-basket-v1";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "katalog", icon: "🥕", label: "Namirnice" },
  { id: "recepti", icon: "🍲", label: "Recepti" },
  { id: "kosarica", icon: "🛒", label: "Košarica" },
];

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [basket, setBasket] = useState<Basket>({});
  const [tab, setTabS] = useState<Tab>("katalog");
  const [err, setErr] = useState<string | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const L = useLocation();

  const setTab = useCallback((t: Tab) => {
    setTabS(t);
    window.scrollTo({ top: 0 });
    history.replaceState(null, "", t === "katalog" ? location.pathname : `?tab=${t}`);
  }, []);
  const say = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), 1800);
  }, []);

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
    // podijeljena košarica: #k=1x2,7,20
    const h = location.hash.match(/^#k=([\dx,]+)/);
    if (h) {
      setBasket(decodeBasket(h[1]));
      setTabS("kosarica");
      history.replaceState(null, "", "?tab=kosarica");
      return;
    }
    try { if (localStorage.getItem("pk-cook")) { setTabS("recepti"); return; } } catch {}
    const t = new URLSearchParams(location.search).get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTabS(t);
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(basket)); } catch {} }, [basket]);
  useEffect(() => { try { localStorage.setItem(KEY + "-chains", JSON.stringify(chains)); } catch {} }, [chains]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const count = Object.keys(basket).length;
  const names = useMemo(() => new Map((meta?.chains ?? []).map((c) => [c.code, c.name])), [meta]);

  const add = (id: number, q = 1) => {
    setBasket((b) => ({ ...b, [id]: Math.min(99, (b[id] ?? 0) + q) }));
    if (!basket[id]) say(`Dodano: ${byId.get(id)?.name ?? ""}`);
  };
  const setQty = (id: number, q: number) =>
    setBasket((b) => {
      const n = { ...b };
      if (q <= 0) delete n[id]; else n[id] = Math.min(99, q);
      return n;
    });
  const addMany = (ids: number[]) => {
    const fresh = ids.filter((id) => !basket[id]).length;
    setBasket((b) => {
      const n = { ...b };
      for (const id of ids) if (!n[id]) n[id] = 1;
      return n;
    });
    say(fresh ? `Dodano ${fresh} ${fresh === 1 ? "namirnica" : "namirnica"} u košaricu` : "Sve je već u košarici");
  };

  const priceDate = meta?.chains.map((c) => c.price_date).sort().at(-1);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <button className="brand" onClick={() => setTab("katalog")} aria-label="Početna">
            <img src="/icons/icon-192.png" alt="" width={34} height={34} />
            <span>
              <b>PametnaKupnja</b>
              <small>{priceDate ? <>cijene od {new Date(priceDate).toLocaleDateString("hr-HR")}</> : "najjeftinija košarica"}</small>
            </span>
          </button>
          <nav className="tabs-top" aria-label="Glavni izbornik">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === "kosarica" && count > 0 && <span className="badge">{count}</span>}
                {t.id === "recepti" && meta?.recipes ? <span className="cnt">{meta.recipes}</span> : null}
              </button>
            ))}
          </nav>
          <div className="top-act">
            <InstallButton />
            <LocationPill L={L} />
          </div>
        </div>
      </header>

      <main className="wrap">
        {err && <div className="alert error">Ne mogu učitati podatke ({err}). Provjeri vezu i pokušaj ponovno.</div>}

        <div className={"layout" + (tab === "kosarica" ? " single" : "")}>
          <section className="content">
            {tab === "katalog" && <Catalog items={items} basket={basket} add={add} setQty={setQty} />}
            {tab === "recepti" && (
              <Recipes byId={byId} basket={basket} addMany={addMany} goBasket={() => setTab("kosarica")} />
            )}
            {tab === "kosarica" && (
              <Results
                L={L} basket={basket} byId={byId} meta={meta} names={names} chains={chains} setChains={setChains}
                setQty={setQty} clear={() => setBasket({})} goCatalog={() => setTab("katalog")} goRecipes={() => setTab("recepti")} say={say}
              />
            )}
          </section>

          {tab !== "kosarica" && (
            <aside className="side card">
              <div className="side-h">
                <h3>Moja košarica</h3>
                {count > 0 && <button className="link danger" onClick={() => setBasket({})}>Isprazni</button>}
              </div>
              {!count && (
                <div className="empty sm">
                  <span>🧺</span>
                  <p>Dodaj namirnice iz kataloga ili sastojke iz recepta.</p>
                </div>
              )}
              <ul className="mini">
                {Object.entries(basket).map(([id, q]) => {
                  const it = byId.get(+id);
                  if (!it) return null;
                  return (
                    <li key={id}>
                      <span className="em">{catEmoji(it.category)}</span>
                      <span className="grow">{it.name}</span>
                      <Qty n={q} set={(n) => setQty(+id, n)} size="sm" />
                    </li>
                  );
                })}
              </ul>
              {count > 0 && (
                <button className="btn primary block" onClick={() => setTab("kosarica")}>Usporedi trgovine →</button>
              )}
            </aside>
          )}
        </div>

        <footer>
          <p>
            Cijene: <a href="https://cijene.dev" target="_blank" rel="noreferrer">cijene.dev</a> — javni cjenici trgovaca
            (Odluka o objavi cjenika). Recepti:{" "}
            <a href="https://www.coolinarika.com" target="_blank" rel="noreferrer">Coolinarika</a> — samo sastojci i
            poveznica na izvorni recept. Cijene su informativne.
          </p>
          <p><a href="https://github.com/lidlcindric-art/pametnakupnja" target="_blank" rel="noreferrer">GitHub</a></p>
        </footer>
      </main>

      {/* mobilno: plutajući poziv na usporedbu */}
      {tab !== "kosarica" && count > 0 && (
        <button className="fab" onClick={() => setTab("kosarica")}>
          <span className="fab-n">{count}</span>
          <span className="grow">{count === 1 ? "namirnica" : "namirnica"} u košarici</span>
          <b>Usporedi →</b>
        </button>
      )}

      <nav className="tabbar" aria-label="Glavni izbornik">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <span className="ico">
              {t.icon}
              {t.id === "kosarica" && count > 0 && <span className="badge">{count}</span>}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <Toast msg={toast} />
    </>
  );
}
