//! Katalog namirnica (catalog/namirnice.toml) i pravila podudaranja.

use crate::norm::Dim;
use anyhow::{Context, Result};
use regex::Regex;
use serde::Deserialize;

#[derive(Deserialize)]
struct RawCatalog {
    #[serde(default)]
    global_exclude: String,
    #[serde(default)]
    category_exclude: String,
    item: Vec<RawItem>,
}

#[derive(Deserialize, Clone)]
struct RawItem {
    slug: String,
    name: String,
    category: String,
    unit: String,
    target: f64,
    min: f64,
    max: f64,
    include: String,
    #[serde(default)]
    exclude: String,
    recipe: String,
    #[serde(default)]
    recipe_exclude: String,
}

pub struct Item {
    pub id: usize,
    pub slug: String,
    pub name: String,
    pub category: String,
    /// None = "any" (bez provjere veličine)
    pub dim: Option<Dim>,
    pub unit: String,
    pub target: f64,
    pub min: f64,
    pub max: f64,
    include: Regex,
    exclude: Option<Regex>,
    recipe: Regex,
    recipe_exclude: Option<Regex>,
}

fn opt_re(s: &str, ctx: &str) -> Result<Option<Regex>> {
    if s.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(Regex::new(s).with_context(|| ctx.to_string())?))
    }
}

impl Item {
    pub fn matches_product(&self, folded_name: &str) -> bool {
        self.include.is_match(folded_name)
            && !self.exclude.as_ref().is_some_and(|r| r.is_match(folded_name))
    }

    /// Duljina najduljeg podudaranja s retkom sastojka (0 = nema).
    pub fn recipe_score(&self, folded_line: &str) -> usize {
        if self.recipe_exclude.as_ref().is_some_and(|r| r.is_match(folded_line)) {
            return 0;
        }
        self.recipe
            .find_iter(folded_line)
            .map(|m| m.as_str().len())
            .max()
            .unwrap_or(0)
    }

    /// Trošak za pokrivanje ciljne količine zadanim pakiranjem (None ako pakiranje ne odgovara).
    pub fn pack_cost(&self, size: Option<(f64, Dim)>, price: f64) -> Option<(f64, u32)> {
        match self.dim {
            None => Some((price, 1)),
            Some(d) => {
                let (s, sd) = size?;
                if sd != d || s < self.min - 1e-9 || s > self.max + 1e-9 {
                    return None;
                }
                let packs = ((self.target / s) - 1e-6).ceil().max(1.0) as u32;
                Some((price * packs as f64, packs))
            }
        }
    }
}

pub struct Catalog {
    pub items: Vec<Item>,
    global_exclude: Option<Regex>,
    category_exclude: Option<Regex>,
}

impl Catalog {
    pub fn load(path: &str) -> Result<Self> {
        let txt = std::fs::read_to_string(path).with_context(|| format!("čitanje {path}"))?;
        let raw: RawCatalog = toml::from_str(&txt).context("parsiranje kataloga")?;
        let mut items = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (i, r) in raw.item.iter().cloned().enumerate() {
            anyhow::ensure!(seen.insert(r.slug.clone()), "dupli slug {}", r.slug);
            let ctx = |f: &str| format!("{}: {}", r.slug, f);
            let dim = match r.unit.as_str() {
                "kg" => Some(Dim::Mass),
                "kom" => Some(Dim::Pieces),
                "any" => None,
                u => anyhow::bail!("{}: nepoznata jedinica {u}", r.slug),
            };
            items.push(Item {
                id: i + 1,
                include: Regex::new(&r.include).with_context(|| ctx("include"))?,
                exclude: opt_re(&r.exclude, &ctx("exclude"))?,
                recipe: Regex::new(&r.recipe).with_context(|| ctx("recipe"))?,
                recipe_exclude: opt_re(&r.recipe_exclude, &ctx("recipe_exclude"))?,
                slug: r.slug,
                name: r.name,
                category: r.category,
                dim,
                unit: r.unit,
                target: r.target,
                min: r.min,
                max: r.max,
            });
        }
        Ok(Self {
            items,
            global_exclude: opt_re(&raw.global_exclude, "global_exclude")?,
            category_exclude: opt_re(&raw.category_exclude, "category_exclude")?,
        })
    }

    /// Stavke kataloga kojima proizvod odgovara (nakon globalnih filtara).
    pub fn match_product(&self, folded_name: &str, folded_category: &str) -> Vec<usize> {
        if self.global_exclude.as_ref().is_some_and(|r| r.is_match(folded_name))
            || (!folded_category.is_empty()
                && self.category_exclude.as_ref().is_some_and(|r| r.is_match(folded_category)))
        {
            return Vec::new();
        }
        self.items.iter().filter(|it| it.matches_product(folded_name)).map(|it| it.id).collect()
    }

    /// Najbolja stavka kataloga za redak sastojka recepta.
    pub fn match_ingredient(&self, line: &str) -> Option<&Item> {
        let f = crate::norm::fold(line);
        self.items
            .iter()
            .map(|it| (it.recipe_score(&f), it))
            .filter(|(s, _)| *s > 0)
            .max_by_key(|(s, it)| (*s, std::cmp::Reverse(it.id)))
            .map(|(_, it)| it)
    }
}
