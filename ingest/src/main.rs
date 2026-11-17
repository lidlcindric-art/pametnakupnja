mod catalog;
mod norm;
mod prices;
mod recipes;
mod sql;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "pk-ingest", about = "PametnaKupnja – uvoz podataka u D1")]
struct Cli {
    #[arg(long, default_value = "catalog/namirnice.toml", global = true)]
    catalog: String,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Preuzmi najnovije cijene (api.cijene.dev) i generiraj SQL
    Prices {
        #[arg(long, default_value = "data/cache")]
        cache: String,
        #[arg(long, default_value = "data/prices.sql")]
        out: String,
        /// Ispiši izvještaj podudaranja po stavkama kataloga
        #[arg(long)]
        report: bool,
    },
    /// Preuzmi nove recepte s coolinarika.com (poštuje Crawl-delay 15 s)
    RecipesScrape {
        #[arg(long, default_value = "data/recipes")]
        cache: String,
        #[arg(long, default_value_t = 50)]
        max_new: usize,
        #[arg(long, default_value_t = 15)]
        delay: u64,
        /// Koliko mjesečnih sitemapova (najnoviji prvi) pregledati
        #[arg(long, default_value_t = 24)]
        months: usize,
    },
    /// Generiraj SQL za recepte iz lokalnog cachea
    RecipesSql {
        #[arg(long, default_value = "data/recipes")]
        cache: String,
        #[arg(long, default_value = "data/recipes.sql")]
        out: String,
    },
    /// Najčešći neprepoznati sastojci
    Unmatched {
        #[arg(long, default_value = "data/recipes")]
        cache: String,
        #[arg(long, default_value_t = 60)]
        top: usize,
    },
    /// Testiraj podudaranje retka sastojka
    Match { line: Vec<String> },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Prices { cache, out, report } => prices::run(&cli.catalog, &cache, &out, report),
        Cmd::RecipesScrape { cache, max_new, delay, months } => recipes::scrape(&cache, max_new, delay, months),
        Cmd::RecipesSql { cache, out } => recipes::to_sql(&cli.catalog, &cache, &out),
        Cmd::Unmatched { cache, top } => recipes::unmatched(&cli.catalog, &cache, top),
        Cmd::Match { line } => {
            let cat = catalog::Catalog::load(&cli.catalog)?;
            let l = line.join(" ");
            match cat.match_ingredient(&l) {
                Some(it) => println!("{l}  →  {} ({})", it.name, it.slug),
                None => println!("{l}  →  (nije u katalogu)"),
            }
            Ok(())
        }
    }
}
