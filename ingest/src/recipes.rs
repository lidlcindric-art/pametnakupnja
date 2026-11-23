//! Recepti s coolinarika.com: pristojno preuzimanje (robots.txt Crawl-delay: 15 s)
//! i mapiranje sastojaka na stavke kataloga.
//!
//! Spremamo SAMO naziv, poveznicu, sliku (URL) i popis sastojaka — upute za pripremu
//! ostaju na izvornoj stranici (autorska prava), a aplikacija uvijek vodi korisnika na izvor.

use crate::catalog::Catalog;
use crate::sql::{q, SqlWriter};
use anyhow::{Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, Instant};

const BASE: &str = "https://www.coolinarika.com";
const UA: &str = "PametnaKupnjaBot/0.1 (+https://github.com/lidlcindric-art/pametnakupnja)";

#[derive(Serialize, Deserialize, Clone)]
pub struct Recipe {
    pub slug: String,
    pub url: String,
    pub title: String,
    pub image: Option<String>,
    pub description: Option<String>,
    pub ingredients: Vec<String>,
    pub servings: Option<String>,
    pub total_time: Option<String>,
    pub category: Option<String>,
    pub published: Option<String>,
    pub fetched: String,
}

struct Polite {
    c: reqwest::blocking::Client,
    delay: Duration,
    last: Option<Instant>,
}

impl Polite {
    fn get(&mut self, url: &str) -> Result<String> {
        if let Some(t) = self.last {
            let el = t.elapsed();
            if el < self.delay {
                std::thread::sleep(self.delay - el);
            }
        }
        self.last = Some(Instant::now());
        let r = self.c.get(url).send()?;
        let st = r.status();
        anyhow::ensure!(st.is_success(), "{url}: HTTP {st}");
        Ok(r.text()?)
    }
}

fn locs(xml: &str) -> Vec<String> {
    let re = Regex::new(r"<loc>\s*([^<\s]+)\s*</loc>").unwrap();
    re.captures_iter(xml).map(|c| c[1].replace("&amp;", "&")).collect()
}

fn slug_of(url: &str) -> String {
    url.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string()
}

fn str_or_first(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(a) => a.iter().find_map(str_or_first),
        serde_json::Value::Object(o) => o.get("url").and_then(str_or_first),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn find_recipe(v: &serde_json::Value) -> Option<&serde_json::Value> {
    match v {
        serde_json::Value::Object(o) => {
            let is = match o.get("@type") {
                Some(serde_json::Value::String(t)) => t == "Recipe",
                Some(serde_json::Value::Array(a)) => a.iter().any(|t| t == "Recipe"),
                _ => false,
            };
            if is {
                return Some(v);
            }
            o.get("@graph").and_then(find_recipe)
        }
        serde_json::Value::Array(a) => a.iter().find_map(find_recipe),
        _ => None,
    }
}

pub fn parse_recipe(html: &str, url: &str) -> Option<Recipe> {
    let re = Regex::new(r#"(?s)<script[^>]*application/ld\+json[^>]*>(.*?)</script>"#).unwrap();
    for c in re.captures_iter(html) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(c[1].trim()) else { continue };
        let Some(r) = find_recipe(&v) else { continue };
        let ingredients: Vec<String> = r
            .get("recipeIngredient")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && s != "null")
                    .collect()
            })
            .unwrap_or_default();
        let title = r.get("name").and_then(str_or_first)?;
        return Some(Recipe {
            slug: slug_of(url),
            url: url.to_string(),
            title: html_unescape(&title),
            image: r.get("image").and_then(str_or_first),
            description: r.get("description").and_then(str_or_first).map(|d| html_unescape(&d)),
            ingredients: ingredients.iter().map(|s| html_unescape(s)).collect(),
            servings: r.get("recipeYield").and_then(str_or_first),
            total_time: r.get("totalTime").or_else(|| r.get("prepTime")).and_then(str_or_first),
            category: r.get("recipeCategory").and_then(str_or_first),
            published: r.get("datePublished").and_then(str_or_first),
            fetched: String::new(),
        });
    }
    None
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

/// Preuzmi do `max_new` novih recepata (najnoviji mjeseci prvi).
pub fn scrape(cache: &str, max_new: usize, delay_s: u64, months: usize) -> Result<()> {
    let dir = Path::new(cache);
    std::fs::create_dir_all(dir)?;
    let mut p = Polite {
        c: reqwest::blocking::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(60))
            .build()?,
        delay: Duration::from_secs(delay_s.max(15)),
        last: None,
    };
    let robots = p.get(&format!("{BASE}/robots.txt")).unwrap_or_default();
    if robots.lines().any(|l| l.trim().eq_ignore_ascii_case("disallow: /recept") || l.trim() == "Disallow: /") {
        anyhow::bail!("robots.txt više ne dopušta preuzimanje recepata — prekidam");
    }
    let index = p.get(&format!("{BASE}/sitemap.xml"))?;
    let mut maps: Vec<String> = locs(&index).into_iter().filter(|u| u.contains("/sitemap/recepti/")).collect();
    maps.sort();
    maps.reverse();
    let mut new = 0usize;
    let mut failures = 0usize;
    'outer: for m in maps.iter().take(months) {
        let xml = match p.get(m) {
            Ok(x) => x,
            Err(e) => {
                eprintln!("⚠ {m}: {e:#}");
                continue;
            }
        };
        for url in locs(&xml) {
            if !url.contains("/recept/") {
                continue;
            }
            let slug = slug_of(&url);
            let f = dir.join(format!("{slug}.json"));
            let miss = dir.join(format!("{slug}.none"));
            if f.exists() || miss.exists() {
                continue;
            }
            if new >= max_new {
                break 'outer;
            }
            match p.get(&url) {
                Ok(html) => match parse_recipe(&html, &url) {
                    Some(mut r) if !r.ingredients.is_empty() => {
                        r.fetched = now_iso();
                        std::fs::write(&f, serde_json::to_vec_pretty(&r)?)?;
                        new += 1;
                        eprintln!("🍲 [{new}/{max_new}] {}", r.title);
                    }
                    _ => {
                        std::fs::write(&miss, b"")?;
                    }
                },
                Err(e) => {
                    failures += 1;
                    eprintln!("⚠ {url}: {e:#}");
                    if failures > 10 {
                        anyhow::bail!("previše grešaka, prekidam");
                    }
                }
            }
        }
    }
    eprintln!("✔ novih recepata: {new}");
    Ok(())
}

pub fn load_cache(cache: &str) -> Result<Vec<Recipe>> {
    let mut v = Vec::new();
    for e in std::fs::read_dir(cache).with_context(|| cache.to_string())?.flatten() {
        let p = e.path();
        if p.extension().is_some_and(|x| x == "json") {
            if let Ok(r) = serde_json::from_slice::<Recipe>(&std::fs::read(&p)?) {
                v.push(r);
            }
        }
    }
    v.sort_by(|a, b| b.published.cmp(&a.published).then(a.slug.cmp(&b.slug)));
    Ok(v)
}

fn is_header(line: &str) -> bool {
    let t = line.trim();
    t.ends_with(':') || t.chars().all(|c| !c.is_alphabetic())
}

pub fn to_sql(catalog: &str, cache: &str, out: &str) -> Result<()> {
    let cat = Catalog::load(catalog)?;
    let recipes = load_cache(cache)?;
    let mut w = SqlWriter::create(out)?;
    w.raw("DELETE FROM recipe_lines;")?;
    w.raw("DELETE FROM recipes;")?;
    let mut lines_rows = Vec::new();
    let mut matched = 0usize;
    let mut total = 0usize;
    let mut recipe_rows = Vec::new();
    for r in &recipes {
        let mut n_items = std::collections::HashSet::new();
        for (pos, line) in r.ingredients.iter().enumerate() {
            if is_header(line) {
                lines_rows.push(vec![q(&r.slug), pos.to_string(), q(line), "NULL".into(), "1".into()]);
                continue;
            }
            total += 1;
            let it = cat.match_ingredient(line);
            if let Some(it) = it {
                matched += 1;
                n_items.insert(it.id);
            }
            lines_rows.push(vec![
                q(&r.slug),
                pos.to_string(),
                q(line),
                it.map(|i| i.id.to_string()).unwrap_or("NULL".into()),
                "0".into(),
            ]);
        }
        let search = crate::norm::fold(&format!("{} {}", r.title, r.ingredients.join(" ")));
        recipe_rows.push(vec![
            q(&r.slug),
            q(&r.title),
            q(&r.url),
            r.image.as_deref().map(q).unwrap_or("NULL".into()),
            r.description.as_deref().map(|d| q(&d.chars().take(220).collect::<String>())).unwrap_or("NULL".into()),
            r.servings.as_deref().map(q).unwrap_or("NULL".into()),
            r.total_time.as_deref().map(q).unwrap_or("NULL".into()),
            r.published.as_deref().map(q).unwrap_or("NULL".into()),
            n_items.len().to_string(),
            q(&search),
            q(crate::category::classify(&crate::norm::fold(&r.title), &crate::norm::fold(&r.ingredients.join(" ")))),
        ]);
    }
    w.insert(
        "recipes",
        &["slug", "title", "url", "image", "description", "servings", "total_time", "published", "n_items", "search", "category"],
        recipe_rows.into_iter(),
    )?;
    w.insert("recipe_lines", &["recipe_slug", "pos", "line", "item_id", "is_header"], lines_rows.into_iter())?;
    w.raw("INSERT OR REPLACE INTO meta(key, value) VALUES ('recipes_updated', datetime('now'));")?;
    w.finish()?;
    eprintln!(
        "💾 {out}: {} recepata, sastojaka prepoznato {matched}/{total} ({:.0}%)",
        recipes.len(),
        if total > 0 { matched as f64 * 100.0 / total as f64 } else { 0.0 }
    );
    Ok(())
}

/// Ispis nepoznatih sastojaka (najčešći prvi) — pomaže proširiti katalog.
pub fn unmatched(catalog: &str, cache: &str, top: usize) -> Result<()> {
    let cat = Catalog::load(catalog)?;
    let mut cnt: std::collections::HashMap<String, usize> = Default::default();
    for r in load_cache(cache)? {
        for l in &r.ingredients {
            if !is_header(l) && cat.match_ingredient(l).is_none() {
                let k = crate::norm::fold(l);
                let k: String = k.split(' ').filter(|w| !w.chars().any(|c| c.is_ascii_digit())).collect::<Vec<_>>().join(" ");
                *cnt.entry(k).or_default() += 1;
            }
        }
    }
    let mut v: Vec<_> = cnt.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    for (k, n) in v.into_iter().take(top) {
        println!("{n:>4}  {k}");
    }
    Ok(())
}
