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
export function parseSanookDrawPage(html: string, sourceUrl: string): ParsedDraw | null {
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

  // รางวัลที่ 1 — เลข 6 หลักหลังคำว่า "รางวัลที่ 1"
  const first = matchAfter(html, /รางวัลที่\s*1[^0-9]{0,200}?(\d{6})/);
  if (first) numbers.push({ prizeType: "first", number: first, position: 0 });

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
function matchAfter(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1] : null;
}

function sliceBetween(s: string, startMarker: string, endMarker: string, maxLen = 2000): string | null {
  const i = s.indexOf(startMarker);
  if (i < 0) return null;
  const j = s.indexOf(endMarker, i + startMarker.length);
  const end = j < 0 ? i + maxLen : Math.min(j, i + maxLen);
  return s.slice(i + startMarker.length, end);
}
