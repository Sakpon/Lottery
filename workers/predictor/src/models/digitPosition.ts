import type { HistoricalNumber, Prediction } from "../types";

/**
 * โมเดล Digit-position — ดูความถี่ของตัวเลขในแต่ละตำแหน่ง
 * ตัวอย่าง: เลขท้าย 3 ตัว — หาเลข 0-9 ที่พบบ่อยในหลักร้อย/สิบ/หน่วย
 * แล้วประกอบกลับเป็น candidate ที่มีคะแนนสูง
 */
export function digitPositionModel(
  history: HistoricalNumber[],
  opts: { topK?: number; windowSize?: number } = {},
): Prediction[] {
  const topK = opts.topK ?? 10;
  const windowSize = opts.windowSize ?? 120;
  if (history.length === 0) return [];
  const digits = history[0].number.length;

  const sorted = [...history].sort((a, b) => (a.drawDate < b.drawDate ? 1 : -1));
  const window = sorted.slice(0, windowSize);

  // counts[pos][digit] = freq
  const counts: number[][] = Array.from({ length: digits }, () =>
    Array(10).fill(0),
  );
  for (const n of window) {
    for (let p = 0; p < digits; p++) {
      const d = Number(n.number[p]);
      if (!isNaN(d)) counts[p][d] += 1;
    }
  }

  // normalize เป็นความน่าจะเป็น
  const probs: number[][] = counts.map((row) => {
    const s = row.reduce((a, b) => a + b, 0) || 1;
    return row.map((c) => c / s);
  });

  // สร้าง candidate: ลอง top-3 ของแต่ละตำแหน่ง → Cartesian
  const topPerPos: number[][] = probs.map((row) =>
    row
      .map((p, d) => ({ d, p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 3)
      .map((x) => x.d),
  );

  const candidates: { number: string; score: number }[] = [];
  const walk = (i: number, acc: string, score: number) => {
    if (i === digits) {
      candidates.push({ number: acc, score });
      return;
    }
    for (const d of topPerPos[i]) {
      walk(i + 1, acc + d, score * probs[i][d]);
    }
  };
  walk(0, "", 1);

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, topK);
  const maxScore = top[0]?.score ?? 1;

  return top.map((c, i) => ({
    number: c.number,
    score: Math.min(1, c.score / maxScore),
    rank: i + 1,
    model: "digit_position",
    reason: "ตัวเลขที่ถี่ในแต่ละตำแหน่ง",
  }));
}
