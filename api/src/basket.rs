//! Izračun košarice: ukupna cijena po lancu, najjeftinija kombinacija dvaju lanaca
//! i "lov na akcije" (svaka namirnica tamo gdje je najjeftinija).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use crate::geo;
use worker::{D1Database, Result};

#[derive(Deserialize)]
pub struct BasketItem {
    pub id: i64,
    #[serde(default = "one")]
    pub qty: f64,
}
fn one() -> f64 {
    1.0
}

#[derive(Deserialize)]
pub struct BasketReq {
    pub items: Vec<BasketItem>,
    /// Ograniči na odabrane lance (prazno = svi)
    #[serde(default)]
    pub chains: Vec<String>,
    /// Lokacija korisnika — ako je zadana, uzimaju se samo lanci s poslovnicom u krugu `radius_km`.
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub radius_km: Option<f64>,
}

#[derive(Deserialize, Clone)]
struct OfferRow {
    item_id: i64,
    chain: String,
    product_name: String,
    brand: Option<String>,
    price: f64,
    size: Option<f64>,
    unit_price: Option<f64>,
    stores: i64,
    min_price: Option<f64>,
    max_price: Option<f64>,
}

#[derive(Deserialize)]
struct ItemRow {
    id: i64,
    name: String,
    unit: String,
    target: f64,
}

#[derive(Deserialize)]
struct ChainRow {
    code: String,
    name: String,
    price_date: String,
    stores: i64,
}

#[derive(Serialize, Clone)]
pub struct Line {
    item_id: i64,
    item_name: String,
    chain: String,
    product: String,
    brand: Option<String>,
    price: f64,
    packs: u32,
    cost: f64,
    size: Option<f64>,
    unit_price: Option<f64>,
    stores: i64,
    min_price: Option<f64>,
    max_price: Option<f64>,
}

#[derive(Serialize)]
pub struct ChainTotal {
    code: String,
    name: String,
    price_date: String,
    stores: i64,
    total: f64,
    found: usize,
    missing: Vec<i64>,
    lines: Vec<Line>,
    /// najbliža poslovnica lanca (samo kad je zadana lokacija)
    nearest: Option<geo::Store>,
    /// broj poslovnica lanca u krugu
    nearby: usize,
}

#[derive(Serialize)]
pub struct Combo {
    chains: Vec<String>,
    total: f64,
    found: usize,
    missing: Vec<i64>,
    lines: Vec<Line>,
}

#[derive(Serialize)]
pub struct BasketResp {
    requested: usize,
    chains: Vec<ChainTotal>,
    best_pair: Option<Combo>,
    cherry_pick: Combo,
    /// zadan radijus (km) ili null kad lokacija nije poslana
    radius_km: Option<f64>,
    /// broj poslovnica (svih lanaca) u krugu
    stores_in_radius: usize,
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn packs_for(item: &ItemRow, qty: f64, size: Option<f64>) -> u32 {
    let need = item.target * qty;
    match (item.unit.as_str(), size) {
        ("any", _) | (_, None) => qty.ceil().max(1.0) as u32,
        (_, Some(s)) if s > 0.0 => ((need / s) - 1e-6).ceil().max(1.0) as u32,
        _ => qty.ceil().max(1.0) as u32,
    }
}

pub async fn compute(db: &D1Database, req: BasketReq) -> Result<BasketResp> {
    let mut qty: BTreeMap<i64, f64> = BTreeMap::new();
    for i in req.items.iter().take(80) {
        let q = if i.qty.is_finite() { i.qty.clamp(0.1, 100.0) } else { 1.0 };
        *qty.entry(i.id).or_insert(0.0) += q;
    }
    if qty.is_empty() {
        return Err(worker::Error::RustError("košarica je prazna".into()));
    }
    let ids: Vec<wasm_bindgen::JsValue> = qty.keys().map(|&i| (i as f64).into()).collect();
    let ph = vec!["?"; ids.len()].join(",");

    let items: Vec<ItemRow> = db
        .prepare(format!("SELECT id, name, unit, target FROM items WHERE id IN ({ph})"))
        .bind(&ids)?
        .all()
        .await?
        .results()?;
    let items: HashMap<i64, ItemRow> = items.into_iter().map(|i| (i.id, i)).collect();

    let offers: Vec<OfferRow> = db
        .prepare(format!(
            "SELECT item_id, chain, product_name, brand, price, size, unit_price, stores, min_price, max_price
             FROM offers WHERE item_id IN ({ph})"
        ))
        .bind(&ids)?
        .all()
        .await?
        .results()?;

    let chains: Vec<ChainRow> = db
        .prepare("SELECT code, name, price_date, stores FROM chains")
        .all()
        .await?
        .results()?;
    let allowed: HashSet<&str> = req.chains.iter().map(|s| s.as_str()).collect();

    // lokacija: samo lanci koji imaju poslovnicu u krugu
    let (near, radius, n_near) = match (req.lat, req.lon) {
        (Some(lat), Some(lon)) if geo::valid(lat, lon) => {
            let r = req.radius_km.unwrap_or(5.0).clamp(0.5, 50.0);
            let st = geo::nearby(db, lat, lon, r).await?;
            (Some(geo::by_chain(&st)), Some(r), st.len())
        }
        _ => (None, None, 0),
    };
    let chains: Vec<ChainRow> = chains
        .into_iter()
        .filter(|c| allowed.is_empty() || allowed.contains(c.code.as_str()))
        .filter(|c| near.as_ref().map_or(true, |n| n.contains_key(&c.code)))
        .collect();

    // najbolja ponuda po (lanac, stavka) uz preračun pakiranja za traženu količinu
    let mut best: HashMap<(String, i64), Line> = HashMap::new();
    for o in offers {
        let Some(it) = items.get(&o.item_id) else { continue };
        let q = qty.get(&o.item_id).copied().unwrap_or(1.0);
        let packs = packs_for(it, q, o.size);
        let cost = round2(o.price * packs as f64);
        let key = (o.chain.clone(), o.item_id);
        let better = match best.get(&key) {
            None => true,
            Some(b) => cost < b.cost || (cost == b.cost && o.stores > b.stores),
        };
        if better {
            best.insert(
                key,
                Line {
                    item_id: o.item_id,
                    item_name: it.name.clone(),
                    chain: o.chain,
                    product: o.product_name,
                    brand: o.brand.filter(|b| !b.is_empty()),
                    price: o.price,
                    packs,
                    cost,
                    size: o.size,
                    unit_price: o.unit_price,
                    stores: o.stores,
                    min_price: o.min_price,
                    max_price: o.max_price,
                },
            );
        }
    }

    let wanted: Vec<i64> = qty.keys().copied().filter(|i| items.contains_key(i)).collect();

    let mut totals: Vec<ChainTotal> = chains
        .iter()
        .map(|c| {
            let mut lines = Vec::new();
            let mut missing = Vec::new();
            for &i in &wanted {
                match best.get(&(c.code.clone(), i)) {
                    Some(l) => lines.push(l.clone()),
                    None => missing.push(i),
                }
            }
            ChainTotal {
                code: c.code.clone(),
                name: c.name.clone(),
                price_date: c.price_date.clone(),
                stores: c.stores,
                total: round2(lines.iter().map(|l| l.cost).sum()),
                found: lines.len(),
                missing,
                lines,
                nearest: near.as_ref().and_then(|n| n.get(&c.code)).map(|x| x.0.clone()),
                nearby: near.as_ref().and_then(|n| n.get(&c.code)).map_or(0, |x| x.1),
            }
        })
        .filter(|t| t.found > 0)
        .collect();
    // najviše pronađenih namirnica prvo, zatim najniža cijena
    totals.sort_by(|a, b| b.found.cmp(&a.found).then(a.total.partial_cmp(&b.total).unwrap()));

    // svaka namirnica u najjeftinijem lancu
    let combo = |set: &[&str]| -> Combo {
        let mut lines = Vec::new();
        let mut missing = Vec::new();
        for &i in &wanted {
            let b = set
                .iter()
                .filter_map(|c| best.get(&(c.to_string(), i)))
                .min_by(|a, b| a.cost.partial_cmp(&b.cost).unwrap().then(b.stores.cmp(&a.stores)));
            match b {
                Some(l) => lines.push(l.clone()),
                None => missing.push(i),
            }
        }
        let mut used: Vec<String> = lines.iter().map(|l| l.chain.clone()).collect();
        used.sort();
        used.dedup();
        Combo {
            chains: used,
            total: round2(lines.iter().map(|l| l.cost).sum()),
            found: lines.len(),
            missing,
            lines,
        }
    };
    let codes: Vec<&str> = chains.iter().map(|c| c.code.as_str()).collect();
    let cherry_pick = combo(&codes);

    // najbolji par lanaca (dvije kupovine umjesto pet)
    let mut best_pair: Option<Combo> = None;
    for a in 0..codes.len() {
        for b in (a + 1)..codes.len() {
            let c = combo(&[codes[a], codes[b]]);
            let better = match &best_pair {
                None => true,
                Some(p) => c.found > p.found || (c.found == p.found && c.total < p.total),
            };
            if better {
                best_pair = Some(c);
            }
        }
    }
    // par ima smisla samo ako je jeftiniji ili potpuniji od najboljeg pojedinačnog lanca
    if let (Some(p), Some(top)) = (&best_pair, totals.first()) {
        if p.chains.len() < 2 || (p.found == top.found && p.total >= top.total) {
            best_pair = None;
        }
    }

    Ok(BasketResp {
        requested: wanted.len(),
        chains: totals,
        best_pair,
        cherry_pick,
        radius_km: radius,
        stores_in_radius: n_near,
    })
}
