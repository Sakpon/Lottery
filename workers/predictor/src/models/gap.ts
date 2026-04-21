import type { HistoricalNumber, Prediction } from "../types";

/**
 * โมเดล Gap Analysis — หาเลขที่ "ค้างนาน" (ไม่ออกมาหลายงวด)
 * แนวคิด: หากเลขไม่ออกมา > ค่าเฉลี่ย gap ของมัน → โอกาสจะออกเพิ่มขึ้น (gambler's view)
 * หมายเหตุ: ในความเป็นจริง การสุ่มไม่มีหน่วยความจำ แต่เราจัดให้เป็นอีกมุมมอง
 */
export function gapModel(
  history: HistoricalNumber[],
  opts: { topK?: number; digits?: number } = {},
): Prediction[] {
  const topK = opts.topK ?? 10;

  // list งวดทั้งหมด (desc)
  const sorted = [...history].sort((a, b) => (a.drawDate < b.drawDate ? 1 : -1));
  if (sorted.length === 0) return [];

  const allNumbers = new Set<string>(sorted.map((n) => n.number));
  // หาทุกเลขที่มีอยู่ในระบบทศนิยมจำนวนหลักเดียวกัน
  const digits = opts.digits ?? (sorted[0].number.length);
  const universe = enumerateNumbers(digits);

  const lastSeenIdx = new Map<string, number>();
  sorted.forEach((n, i) => {
    if (!lastSeenIdx.has(n.number)) lastSeenIdx.set(n.number, i);
  });

  const scored = universe.map((num) => {
    const seenAt = lastSeenIdx.get(num);
    // ถ้าไม่เคยเห็นเลย — gap = ∞ (ให้คะแนนสูง แต่ไม่สุดขีด)
    const gap = seenAt === undefined ? sorted.length * 1.5 : seenAt;
    return { number: num, gap };
  });

  scored.sort((a, b) => b.gap - a.gap);
  const top = scored.slice(0, topK);
  const maxGap = top[0]?.gap ?? 1;

  return top.map((t, i) => ({
    number: t.number,
    score: Math.min(1, t.gap / maxGap),
    rank: i + 1,
    model: "gap",
    reason: `ไม่ออก ${Math.round(t.gap)} งวด`,
  }));
}

function enumerateNumbers(digits: number): string[] {
  const max = Math.pow(10, digits);
  const arr: string[] = [];
  for (let i = 0; i < max; i++) arr.push(String(i).padStart(digits, "0"));
  return arr;
}
