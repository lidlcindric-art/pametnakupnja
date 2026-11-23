export type Item = { id: number; slug: string; name: string; category: string; unit: string; target: number };
export type Chain = { code: string; name: string; price_date: string; stores: number; products: number; items_covered: number };
export type Meta = { chains: Chain[]; meta: Record<string, string | null>; recipes: number };
export type RecipeRow = {
  slug: string; title: string; url: string; image?: string | null; description?: string | null;
  servings?: string | null; total_time?: string | null; n_items: number; category?: string | null;
};
export type RecipeLine = { pos: number; line: string; item_id: number | null; is_header: number; item_name: string | null };
export type Line = {
  item_id: number; item_name: string; chain: string; product: string; brand?: string | null; ean?: string | null;
  price: number; packs: number; cost: number; size?: number | null; unit_price?: number | null;
  stores: number; min_price?: number | null; max_price?: number | null;
};
export type NearStore = {
  chain: string; store_id: string; type?: string | null; address?: string | null; city?: string | null;
  lat: number; lon: number; geo?: string | null; dist_km: number;
};
export type ChainTotal = {
  code: string; name: string; price_date: string; stores: number; total: number;
  found: number; missing: number[]; lines: Line[]; nearest: NearStore | null; nearby: number;
};
export type Combo = { chains: string[]; total: number; found: number; missing: number[]; lines: Line[] };
export type BasketResp = {
  requested: number; chains: ChainTotal[]; best_pair: Combo | null; cherry_pick: Combo;
  radius_km: number | null; stores_in_radius: number;
};
export type Where = { lat: number; lon: number; radius_km: number } | null;

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).error ?? msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  meta: () => fetch("/api/meta").then(j<Meta>),
  items: () => fetch("/api/items").then(j<Item[]>),
  recipes: (q: string, offset = 0, item?: number, cat = "") =>
    fetch(`/api/recipes?q=${encodeURIComponent(q)}&offset=${offset}&limit=24${item ? `&item=${item}` : ""}${cat ? `&cat=${cat}` : ""}`).then(j<RecipeRow[]>),
  recipe: (slug: string) =>
    fetch(`/api/recipes/${encodeURIComponent(slug)}`).then(j<{ recipe: RecipeRow; lines: RecipeLine[] }>),
  basket: async (items: { id: number; qty: number }[], chains: string[] = [], where: Where = null) => {
    const body = JSON.stringify({ items, chains, ...(where ?? {}) });
    const key = "pk-last-basket";
    try {
      const r = await fetch("/api/basket", { method: "POST", headers: { "Content-Type": "application/json" }, body }).then(j<BasketResp>);
      try { localStorage.setItem(key, JSON.stringify({ body, r })); } catch {}
      return { ...r, offline: false };
    } catch (e) {
      // offline (PWA): vrati zadnji izračun za istu košaricu
      try {
        const c = JSON.parse(localStorage.getItem(key) ?? "null");
        if (c && c.body === body) return { ...(c.r as BasketResp), offline: true };
      } catch {}
      throw e;
    }
  },
  stores: (lat: number, lon: number, radius: number) =>
    fetch(`/api/stores?lat=${lat}&lon=${lon}&radius=${radius}`).then(j<{ radius_km: number; stores: NearStore[] }>),
};

export const eur = (x: number) =>
  new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR" }).format(x);

export const fold = (s: string) =>
  s.toLowerCase().replace(/[čć]/g, "c").replace(/š/g, "s").replace(/ž/g, "z").replace(/đ/g, "d");

export function sizeLabel(l: Line, unit?: string) {
  if (!l.size) return "";
  if (unit === "kom") return `${l.size} kom`;
  return l.size >= 1 ? `${+l.size.toFixed(2)} kg/l` : `${Math.round(l.size * 1000)} g/ml`;
}
