//! Cijene: preuzimanje dnevnih arhiva s api.cijene.dev i agregacija po lancu i stavci kataloga.

use crate::catalog::Catalog;
use crate::norm::{fold, parse_num, size_from_columns, size_from_name, Dim};
use crate::sql::{q, SqlWriter};
use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

const LIST_URL: &str = "https://api.cijene.dev/v0/list";
const UA: &str = "PametnaKupnja/0.1 (+https://github.com/lidlcindric-art/pametnakupnja)";

/// Lanci koje želimo i njihovi prikazni nazivi.
pub const CHAINS: &[(&str, &str)] = &[
    ("konzum", "Konzum"),
    ("lidl", "Lidl"),
    ("spar", "Spar"),
    ("kaufland", "Kaufland"),
    ("plodine", "Plodine"),
    ("tommy", "Tommy"),
    ("studenac", "Studenac"),
    ("eurospin", "Eurospin"),
    ("ktc", "KTC"),
    ("ribola", "Ribola"),
    ("ntl", "NTL"),
    ("zabac", "Žabac"),
    ("vrutak", "Vrutak"),
    ("trgocentar", "Trgocentar"),
    ("metro", "Metro"),
    ("dm", "dm"),
    ("boso", "Boso"),
    ("roto", "Roto"),
    ("brodokomerc", "Brodokomerc"),
    ("lorenco", "Lorenco"),
    ("trgovina-krk", "Trgovina Krk"),
    ("jadranka_trgovina", "Jadranka trgovina"),
    ("gavranovic", "Gavranović"),
    ("branka", "Branka"),
    ("djelo_vodice", "Djelo Vodice"),
    ("bure", "Bure"),
    ("dukat", "Dukat"),
    ("stanic", "Diskont Stanić"),
    ("stridon", "Stridon"),
];

#[derive(Deserialize)]
struct ArchiveList {
    archives: Vec<Archive>,
}
#[derive(Deserialize, Clone)]
struct Archive {
    date: String,
    url: String,
}

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(900))
        .build()?)
}

/// Popis lanaca u arhivi bez preuzimanja cijele datoteke (čita samo središnji direktorij ZIP-a).
fn chains_in_remote(c: &reqwest::blocking::Client, url: &str) -> Result<HashSet<String>> {
    let bytes = c
        .get(url)
        .header("Range", "bytes=-65536")
        .send()?
        .error_for_status()?
        .bytes()?;
    let s = String::from_utf8_lossy(&bytes);
    let mut set = HashSet::new();
    for (code, _) in CHAINS {
        if s.contains(&format!("{code}/prices.csv")) {
            set.insert(code.to_string());
        }
    }
    Ok(set)
}

fn download(c: &reqwest::blocking::Client, a: &Archive, dir: &Path) -> Result<PathBuf> {
    let p = dir.join(format!("{}.zip", a.date));
    if p.exists() {
        return Ok(p);
    }
    eprintln!("⬇  preuzimam {}", a.url);
    let tmp = dir.join(format!("{}.zip.part", a.date));
    let mut resp = c.get(&a.url).send()?.error_for_status()?;
    let mut f = File::create(&tmp)?;
    std::io::copy(&mut resp, &mut f)?;
    std::fs::rename(&tmp, &p)?;
    Ok(p)
}

/// Odaberi arhive: najnovija + starije za lance koji u najnovijoj nedostaju (do 10 dana unatrag).
fn plan_archives(cache: &Path) -> Result<Vec<(PathBuf, String, Vec<String>)>> {
    std::fs::create_dir_all(cache)?;
    let c = client()?;
    let list: ArchiveList = c.get(LIST_URL).send()?.error_for_status()?.json()?;
    let mut missing: HashSet<String> = CHAINS.iter().map(|(c, _)| c.to_string()).collect();
    let mut plan = Vec::new();
    for a in list.archives.iter().take(10) {
        if missing.is_empty() {
            break;
        }
        let present = chains_in_remote(&c, &a.url).with_context(|| a.url.clone())?;
        let take: Vec<String> = present.intersection(&missing).cloned().collect();
        if take.is_empty() {
            continue;
        }
        let path = download(&c, a, cache)?;
        // provjera u stvarnoj arhivi: daljinski pregled zna lažno prijaviti lanac (npr. Lidl)
        let names: HashSet<String> = zip::ZipArchive::new(File::open(&path)?)?
            .file_names()
            .map(|s| s.to_string())
            .collect();
        let take: Vec<String> = take
            .into_iter()
            .filter(|t| ["prices.csv", "products.csv", "stores.csv"].iter().all(|f| names.contains(&format!("{t}/{f}"))))
            .collect();
        if take.is_empty() {
            continue;
        }
        for t in &take {
            missing.remove(t);
        }
        eprintln!("📦 {}: {} lanaca", a.date, take.len());
        plan.push((path, a.date.clone(), take));
    }
    if !missing.is_empty() {
        eprintln!("⚠  bez podataka (10 dana): {:?}", missing);
    }
    // počisti stare arhive iz cachea
    let keep: HashSet<PathBuf> = plan.iter().map(|p| p.0.clone()).collect();
    for e in std::fs::read_dir(cache)?.flatten() {
        let p = e.path();
        if p.extension().is_some_and(|x| x == "zip") && !keep.contains(&p) {
            let _ = std::fs::remove_file(&p);
        }
    }
    Ok(plan)
}

struct Product {
    name: String,
    brand: String,
    ean: String,
    size: Option<(f64, Dim)>,
    items: Vec<usize>,
    prices: Vec<f64>,
    unit_prices: Vec<f64>,
}

pub struct Offer {
    pub item_id: usize,
    pub chain: String,
    pub name: String,
    pub brand: String,
    pub ean: String,
    pub price: f64,
    pub packs: u32,
    pub cost: f64,
    pub size: Option<f64>,
    pub unit_price: Option<f64>,
    pub stores: usize,
    pub min_price: f64,
    pub max_price: f64,
}

struct StoreRow {
    id: String,
    kind: String,
    address: String,
    city: String,
    zipcode: String,
}

fn csv_reader<R: Read>(r: R) -> csv::Reader<R> {
    csv::ReaderBuilder::new().flexible(true).from_reader(r)
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

fn process_chain(
    zip: &mut zip::ZipArchive<File>,
    chain: &str,
    cat: &Catalog,
) -> Result<(Vec<Offer>, Vec<StoreRow>, usize)> {
    // 1) proizvodi
    let mut products: HashMap<String, Product> = HashMap::new();
    let mut total_products = 0usize;
    {
        let f = zip.by_name(&format!("{chain}/products.csv"))?;
        let mut rdr = csv_reader(f);
        let h = rdr.headers()?.clone();
        let col = |n: &str| h.iter().position(|x| x == n);
        let ccat = col("category");
        let (ci, cb, cn, cbr, cu, cq) = (
            col("product_id").context("product_id")?,
            col("barcode"),
            col("name").context("name")?,
            col("brand"),
            col("unit"),
            col("quantity"),
        );
        for rec in rdr.records() {
            let rec = match rec {
                Ok(r) => r,
                Err(_) => continue,
            };
            total_products += 1;
            let name = rec.get(cn).unwrap_or("").trim().to_string();
            let fname = fold(&name);
            let fcat = fold(ccat.and_then(|i| rec.get(i)).unwrap_or(""));
            let items = cat.match_product(&fname, &fcat);
            if items.is_empty() {
                continue;
            }
            let g = |c: Option<usize>| c.and_then(|i| rec.get(i)).unwrap_or("").trim().to_string();
            let size = size_from_name(&fname).or_else(|| size_from_columns(&g(cu), &g(cq)));
            products.insert(
                rec.get(ci).unwrap_or("").trim().to_string(),
                Product {
                    name,
                    brand: g(cbr),
                    ean: g(cb),
                    size,
                    items,
                    prices: Vec::new(),
                    unit_prices: Vec::new(),
                },
            );
        }
    }
    // 2) cijene
    {
        let f = zip.by_name(&format!("{chain}/prices.csv"))?;
        let mut rdr = csv_reader(f);
        let h = rdr.headers()?.clone();
        let col = |n: &str| h.iter().position(|x| x == n);
        let can = col("anchor_price");
        let (cp, cpr, cup, csp) = (
            col("product_id").context("product_id")?,
            col("price").context("price")?,
            col("unit_price"),
            col("special_price"),
        );
        let mut rec = csv::StringRecord::new();
        while rdr.read_record(&mut rec).unwrap_or(false) {
            let Some(p) = rec.get(cp).and_then(|id| products.get_mut(id.trim())) else {
                continue;
            };
            let base = rec.get(cpr).and_then(parse_num);
            let special = csp.and_then(|i| rec.get(i)).and_then(parse_num);
            let eff = match (base, special) {
                (Some(b), Some(s)) if s > 0.0 && s < b => Some(s),
                (Some(b), _) if b > 0.0 => Some(b),
                (None, Some(s)) if s > 0.0 => Some(s),
                _ => None,
            };
            // rasprodaja/otpis u pojedinoj poslovnici (npr. 0,10 € uz sidrenu cijenu 1,79 €) — nije reprezentativno
            let anchor = can.and_then(|i| rec.get(i)).and_then(parse_num);
            let eff = match (eff, anchor) {
                (Some(e), Some(a)) if a > 0.0 && e < a * 0.4 => None,
                (e, _) => e,
            };
            if let Some(e) = eff {
                p.prices.push(e);
                if let Some(u) = cup.and_then(|i| rec.get(i)).and_then(parse_num) {
                    if u > 0.0 {
                        p.unit_prices.push(u);
                    }
                }
            }
        }
    }
    // 3) poslovnice
    let mut stores = Vec::new();
    {
        let f = zip.by_name(&format!("{chain}/stores.csv"))?;
        let mut rdr = csv_reader(f);
        let h = rdr.headers()?.clone();
        let col = |n: &str| h.iter().position(|x| x == n);
        let cols = [col("store_id"), col("type"), col("address"), col("city"), col("zipcode")];
        for rec in rdr.records().flatten() {
            let g = |i: usize| cols[i].and_then(|c| rec.get(c)).unwrap_or("").trim().to_string();
            stores.push(StoreRow { id: g(0), kind: g(1), address: g(2), city: g(3), zipcode: g(4) });
        }
    }
    // 4) ponude po stavci
    // proizvod mora biti u barem 3 % poslovnica lanca (min. 1, maks. 3) — inače je lokalna anomalija
    let min_stores = ((stores.len() as f64 * 0.03).ceil() as usize).clamp(1, 3);
    let mut per_item: BTreeMap<usize, Vec<Offer>> = BTreeMap::new();
    for p in products.values_mut() {
        if p.prices.len() < min_stores {
            continue;
        }
        let min_price = p.prices.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_price = p.prices.iter().cloned().fold(0.0, f64::max);
        let stores_n = p.prices.len();
        let price = (median(&mut p.prices) * 100.0).round() / 100.0;
        // veličina iz jedinične cijene ako je nema u nazivu/stupcima
        let mut size = p.size;
        if size.is_none() && !p.unit_prices.is_empty() {
            let up = median(&mut p.unit_prices);
            if up > 0.0 {
                let s = price / up;
                if s > 0.005 && s < 50.0 {
                    size = Some(((s * 1000.0).round() / 1000.0, Dim::Mass));
                }
            }
        }
        for &iid in &p.items {
            let it = &cat.items[iid - 1];
            if let Some((cost, packs)) = it.pack_cost(size, price) {
                let (sz, unit_price) = match size {
                    Some((s, _)) if s > 0.0 => (Some(s), Some(price / s)),
                    _ => (None, None),
                };
                per_item.entry(iid).or_default().push(Offer {
                    item_id: iid,
                    chain: chain.to_string(),
                    name: p.name.clone(),
                    brand: p.brand.clone(),
                    ean: p.ean.clone(),
                    price,
                    packs,
                    cost: (cost * 100.0).round() / 100.0,
                    size: sz,
                    unit_price,
                    stores: stores_n,
                    min_price,
                    max_price,
                });
            }
        }
    }
    let mut offers = Vec::new();
    for (_, mut v) in per_item {
        // cijena pa "dostupnost" (više poslovnica = pouzdanije)
        v.sort_by(|a, b| a.cost.partial_cmp(&b.cost).unwrap().then(b.stores.cmp(&a.stores)));
        offers.extend(v.into_iter().take(10));
    }
    Ok((offers, stores, total_products))
}

const STORES_DDL: &str = "CREATE TABLE IF NOT EXISTS stores (chain TEXT NOT NULL, store_id TEXT NOT NULL, type TEXT, address TEXT, city TEXT, zipcode TEXT, lat REAL, lon REAL, geo TEXT); CREATE INDEX IF NOT EXISTS stores_lat ON stores(lat); CREATE INDEX IF NOT EXISTS stores_city ON stores(city);";

fn geo_key(address: &str, city: &str) -> String {
    let n = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    format!("{}|{}", n(address), n(city))
}

/// data/geo/stores.json (scripts/geocode_stores.py): "adresa|grad" -> [lat, lon, preciznost] | null
fn load_geo(path: &str) -> HashMap<String, (f64, f64, String)> {
    let Ok(txt) = std::fs::read_to_string(path) else {
        eprintln!("⚠ nema {path} — poslovnice bez koordinata");
        return HashMap::new();
    };
    let raw: HashMap<String, Option<(f64, f64, String)>> = serde_json::from_str(&txt).unwrap_or_default();
    // "town" = samo središte grada — preneprecizno za radijus od par km, ne upisujemo
    raw.into_iter().filter_map(|(k, v)| v.filter(|v| v.2 != "town").map(|v| (k, v))).collect()
}

pub fn run(catalog: &str, cache: &str, out: &str, report: bool) -> Result<()> {
    let cat = Catalog::load(catalog)?;
    let geo = load_geo("data/geo/stores.json");
    let plan = plan_archives(Path::new(cache))?;
    let mut all_offers: Vec<Offer> = Vec::new();
    let mut chains_meta = Vec::new();
    let mut all_stores: Vec<(String, StoreRow)> = Vec::new();
    for (path, date, chains) in &plan {
        let mut zip = zip::ZipArchive::new(File::open(path)?)?;
        for chain in chains {
            match process_chain(&mut zip, chain, &cat) {
                Ok((offers, stores, nprod)) => {
                    let items_cov = offers.iter().map(|o| o.item_id).collect::<HashSet<_>>().len();
                    eprintln!(
                        "✔ {chain:<18} {date}  proizvoda {nprod:>6}  poslovnica {:>4}  stavki {items_cov:>3}/{}",
                        stores.len(),
                        cat.items.len()
                    );
                    chains_meta.push((chain.clone(), date.clone(), stores.len(), nprod, items_cov));
                    all_stores.extend(stores.into_iter().map(|s| (chain.clone(), s)));
                    all_offers.extend(offers);
                }
                Err(e) => eprintln!("✘ {chain}: {e:#}"),
            }
        }
    }

    let all_offers = drop_outliers(all_offers);
    // ponovno izračunaj pokrivenost nakon filtriranja
    for m in chains_meta.iter_mut() {
        m.4 = all_offers.iter().filter(|o| o.chain == m.0).map(|o| o.item_id).collect::<HashSet<_>>().len();
    }

    if report {
        print_report(&cat, &all_offers);
    }

    let mut w = SqlWriter::create(out)?;
    w.raw("DELETE FROM offers;")?;
    // stores tablicu uvijek iznova kreiramo (shema se razvija: lat/lon)
    w.raw("DROP TABLE IF EXISTS stores;")?;
    w.raw(STORES_DDL)?;
    w.raw("DELETE FROM chains;")?;
    w.raw("DELETE FROM items;")?;
    w.insert(
        "items",
        &["id", "slug", "name", "category", "unit", "target"],
        cat.items.iter().map(|it| {
            vec![
                it.id.to_string(),
                q(&it.slug),
                q(&it.name),
                q(&it.category),
                q(&it.unit),
                format!("{}", it.target),
            ]
        }),
    )?;
    let names: HashMap<&str, &str> = CHAINS.iter().cloned().collect();
    w.insert(
        "chains",
        &["code", "name", "price_date", "stores", "products", "items_covered"],
        chains_meta.iter().map(|(c, d, s, p, i)| {
            vec![q(c), q(names.get(c.as_str()).unwrap_or(&c.as_str())), q(d), s.to_string(), p.to_string(), i.to_string()]
        }),
    )?;
    w.insert(
        "stores",
        &["chain", "store_id", "type", "address", "city", "zipcode", "lat", "lon", "geo"],
        all_stores.iter().map(|(c, s)| {
            let g = geo.get(&geo_key(&s.address, &s.city));
            let (lat, lon, prec) = match g {
                Some((la, lo, p)) => (format!("{la:.6}"), format!("{lo:.6}"), q(p)),
                None => ("NULL".into(), "NULL".into(), "NULL".into()),
            };
            vec![q(c), q(&s.id), q(&s.kind), q(&s.address), q(&title_city(&s.city)), q(&s.zipcode), lat, lon, prec]
        }),
    )?;
    w.insert(
        "offers",
        &[
            "item_id", "chain", "rank", "product_name", "brand", "ean", "price", "packs", "cost", "size",
            "unit_price", "stores", "min_price", "max_price",
        ],
        {
            let mut rank: HashMap<(usize, String), u32> = HashMap::new();
            all_offers.iter().map(move |o| {
                let r = rank.entry((o.item_id, o.chain.clone())).or_insert(0);
                *r += 1;
                vec![
                    o.item_id.to_string(),
                    q(&o.chain),
                    r.to_string(),
                    q(&o.name),
                    q(&o.brand),
                    q(&o.ean),
                    format!("{:.2}", o.price),
                    o.packs.to_string(),
                    format!("{:.2}", o.cost),
                    o.size.map(|s| format!("{s:.3}")).unwrap_or("NULL".into()),
                    o.unit_price.map(|s| format!("{s:.2}")).unwrap_or("NULL".into()),
                    o.stores.to_string(),
                    format!("{:.2}", o.min_price),
                    format!("{:.2}", o.max_price),
                ]
            }).collect::<Vec<_>>().into_iter()
        },
    )?;
    let newest = plan.first().map(|p| p.1.clone()).unwrap_or_default();
    w.raw(&format!(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('prices_date', {}), ('prices_updated', datetime('now'));",
        q(&newest)
    ))?;
    w.finish()?;
    let located = all_stores.iter().filter(|(_, s)| geo.contains_key(&geo_key(&s.address, &s.city))).count();
    eprintln!(
        "💾 {out}: {} ponuda, {} lanaca, {} poslovnica ({located} s koordinatama)",
        all_offers.len(),
        chains_meta.len(),
        all_stores.len()
    );
    Ok(())
}

/// "ZAGREB" → "Zagreb", "SLAVONSKI BROD" → "Slavonski Brod"
/// Izbaci ponude čiji je trošak nerealno nizak u odnosu na medijan stavke preko svih lanaca
/// (pogrešno prepoznat proizvod, krivo pakiranje, otpis), zatim zadrži 3 najbolje po lancu.
fn drop_outliers(offers: Vec<Offer>) -> Vec<Offer> {
    let mut by_item: BTreeMap<usize, Vec<Offer>> = BTreeMap::new();
    for o in offers {
        by_item.entry(o.item_id).or_default().push(o);
    }
    let mut out = Vec::new();
    for (_, v) in by_item {
        // medijan najbolje ponude po lancu
        let mut best: HashMap<&str, f64> = HashMap::new();
        for o in &v {
            let e = best.entry(o.chain.as_str()).or_insert(f64::INFINITY);
            *e = e.min(o.cost);
        }
        let mut b: Vec<f64> = best.values().cloned().collect();
        let med = if b.is_empty() { 0.0 } else { median(&mut b) };
        let floor = med * 0.35;
        let mut per_chain: BTreeMap<String, Vec<Offer>> = BTreeMap::new();
        for o in v {
            if o.cost >= floor {
                per_chain.entry(o.chain.clone()).or_default().push(o);
            }
        }
        for (_, mut cv) in per_chain {
            cv.sort_by(|a, b| a.cost.partial_cmp(&b.cost).unwrap().then(b.stores.cmp(&a.stores)));
            out.extend(cv.into_iter().take(3));
        }
    }
    out
}

fn title_city(s: &str) -> String {
    let s = s.trim();
    if s.chars().any(|c| c.is_lowercase()) {
        return s.to_string();
    }
    s.split(' ')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn print_report(cat: &Catalog, offers: &[Offer]) {
    let mut by_item: BTreeMap<usize, Vec<&Offer>> = BTreeMap::new();
    for o in offers {
        by_item.entry(o.item_id).or_default().push(o);
    }
    for it in &cat.items {
        let v = by_item.get(&it.id).cloned().unwrap_or_default();
        let firsts: Vec<&&Offer> = {
            let mut seen = HashSet::new();
            v.iter().filter(|o| seen.insert(o.chain.clone())).collect()
        };
        println!("\n## {} [{}] — {} lanaca", it.name, it.slug, firsts.len());
        let mut f2 = firsts.clone();
        f2.sort_by(|a, b| a.cost.partial_cmp(&b.cost).unwrap());
        for o in f2.iter().take(8) {
            println!(
                "   {:>7.2} € ({}× {:.2})  {:<12} {}  [{:?}]",
                o.cost, o.packs, o.price, o.chain, o.name, o.size
            );
        }
    }
}
