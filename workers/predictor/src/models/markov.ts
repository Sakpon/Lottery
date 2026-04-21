import type { HistoricalNumber, Prediction } from "../types";

/**
 * โมเดล Markov (first-order) — P(เลขงวดนี้ | เลขงวดก่อน)
 * เหมาะกับหมายเลขพื้นที่เล็ก เช่น เลขท้าย 2 ตัว (100 สถานะ)
 */
export function markovModel(
  history: HistoricalNumber[],
  opts: { topK?: number } = {},
): Prediction[] {
  const topK = opts.topK ?? 10;
  if (history.length < 3) return [];

  // sort asc by drawDate เพื่อสร้างเส้นทาง transitions
  const asc = [...history].sort((a, b) => (a.drawDate < b.drawDate ? -1 : 1));

  // transitions[prev] = Map<next, count>
  const transitions = new Map<string, Map<string, number>>();
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1].number;
    const next = asc[i].number;
    if (!transitions.has(prev)) transitions.set(prev, new Map());
    const m = transitions.get(prev)!;
    m.set(next, (m.get(next) ?? 0) + 1);
  }

  const latest = asc[asc.length - 1].number;
  const dist = transitions.get(latest);
  if (!dist || dist.size === 0) {
    // fallback: ความถี่รวม
    const counts = new Map<string, number>();
    asc.forEach((n) => counts.set(n.number, (counts.get(n.number) ?? 0) + 1));
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);
    const total = sorted.reduce((s, x) => s + x[1], 0) || 1;
    return sorted.map(([n, c], i) => ({
      number: n,
      score: c / total,
      rank: i + 1,
      model: "markov",
      reason: "ไม่มีข้อมูลหลังเลขก่อนหน้า — ใช้ความถี่รวม",
    }));
  }

  const total = Array.from(dist.values()).reduce((s, v) => s + v, 0) || 1;
  const ranked = Array.from(dist.entries())
    .map(([n, c]) => ({ number: n, score: c / total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked.map((r, i) => ({
    number: r.number,
    score: r.score,
    rank: i + 1,
    model: "markov",
    reason: `เคยตามหลัง ${latest}`,
  }));
}
