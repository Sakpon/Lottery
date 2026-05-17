#!/usr/bin/env node
/**
 * แปลงไฟล์ผลสลาก plain-text ของ vicha-w/thai-lotto-archive ให้อยู่ในรูป JSON
 * ที่ scripts/import-historical.mjs รับได้
 *
 * ใช้งาน:
 *   git clone --depth=1 https://github.com/vicha-w/thai-lotto-archive /tmp/lotto-archive
 *   node scripts/convert-vicha-archive.mjs /tmp/lotto-archive/lottonumbers \
 *        > data/historical/draws.json
 *
 * Format ต้นทาง (สังเกตจากไฟล์ .txt ที่ชื่อเป็นวันที่ ISO):
 *   <source_url>
 *   FIRST <6 หลัก>
 *   (THREE <3 หลัก> <3 หลัก> <3 หลัก> <3 หลัก>)           ก่อน 2016 — เลขท้าย 3 ตัว 4 เลข
 *   หรือ:
 *     THREE_FIRST <3 หลัก> <3 หลัก>                        เลขหน้า 3 ตัว
 *     THREE_LAST  <3 หลัก> <3 หลัก>                        เลขท้าย 3 ตัว
 *   TWO <2 หลัก>
 *   NEAR_FIRST <6 หลัก> <6 หลัก>
 *   (SECOND/THIRD/FOURTH/FIFTH — ไม่ได้ใช้ในระบบนี้ เก็บเพิ่มภายหลังได้)
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: convert-vicha-archive.mjs <path/to/lottonumbers>");
  process.exit(1);
}

const THAI_MONTHS = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function parseFile(text) {
  const lines = text.split("\n").map((l) => l.trim());
  const sourceUrl = lines[0]?.startsWith("http") ? lines[0] : undefined;
  const out = { sourceUrl };

  for (const line of lines) {
    const parts = line.split(/\s+/);
    const k = parts[0];
    const vals = parts.slice(1);
    switch (k) {
      case "FIRST":
        if (vals[0]) out.first = vals[0];
        break;
      case "NEAR_FIRST":
        out.firstNear = vals.filter(Boolean);
        break;
      case "THREE":
        // รูปแบบเก่า (ก่อน 2016): เลขท้าย 3 ตัว 4 เลข, ไม่มีเลขหน้า 3 ตัว
        out.lastThree = vals.filter(Boolean);
        break;
      case "THREE_FIRST":
        out.frontThree = vals.filter(Boolean);
        break;
      case "THREE_LAST":
        out.lastThree = vals.filter(Boolean);
        break;
      case "TWO":
        if (vals[0]) out.lastTwo = vals[0];
        break;
    }
  }
  return out;
}

const files = readdirSync(dir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(f))
  .sort();

const out = [];
for (const f of files) {
  const iso = f.replace(/\.txt$/, "");
  const [y, m, d] = iso.split("-").map(Number);
  const drawDateTh = `${d} ${THAI_MONTHS[m]} ${y + 543}`;
  const parsed = parseFile(readFileSync(resolve(dir, f), "utf8"));
  out.push({
    drawDate: iso,
    drawDateTh,
    sourceUrl: parsed.sourceUrl,
    first: parsed.first,
    firstNear: parsed.firstNear,
    frontThree: parsed.frontThree,
    lastThree: parsed.lastThree,
    lastTwo: parsed.lastTwo,
  });
}

process.stdout.write(JSON.stringify(out, null, 2));
process.stderr.write(`converted ${out.length} draws (${out[0]?.drawDate} → ${out[out.length - 1]?.drawDate})\n`);
