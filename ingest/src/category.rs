//! Kategorija recepta (Coolinarika je ne objavljuje): pravila nad nazivom i sastojcima.
//! Vrijednosti: "juhe", "predjela", "glavna", "deserti".
use regex::Regex;
use std::sync::OnceLock;

struct Rx { soup: Regex, soup_not: Regex, strong_app: Regex, des: Regex, sav_t: Regex, palac: Regex, des_amb: Regex, app: Regex, salty_i: Regex, sweet_i: Regex }

fn rx() -> &'static Rx {
    static R: OnceLock<Rx> = OnceLock::new();
    R.get_or_init(|| Rx {
        soup: Regex::new(r"\b(juh|krem juh|cucina|corb|minestron|temeljac|consomm|gazpach|ramen|pho\b|bujon|potaz|krem od (bundev|brokul|tikvic|graska|mrkv|gljiv|rajcic|cvjetac|poriluk|krumpir|celer|batat|leca))").unwrap(),
        soup_not: Regex::new(r"stapic|za juhu").unwrap(),
        strong_app: Regex::new(r"(salat|namaz|bruskett|bruschett|\bdip\b|pasteta|carpaccio|tartar|hummus|humus|kanape|predjel|tapas|crostin|guacamole|tzatziki|pinjur)").unwrap(),
        des: Regex::new(r"(kolac|cookie|torta|tortic|keks|muffin|sladoled|puding|pudding|mousse|tiramisu|krafn|strudl|savijac|cheesecake|brownie|cokolad|desert|kuglic|fritul|biskvit|cupcake|affogato|panna cotta|kremsnit|slatk|semifreddo|parfe|tartuf|praline|medenjak|licitar|gugelhupf|kuglof|krempit|banana bread|crumble|granola|kompot|marmelad|dzem|zele\b|baklav|kadaif|tufahij|orehnjac|makovnjac|povitic|pinca|sarlot|waffl|vafl|donut|sufle|eklere?|ekleri|profiterol|flan|brulee|nutell|rolic|lincer|panettone|oblatn|sni?te|karamel|bombon|fudge|halv|smoothie|frape|milkshake|koktel|napitak|limunad|kakao|overnight|stracciatell)").unwrap(),
        sav_t: Regex::new(r"(piletin|pilec|pile\b|purec|puret|meso|mesn|mljeven|junet|junec|telet|telec|svinj|janjet|odrezak|snicl|kotlet|lungic|rebarc|krilc|batak|kobasic|slanin|sunk|pancet|prsut|riba|ribl|tun[aeu]\b|tunjevin|losos|srdel|oslic|pastrv|grdobin|lignj|kozic|racic|skamp|hobotnic|njok|tjestenin|pasta|pasta\b|spaget|tagliatell|lazanj|makaron|rezanc|riz|rizot|pizza|pizz|burger|gulas|varivo|paprikas|grah|lec[ae]|musak|burrito|tortilj|wrap|kebab|doner|sendvic|tost|omlet|jaja|frittat|quiche|burek|zeljanic|sirnic|krumpir|palent|kaga|stir fry|curry|bowl|cevap|plesk|sarma|punjene paprike|punjena paprika|tikvic|patlidzan|balancan|blitva|spinat|gljiv|maneštr|manestr|ricet|jecam|heljd|kus kus|cous)").unwrap(),
        palac: Regex::new(r"palacin|pancake").unwrap(),
        des_amb: Regex::new(r"(palacin|palacink|pancake|pita|rolad|rolat|kifl|pogac|gužvar|guzvar|tart\b|kroasan)").unwrap(),
        app: Regex::new(r"(^umak|^dip|stapic|pogacic|grickalic|focacc|kruh|pogac|perec|peciv|lepin|pire|pomfrit|prilog|pecene paprike|slanac|punjena jaja|jaja punjen|ajvar|pesto|marinirane? (paprik|tikvic|gljiv))").unwrap(),
        salty_i: Regex::new(r"(\bluk|cesnjak|meso|mesa\b|piletin|pilec|pure|svinj|junet|telet|riba|tun[ae]|tunjevin|losos|slanin|sunk|kobasic|parmezan|feta|papar|kecap|senf|ajvar|sir za pizzu|mozzarell|spinat|blitva)").unwrap(),
        sweet_i: Regex::new(r"(secer|\bmed\b|meda\b|cokolad|kakao|vanil|nutell|dzem|marmelad|slatko vrhnje.*secer)").unwrap(),
    })
}

/// `title` i `ingredients` moraju biti prošli kroz `norm::fold`.
pub fn classify(title: &str, ingredients: &str) -> &'static str {
    let r = rx();
    let (t, ing) = (title, ingredients);
    let salty = r.salty_i.is_match(ing);
    let sweet = r.sweet_i.is_match(ing);
    if r.soup.is_match(t) && !r.soup_not.is_match(t) { return "juhe"; }
    if r.strong_app.is_match(t) && !r.des.is_match(t) && !t.contains("salatom") { return "predjela"; }
    if r.des.is_match(t) && !r.sav_t.is_match(t) { return "deserti"; }
    if r.palac.is_match(t) && !salty { return "deserti"; }
    if r.des_amb.is_match(t) && sweet && !salty { return "deserti"; }
    if r.sav_t.is_match(t) { return "glavna"; }
    if r.app.is_match(t) { return "predjela"; }
    if sweet && !salty { return "deserti"; }
    if r.des_amb.is_match(t) { return "predjela"; }
    "glavna"
}
