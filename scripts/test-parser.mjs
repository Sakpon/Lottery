// Smoke test สำหรับ parser ของ scraper — รันด้วย Node ผ่าน ts ผ่าน --experimental-strip-types
// (Node 22+ รองรับ) หรือ `node --experimental-strip-types scripts/test-parser.mjs`
//
// ครอบคลุมเคสที่เคยทำให้ first prize หายไปบน sanook:
//   1. HTML แบบ "canonical": <div class="lotto__number lotto--black">XXXXXX</div>
//   2. เลขแยก span ทีละหลัก
//   3. มี "รางวัลที่ 1" ปรากฏในเมนูหรือ "ข้างเคียงรางวัลที่ 1" ก่อนจริง
//   4. Two distinct 3-digit numbers คั่นด้วย space (front_three / last_three) ไม่ถูกรวมเป็น 6 หลัก

import { parseSanookDrawPage } from "../workers/scraper/src/parser.ts";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  — ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL — ${msg}`);
  }
}

function prizeMap(parsed) {
  const m = {};
  if (!parsed) return m;
  for (const n of parsed.numbers) {
    m[n.prizeType] ??= [];
    m[n.prizeType][n.position] = n.number;
  }
  return m;
}

// ─── Case 1: canonical sanook markup ──────────────────────────────────────
console.log("case 1: canonical markup");
{
  const html = `<!doctype html><html><body>
    <h1>งวดวันที่ 16 เมษายน 2569</h1>
    <div class="lotto__number lotto--black">355868</div>
    <section>รางวัลข้างเคียงรางวัลที่ 1
      <div class="lotto__number">123456</div>
      <div class="lotto__number">789012</div>
    </section>
    <section>เลขหน้า 3 ตัว
      <div class="lotto__number">000</div>
      <div class="lotto__number">355</div>
    </section>
    <section>เลขท้าย 3 ตัว
      <div class="lotto__number">000</div>
      <div class="lotto__number">868</div>
    </section>
    <section>เลขท้าย 2 ตัว
      <div class="lotto__number">77</div>
    </section>
  </body></html>`;
  const p = parseSanookDrawPage(html, "https://x/");
  const m = prizeMap(p);
  assert(p?.drawDate === "2026-04-16", `drawDate parsed correctly (got ${p?.drawDate})`);
  assert(m.first?.[0] === "355868", `first prize = 355868 (got ${m.first?.[0]})`);
  assert(
    m.front_three?.[0] === "000" && m.front_three?.[1] === "355",
    `front_three = [000, 355] (got ${JSON.stringify(m.front_three)})`,
  );
  assert(
    m.last_three?.[0] === "000" && m.last_three?.[1] === "868",
    `last_three = [000, 868] (got ${JSON.stringify(m.last_three)})`,
  );
  assert(m.last_two?.[0] === "77", `last_two = 77 (got ${m.last_two?.[0]})`);
}

// ─── Case 2: first prize digits split into individual spans ───────────────
console.log("case 2: digit-per-span layout");
{
  const html = `<html><body>
    <h1>งวดวันที่ 16 เมษายน 2569</h1>
    <div class="lotto__number lotto--black">
      <span>3</span><span>5</span><span>5</span><span>8</span><span>6</span><span>8</span>
    </div>
    <p>รางวัลข้างเคียงรางวัลที่ 1</p>
    <p>เลขหน้า 3 ตัว</p><p>000</p><p>355</p>
    <p>เลขท้าย 3 ตัว</p><p>000</p><p>868</p>
    <p>เลขท้าย 2 ตัว</p><p>77</p>
  </body></html>`;
  const p = parseSanookDrawPage(html, "https://x/");
  const m = prizeMap(p);
  assert(m.first?.[0] === "355868", `first prize = 355868 (got ${m.first?.[0]})`);
}

// ─── Case 3: navigation/menu mentions "รางวัลที่ 1" with other 6-digit noise ─
//     เดิมกลยุทธ์ positional จะจับ 6 หลักผิดจากเมนู/breadcrumb
console.log("case 3: menu noise before the real first prize");
{
  const html = `<html><body>
    <header>
      <h1>งวดวันที่ 16 เมษายน 2569</h1>
      <nav>ดูย้อนหลัง งวด 123456 789012</nav>
    </header>
    <main>
      <h2>รางวัลที่ 1</h2>
      <div class="lotto__number lotto--black">355868</div>
      <h2>รางวัลข้างเคียงรางวัลที่ 1</h2>
      <div class="lotto__number">111111</div>
      <div class="lotto__number">222222</div>
      <h2>เลขหน้า 3 ตัว</h2><p>000</p><p>355</p>
      <h2>เลขท้าย 3 ตัว</h2><p>000</p><p>868</p>
      <h2>เลขท้าย 2 ตัว</h2><p>77</p>
    </main>
  </body></html>`;
  const p = parseSanookDrawPage(html, "https://x/");
  const m = prizeMap(p);
  assert(m.first?.[0] === "355868", `first prize = 355868 despite menu noise (got ${m.first?.[0]})`);
}

// ─── Case 4: no `lotto--black` class (hypothetical redesign) ──────────────
//     ควร fallback ไป label-proximity แล้วได้ 355868
console.log("case 4: redesigned markup without lotto--black class");
{
  const html = `<html><body>
    <h1>งวดวันที่ 16 เมษายน 2569</h1>
    <section>
      <h2>รางวัลที่ 1</h2>
      <p class="result-number">355868</p>
    </section>
    <section>
      <h2>รางวัลข้างเคียงรางวัลที่ 1</h2>
      <p>111111</p><p>222222</p>
    </section>
    <section>
      <h2>เลขหน้า 3 ตัว</h2><p>000</p><p>355</p>
      <h2>เลขท้าย 3 ตัว</h2><p>000</p><p>868</p>
      <h2>เลขท้าย 2 ตัว</h2><p>77</p>
    </section>
  </body></html>`;
  const p = parseSanookDrawPage(html, "https://x/");
  const m = prizeMap(p);
  assert(m.first?.[0] === "355868", `first prize via label fallback (got ${m.first?.[0]})`);
}

// ─── Case 5: front_three "000 355" must not be glued into "000355" ─────────
//     Regression test for the normalizeHtml tightening
console.log("case 5: adjacent 3-digit numbers stay separate");
{
  const html = `<html><body>
    <h1>งวดวันที่ 16 เมษายน 2569</h1>
    <div class="lotto__number lotto--black">355868</div>
    <p>รางวัลข้างเคียงรางวัลที่ 1</p><p>111111</p><p>222222</p>
    <p>เลขหน้า 3 ตัว</p> 000 355
    <p>เลขท้าย 3 ตัว</p> 000 868
    <p>เลขท้าย 2 ตัว</p> 77
  </body></html>`;
  const p = parseSanookDrawPage(html, "https://x/");
  const m = prizeMap(p);
  assert(
    m.front_three?.[0] === "000" && m.front_three?.[1] === "355",
    `front_three = [000, 355] not glued (got ${JSON.stringify(m.front_three)})`,
  );
  assert(
    m.last_three?.[0] === "000" && m.last_three?.[1] === "868",
    `last_three = [000, 868] not glued (got ${JSON.stringify(m.last_three)})`,
  );
}

// ─── Case 6: prize-amount commas must not leak as phantom 000 digits ───────
//     Real sanook rendering — "รางวัลละ 4,000 บาท" appears in each section.
//     Without comma-stripping, the 3-digit extractor picks "000" from "4,000"
//     as position-0 for both front_three and last_three.
console.log("case 6: prize-amount commas don't leak as 000");
{
  const html = `<html><body>
    <h1>งวดวันที่ 16 เมษายน 2569</h1>
    <div class="lotto__number lotto--black">309612</div>
    <section>รางวัลข้างเคียงรางวัลที่ 1 รางวัลละ 100,000 บาท
      <div>309611</div><div>309613</div>
    </section>
    <section>เลขหน้า 3 ตัว รางวัลละ 4,000 บาท
      <div>123</div><div>355</div>
    </section>
    <section>เลขท้าย 3 ตัว รางวัลละ 4,000 บาท
      <div>456</div><div>868</div>
    </section>
    <section>เลขท้าย 2 ตัว รางวัลละ 2,000 บาท
      <div>77</div>
    </section>
  </body></html>`;
  const p = parseSanookDrawPage(html, "https://x/");
  const m = prizeMap(p);
  assert(m.first?.[0] === "309612", `first = 309612 (got ${m.first?.[0]})`);
  assert(
    m.front_three?.[0] === "123" && m.front_three?.[1] === "355",
    `front_three = [123, 355], no 000 phantom (got ${JSON.stringify(m.front_three)})`,
  );
  assert(
    m.last_three?.[0] === "456" && m.last_three?.[1] === "868",
    `last_three = [456, 868], no 000 phantom (got ${JSON.stringify(m.last_three)})`,
  );
  assert(m.last_two?.[0] === "77", `last_two = 77 (got ${m.last_two?.[0]})`);
  assert(
    m.first_near?.[0] === "309611" && m.first_near?.[1] === "309613",
    `first_near = [309611, 309613], no phantom from "100,000" (got ${JSON.stringify(m.first_near)})`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
