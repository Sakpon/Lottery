import type { Prediction } from "../types";

/**
 * รวมผลจากทุกโมเดลด้วย weighted sum
 * weights ใช้ค่าที่ทดสอบแล้วให้ผลพอใช้ได้กับข้อมูลย้อนหลัง (ปรับเพิ่มภายหลังได้)
 */
export function ensemble(
  inputs: { predictions: Prediction[]; weight: number }[],
  opts: { topK?: number } = {},
): Prediction[] {
  const topK = opts.topK ?? 10;
  const scores = new Map<string, { score: number; reasons: string[] }>();

  for (const { predictions, weight } of inputs) {
    for (const p of predictions) {
      const cur = scores.get(p.number) ?? { score: 0, reasons: [] };
      cur.score += p.score * weight;
      if (p.reason) cur.reasons.push(`${p.model}: ${p.reason}`);
      scores.set(p.number, cur);
    }
  }

  const ranked = Array.from(scores.entries())
    .map(([number, v]) => ({ number, score: v.score, reasons: v.reasons }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const maxScore = ranked[0]?.score ?? 1;
  return ranked.map((r, i) => ({
    number: r.number,
    score: Math.min(1, r.score / maxScore),
    rank: i + 1,
    model: "ensemble",
    reason: r.reasons.slice(0, 3).join(" • "),
  }));
}
