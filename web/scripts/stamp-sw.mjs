// Upisuje jedinstvenu verziju u out/sw.js da korisnici nakon deploya dobiju novu verziju aplikacije.
import { readFileSync, writeFileSync } from "node:fs";
const f = new URL("../out/sw.js", import.meta.url);
const v = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
writeFileSync(f, readFileSync(f, "utf8").replaceAll("__BUILD__", v));
console.log("sw.js verzija", v);
