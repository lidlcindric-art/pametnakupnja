//! PametnaKupnja API — Cloudflare Worker (Rust → wasm) nad D1 bazom.
//!
//!   GET  /api/meta                  lanci, datum cijena, broj recepata
//!   GET  /api/items                 katalog namirnica
//!   GET  /api/recipes?q=&limit=&offset=
//!   GET  /api/recipes/:slug         recept + sastojci mapirani na katalog
//!   POST /api/basket                {"items":[{"id":1,"qty":1}], "chains":["lidl",...]?}
//!
//! Sve ostale putanje poslužuju statički Next.js frontend (Workers Static Assets).

mod basket;
mod geo;

use serde::{Deserialize, Serialize};
use worker::*;

#[derive(Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub category: String,
    pub unit: String,
    pub target: f64,
}

#[derive(Serialize, Deserialize)]
struct Chain {
    code: String,
    name: String,
    price_date: String,
    stores: i64,
    products: i64,
    items_covered: i64,
}

#[derive(Serialize, Deserialize)]
struct MetaRow {
    key: String,
    value: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct RecipeRow {
    slug: String,
    title: String,
    url: String,
    image: Option<String>,
    description: Option<String>,
    servings: Option<String>,
    total_time: Option<String>,
    n_items: i64,
}

#[derive(Serialize, Deserialize)]
struct LineRow {
    pos: i64,
    line: String,
    item_id: Option<i64>,
    is_header: i64,
    item_name: Option<String>,
}

#[derive(Deserialize)]
struct Count {
    n: i64,
}

fn json<T: Serialize>(v: &T, max_age: u32) -> Result<Response> {
    let mut r = Response::from_json(v)?;
    let h = r.headers_mut();
    h.set("Cache-Control", &format!("public, max-age={max_age}"))?;
    h.set("Access-Control-Allow-Origin", "*")?;
    Ok(r)
}

fn err(msg: &str, status: u16) -> Result<Response> {
    let mut r = Response::from_json(&serde_json::json!({ "error": msg }))?.with_status(status);
    r.headers_mut().set("Access-Control-Allow-Origin", "*")?;
    Ok(r)
}

/// Normalizacija upita za pretragu — isto kao u ingestu (bez dijakritika, mala slova).
pub fn fold(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'č' | 'ć' | 'Č' | 'Ć' => 'c',
            'š' | 'Š' => 's',
            'ž' | 'Ž' => 'z',
            'đ' | 'Đ' => 'd',
            c => c,
        })
        .flat_map(|c| c.to_lowercase())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    if req.method() == Method::Options {
        let mut r = Response::empty()?;
        let h = r.headers_mut();
        h.set("Access-Control-Allow-Origin", "*")?;
        h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")?;
        h.set("Access-Control-Allow-Headers", "Content-Type")?;
        return Ok(r);
    }
    Router::new()
        .get_async("/api/meta", |_, ctx| async move { meta(&ctx.env).await })
        .get_async("/api/items", |_, ctx| async move { items(&ctx.env).await })
        .get_async("/api/recipes", |req, ctx| async move { recipes(&req, &ctx.env).await })
        .get_async("/api/recipes/:slug", |_, ctx| async move {
            let slug = ctx.param("slug").cloned().unwrap_or_default();
            recipe(&ctx.env, &slug).await
        })
        .post_async("/api/basket", |mut req, ctx| async move {
            let body: basket::BasketReq = match req.json().await {
                Ok(b) => b,
                Err(_) => return err("neispravan JSON", 400),
            };
            match basket::compute(&ctx.env.d1("DB")?, body).await {
                Ok(r) => json(&r, 0),
                Err(e) => err(&e.to_string(), 400),
            }
        })
        .get_async("/api/stores", |req, ctx| async move {
            // GET /api/stores?lat=..&lon=..&radius=5
            let url = req.url()?;
            let p: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
            let f = |k: &str| p.get(k).and_then(|v| v.parse::<f64>().ok());
            let (Some(lat), Some(lon)) = (f("lat"), f("lon")) else { return err("lat i lon su obavezni", 400) };
            if !geo::valid(lat, lon) {
                return err("neispravne koordinate", 400);
            }
            let r = f("radius").unwrap_or(5.0).clamp(0.5, 50.0);
            let st = geo::nearby(&ctx.env.d1("DB")?, lat, lon, r).await?;
            json(&serde_json::json!({ "radius_km": r, "stores": st }), 300)
        })
        .get("/api/health", |_, _| json(&serde_json::json!({"ok": true}), 0))
        .or_else_any_method_async("/api/*rest", |_, _| async { err("nepoznata ruta", 404) })
        .or_else_any_method_async("/*rest", |req, ctx| async move {
            // statički frontend
            let assets = ctx.env.assets("ASSETS")?;
            assets.fetch_request(req).await
        })
        .run(req, env)
        .await
}

async fn meta(env: &Env) -> Result<Response> {
    let db = env.d1("DB")?;
    let chains: Vec<Chain> = db
        .prepare("SELECT * FROM chains ORDER BY items_covered DESC, stores DESC")
        .all()
        .await?
        .results()?;
    let meta: Vec<MetaRow> = db.prepare("SELECT key, value FROM meta").all().await?.results()?;
    let n: Option<Count> = db.prepare("SELECT COUNT(*) AS n FROM recipes").first(None).await?;
    let mut m = serde_json::Map::new();
    for r in meta {
        m.insert(r.key, r.value.into());
    }
    json(
        &serde_json::json!({ "chains": chains, "meta": m, "recipes": n.map(|c| c.n).unwrap_or(0) }),
        300,
    )
}

async fn items(env: &Env) -> Result<Response> {
    let db = env.d1("DB")?;
    let items: Vec<Item> = db.prepare("SELECT * FROM items ORDER BY id").all().await?.results()?;
    json(&items, 300)
}

async fn recipes(req: &Request, env: &Env) -> Result<Response> {
    let url = req.url()?;
    let mut q = String::new();
    let mut limit = 24i64;
    let mut offset = 0i64;
    let mut item: Option<i64> = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "q" => q = fold(&v),
            "limit" => limit = v.parse().unwrap_or(24).clamp(1, 60),
            "offset" => offset = v.parse().unwrap_or(0).max(0),
            "item" => item = v.parse().ok(),
            _ => {}
        }
    }
    let db = env.d1("DB")?;
    let mut sql = String::from(
        "SELECT slug, title, url, image, description, servings, total_time, n_items FROM recipes r WHERE n_items > 0",
    );
    let mut binds: Vec<wasm_bindgen::JsValue> = Vec::new();
    for w in q.split(' ').filter(|w| w.len() >= 2).take(5) {
        sql.push_str(" AND search LIKE ?");
        binds.push(format!("%{w}%").into());
    }
    if let Some(i) = item {
        sql.push_str(" AND EXISTS (SELECT 1 FROM recipe_lines l WHERE l.recipe_slug = r.slug AND l.item_id = ?)");
        binds.push((i as f64).into());
    }
    sql.push_str(" ORDER BY published DESC, slug LIMIT ? OFFSET ?");
    binds.push((limit as f64).into());
    binds.push((offset as f64).into());
    let rows: Vec<RecipeRow> = db.prepare(&sql).bind(&binds)?.all().await?.results()?;
    json(&rows, 300)
}

async fn recipe(env: &Env, slug: &str) -> Result<Response> {
    let db = env.d1("DB")?;
    let r: Option<RecipeRow> = db
        .prepare("SELECT slug, title, url, image, description, servings, total_time, n_items FROM recipes WHERE slug = ?")
        .bind(&[slug.into()])?
        .first(None)
        .await?;
    let Some(r) = r else { return err("recept nije pronađen", 404) };
    let lines: Vec<LineRow> = db
        .prepare(
            "SELECT l.pos, l.line, l.item_id, l.is_header, i.name AS item_name
             FROM recipe_lines l LEFT JOIN items i ON i.id = l.item_id
             WHERE l.recipe_slug = ? ORDER BY l.pos",
        )
        .bind(&[slug.into()])?
        .all()
        .await?
        .results()?;
    json(&serde_json::json!({ "recipe": r, "lines": lines }), 300)
}
