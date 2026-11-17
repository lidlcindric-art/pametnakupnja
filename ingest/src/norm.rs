//! Normalizacija teksta i parsiranje količina.

/// Mala slova + bez hrvatskih dijakritika (č,ć→c, š→s, ž→z, đ→d) + sažeti razmaci.
pub fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = true;
    for ch in s.chars() {
        let c = match ch {
            'č' | 'ć' | 'Č' | 'Ć' => 'c',
            'š' | 'Š' => 's',
            'ž' | 'Ž' => 'z',
            'đ' | 'Đ' => 'd',
            'à' | 'á' | 'â' | 'ä' | 'À' | 'Á' | 'Â' | 'Ä' => 'a',
            'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ò' | 'ó' | 'ô' | 'ö' | 'Ö' | 'Ó' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'Ü' => 'u',
            '½' => ' ',
            c => c,
        };
        for lc in c.to_lowercase() {
            if lc.is_whitespace() {
                if !last_space {
                    out.push(' ');
                    last_space = true;
                }
            } else {
                out.push(lc);
                last_space = false;
            }
        }
    }
    out.trim_end().to_string()
}

pub fn parse_num(s: &str) -> Option<f64> {
    let t = s.trim().replace(',', ".");
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok().filter(|v| v.is_finite())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Dim {
    /// kg ili l (gustoća ≈ 1)
    Mass,
    Pieces,
}

/// Pokušaj izvući veličinu pakiranja iz naziva proizvoda (već "fold"-an).
pub fn size_from_name(name: &str) -> Option<(f64, Dim)> {
    use std::sync::OnceLock;
    static MULTI: OnceLock<regex::Regex> = OnceLock::new();
    static SINGLE: OnceLock<regex::Regex> = OnceLock::new();
    static PIECES: OnceLock<regex::Regex> = OnceLock::new();
    let multi = MULTI.get_or_init(|| {
        regex::Regex::new(r"(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|lit|ml|dl|cl)\b").unwrap()
    });
    let single = SINGLE.get_or_init(|| {
        regex::Regex::new(r"(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|lt|lit|ml|dl|cl)\b").unwrap()
    });
    let pieces = PIECES
        .get_or_init(|| regex::Regex::new(r"(?:^|\s)(\d{1,3})\s*(?:kom|komada|/1)\b|\bm?\s?(\d{1,2})/1\b").unwrap());

    if let Some(c) = multi.captures(name) {
        let n = parse_num(&c[1])?;
        let v = parse_num(&c[2])?;
        return Some((n * v * unit_factor(&c[3]), Dim::Mass));
    }
    if let Some(c) = single.captures_iter(name).last() {
        let v = parse_num(&c[1])?;
        if v > 0.0 {
            return Some((v * unit_factor(&c[2]), Dim::Mass));
        }
    }
    if let Some(c) = pieces.captures(name) {
        let g = c.get(1).or_else(|| c.get(2))?;
        let v = parse_num(g.as_str())?;
        if v > 0.0 {
            return Some((v, Dim::Pieces));
        }
    }
    None
}

fn unit_factor(u: &str) -> f64 {
    match u {
        "g" | "gr" | "ml" => 0.001,
        "dl" => 0.1,
        "cl" => 0.01,
        _ => 1.0,
    }
}

/// Veličina iz stupaca `unit` + `quantity` (formati se razlikuju po lancima).
pub fn size_from_columns(unit: &str, quantity: &str) -> Option<(f64, Dim)> {
    let u = fold(unit);
    let q = fold(quantity);
    // npr. "0,500 kg", "1 l"
    if let Some(r) = size_from_name(&q) {
        return Some(r);
    }
    // npr. unit="80g", quantity="0.08"
    if let Some(r) = size_from_name(&u) {
        if r.1 == Dim::Mass {
            return Some(r);
        }
    }
    let v = parse_num(&q)?;
    if v <= 0.0 {
        return None;
    }
    match u.as_str() {
        "kg" | "l" | "lt" | "lit" | "litra" => Some((v, Dim::Mass)),
        "g" | "ml" => Some((v / 1000.0, Dim::Mass)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folding() {
        assert_eq!(fold("BRAŠNO  Glatko T-550 Čakovečki"), "brasno glatko t-550 cakovecki");
        assert_eq!(fold("Đumbir"), "dumbir");
    }
    #[test]
    fn sizes() {
        assert_eq!(size_from_name("mlijeko 2,8% 1 l"), Some((1.0, Dim::Mass)));
        assert_eq!(size_from_name("jogurt 6x180g").map(|x| (x.0 * 1000.0).round()), Some(1080.0));
        assert_eq!(size_from_name("jaja l 10/1"), Some((10.0, Dim::Pieces)));
        assert_eq!(size_from_name("jaja 10 kom"), Some((10.0, Dim::Pieces)));
        assert_eq!(size_from_columns("KOM", "0,500 KG"), Some((0.5, Dim::Mass)));
        assert_eq!(size_from_columns("1l", "1"), Some((1.0, Dim::Mass)));
    }
}
