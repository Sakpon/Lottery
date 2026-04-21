import type { HistoricalNumber, Prediction } from "../types";

/**
 * โมเดล Frequency — ให้คะแนนหมายเลขตามความถี่การปรากฏในช่วง N งวดล่าสุด
 * ใช้ exponential decay weight เพื่อให้งวดใหม่มีน้ำหนักกว่างวดเก่า
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

  const counts = new Map<string, number>();
  const decayBase = Math.pow(0.5, 1 / halfLife);
  window.forEach((n, idx) => {
    const w = Math.pow(decayBase, idx);
    counts.set(n.number, (counts.get(n.number) ?? 0) + w);
  });

  const total = Array.from(counts.values()).reduce((s, v) => s + v, 0) || 1;
  const ranked = Array.from(counts.entries())
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
