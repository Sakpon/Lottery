#!/usr/bin/env node
/**
 * นำเข้าข้อมูลผลสลากย้อนหลัง 20 ปีจาก JSON file → D1
 *
 * ใช้งาน:
 *   node scripts/import-historical.mjs <path/to/draws.json> [--replace] [--dry]
 *
 * JSON format (array):
 *   [
 *     {
 *       "drawDate":  "2006-01-16",          // required, ISO
 *       "drawDateTh":"16 มกราคม 2549",      // required
 *       "sourceUrl": "https://…",           // optional
 *       "first":     "123456",              // 6 หลัก (optional)
 *       "firstNear": ["123455", "123457"],  // เลข 6 หลัก 2 ตัว (optional)
 *       "frontThree":["123", "456"],        // เลข 3 หลัก 2 ตัว (optional)
 *       "lastThree": ["789", "012"],        // เลข 3 หลัก 2 ตัว (optional)
 *       "lastTwo":   "34"                   // 2 หลัก (optional)
 *     },
 *     …
 *   ]
 *
 * ลักษณะการทำงาน:
 * - ใช้ INSERT OR IGNORE เสมอ → งวดที่มีใน D1 แล้วจะไม่ถูกเขียนทับ (ยกเว้นระบุ --replace)
 * - Generate SQL เป็น batch ไม่เกิน BATCH_SIZE งวดต่อไฟล์ แล้ว execute ทีละไฟล์ผ่าน
 *   `wrangler d1 execute lottery_th --remote --file=...`
 * - source='imported' สำหรับแยกจากข้อมูล sanook
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const BATCH_SIZE = 50;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const dry = args.includes("--dry");
const jsonPath = args.find((a) => !a.startsWith("--"));
if (!jsonPath) die("usage: import-historical.mjs <draws.json> [--replace] [--dry]");

const raw = readFileSync(jsonPath, "utf8");
let draws;
try { draws = JSON.parse(raw); } catch (e) { die(`invalid JSON: ${e.message}`); }
if (!Array.isArray(draws)) die("expected top-level JSON array");

console.log(`loaded ${draws.length} draws from ${jsonPath}`);
if (replace) console.log("mode: --replace (DELETE numbers for matching draws before insert)");
if (dry) console.log("mode: --dry (generate SQL but do not execute)");

// ─── Validate + stage SQL ────────────────────────────────────────────────
function q(v) {
  if (v == null) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlForDraw(d) {
  const { drawDate, drawDateTh, sourceUrl, first, firstNear, frontThree, lastThree, lastTwo } = d;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drawDate ?? "")) {
    throw new Error(`invalid drawDate: ${JSON.stringify(drawDate)}`);
  }
  if (!drawDateTh) throw new Error(`${drawDate}: missing drawDateTh`);

  const stmts = [];
  stmts.push(
    `INSERT OR IGNORE INTO draws (draw_date, draw_date_th, source, source_url) VALUES (${q(drawDate)}, ${q(drawDateTh)}, 'imported', ${q(sourceUrl ?? null)});`,
  );

  if (replace) {
    stmts.push(
      `DELETE FROM numbers WHERE draw_id = (SELECT id FROM draws WHERE draw_date = ${q(drawDate)});`,
    );
  }

  const push = (prizeType, number, position) => {
    if (number == null || number === "") return;
    stmts.push(
      `INSERT OR IGNORE INTO numbers (draw_id, prize_type, number, position) SELECT id, ${q(prizeType)}, ${q(String(number))}, ${position} FROM draws WHERE draw_date = ${q(drawDate)};`,
    );
  };

  if (first) push("first", first, 0);
  (firstNear ?? []).forEach((n, i) => push("first_near", n, i));
  (frontThree ?? []).forEach((n, i) => push("front_three", n, i));
  (lastThree ?? []).forEach((n, i) => push("last_three", n, i));
  if (lastTwo) push("last_two", lastTwo, 0);

  return stmts.join("\n");
}

const tmpDir = resolve(ROOT, ".wrangler/import-tmp");
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const batches = [];
for (let i = 0; i < draws.length; i += BATCH_SIZE) {
  const slice = draws.slice(i, i + BATCH_SIZE);
  const sql = slice.map((d, j) => {
    try { return sqlForDraw(d); }
    catch (e) { die(`draw ${i + j}: ${e.message}`); }
  }).join("\n\n");
  const file = resolve(tmpDir, `batch-${String(i / BATCH_SIZE).padStart(3, "0")}.sql`);
  writeFileSync(file, sql);
  batches.push({ file, count: slice.length });
}

console.log(`generated ${batches.length} batches in ${tmpDir}`);

if (dry) {
  console.log(`first batch preview (${batches[0]?.file}):`);
  console.log(readFileSync(batches[0].file, "utf8").split("\n").slice(0, 20).join("\n"));
  console.log("…");
  process.exit(0);
}

// ─── Execute batches through wrangler ────────────────────────────────────
let ok = 0;
for (const { file, count } of batches) {
  const res = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "lottery_th", "--remote", "--file", file],
    { stdio: "inherit", cwd: ROOT },
  );
  if (res.status !== 0) die(`batch failed on ${file} (${count} draws)`);
  ok += count;
  console.log(`✓ imported ${ok}/${draws.length} draws`);
}

// ─── Clear prediction cache so UI recomputes with fresh data ─────────────
spawnSync(
  "npx",
  [
    "wrangler", "d1", "execute", "lottery_th", "--remote",
    "--command", "DELETE FROM stats_cache;",
  ],
  { stdio: "inherit", cwd: ROOT },
);

console.log(`\ndone: ${ok} draws imported`);
