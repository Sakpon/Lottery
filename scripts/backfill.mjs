#!/usr/bin/env node
/**
 * Local backfill helper — เรียก scraper worker endpoint /backfill
 * usage: node scripts/backfill.mjs [years]
 */
const years = Number(process.argv[2] ?? 20);
const workerUrl = process.env.SCRAPER_URL;
const token = process.env.ADMIN_TOKEN;

if (!workerUrl || !token) {
  console.error("set SCRAPER_URL and ADMIN_TOKEN env vars");
  process.exit(1);
}

const url = `${workerUrl.replace(/\/$/, "")}/backfill?years=${years}`;
console.log(`POST ${url}`);

const res = await fetch(url, {
  method: "POST",
  headers: { "X-Admin-Token": token },
});
const body = await res.text();
console.log(`status: ${res.status}`);
console.log(body);
process.exit(res.ok ? 0 : 1);
