#!/usr/bin/env python3
"""Koordinate poslovnica: spaja popis poslovnica iz cijene.dev s OpenStreetMap trgovinama.

Ulaz (preuzimanje — vidi README):
  data/geo/osm/shops.geojsonseq  osmium export trgovina iz Geofabrik croatia-latest.osm.pbf
  data/geo/osm/places.geojsonseq osmium export naselja (place=*)
Izlaz:
  data/geo/stores.json  "adresa|grad" -> [lat, lon, preciznost] | null
     preciznost: "osm"    — poslovnica istog lanca u OSM-u, ulica se poklapa
                 "osm1"   — jedina poslovnica tog lanca u mjestu (ulica se ne poklapa / ne postoji u OSM-u)
                 "street" — ulica s OSM trgovinom bilo kojeg lanca u mjestu (središte ulice)
                 "city"   — samo središte sela/manjeg naselja (dovoljno za radijus 5 km)
                 "town"   — samo središte grada: preneprecizno, ingest za njih NE upisuje koordinate
Postojeći unosi preciznosti "addr" (Nominatim) se zadržavaju.
"""
import csv, glob, io, json, math, os, re, sys, unicodedata, zipfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(ROOT, "data/geo")

# kod lanca u cijene.dev -> regex na OSM brand/name/operator
BRANDS = {
    "konzum": r"konzum", "studenac": r"studenac", "tommy": r"tommy", "plodine": r"plodine",
    "spar": r"spar", "lidl": r"lidl", "kaufland": r"kaufland", "ntl": r"\bntl\b|ntl market|n\.t\.l",
    "boso": r"\bboso\b", "gavranovic": r"gavranovi", "ribola": r"ribola", "ktc": r"\bktc\b",
    "eurospin": r"eurospin", "stridon": r"stridon", "djelo_vodice": r"\bdjelo\b", "stanic": r"stani[cć]",
    "trgovina-krk": r"trgovina krk", "metro": r"\bmetro\b", "vrutak": r"vrutak", "roto": r"\broto\b",
    "dukat": r"dukat", "trgocentar": r"trgocentar", "bure": r"\bbure\b", "zabac": r"[zž]aba[cć]",
    "branka": r"branka", "jadranka_trgovina": r"jadranka", "dm": r"^dm\b|dm-drogerie", "lorenco": r"lorenco",
}


def fold(s):
    s = unicodedata.normalize("NFKD", (s or "").lower().replace("đ", "d"))
    return "".join(c for c in s if not unicodedata.combining(c))


STOP = {"ulica", "ul", "trg", "cesta", "put", "obala", "avenija", "bb", "i", "ii", "iii", "sv", "svetog", "svete",
        "kralja", "kneza", "bana", "dr", "hrvatskih", "hrvatske", "bb.", "odvojak", "novo", "naselje", "kbr"}


def street_tokens(addr):
    a = fold(addr)
    a = re.sub(r"\d+[a-z]?(/\w+)?", " ", a)
    toks = [t for t in re.split(r"[^a-z]+", a) if len(t) >= 3 and t not in STOP]
    return toks


def tok_match(a, b):
    """Poklapanje ulica: bar jedna značajna riječ zajednička (prefiks ≥5 znakova za padeže/kratice)."""
    for x in a:
        for y in b:
            if x == y or (len(x) >= 5 and len(y) >= 5 and (x[:5] == y[:5])):
                return True
            if (x.startswith(y) or y.startswith(x)) and min(len(x), len(y)) >= 4:
                return True
    return False


def km(a, b):
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def center(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        return (c[1], c[0])
    pts = c[0] if t == "Polygon" else c[0][0]
    return (sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts))


def load_seq(p):
    for line in open(p, encoding="utf-8"):
        line = line.strip("\x1e\n ")
        if line:
            yield json.loads(line)


def key(address, city):
    n = lambda s: " ".join((s or "").split()).lower()
    return f"{n(address)}|{n(city)}"


def clean_city(c):
    c = re.sub(r"\s*\(.*?\)|,.*$", "", c or "")
    c = re.sub(r"^\d{5}\s+", "", c)
    return " ".join(c.split())


def main():
    shops = []
    for f in load_seq(os.path.join(G, "osm/shops.geojsonseq")):
        p = f["properties"]
        label = fold(" ".join(p.get(k, "") for k in ("brand", "name", "operator")))
        shops.append({
            "pt": center(f["geometry"]), "label": label,
            "street": street_tokens(p.get("addr:street", "") + " " + p.get("addr:place", "")),
            "city": fold(p.get("addr:city", "")),
        })
    places = defaultdict(list)  # ime naselja -> [(lat, lon, rang)]
    rank = {"city": 5, "town": 4, "village": 3, "suburb": 3, "quarter": 2, "neighbourhood": 1, "hamlet": 1}
    for f in load_seq(os.path.join(G, "osm/places.geojsonseq")):
        p = f["properties"]
        for nk in ("name", "name:hr", "alt_name", "official_name"):
            if p.get(nk):
                places[fold(p[nk])].append((*center(f["geometry"]), rank.get(p.get("place"), 0)))

    stores = {}
    for zp in sorted(glob.glob(os.path.join(ROOT, "data/cache/*.zip")), reverse=True):
        with zipfile.ZipFile(zp) as z:
            for n in z.namelist():
                if n.endswith("/stores.csv"):
                    ch = n.split("/")[0]
                    for r in csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig")):
                        stores.setdefault(key(r.get("address"), r.get("city")), (ch, r.get("address") or "", r.get("city") or ""))

    cache_p = os.path.join(G, "stores.json")
    old = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    out, stats = {}, defaultdict(int)
    brand_shops = {ch: [s for s in shops if re.search(rx, s["label"])] for ch, rx in BRANDS.items()}

    for k, (ch, addr, city) in stores.items():
        if old.get(k) and old[k][2] == "addr":  # Nominatim (geocode_stores.py --refine)
            out[k] = old[k]; stats["addr (nominatim)"] += 1; continue
        cc = fold(clean_city(city))
        cands = sorted(places.get(cc, []), key=lambda x: -x[2])
        # "Zagreb-Dubrava" / "Zagreb - Novi Zagreb" -> Zagreb
        if not cands and re.search(r"[-/]", cc):
            for part in re.split(r"\s*[-/]\s*", cc):
                if places.get(part):
                    cands = sorted(places[part], key=lambda x: -x[2]); break
        st = street_tokens(addr)
        bs = brand_shops.get(ch, [])
        best = None
        # svaka kandidatska lokacija naselja; za istoimena naselja uzmi ono gdje lanac ima poslovnicu na toj ulici
        for (la, lo, _r) in (cands or [(None, None, 0)]):
            near = [s for s in bs if (la is None and s["city"] == cc) or (la is not None and km((la, lo), s["pt"]) < (12 if _r >= 4 else 5))]
            hit = [s for s in near if st and tok_match(st, s["street"])]
            if hit:
                best = (hit[0]["pt"], "osm"); break
        if not best and cands:
            la, lo, _r = cands[0]
            near = [s for s in bs if km((la, lo), s["pt"]) < (12 if _r >= 4 else 4)]
            same_city = [s for s in near if not s["city"] or s["city"] == cc]
            if len(same_city) == 1 and _r < 5:
                best = (same_city[0]["pt"], "osm1")
            else:
                any_street = [s for s in shops if st and km((la, lo), s["pt"]) < 6 and tok_match(st, s["street"])]
                # središte grada/gradića je preneprecizno za radijus od par km -> "town" (ingest ne upisuje koordinate)
                best = (any_street[0]["pt"], "street") if any_street else ((la, lo), "town" if _r >= 4 else "city")
        if best:
            out[k] = [round(best[0][0], 6), round(best[0][1], 6), best[1]]
        else:
            out[k] = old.get(k)
        stats[best[1] if best else ("staro" if old.get(k) else "none")] += 1

    json.dump(out, open(cache_p, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    print(f"{len(stores)} adresa:", dict(stats))
    if "-v" in sys.argv:
        for k, v in out.items():
            if not v or v[2] == "city":
                print("  ", v and v[2], k, stores[k][0])


if __name__ == "__main__":
    main()
