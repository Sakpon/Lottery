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

  // ดึง title/heading → "งวดวันที่ 1 เมษายน 2569"
  const dateMatch = html.match(
    /งวด(?:ประจำ|)วันที่\s*(\d{1,2})\s*([฀-๿]+)\s*(\d{4})/,
  );
  if (!dateMatch) return null;
  const day = Number(dateMatch[1]);
  const monthName = dateMatch[2];
  const yearBe = Number(dateMatch[3]);
  const month = THAI_MONTHS[monthName];
  if (!month) return null;
  const yearAd = yearBe - 543;
  const drawDate = `${yearAd}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const drawDateTh = `${day} ${monthName} ${yearBe}`;

  const numbers: ParsedNumber[] = [];

  // รางวัลที่ 1 — ลองหลายกลยุทธ์เรียงลำดับจากน่าเชื่อถือมากไปน้อย:
  //   (1) class-based จาก raw HTML: sanook ใช้ `lotto--black` สำหรับรางวัลที่ 1
  //   (2) label proximity: เลข 6 หลักถัดจาก "รางวัลที่ 1" ที่ไม่ได้อยู่ใต้ "ข้างเคียง"
  //   (3) positional: เลข 6 หลักแรกระหว่าง date heading กับ "รางวัลข้างเคียง"
  const firstPrize = extractFirstPrize(rawHtml, html, dateMatch.index ?? 0, dateMatch[0].length);
  if (firstPrize) numbers.push({ prizeType: "first", number: firstPrize, position: 0 });

  // รางวัลข้างเคียงรางวัลที่ 1 — เลข 6 หลัก 2 หมายเลข
  const nearBlock = sliceBetween(html, "รางวัลข้างเคียงรางวัลที่ 1", "รางวัลที่ 2", 4000)
    ?? sliceBetween(html, "รางวัลข้างเคียงรางวัลที่ 1", "เลขหน้า 3 ตัว", 4000);
  if (nearBlock) {
    const six = Array.from(nearBlock.matchAll(/(?<!\d)(\d{6})(?!\d)/g)).map((m) => m[1]);
    six.slice(0, 2).forEach((n, i) =>
      numbers.push({ prizeType: "first_near", number: n, position: i }),
    );
  }

  // เลขหน้า 3 ตัว
  const frontBlock = sliceBetween(html, "เลขหน้า 3 ตัว", "เลขท้าย 3 ตัว", 4000);
  if (frontBlock) {
    const three = Array.from(frontBlock.matchAll(/(?<!\d)(\d{3})(?!\d)/g)).map((m) => m[1]);
    three.slice(0, 2).forEach((n, i) =>
      numbers.push({ prizeType: "front_three", number: n, position: i }),
    );
  }

  // เลขท้าย 3 ตัว
  const backBlock = sliceBetween(html, "เลขท้าย 3 ตัว", "เลขท้าย 2 ตัว", 4000);
  if (backBlock) {
    const three = Array.from(backBlock.matchAll(/(?<!\d)(\d{3})(?!\d)/g)).map((m) => m[1]);
    three.slice(0, 2).forEach((n, i) =>
      numbers.push({ prizeType: "last_three", number: n, position: i }),
    );
  }

  // เลขท้าย 2 ตัว
  const lastTwoBlock = sliceBetween(html, "เลขท้าย 2 ตัว", "</body", 4000)
    ?? sliceBetween(html, "เลขท้าย 2 ตัว", "รางวัลที่ 2", 4000);
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
 * @param rawHtml  HTML ดิบ (ยังไม่ strip tags) — ใช้จับ class="lotto--black"
 * @param html     HTML ที่ผ่าน normalizeHtml แล้ว — ใช้จับด้วย label/position
 * @param dateIdx  ดัชนีเริ่มต้นของ date heading ใน html
 * @param dateLen  ความยาวของ date heading ที่ match ได้
 */
function extractFirstPrize(
  rawHtml: string,
  html: string,
  dateIdx: number,
  dateLen: number,
): string | null {
  // (1) class-based: sanook ใช้ <div class="lotto__number lotto--black">XXXXXX</div>
  //     จับช่วง ~1000 ตัวอักษรหลัง opening tag แล้วดึงเลข 6 หลักแรก
  //     (รองรับทั้งกรณีเลขอยู่ต่อกันและกรณีแยกเป็น span ทีละหลัก)
  const classRe = /class\s*=\s*"[^"]*\blotto--black\b[^"]*"[^>]*>([\s\S]{0,1000})/g;
  for (const m of rawHtml.matchAll(classRe)) {
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
  while (cursor < html.length) {
    const i = html.indexOf(label, cursor);
    if (i < 0) break;
    const before = html.slice(Math.max(0, i - 20), i);
    cursor = i + label.length;
    if (before.includes("ข้างเคียง")) continue;
    const window = html.slice(cursor, Math.min(cursor + 500, html.length));
    const six = window.match(/(?<!\d)(\d{6})(?!\d)/);
    if (six) return six[1];
  }

  // (3) positional: เลข 6 หลักแรกระหว่าง date heading กับ "รางวัลข้างเคียง"
  const dateEnd = dateIdx + dateLen;
  const nearIdx = html.indexOf("รางวัลข้างเคียง", dateEnd);
  const end = nearIdx >= 0 ? nearIdx : Math.min(dateEnd + 5000, html.length);
  const region = html.slice(dateEnd, end);
  const six = region.match(/(?<!\d)(\d{6})(?!\d)/);
  return six ? six[1] : null;
}

function sliceBetween(s: string, startMarker: string, endMarker: string, maxLen = 2000): string | null {
  const i = s.indexOf(startMarker);
  if (i < 0) return null;
  const j = s.indexOf(endMarker, i + startMarker.length);
  const end = j < 0 ? i + maxLen : Math.min(j, i + maxLen);
  return s.slice(i + startMarker.length, end);
}
