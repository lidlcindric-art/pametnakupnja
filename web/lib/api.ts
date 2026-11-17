export type Item = { id: number; slug: string; name: string; category: string; unit: string; target: number };
export type Chain = { code: string; name: string; price_date: string; stores: number; products: number; items_covered: number };
export type Meta = { chains: Chain[]; meta: Record<string, string | null>; recipes: number };
export type RecipeRow = {
  slug: string; title: string; url: string; image?: string | null; description?: string | null;
  servings?: string | null; total_time?: string | null; n_items: number;
};
export type RecipeLine = { pos: number; line: string; item_id: number | null; is_header: number; item_name: string | null };
export type Line = {
  item_id: number; item_name: string; chain: string; product: string; brand?: string | null;
  price: number; packs: number; cost: number; size?: number | null; unit_price?: number | null;
  stores: number; min_price?: number | null; max_price?: number | null;
};
export type ChainTotal = {
  code: string; name: string; price_date: string; stores: number; total: number;
  found: number; missing: number[]; lines: Line[];
};
export type Combo = { chains: string[]; total: number; found: number; missing: number[]; lines: Line[] };
export type BasketResp = { requested: number; chains: ChainTotal[]; best_pair: Combo | null; cherry_pick: Combo };

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
  recipes: (q: string, offset = 0, item?: number) =>
    fetch(`/api/recipes?q=${encodeURIComponent(q)}&offset=${offset}&limit=24${item ? `&item=${item}` : ""}`).then(j<RecipeRow[]>),
  recipe: (slug: string) =>
    fetch(`/api/recipes/${encodeURIComponent(slug)}`).then(j<{ recipe: RecipeRow; lines: RecipeLine[] }>),
  basket: (items: { id: number; qty: number }[], chains: string[] = []) =>
    fetch("/api/basket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, chains }),
    }).then(j<BasketResp>),
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
