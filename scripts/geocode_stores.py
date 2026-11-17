#!/usr/bin/env python3
"""(Drugi korak, nakon scripts/locate_stores.py: `--refine`.)
Geokodira poslovnice iz arhiva cijene.dev (data/cache/*.zip) preko OSM Nominatima.

Rezultat je trajni cache data/geo/stores.json (commita se u repo), ključ:
"<adresa>|<grad>" (mala slova, sažeti razmaci) -> [lat, lon, preciznost]
preciznost: "addr" (ulica i broj), "street" (ulica), "city" (samo središte mjesta).

Poštuje Nominatim usage policy: 1 zahtjev/s, identificirajući User-Agent, cache.
"""
import csv, io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data/geo/stores.json")
UA = "PametnaKupnja/0.1 (+https://github.com/lidlcindric-art/pametnakupnja; lidlcindric@gmail.com)"
HR_BBOX = "13.2,46.6,19.5,42.3"  # viewbox lon1,lat1,lon2,lat2


def key(address, city):
    norm = lambda s: " ".join((s or "").split()).lower()
    return f"{norm(address)}|{norm(city)}"


def stores():
    seen = {}
    for zp in sorted(glob.glob(os.path.join(ROOT, "data/cache/*.zip")), reverse=True):
        with zipfile.ZipFile(zp) as z:
            for n in z.namelist():
                if not n.endswith("/stores.csv"):
                    continue
                for r in csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig")):
                    k = key(r.get("address"), r.get("city"))
                    if k != "|":
                        seen.setdefault(k, (r.get("address") or "", r.get("city") or "", r.get("zipcode") or ""))
    return seen


last = [0.0]


def nominatim(params):
    wait = 1.1 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    params = {**params, "format": "jsonv2", "limit": 1, "countrycodes": "hr", "viewbox": HR_BBOX}
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            last[0] = time.time()
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                d = json.load(r)
                return (float(d[0]["lat"]), float(d[0]["lon"])) if d else None
        except Exception as e:  # noqa
            print("  ! ", e, file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return None


def clean_addr(a):
    a = re.sub(r"\b(bb|b\.b\.|bez broja)\b", "", a, flags=re.I)
    a = re.sub(r"\b(ul\.|ulica)\s*", "", a, flags=re.I)
    a = re.sub(r"\s*[,(].*$", "", a)  # "Ilica 1, TC Xyz" -> "Ilica 1"
    return " ".join(a.split())


def geocode(address, city, zipcode):
    city_c = re.sub(r"\s*\(.*\)|,.*$", "", city).strip()
    a = clean_addr(address)
    if a:
        p = nominatim({"street": a, "city": city_c, **({"postalcode": zipcode} if zipcode else {})})
        if p:
            return [*p, "addr"]
        p = nominatim({"q": f"{a}, {city_c}"})
        if p:
            return [*p, "addr"]
        street = re.sub(r"\s+\d+\w?(/\w+)?$", "", a)
        if street != a:
            p = nominatim({"street": street, "city": city_c})
            if p:
                return [*p, "street"]
    p = nominatim({"city": city_c}) if city_c else None
    return [*p, "city"] if p else None


def _km(a, b):
    import math
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def refine(address, city, zipcode, prev=None):
    """Samo precizni pokušaji (adresa) — za unose koje locate_stores.py nije smjestio bolje od središta mjesta."""
    city_c = re.sub(r"\s*\(.*\)|,.*$", "", city).strip()
    a = clean_addr(address) if city_c else address.replace(" null", "")
    if not a:
        return None
    p = nominatim({"street": a, "city": city_c}) if city_c else None
    if not p:
        p = nominatim({"q": f"{a}, {city_c}" if city_c else a})
    if p and prev and _km(p, prev[:2]) > 15:  # istoimena ulica u krivom mjestu
        return None
    return [*p, "addr"] if p else None


def main():
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    if "--refine" in sys.argv:
        # nakon locate_stores.py: pokušaj preciznu adresu za sve što je ostalo na "city" ili bez koordinata
        todo = [(k, v) for k, v in stores().items() if not cache.get(k) or cache[k][2] in ("city", "town")]
        print(f"refine: {len(todo)} adresa", flush=True)
        for i, (k, (a, c, z)) in enumerate(todo, 1):
            r = refine(a, c, z, cache.get(k))
            if r:
                cache[k] = r
            print(f"[{i}/{len(todo)}] {a}, {c} -> {r or 'ostaje ' + str(cache.get(k))}", flush=True)
            if i % 25 == 0:
                json.dump(cache, open(CACHE, "w"), ensure_ascii=False, indent=0, sort_keys=True)
        json.dump(cache, open(CACHE, "w"), ensure_ascii=False, indent=0, sort_keys=True)
        return
    todo = [(k, v) for k, v in stores().items() if k not in cache]
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(todo)
    print(f"poslovnica (jedinstvenih adresa): {len(cache) + len(todo)}, u cacheu {len(cache)}, za geokodiranje {min(limit, len(todo))}")
    for i, (k, (a, c, z)) in enumerate(todo[:limit], 1):
        cache[k] = geocode(a, c, z)
        print(f"[{i}/{min(limit, len(todo))}] {a}, {c} -> {cache[k]}", flush=True)
        if i % 25 == 0:
            json.dump(cache, open(CACHE, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    json.dump(cache, open(CACHE, "w"), ensure_ascii=False, indent=0, sort_keys=True)
    prec = {}
    for v in cache.values():
        prec[v[2] if v else "none"] = prec.get(v[2] if v else "none", 0) + 1
    print("preciznost:", prec)


if __name__ == "__main__":
    main()
