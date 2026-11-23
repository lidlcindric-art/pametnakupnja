-- PametnaKupnja D1 shema

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS items (
  id       INTEGER PRIMARY KEY,
  slug     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  category TEXT NOT NULL,
  unit     TEXT NOT NULL,
  target   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS chains (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  price_date    TEXT NOT NULL,
  stores        INTEGER NOT NULL,
  products      INTEGER NOT NULL,
  items_covered INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  chain    TEXT NOT NULL,
  store_id TEXT NOT NULL,
  type     TEXT,
  address  TEXT,
  city     TEXT,
  zipcode  TEXT,
  lat      REAL,
  lon      REAL,
  geo      TEXT   -- preciznost geokodiranja: addr | street | city
);
CREATE INDEX IF NOT EXISTS stores_city ON stores(city);

-- Do 3 najjeftinije ponude po (stavka, lanac). cost = cijena za pokrivanje ciljne količine.
CREATE TABLE IF NOT EXISTS offers (
  item_id      INTEGER NOT NULL,
  chain        TEXT NOT NULL,
  rank         INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  brand        TEXT,
  ean          TEXT,
  price        REAL NOT NULL,
  packs        INTEGER NOT NULL,
  cost         REAL NOT NULL,
  size         REAL,
  unit_price   REAL,
  stores       INTEGER NOT NULL,
  min_price    REAL,
  max_price    REAL
);
CREATE INDEX IF NOT EXISTS offers_item ON offers(item_id, rank);

CREATE TABLE IF NOT EXISTS recipes (
  slug        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  image       TEXT,
  description TEXT,
  servings    TEXT,
  total_time  TEXT,
  published   TEXT,
  n_items     INTEGER NOT NULL DEFAULT 0,
  search      TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'glavna'  -- juhe | predjela | glavna | deserti
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  recipe_slug TEXT NOT NULL,
  pos         INTEGER NOT NULL,
  line        TEXT NOT NULL,
  item_id     INTEGER,
  is_header   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS recipe_lines_slug ON recipe_lines(recipe_slug, pos);
CREATE INDEX IF NOT EXISTS recipe_lines_item ON recipe_lines(item_id);
CREATE INDEX IF NOT EXISTS recipes_pub ON recipes(published);
