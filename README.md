# PametnaKupnja 🛒

Složi košaricu namirnica **iz kataloga** (ili iz recepta s [Coolinarike](https://www.coolinarika.com)) i saznaj
u kojoj je hrvatskoj trgovini **cijela kupnja najjeftinija** — trgovine su sortirane po ukupnoj cijeni košarice,
uz prijedlog kupnje u dvije trgovine i „svaka namirnica tamo gdje je najjeftinija“.

## Arhitektura

```
web/      Next.js 16 (static export)  ─┐
api/      Rust Cloudflare Worker (wasm) ├─► jedan Worker: /api/* = Rust, ostalo = statički frontend
db/       D1 (SQLite) shema             ─┘
ingest/   Rust CLI: cijene (api.cijene.dev) + recepti (coolinarika.com) → SQL za D1
catalog/  namirnice.toml — katalog ~120 namirnica s pravilima prepoznavanja proizvoda
```

**Cijene** dolaze iz dnevnih arhiva [cijene.dev](https://cijene.dev) (javno objavljeni cjenici trgovaca prema
Odluci o objavi cjenika, NN 75/2025) — ~27 lanaca, ~1850 poslovnica. Za svaku namirnicu iz kataloga i svaki lanac
ingest pronalazi najjeftinije odgovarajuće proizvode (medijan cijene po poslovnicama, uz odbacivanje lokalnih
rasprodaja i očitih outliera) i računa trošak za ciljnu količinu (broj pakiranja × cijena).

**Recepti**: ingest čita sitemap Coolinarike i JSON-LD `Recipe`, poštuje `robots.txt` (Crawl-delay 15 s) i sprema
**samo naziv, sliku, popis sastojaka i poveznicu** — postupak pripreme ostaje na izvornoj stranici. Svaki redak
sastojka mapira se na stavku kataloga (najduže podudaranje pravila `recipe`).

## API

| | |
|---|---|
| `GET /api/items` | katalog namirnica |
| `GET /api/meta` | lanci, datum cijena, broj recepata |
| `GET /api/recipes?q=&offset=&item=` | pretraga recepata |
| `GET /api/recipes/:slug` | recept + sastojci mapirani na katalog |
| `GET /api/stores?lat=&lon=&radius=5` | poslovnice u krugu (km), sortirane po udaljenosti |
| `POST /api/basket` | `{"items":[{"id":1,"qty":2}],"chains":[],"lat":45.81,"lon":15.98,"radius_km":5}` → lanci s poslovnicom u krugu, sortirani po ukupnoj cijeni, + najbliža poslovnica; najbolji par, cherry-pick |

## Lokacija

Aplikacija (uz dopuštenje) prati lokaciju uređaja (`watchPosition`, zaokruženo na ~100 m, osvježava se tek nakon
pomaka > 300 m) i u izračun uzima samo lance koji imaju poslovnicu unutar odabranog radijusa (zadano 5 km).
Lokacija se ne sprema na serveru — šalje se samo uz upit košarice.

Koordinate poslovnica (cjenici sadrže samo adresu):
1. `scripts/locate_stores.py` — spaja poslovnice s trgovinama istog lanca u OpenStreetMapu
   ([Geofabrik](https://download.geofabrik.de/europe/croatia.html) izvoz, `osmium`), po mjestu i ulici;
2. `scripts/geocode_stores.py --refine` — ostatak preko Nominatima (1 zahtjev/s);
3. rezultat `data/geo/stores.json` je u repou; `pk-ingest prices` ga upisuje u `stores.lat/lon/geo`.

```bash
cd data/geo/osm && curl -LO https://download.geofabrik.de/europe/croatia-latest.osm.pbf
osmium tags-filter croatia-latest.osm.pbf nwr/shop=supermarket,convenience,discount,department_store,wholesale,general,hypermarket,chemist -o shops.pbf
osmium export shops.pbf -f geojsonseq -o shops.geojsonseq
osmium tags-filter croatia-latest.osm.pbf n/place=city,town,village,suburb,quarter,neighbourhood,hamlet -o places.pbf
osmium export places.pbf -f geojsonseq -o places.geojsonseq
cd ../../.. && python3 scripts/locate_stores.py && python3 scripts/geocode_stores.py --refine
```

## PWA

`web/public/manifest.webmanifest` + `web/public/sw.js`: aplikacija se može instalirati na početni zaslon (Android:
gumb „Instaliraj aplikaciju“, iOS: Dijeli → Dodaj na početni zaslon) i radi offline — katalog, recepti i slike iz
cachea, zadnji izračun košarice iz `localStorage`. Verzija service workera se mijenja pri svakom buildu.

## Zašto baza (D1), a ne statični JSON?

- **Količina**: ~7–8 tisuća agregiranih ponuda × 27 lanaca + ~1900 poslovnica s koordinatama + recepti sa sastojcima
  — sve to slati svakom mobitelu pri svakom otvaranju (i nakon svakog dnevnog osvježenja) bilo bi nekoliko MB.
  Upit košarice vrati samo ono što treba (desetak KB).
- **Upiti ovise o korisniku**: košarica × lokacija × radijus × odabrani lanci — to je JOIN/filtar koji SQLite radi
  u milisekundama, uz indekse po namirnici i koordinatama.
- **Dnevno osvježavanje**: cijene se mijenjaju svaki dan; u bazu ih CI upiše jednim `d1 execute`, bez novog deploya
  aplikacije i bez da korisnici skidaju novi paket podataka.
- **Rast**: povijest cijena, upozorenja na sniženja, više recepata — sve to ide u istu bazu bez promjene arhitekture.
- **Offline** nije izgubljen: PWA čuva katalog, recepte i zadnji izračun na uređaju.

D1 je u besplatnom planu (5 GB, 5 M čitanja/dan) — za ovaj projekt praktički besplatno.

## Lokalno

```bash
# 1) podaci
cd ingest && cargo build --release && cd ..
./ingest/target/release/pk-ingest prices --report > data/report.txt
./ingest/target/release/pk-ingest recipes-scrape --max-new 50     # sporo: 15 s/recept
./ingest/target/release/pk-ingest recipes-sql

# 2) frontend
cd web && npm ci && npm run build && cd ..

# 3) worker + lokalni D1
cd api
for f in ../db/schema.sql ../data/prices.sql ../data/recipes.sql; do npx wrangler d1 execute pametnakupnja --local --yes --file $f; done
npx wrangler dev        # http://localhost:8787
```

Alati: `pk-ingest match "2 dl slatkog vrhnja"` (test prepoznavanja), `pk-ingest unmatched` (najčešći neprepoznati
sastojci — za proširenje kataloga).

## Deploy (Cloudflare)

```bash
npx wrangler d1 create pametnakupnja      # upiši database_id u api/wrangler.toml
for f in db/schema.sql data/prices.sql data/recipes.sql; do npx wrangler d1 execute pametnakupnja --remote --yes --file $f; done
cd web && npm run build && cd ../api && npx wrangler deploy
```

GitHub Actions (`.github/workflows/`) svaki dan osvježava cijene, nedjeljom dohvaća nove recepte (cache u
`data/recipes/`, commita se natrag u repo) i deploya na push u `main`. Potrebni secreti: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + D1:Edit) i `CLOUDFLARE_ACCOUNT_ID`.

## Napomene

Cijene su informativne i mogu odstupati od cijene na polici. Recepti © Podravka d.d. / autori na Coolinarici.
