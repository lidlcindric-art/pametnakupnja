//! Generiranje SQL datoteke za `wrangler d1 execute --file`.

use anyhow::Result;
use std::io::{BufWriter, Write};

pub fn q(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''").replace('\0', ""))
}

pub struct SqlWriter {
    w: BufWriter<std::fs::File>,
}

/// D1 ograničava veličinu pojedine naredbe (~100 KB) — pišemo u manjim serijama.
const BATCH_BYTES: usize = 60_000;

impl SqlWriter {
    pub fn create(path: &str) -> Result<Self> {
        if let Some(p) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(p)?;
        }
        Ok(Self { w: BufWriter::new(std::fs::File::create(path)?) })
    }

    pub fn raw(&mut self, s: &str) -> Result<()> {
        writeln!(self.w, "{s}")?;
        Ok(())
    }

    pub fn insert<I>(&mut self, table: &str, cols: &[&str], rows: I) -> Result<()>
    where
        I: Iterator<Item = Vec<String>>,
    {
        let head = format!("INSERT INTO {table} ({}) VALUES\n", cols.join(", "));
        let mut buf = String::new();
        for r in rows {
            let row = format!("({})", r.join(", "));
            if !buf.is_empty() && buf.len() + row.len() > BATCH_BYTES {
                writeln!(self.w, "{head}{buf};")?;
                buf.clear();
            }
            if !buf.is_empty() {
                buf.push_str(",\n");
            }
            buf.push_str(&row);
        }
        if !buf.is_empty() {
            writeln!(self.w, "{head}{buf};")?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<()> {
        self.w.flush()?;
        Ok(())
    }
}
