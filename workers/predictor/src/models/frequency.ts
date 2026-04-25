import type { HistoricalNumber, Prediction } from "../types";

/**
 * โมเดล Frequency — ให้คะแนนหมายเลขตามความถี่การปรากฏในช่วง N งวดล่าสุด
 * ใช้ exponential decay weight เพื่อให้งวดใหม่มีน้ำหนักกว่างวดเก่า
 *
 * ขอบเขต: ใช้ได้เฉพาะกับเลขที่ "เคยซ้ำ" ภายใน window (raw count > 1)
 * เพราะถ้าเลขส่วนใหญ่ปรากฏแค่ครั้งเดียว (เช่น เลข 6 หลักของรางวัลที่ 1
 * ที่ space=10^6 ≫ windowSize) สัญญาณจะกลายเป็น "ความใหม่" แทน "ความถี่"
 * และทำให้โมเดลแนะนำเลขที่เพิ่งออกงวดก่อนเป็นอันดับ 1 เสมอ
 */
export function frequencyModel(
  history: HistoricalNumber[],
  opts: { windowSize?: number; topK?: number; halfLife?: number } = {},
): Prediction[] {
  const windowSize = opts.windowSize ?? 60;
  const topK = opts.topK ?? 10;
  const halfLife = opts.halfLife ?? 30;

  // sort desc, take window
  const sorted = [...history].sort((a, b) => (a.drawDate < b.drawDate ? 1 : -1));
  const window = sorted.slice(0, windowSize);

  const rawCounts = new Map<string, number>();
  const weighted = new Map<string, number>();
  const decayBase = Math.pow(0.5, 1 / halfLife);
  window.forEach((n, idx) => {
    const w = Math.pow(decayBase, idx);
    rawCounts.set(n.number, (rawCounts.get(n.number) ?? 0) + 1);
    weighted.set(n.number, (weighted.get(n.number) ?? 0) + w);
  });

  // ตัดเลขที่ปรากฏครั้งเดียวออก — count=1 คือ "เคยเห็น" ไม่ใช่ "ถี่"
  // ในพื้นที่หมายเลขที่กว้าง (เช่น 10^6 สำหรับรางวัลที่ 1) ทุกเลขจะมี count=1
  // ทำให้โมเดลคืนค่า empty และ ensemble จะ re-normalize น้ำหนักไปยังโมเดลอื่น
  const repeated = Array.from(weighted.entries()).filter(
    ([n]) => (rawCounts.get(n) ?? 0) > 1,
  );
  if (repeated.length === 0) return [];

  const total = repeated.reduce((s, [, v]) => s + v, 0) || 1;
  const ranked = repeated
    .map(([number, w]) => ({ number, score: w / total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const maxScore = ranked[0]?.score ?? 1;
  return ranked.map((r, i) => ({
    number: r.number,
    score: Math.min(1, r.score / maxScore),
    rank: i + 1,
    model: "frequency",
    reason: `ออกบ่อยใน ${windowSize} งวดล่าสุด`,
  }));
}
