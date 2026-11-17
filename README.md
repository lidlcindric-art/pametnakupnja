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
| `POST /api/basket` | `{"items":[{"id":1,"qty":2}],"chains":[]}` → lanci sortirani po ukupnoj cijeni, najbolji par, cherry-pick |

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
