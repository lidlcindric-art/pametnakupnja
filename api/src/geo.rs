//! Poslovnice u krugu oko korisnika (haversine nad D1, prefiltrirano bounding boxom).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use worker::{D1Database, Result};

#[derive(Deserialize, Serialize, Clone)]
pub struct Store {
    pub chain: String,
    pub store_id: String,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub lat: f64,
    pub lon: f64,
    /// preciznost geokodiranja: addr | street | city
    pub geo: Option<String>,
    #[serde(default)]
    pub dist_km: f64,
}

pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371.0088;
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * r * a.sqrt().asin()
}

pub fn valid(lat: f64, lon: f64) -> bool {
    lat.is_finite() && lon.is_finite() && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)
}

/// Sve poslovnice unutar `radius_km`, sortirane po udaljenosti.
pub async fn nearby(db: &D1Database, lat: f64, lon: f64, radius_km: f64) -> Result<Vec<Store>> {
    let dlat = radius_km / 111.0;
    let dlon = radius_km / (111.320 * lat.to_radians().cos().max(0.01));
    let rows: Vec<Store> = db
        .prepare(
            "SELECT chain, store_id, type, address, city, lat, lon, geo FROM stores
             WHERE lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4",
        )
        .bind(&[(lat - dlat).into(), (lat + dlat).into(), (lon - dlon).into(), (lon + dlon).into()])?
        .all()
        .await?
        .results()?;
    let mut v: Vec<Store> = rows
        .into_iter()
        .map(|mut s| {
            s.dist_km = (haversine_km(lat, lon, s.lat, s.lon) * 100.0).round() / 100.0;
            s
        })
        .filter(|s| s.dist_km <= radius_km)
        .collect();
    v.sort_by(|a, b| a.dist_km.partial_cmp(&b.dist_km).unwrap());
    Ok(v)
}

/// Najbliža poslovnica i broj poslovnica u krugu, po lancu.
pub fn by_chain(stores: &[Store]) -> HashMap<String, (Store, usize)> {
    let mut m: HashMap<String, (Store, usize)> = HashMap::new();
    for s in stores {
        m.entry(s.chain.clone()).and_modify(|e| e.1 += 1).or_insert((s.clone(), 1));
    }
    m
}
