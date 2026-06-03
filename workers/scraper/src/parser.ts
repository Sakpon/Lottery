/**
 * Parser สำหรับหน้าผลสลากของ sanook.com
 *
 * โครงสร้าง HTML ของหน้าผลรางวัล (สังเกตจาก /lotto/check/DDMMYYYY/):
 *   - มีหัวข้อระบุวันที่ พ.ศ. ไทย
 *   - รางวัลที่ 1           : <div class="lotto__number lotto--black">XXXXXX</div>
 *   - เลขหน้า 3 ตัว         : หัวข้อ "เลขหน้า 3 ตัว" พร้อมเลข 3 หลัก 2 หมายเลข
 *   - เลขท้าย 3 ตัว         : หัวข้อ "เลขท้าย 3 ตัว" พร้อมเลข 3 หลัก 2 หมายเลข
 *   - เลขท้าย 2 ตัว         : หัวข้อ "เลขท้าย 2 ตัว"
 *   - รางวัลข้างเคียงรางวัลที่ 1 : สองหมายเลข 6 หลัก
 *
 * Strategy: ใช้ HTMLRewriter (มีใน Workers runtime) จับ element + class patterns
 * พร้อม regex เป็น fallback กรณีโครงสร้างเปลี่ยน
 */

export type PrizeType =
  | "first"
  | "first_near"
  | "front_three"
  | "last_three"
  | "last_two";

export interface ParsedNumber {
  prizeType: PrizeType;
  number: string;
  position: number;
}

export interface ParsedDraw {
  drawDate: string;      // ISO YYYY-MM-DD (AD)
  drawDateTh: string;    // "1 เมษายน 2569"
  sourceUrl: string;
  numbers: ParsedNumber[];
}

const THAI_MONTHS: Record<string, number> = {
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
  "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
  "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
};

const THAI_MONTH_NAMES = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** ดึงรายการ URL งวดล่าสุดจากหน้า listing ของ sanook */
export async function listSanookArchiveUrls(
  base: string,
  ua: string,
  limit = 2,
): Promise<string[]> {
  const res = await fetch(`${base}/archive/`, {
    headers: { "User-Agent": ua, "Accept-Language": "th-TH,th;q=0.9" },
    cf: { cacheTtl: 1800, cacheEverything: true },
  });
  if (!res.ok) return [];
  const html = await res.text();
  // ลิงก์รูปแบบ /lotto/check/DDMMYYYY/
  const re = /\/lotto\/check\/(\d{8})\/?/g;
  const set = new Set<string>();
  for (const m of html.matchAll(re)) {
    set.add(`${base}/check/${m[1]}/`);
    if (set.size >= limit) break;
  }
  return Array.from(set);
}

/** Parse หน้าผลรางวัลเดียว */
export function parseSanookDrawPage(rawHtml: string, sourceUrl: string): ParsedDraw | null {
  // Normalize: strip tags + decode common entities + collapse ช่องว่างระหว่างตัวเลข
  // เพื่อให้ pattern เช่น "<span>3</span><span>0</span>..." กลายเป็น "30..." ที่ regex จับได้
  const html = normalizeHtml(rawHtml);

  // หา date heading ของ "งวดที่กำลัง scrape" จริง ๆ (ไม่ใช่ widget ผลล่าสุด
  // ที่อยู่ส่วนบนของหน้า archive เก่า) — ใช้วันที่จาก URL เป็น anchor ก่อน
  // แล้วค่อย fallback เป็น regex ทั่วไปสำหรับ source ที่ไม่มีวันที่ใน path
  const expected = parseSanookCheckDate(sourceUrl);
  let dateIdx = -1;
  let dateLen = 0;
  let day = 0;
  let monthName = "";
  let yearBe = 0;

  if (expected) {
    const candidates = [
      `งวดวันที่ ${expected.day} ${expected.monthName} ${expected.yearBe}`,
      `งวดประจำวันที่ ${expected.day} ${expected.monthName} ${expected.yearBe}`,
    ];
    for (const c of candidates) {
      const i = html.indexOf(c);
      if (i >= 0 && (dateIdx < 0 || i < dateIdx)) {
        dateIdx = i;
        dateLen = c.length;
      }
    }
    if (dateIdx >= 0) {
      day = expected.day;
      monthName = expected.monthName;
      yearBe = expected.yearBe;
    }
  }

  if (dateIdx < 0) {
    const dateMatch = html.match(
      /งวด(?:ประจำ|)วันที่\s*(\d{1,2})\s*([฀-๿]+)\s*(\d{4})/,
    );
    if (!dateMatch) return null;
    day = Number(dateMatch[1]);
    monthName = dateMatch[2];
    yearBe = Number(dateMatch[3]);
    dateIdx = dateMatch.index ?? 0;
    dateLen = dateMatch[0].length;
  }

  const month = THAI_MONTHS[monthName];
  if (!month) return null;
  const yearAd = yearBe - 543;
  const drawDate = `${yearAd}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const drawDateTh = `${day} ${monthName} ${yearBe}`;

  const numbers: ParsedNumber[] = [];

  // หน้าผลของ sanook สำหรับงวดเก่ามักมี "ผลล่าสุด" widget ตอนต้นหน้า ทำให้
  // selector ทุกชนิด (class, label, position) จับเลขจาก widget แทนของจริง — เลื่อน
  // จุดเริ่มทุกการค้นหาให้อยู่หลัง date heading ก่อนเสมอ
  const dateEnd = dateIdx + dateLen;
  const htmlAfter = html.slice(dateEnd);

  // ฝั่ง raw HTML ก็เลื่อนจุดเริ่มเหมือนกัน — ใช้ทั้ง drawDateTh ("16 มกราคม 2563")
  // และ "งวดวันที่ 16 มกราคม 2563" เป็น anchor; เก็บค่าที่เร็วที่สุดที่เจอ
  const rawAfter = sliceRawAfterDate(rawHtml, day, monthName, yearBe);

  // รางวัลที่ 1 — ลองหลายกลยุทธ์เรียงลำดับจากน่าเชื่อถือมากไปน้อย:
  //   (1) class-based จาก raw HTML: sanook ใช้ `lotto--black` สำหรับรางวัลที่ 1
  //   (2) label proximity: เลข 6 หลักถัดจาก "รางวัลที่ 1" ที่ไม่ได้อยู่ใต้ "ข้างเคียง"
  //   (3) positional: เลข 6 หลักแรกในช่วง htmlAfter ก่อน "รางวัลข้างเคียง"
  const firstPrize = extractFirstPrize(rawAfter, htmlAfter);
  if (firstPrize) numbers.push({ prizeType: "first", number: firstPrize, position: 0 });

  // รางวัลข้างเคียงรางวัลที่ 1 — เลข 6 หลัก 2 หมายเลข
  const nearBlock = sliceBetween(htmlAfter, "รางวัลข้างเคียงรางวัลที่ 1", "รางวัลที่ 2", 4000)
    ?? sliceBetween(htmlAfter, "รางวัลข้างเคียงรางวัลที่ 1", "เลขหน้า 3 ตัว", 4000);
  if (nearBlock) {
    const six = Array.from(nearBlock.matchAll(/(?<!\d)(\d{6})(?!\d)/g)).map((m) => m[1]);
    six.slice(0, 2).forEach((n, i) =>
      numbers.push({ prizeType: "first_near", number: n, position: i }),
    );
  }

  // เลขหน้า 3 ตัว
  const frontThree = extractAfterMarker(
    htmlAfter, "เลขหน้า 3 ตัว", "เลขท้าย 3 ตัว", /(?<!\d)(\d{3})(?!\d)/g, 2,
  );
  frontThree.forEach((n, i) =>
    numbers.push({ prizeType: "front_three", number: n, position: i }),
  );

  // เลขท้าย 3 ตัว
  const lastThree = extractAfterMarker(
    htmlAfter, "เลขท้าย 3 ตัว", "เลขท้าย 2 ตัว", /(?<!\d)(\d{3})(?!\d)/g, 2,
  );
  lastThree.forEach((n, i) =>
    numbers.push({ prizeType: "last_three", number: n, position: i }),
  );

  // เลขท้าย 2 ตัว
  const lastTwoBlock = sliceBetween(htmlAfter, "เลขท้าย 2 ตัว", "</body", 4000)
    ?? sliceBetween(htmlAfter, "เลขท้าย 2 ตัว", "รางวัลที่ 2", 4000);
  if (lastTwoBlock) {
    const two = lastTwoBlock.match(/(?<!\d)(\d{2})(?!\d)/);
    if (two) numbers.push({ prizeType: "last_two", number: two[1], position: 0 });
  }

  if (!numbers.length) return null;

  return { drawDate, drawDateTh, sourceUrl, numbers };
}

// ───────────── helpers ─────────────
function normalizeHtml(html: string): string {
  return (
    html
      // ลบ script/style content ออกก่อน กัน regex หลงไปเจอเลขใน inline JS
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      // strip HTML tags
      .replace(/<[^>]+>/g, " ")
      // decode common entities
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      // ลบ token จำนวนเงินรางวัลที่มี thousand-separator (เช่น "4,000", "100,000",
      // "6,000,000") ทิ้งทั้งก้อน — sanook โชว์ "รางวัลละ N บาท" ในทุกหมวด ถ้าปล่อยไว้
      // regex จับเลขรางวัลจะหยิบเอา "000" / "100000" จาก token เหล่านี้แทนของจริง
      .replace(/\d{1,3}(?:,\d{3})+/g, " ")
      // collapse whitespace ที่อยู่ "ระหว่างตัวเลขที่แยกเป็นหลักเดี่ยว" ให้ติดกัน
      // "3 0 9 6 1 2" → "309612" (หน้าที่แต่ละหลักอยู่ใน span แยก)
      // เงื่อนไข: ทุกหลักคั่นด้วย whitespace หลักเดียว (\d( \d)+) เพื่อไม่ให้เผลอรวม
      // สองหมายเลขที่อยู่ติดกันเช่น "355 868" → "355868"
      .replace(/(?<!\d)\d(?:\s+\d){2,}(?!\d)/g, (m) => m.replace(/\s+/g, ""))
      // ลด whitespace ซ้ำ ๆ
      .replace(/[ \t]+/g, " ")
  );
}

/**
 * ดึงรางวัลที่ 1 แบบหลายกลยุทธ์ — คืน string 6 หลักหรือ null
 *
 * @param rawAfter  raw HTML นับจากหลัง date heading (ลด false-positive จาก
 *                  widget "ผลล่าสุด" ตอนต้นหน้า)
 * @param htmlAfter HTML ที่ผ่าน normalizeHtml แล้ว นับจากหลัง date heading
 */
function extractFirstPrize(rawAfter: string, htmlAfter: string): string | null {
  // (1) class-based: sanook ใช้ <div class="lotto__number lotto--black">XXXXXX</div>
  //     จับช่วง ~1000 ตัวอักษรหลัง opening tag แล้วดึงเลข 6 หลักแรก
  //     (รองรับทั้งกรณีเลขอยู่ต่อกันและกรณีแยกเป็น span ทีละหลัก)
  const classRe = /class\s*=\s*"[^"]*\blotto--black\b[^"]*"[^>]*>([\s\S]{0,1000})/g;
  for (const m of rawAfter.matchAll(classRe)) {
    const text = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/(?<!\d)\d(?:\s+\d){2,}(?!\d)/g, (s) => s.replace(/\s+/g, ""));
    const six = text.match(/(?<!\d)(\d{6})(?!\d)/);
    if (six) return six[1];
  }

  // (2) label proximity: หา "รางวัลที่ 1" ที่ "ไม่ใช่" ส่วนของ "ข้างเคียงรางวัลที่ 1"
  //     แล้วเอาเลข 6 หลักถัดไปภายในช่วงสั้น ๆ
  const label = "รางวัลที่ 1";
  let cursor = 0;
  while (cursor < htmlAfter.length) {
    const i = htmlAfter.indexOf(label, cursor);
    if (i < 0) break;
    const before = htmlAfter.slice(Math.max(0, i - 20), i);
    cursor = i + label.length;
    if (before.includes("ข้างเคียง")) continue;
    const window = htmlAfter.slice(cursor, Math.min(cursor + 500, htmlAfter.length));
    const six = window.match(/(?<!\d)(\d{6})(?!\d)/);
    if (six) return six[1];
  }

  // (3) positional: เลข 6 หลักแรกก่อน "รางวัลข้างเคียง"
  const nearIdx = htmlAfter.indexOf("รางวัลข้างเคียง");
  const end = nearIdx >= 0 ? nearIdx : Math.min(5000, htmlAfter.length);
  const region = htmlAfter.slice(0, end);
  const six = region.match(/(?<!\d)(\d{6})(?!\d)/);
  return six ? six[1] : null;
}

/**
 * คืนช่วง raw HTML ที่อยู่หลัง date heading "งวดวันที่ DD <month> YYYY".
 * เลือก index ที่เร็วที่สุดที่เจอข้อความนั้น — ถ้าไม่พบ (เช่น tag คั่นกลาง
 * ทำให้ raw HTML ไม่มี substring ตรงตัว) คืน rawHtml ทั้งก้อนเป็น fallback
 * เพื่อไม่ให้ pipeline เสียทั้งหมด
 */
function sliceRawAfterDate(
  rawHtml: string,
  day: number,
  monthName: string,
  yearBe: number,
): string {
  const candidates = [
    `งวดวันที่ ${day} ${monthName} ${yearBe}`,
    `งวดประจำวันที่ ${day} ${monthName} ${yearBe}`,
  ];
  let best = -1;
  for (const c of candidates) {
    const i = rawHtml.indexOf(c);
    if (i >= 0 && (best < 0 || i < best)) best = i + c.length;
  }
  return best >= 0 ? rawHtml.slice(best) : rawHtml;
}

/**
 * ดึงวันที่ของงวดจาก sanook check URL เช่น
 *   https://news.sanook.com/lotto/check/16012563/  →  day=16, month=มกราคม, yearBe=2563
 * คืน null ถ้า URL ไม่ตรง pattern
 */
function parseSanookCheckDate(
  url: string,
): { day: number; monthName: string; yearBe: number } | null {
  const m = url.match(/\/check\/(\d{2})(\d{2})(\d{4})\/?/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const yearBe = Number(m[3]);
  if (month < 1 || month > 12) return null;
  return { day, monthName: THAI_MONTH_NAMES[month], yearBe };
}

function sliceBetween(s: string, startMarker: string, endMarker: string, maxLen = 2000): string | null {
  const i = s.indexOf(startMarker);
  if (i < 0) return null;
  const j = s.indexOf(endMarker, i + startMarker.length);
  const end = j < 0 ? i + maxLen : Math.min(j, i + maxLen);
  return s.slice(i + startMarker.length, end);
}

/**
 * Walk every occurrence of `startMarker` and return the first slice that
 * yields at least one regex match. Use when sanook's page has the marker
 * label duplicated (e.g. in a TOC or sticky nav before the actual results
 * card) — the first occurrence's slice may be empty/decorative.
 */
function extractAfterMarker(
  s: string,
  startMarker: string,
  endMarker: string,
  regex: RegExp,
  count: number,
  maxLen = 4000,
): string[] {
  let cursor = 0;
  while (cursor < s.length) {
    const i = s.indexOf(startMarker, cursor);
    if (i < 0) return [];
    const j = s.indexOf(endMarker, i + startMarker.length);
    const end = j < 0 ? i + maxLen : Math.min(j, i + maxLen);
    const block = s.slice(i + startMarker.length, end);
    const matches = Array.from(block.matchAll(regex)).map((m) => m[1]);
    if (matches.length >= 1) return matches.slice(0, count);
    cursor = i + startMarker.length;
  }
  return [];
}
